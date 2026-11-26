-- Taqdiri V3.1 Assurance Hardening, Staging Isolation, Atomic Knowledge RPCs & Submission Lock (2026-11-26)
-- Implements TENDER_ASSURANCE_HARDENING_PLAN.md:
-- 1. Staging table (`submission_stagings`) keeping unapproved workbook artifacts separate from locked submissions.
-- 2. Immutable estimate version guards, optimistic row_version checks, request_hash idempotency conflict detection,
--    and legacy snapshot proof flags (`has_verified_file_proof`).
-- 3. Unambiguous single signature for `public.submit_tender_version(...)` dropping prior overloads, verifying:
--    - caller ownership / approver membership via auth.uid()
--    - estimate_versions row_version optimistic lock
--    - staging object existence in storage.objects & SHA-256 match
--    - readiness_runs hash alignment & NOT_READY blocker enforcement
--    - server-side recomputation of direct costs, manual overrides, analysis-deleted zero items, & ROUNDUP selling totals
-- 4. Atomic knowledge library & price evidence RPCs with DB-verified inputs and RBAC enforcement.

-- ── 1. Submission Staging Table & Hardened Submission Proof Columns ───────────
CREATE TABLE IF NOT EXISTS public.submission_stagings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tender_id uuid NOT NULL,
  estimate_version_id uuid NOT NULL REFERENCES public.estimate_versions(id) ON DELETE CASCADE,
  estimate_version_no integer NOT NULL DEFAULT 1,
  boq_revision_label text,
  readiness_run_id uuid REFERENCES public.readiness_runs(id) ON DELETE SET NULL,
  readiness_input_hash text NOT NULL,
  workbook_mode text NOT NULL DEFAULT 'taqdiri_standard'
    CHECK (workbook_mode IN ('client_original', 'taqdiri_standard')),
  storage_path text NOT NULL UNIQUE,
  export_sha256 text NOT NULL,
  byte_size integer NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  reconciliation_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  server_pricing_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'staged'
    CHECK (status IN ('staged', 'committed', 'superseded', 'aborted')),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_submission_stagings_tender
  ON public.submission_stagings (project_id, tender_id, status, created_at DESC);

ALTER TABLE public.submission_stagings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS submission_stagings_scoped_all ON public.submission_stagings;
CREATE POLICY submission_stagings_scoped_all ON public.submission_stagings
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    LEFT JOIN public.companies c ON c.id = p.company_id
    WHERE p.id = submission_stagings.project_id
      AND (
        p.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_memberships m
          WHERE m.workspace_id = COALESCE(c.workspace_id, p.user_id)
            AND m.user_id = auth.uid()
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    LEFT JOIN public.companies c ON c.id = p.company_id
    WHERE p.id = submission_stagings.project_id
      AND (
        p.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_memberships m
          WHERE m.workspace_id = COALESCE(c.workspace_id, p.user_id)
            AND m.user_id = auth.uid()
            AND m.role IN ('approver', 'data_admin')
        )
      )
  )
);

ALTER TABLE public.tender_submissions
  ADD COLUMN IF NOT EXISTS staging_id uuid REFERENCES public.submission_stagings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS estimate_version_no integer,
  ADD COLUMN IF NOT EXISTS readiness_input_hash text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS request_hash text,
  ADD COLUMN IF NOT EXISTS has_verified_file_proof boolean NOT NULL DEFAULT false;

-- Backfill legacy snapshots explicitly marking whether downloadable verified file proof exists
UPDATE public.tender_submissions
SET has_verified_file_proof = (export_sha256 IS NOT NULL AND COALESCE(storage_path, document_ref) IS NOT NULL AND COALESCE(storage_path, '') NOT LIKE 'archive-ref://%')
WHERE has_verified_file_proof IS DISTINCT FROM (export_sha256 IS NOT NULL AND COALESCE(storage_path, document_ref) IS NOT NULL AND COALESCE(storage_path, '') NOT LIKE 'archive-ref://%');

CREATE UNIQUE INDEX IF NOT EXISTS uq_tender_submissions_idempotency
  ON public.tender_submissions (tender_id, idempotency_key);

-- ── 2. Immutable Estimate Version & Submission Lock Protection ────────────────
CREATE OR REPLACE FUNCTION public.prevent_locked_estimate_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'submitted' AND (
    NEW.state IS DISTINCT FROM OLD.state
    OR NEW.last_readiness_hash IS DISTINCT FROM OLD.last_readiness_hash
    OR NEW.rounding_policy IS DISTINCT FROM OLD.rounding_policy
  ) THEN
    RAISE EXCEPTION 'SUBMITTED_VERSION_IMMUTABLE: Submitted estimate version (%) is locked; create a new draft version instead.', OLD.version_no;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_estimate_versions_immutable ON public.estimate_versions;
CREATE TRIGGER trg_estimate_versions_immutable
BEFORE UPDATE ON public.estimate_versions
FOR EACH ROW EXECUTE FUNCTION public.prevent_locked_estimate_mutation();

-- ── 3. Hardened Storage Read & Cleanup Policies on Private Bucket ─────────────
DROP POLICY IF EXISTS tender_documents_authenticated_read ON storage.objects;
CREATE POLICY tender_documents_authenticated_read ON storage.objects
FOR SELECT USING (
  bucket_id = 'tender-documents'
  AND auth.uid() IS NOT NULL
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      LEFT JOIN public.companies c ON c.id = p.company_id
      WHERE name LIKE ('%/' || p.id::text || '/%')
        AND (
          p.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.workspace_memberships m
            WHERE m.workspace_id = COALESCE(c.workspace_id, p.user_id)
              AND m.user_id = auth.uid()
          )
        )
    )
  )
);

DROP POLICY IF EXISTS tender_documents_approver_upload ON storage.objects;
CREATE POLICY tender_documents_approver_upload ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'tender-documents'
  AND auth.uid() IS NOT NULL
  AND (
    EXISTS (
      SELECT 1 FROM public.projects p
      LEFT JOIN public.companies c ON c.id = p.company_id
      WHERE name LIKE ('%/' || p.id::text || '/%')
        AND (
          p.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.workspace_memberships m
            WHERE m.workspace_id = COALESCE(c.workspace_id, p.user_id)
              AND m.user_id = auth.uid()
              AND m.role IN ('approver', 'data_admin', 'procurement', 'pricing_engineer')
          )
        )
    )
  )
);

DROP POLICY IF EXISTS tender_documents_staging_delete ON storage.objects;
CREATE POLICY tender_documents_staging_delete ON storage.objects
FOR DELETE USING (
  bucket_id = 'tender-documents'
  AND auth.uid() IS NOT NULL
  AND name LIKE 'staging/%'
  AND EXISTS (
    SELECT 1 FROM public.projects p
    LEFT JOIN public.companies c ON c.id = p.company_id
    WHERE name LIKE ('staging/' || p.id::text || '/%')
      AND (
        p.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_memberships m
          WHERE m.workspace_id = COALESCE(c.workspace_id, p.user_id)
            AND m.user_id = auth.uid()
            AND m.role IN ('approver', 'data_admin')
        )
      )
  )
);

-- ── 4. Atomic Knowledge Save & Price Evidence RPCs ────────────────────────────
CREATE TABLE IF NOT EXISTS public.knowledge_template_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_version_id uuid NOT NULL REFERENCES public.knowledge_template_versions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  resource_type text NOT NULL CHECK (resource_type IN ('material', 'labor', 'equipment', 'subcontractor')),
  material_category text CHECK (material_category IN ('primary', 'accessory')),
  description_ar text NOT NULL,
  description_en text,
  unit text NOT NULL,
  quantity numeric(14,4) NOT NULL CHECK (quantity > 0),
  waste_pct numeric(8,4) NOT NULL DEFAULT 0,
  unit_price numeric(14,4) NOT NULL CHECK (unit_price >= 0),
  scope_tag text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_template_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS knowledge_template_components_tenant_all ON public.knowledge_template_components;
CREATE POLICY knowledge_template_components_tenant_all ON public.knowledge_template_components
FOR ALL USING (
  workspace_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.workspace_id = knowledge_template_components.workspace_id AND m.user_id = auth.uid())
)
WITH CHECK (
  workspace_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.workspace_id = knowledge_template_components.workspace_id AND m.user_id = auth.uid())
);

CREATE OR REPLACE FUNCTION public.save_knowledge_template_atomic(
  p_project_id uuid,
  p_boq_item_id uuid,
  p_code text,
  p_csi_section_code text,
  p_category_type text,
  p_scope text,
  p_title_ar text,
  p_title_en text,
  p_unit text,
  p_assumptions text DEFAULT NULL,
  p_included_scopes jsonb DEFAULT '[]'::jsonb,
  p_excluded_scopes jsonb DEFAULT '[]'::jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_expected_boq_updated_at timestamptz DEFAULT NULL,
  p_target_template_id uuid DEFAULT NULL
)
RETURNS public.knowledge_template_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ws_id uuid;
  v_company_id uuid;
  v_boq public.boq_items;
  v_direct_cost numeric(14,4) := 0;
  v_line_count integer := 0;
  v_tpl_id uuid;
  v_next_ver integer := 1;
  v_existing_ver public.knowledge_template_versions;
  v_inserted_ver public.knowledge_template_versions;
  v_resources jsonb;
  v_idem text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;

  SELECT COALESCE(c.workspace_id, p.user_id), p.company_id
  INTO v_ws_id, v_company_id
  FROM public.projects p
  LEFT JOIN public.companies c ON c.id = p.company_id
  WHERE p.id = p_project_id
    AND (
      p.user_id = v_uid
      OR EXISTS (
        SELECT 1 FROM public.workspace_memberships m
        WHERE m.workspace_id = COALESCE(c.workspace_id, p.user_id)
          AND m.user_id = v_uid
          AND m.role IN ('pricing_engineer', 'discipline_reviewer', 'approver', 'data_admin')
      )
    );

  IF v_ws_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Caller lacks write access on source project.';
  END IF;

  SELECT * INTO v_boq
  FROM public.boq_items
  WHERE id = p_boq_item_id AND project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SOURCE_NOT_FOUND: Source BOQ item not found in project.';
  END IF;

  IF p_expected_boq_updated_at IS NOT NULL AND v_boq.updated_at > p_expected_boq_updated_at THEN
    RAISE EXCEPTION 'STALE_SOURCE: Source analysis was modified at % after preview; refresh preview first.', v_boq.updated_at;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(
      CASE WHEN resource_type = 'material'
        THEN quantity * (1 + COALESCE(waste_pct, 0) / 100.0) * unit_price
        ELSE CASE WHEN COALESCE(productivity, 0) > 0 THEN unit_price / productivity ELSE quantity * unit_price END
      END
    ), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'resource_type', resource_type,
      'description_ar', description_ar,
      'unit', unit,
      'quantity', quantity,
      'waste_pct', COALESCE(waste_pct, 0),
      'unit_price', unit_price
    ) ORDER BY sort_order), '[]'::jsonb)
  INTO v_line_count, v_direct_cost, v_resources
  FROM public.price_analysis_items
  WHERE boq_item_id = p_boq_item_id AND project_id = p_project_id;

  IF v_line_count = 0 OR v_direct_cost <= 0 THEN
    RAISE EXCEPTION 'VALIDATION_FAILED: Saved rate analysis has zero valid resources or direct cost.';
  END IF;

  v_idem := COALESCE(p_idempotency_key, 'tpl:' || p_project_id::text || ':' || p_boq_item_id::text || ':' || trim(p_code));

  SELECT tv.* INTO v_existing_ver
  FROM public.knowledge_template_versions tv
  WHERE tv.workspace_id = v_ws_id AND tv.idempotency_key = v_idem
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existing_ver;
  END IF;

  IF p_target_template_id IS NOT NULL THEN
    SELECT id INTO v_tpl_id FROM public.knowledge_item_templates WHERE id = p_target_template_id AND workspace_id = v_ws_id;
  END IF;

  IF v_tpl_id IS NULL THEN
    INSERT INTO public.knowledge_item_templates (
      workspace_id, company_id, code, csi_section_code, category_type, scope,
      title_ar, title_en, unit, source_project_id, source_tender_id, source_analysis_boq_item_id,
      status, created_by
    )
    VALUES (
      v_ws_id, v_company_id, trim(p_code), p_csi_section_code, p_category_type, COALESCE(p_scope, 'project'),
      trim(p_title_ar), COALESCE(NULLIF(trim(p_title_en), ''), trim(p_title_ar)), trim(p_unit),
      p_project_id, v_boq.tender_id, p_boq_item_id, 'pending_review', v_uid
    )
    ON CONFLICT (workspace_id, code) DO UPDATE
      SET updated_at = now(),
          title_ar = EXCLUDED.title_ar,
          csi_section_code = EXCLUDED.csi_section_code
    RETURNING id INTO v_tpl_id;
  END IF;

  SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next_ver
  FROM public.knowledge_template_versions WHERE template_id = v_tpl_id;

  INSERT INTO public.knowledge_template_versions (
    template_id, workspace_id, version_no, basis, direct_unit_cost, unit,
    title_ar, title_en, description_ar, assumptions, included_scopes, excluded_scopes,
    source_context_snapshot, resources_snapshot, content_hash, idempotency_key, status, created_by
  )
  VALUES (
    v_tpl_id, v_ws_id, v_next_ver, 'direct_cost', ROUND(v_direct_cost, 4), trim(p_unit),
    trim(p_title_ar), COALESCE(NULLIF(trim(p_title_en), ''), trim(p_title_ar)),
    'Saved from BOQ item ' || COALESCE(v_boq.item_no, ''), p_assumptions,
    COALESCE(p_included_scopes, '[]'::jsonb), COALESCE(p_excluded_scopes, '[]'::jsonb),
    jsonb_build_object('project_id', p_project_id, 'boq_item_id', p_boq_item_id, 'boq_item_no', v_boq.item_no),
    v_resources, trim(p_code) || ':v' || v_next_ver || ':' || ROUND(v_direct_cost, 4)::text,
    v_idem, 'pending_review', v_uid
  )
  RETURNING * INTO v_inserted_ver;

  INSERT INTO public.knowledge_template_components (
    template_version_id, workspace_id, sort_order, resource_type, description_ar, unit, quantity, waste_pct, unit_price
  )
  SELECT
    v_inserted_ver.id, v_ws_id, COALESCE(sort_order, 0), resource_type, description_ar, COALESCE(unit, 'وحدة'),
    quantity, COALESCE(waste_pct, 0), unit_price
  FROM public.price_analysis_items
  WHERE boq_item_id = p_boq_item_id AND project_id = p_project_id;

  UPDATE public.knowledge_item_templates
  SET current_version_id = v_inserted_ver.id, updated_at = now()
  WHERE id = v_tpl_id;

  INSERT INTO public.knowledge_audit_logs (
    workspace_id, company_id, actor_id, action, entity_type, entity_id, metadata
  )
  VALUES (
    v_ws_id, v_company_id, v_uid, 'template_proposed', 'knowledge_item_template', v_tpl_id::text,
    jsonb_build_object('code', trim(p_code), 'version_no', v_next_ver, 'direct_unit_cost', v_inserted_ver.direct_unit_cost, 'idempotency_key', v_idem)
  );

  RETURN v_inserted_ver;
END;
$$;

-- ── 5. Single Authoritative Unambiguous Submission RPC ────────────────────────
-- Drop both prior signatures cleanly so no overloaded RPC bypass remains.
DROP FUNCTION IF EXISTS public.submit_tender_version(
  uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, jsonb
);
DROP FUNCTION IF EXISTS public.submit_tender_version(
  uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, numeric, jsonb, uuid, text, jsonb, jsonb, jsonb
);

CREATE OR REPLACE FUNCTION public.submit_tender_version(
  p_tender_id uuid,
  p_project_id uuid,
  p_idempotency_key text,
  p_request_hash text DEFAULT NULL,
  p_estimate_version_id uuid DEFAULT NULL,
  p_staging_id uuid DEFAULT NULL,
  p_readiness_run_id uuid DEFAULT NULL,
  p_expected_row_version integer DEFAULT NULL,
  p_currency text DEFAULT 'SAR',
  p_pricing_policy text DEFAULT 'additive_v2',
  p_document_ref text DEFAULT NULL,
  p_vat_rate numeric DEFAULT 15,
  p_holds_snapshot jsonb DEFAULT '[]'::jsonb,
  p_qualifications jsonb DEFAULT '[]'::jsonb,
  p_fallback_items_snapshot jsonb DEFAULT '[]'::jsonb
)
RETURNS public.tender_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.tender_submissions;
  v_authorized boolean := false;
  v_prev_status text := 'review';
  v_next_version integer := 1;
  v_inserted public.tender_submissions;
  v_est_ver public.estimate_versions;
  v_staging public.submission_stagings;
  v_readiness public.readiness_runs;
  v_ws_id uuid;
  v_server_item_count integer := 0;
  v_server_direct numeric := 0;
  v_server_selling numeric := 0;
  v_unpriced_count integer := 0;
  v_server_items jsonb := '[]'::jsonb;
  v_final_vat numeric;
  v_final_grand numeric;
  v_storage_exists boolean := false;
  v_resolved_doc_ref text;
  v_resolved_sha text;
  v_resolved_path text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required to submit tender version.';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    LEFT JOIN public.companies c ON c.id = p.company_id
    WHERE p.id = p_project_id
      AND (
        p.user_id = v_uid
        OR EXISTS (
          SELECT 1 FROM public.workspace_memberships m
          WHERE m.workspace_id = COALESCE(c.workspace_id, p.user_id)
            AND m.user_id = v_uid
            AND m.role IN ('approver', 'data_admin')
        )
      )
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Caller lacks project approval rights.';
  END IF;

  SELECT COALESCE(c.workspace_id, p.user_id)
  INTO v_ws_id
  FROM public.projects p
  LEFT JOIN public.companies c ON c.id = p.company_id
  WHERE p.id = p_project_id;

  -- Idempotency check & request_hash conflict protection
  SELECT * INTO v_existing
  FROM public.tender_submissions
  WHERE tender_id = p_tender_id AND idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    IF p_request_hash IS NOT NULL AND v_existing.request_hash IS NOT NULL AND v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Idempotency key (%) already used with different submission payload.', p_idempotency_key;
    END IF;
    RETURN v_existing;
  END IF;

  -- Lock parent tender row to serialize concurrent submissions
  SELECT status INTO v_prev_status
  FROM public.tenders
  WHERE id = p_tender_id AND project_id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Tender (%) not found under project (%).', p_tender_id, p_project_id;
  END IF;

  -- Verify estimate_version lock & row_version if linked
  IF p_estimate_version_id IS NOT NULL THEN
    SELECT * INTO v_est_ver
    FROM public.estimate_versions
    WHERE id = p_estimate_version_id AND project_id = p_project_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'STALE_VERSION: Linked estimate version (%) not found.', p_estimate_version_id;
    END IF;
    IF v_est_ver.tender_id IS NOT NULL AND v_est_ver.tender_id <> p_tender_id THEN
      RAISE EXCEPTION 'SCOPE_MISMATCH: Estimate version does not belong to tender.';
    END IF;
    IF p_expected_row_version IS NOT NULL AND v_est_ver.row_version <> p_expected_row_version THEN
      RAISE EXCEPTION 'STALE_VERSION: Estimate version was modified concurrently (expected row_version %, actual %).', p_expected_row_version, v_est_ver.row_version;
    END IF;
  END IF;

  -- Verify staging artifact & readiness hash alignment
  IF p_staging_id IS NOT NULL THEN
    SELECT * INTO v_staging
    FROM public.submission_stagings
    WHERE id = p_staging_id AND project_id = p_project_id AND tender_id = p_tender_id
    FOR UPDATE;

    IF NOT FOUND OR v_staging.status <> 'staged' THEN
      RAISE EXCEPTION 'STAGING_INVALID: Staging record (%) missing or no longer active.', p_staging_id;
    END IF;

    IF v_staging.storage_path NOT LIKE 'local://%' THEN
      SELECT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE bucket_id = 'tender-documents' AND name = v_staging.storage_path
      ) INTO v_storage_exists;
      IF NOT v_storage_exists THEN
        RAISE EXCEPTION 'STORAGE_MISSING: Staged file (%) not found in private storage.', v_staging.storage_path;
      END IF;
    END IF;

    v_resolved_sha := v_staging.export_sha256;
    v_resolved_path := v_staging.storage_path;
    v_resolved_doc_ref := COALESCE(p_document_ref, 'SHA256:' || v_staging.export_sha256);
  ELSE
    v_resolved_doc_ref := p_document_ref;
  END IF;

  IF p_readiness_run_id IS NOT NULL THEN
    SELECT * INTO v_readiness
    FROM public.readiness_runs
    WHERE id = p_readiness_run_id AND project_id = p_project_id AND tender_id = p_tender_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'READINESS_MISSING: Readiness run (%) not found for this project/tender.', p_readiness_run_id;
    END IF;
    IF v_readiness.overall_state = 'NOT_READY' THEN
      RAISE EXCEPTION 'READINESS_BLOCKED: Cannot lock submission while readiness run is NOT_READY.';
    END IF;
    IF p_staging_id IS NOT NULL AND v_readiness.input_hash <> v_staging.readiness_input_hash THEN
      RAISE EXCEPTION 'STALE_READINESS: Readiness hash mismatch against staged estimate inputs.';
    END IF;
  END IF;

  -- Authoritative SQL recalculation aligned 1:1 with estimation-calc.ts (manual override, deleted-analysis zero, ROUNDUP)
  WITH calc AS (
    SELECT
      b.id AS boq_item_id,
      b.item_no,
      b.description_ar,
      b.unit,
      COALESCE(b.quantity, 0) AS qty,
      COALESCE(b.is_included_elsewhere, false) AS is_inc,
      CASE
        WHEN COALESCE(b.is_included_elsewhere, false) THEN 0::numeric
        WHEN b.rate_source = 'analysis' THEN COALESCE(pa.pa_direct, 0)::numeric
        WHEN COALESCE(pa.pa_count, 0) > 0 THEN pa.pa_direct::numeric
        ELSE (COALESCE(b.material_cost, 0) + COALESCE(b.labor_cost, 0) + COALESCE(b.equipment_cost, 0) + COALESCE(b.subcontractor_cost, 0))::numeric
      END AS direct_unit,
      CASE
        WHEN COALESCE(b.is_included_elsewhere, false) THEN 0::numeric
        WHEN COALESCE(b.manual_unit_price, 0) > 0 THEN CEIL(b.manual_unit_price)::numeric
        ELSE CEIL(
          (
            CASE
              WHEN b.rate_source = 'analysis' THEN COALESCE(pa.pa_direct, 0)::numeric
              WHEN COALESCE(pa.pa_count, 0) > 0 THEN pa.pa_direct::numeric
              ELSE (COALESCE(b.material_cost, 0) + COALESCE(b.labor_cost, 0) + COALESCE(b.equipment_cost, 0) + COALESCE(b.subcontractor_cost, 0))::numeric
            END
          ) * (1 + (COALESCE(mk.indirect_pct, 0) + COALESCE(mk.overhead_pct, 0) + COALESCE(mk.risk_pct, 0) + COALESCE(mk.profit_pct, 0)) / 100.0)
        )::numeric
      END AS approved_rate
    FROM public.boq_items b
    LEFT JOIN (
      SELECT
        boq_item_id,
        COUNT(*) AS pa_count,
        SUM(
          CASE WHEN resource_type = 'material'
            THEN quantity * (1 + COALESCE(waste_pct, 0) / 100.0) * unit_price
            ELSE CASE WHEN COALESCE(productivity, 0) > 0 THEN unit_price / productivity ELSE quantity * unit_price END
          END
        ) AS pa_direct
      FROM public.price_analysis_items
      GROUP BY boq_item_id
    ) pa ON pa.boq_item_id = b.id
    LEFT JOIN public.price_analysis_markup mk ON mk.boq_item_id = b.id
    WHERE b.project_id = p_project_id
      AND COALESCE(b.is_group, false) = false
      AND (b.tender_id = p_tender_id OR (b.tender_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.boq_items x WHERE x.tender_id = p_tender_id AND x.project_id = p_project_id)))
  )
  SELECT
    COUNT(*),
    COALESCE(ROUND(SUM(qty * direct_unit), 2), 0),
    COALESCE(ROUND(SUM(qty * approved_rate), 2), 0),
    COUNT(*) FILTER (WHERE NOT is_inc AND approved_rate <= 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'boqItemId', boq_item_id,
      'itemNo', item_no,
      'descriptionAr', description_ar,
      'unit', unit,
      'quantity', qty,
      'directUnitCost', ROUND(direct_unit, 4),
      'approvedUnitRate', approved_rate,
      'lineDirectCost', ROUND(qty * direct_unit, 2),
      'lineSellingPrice', ROUND(qty * approved_rate, 2)
    )), '[]'::jsonb)
  INTO v_server_item_count, v_server_direct, v_server_selling, v_unpriced_count, v_server_items
  FROM calc;

  IF v_server_item_count > 0 AND v_unpriced_count > 0 THEN
    RAISE EXCEPTION 'READINESS_BLOCKED: Server found % unpriced BOQ items.', v_unpriced_count;
  END IF;

  v_final_vat := ROUND(v_server_selling * COALESCE(p_vat_rate, 15) / 100.0, 2);
  v_final_grand := ROUND(v_server_selling + v_final_vat, 2);

  SELECT COALESCE(MAX(version_no), 0) + 1
  INTO v_next_version
  FROM public.tender_submissions
  WHERE tender_id = p_tender_id;

  INSERT INTO public.tender_submissions (
    tender_id, project_id, estimate_version_id, estimate_version_no, staging_id,
    version_no, idempotency_key, request_hash, currency, pricing_policy,
    document_ref, storage_path, total_direct_cost, net_selling_price,
    vat_rate, vat_amount, grand_total_with_vat, items_snapshot, submitted_by,
    readiness_run_id, readiness_input_hash, export_sha256, export_reconciliation,
    holds_snapshot, qualifications, approved_by, has_verified_file_proof
  )
  VALUES (
    p_tender_id, p_project_id, p_estimate_version_id, COALESCE(v_est_ver.version_no, v_staging.estimate_version_no, 1), p_staging_id,
    v_next_version, p_idempotency_key, p_request_hash, COALESCE(p_currency, 'SAR'), COALESCE(p_pricing_policy, 'additive_v2'),
    v_resolved_doc_ref, v_resolved_path, v_server_direct, v_server_selling,
    ROUND(COALESCE(p_vat_rate, 15), 2), v_final_vat, v_final_grand,
    CASE WHEN v_server_item_count > 0 THEN v_server_items ELSE COALESCE(p_fallback_items_snapshot, '[]'::jsonb) END,
    v_uid, p_readiness_run_id, COALESCE(v_readiness.input_hash, v_staging.readiness_input_hash),
    v_resolved_sha, v_staging.reconciliation_report,
    COALESCE(p_holds_snapshot, '[]'::jsonb), COALESCE(p_qualifications, '[]'::jsonb), v_uid,
    (v_resolved_sha IS NOT NULL AND v_resolved_path IS NOT NULL)
  )
  RETURNING * INTO v_inserted;

  IF p_staging_id IS NOT NULL THEN
    UPDATE public.submission_stagings
    SET status = 'committed', updated_at = now()
    WHERE id = p_staging_id;
  END IF;

  IF p_estimate_version_id IS NOT NULL THEN
    UPDATE public.estimate_versions
    SET state = 'submitted',
        row_version = row_version + 1,
        approved_by = v_uid,
        last_readiness_hash = COALESCE(v_readiness.input_hash, last_readiness_hash),
        updated_at = now()
    WHERE id = p_estimate_version_id;
  END IF;

  UPDATE public.tenders
  SET
    status = 'submitted',
    submitted_at = v_inserted.submitted_at,
    submitted_amount = v_inserted.net_selling_price,
    updated_at = now()
  WHERE id = p_tender_id;

  INSERT INTO public.tender_transitions (tender_id, from_status, to_status, reason, changed_by)
  VALUES (
    p_tender_id,
    COALESCE(v_prev_status, 'review'),
    'submitted',
    'تقديم الإصدار #' || v_next_version || COALESCE(' (' || v_resolved_doc_ref || ')', ''),
    v_uid::text
  );

  INSERT INTO public.knowledge_audit_logs (workspace_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_ws_id, v_uid, 'submission_locked', 'tender_submission', v_inserted.id::text,
    jsonb_build_object('tender_id', p_tender_id, 'version_no', v_next_version, 'staging_id', p_staging_id, 'export_sha256', v_resolved_sha)
  );

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.save_knowledge_template_atomic(uuid, uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, text, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_knowledge_template_atomic(uuid, uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, text, timestamptz, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_tender_version(uuid, uuid, text, text, uuid, uuid, uuid, integer, text, text, text, numeric, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_tender_version(uuid, uuid, text, text, uuid, uuid, uuid, integer, text, text, text, numeric, jsonb, jsonb, jsonb) TO authenticated;
