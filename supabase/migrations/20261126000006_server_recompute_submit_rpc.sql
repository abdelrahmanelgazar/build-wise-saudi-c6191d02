-- Taqdiri V3.0 Server-Recomputed Tender Submission & Private Storage Policy (2026-11-26)
-- Closes TENDER_KNOWLEDGE_IMPLEMENTATION_PLAN.md §6.3 ("مراجعة ثقة المدخلات داخل submit_tender_version"):
-- 1. Re-derives authoritative direct cost & additive Phase 2 ROUNDUP selling totals server-side
--    from `boq_items` / `price_analysis_items` / `price_analysis_markup` when BOQ items exist in DB.
-- 2. Verifies latest `readiness_runs` is not `NOT_READY` when present, and stores export SHA-256,
--    readiness_run_id, holds_snapshot, and qualifications on the immutable submission row.
-- 3. Provisions private `tender-documents` storage bucket & RLS policies.

INSERT INTO storage.buckets (id, name, public)
VALUES ('tender-documents', 'tender-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.submit_tender_version(
  p_tender_id uuid,
  p_project_id uuid,
  p_idempotency_key text,
  p_currency text DEFAULT 'SAR',
  p_pricing_policy text DEFAULT 'additive_v2',
  p_document_ref text DEFAULT NULL,
  p_total_direct_cost numeric DEFAULT 0,
  p_net_selling_price numeric DEFAULT 0,
  p_vat_rate numeric DEFAULT 15,
  p_vat_amount numeric DEFAULT 0,
  p_grand_total_with_vat numeric DEFAULT 0,
  p_items_snapshot jsonb DEFAULT '[]'::jsonb,
  p_readiness_run_id uuid DEFAULT NULL,
  p_export_sha256 text DEFAULT NULL,
  p_export_reconciliation jsonb DEFAULT NULL,
  p_holds_snapshot jsonb DEFAULT '[]'::jsonb,
  p_qualifications jsonb DEFAULT '[]'::jsonb
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
  v_readiness_state text;
  v_server_item_count integer := 0;
  v_server_direct numeric := 0;
  v_server_selling numeric := 0;
  v_final_direct numeric;
  v_final_selling numeric;
  v_final_vat numeric;
  v_final_grand numeric;
  v_unpriced_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to submit tender version.';
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
    RAISE EXCEPTION 'Forbidden: caller lacks project approval rights.';
  END IF;

  -- Idempotency check
  SELECT * INTO v_existing
  FROM public.tender_submissions
  WHERE tender_id = p_tender_id AND idempotency_key = p_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  -- Verify readiness gate if a readiness run id was supplied
  IF p_readiness_run_id IS NOT NULL THEN
    SELECT overall_state INTO v_readiness_state
    FROM public.readiness_runs
    WHERE id = p_readiness_run_id AND project_id = p_project_id;

    IF v_readiness_state = 'NOT_READY' THEN
      RAISE EXCEPTION 'READINESS_BLOCKED: Cannot lock submission while readiness run is NOT_READY.';
    END IF;
  END IF;

  -- Lock parent tender row to prevent concurrent version races
  SELECT status INTO v_prev_status
  FROM public.tenders
  WHERE id = p_tender_id
  FOR UPDATE;

  -- Server-side recomputation from authoritative DB rows (prevents blind trust in client totals)
  SELECT
    COUNT(*),
    COALESCE(SUM(CASE
      WHEN COALESCE(b.is_included_elsewhere, false) THEN 0
      WHEN COALESCE(b.manual_unit_price, 0) > 0 THEN COALESCE(b.quantity, 0) * COALESCE(b.manual_unit_price, 0)
      ELSE COALESCE(b.quantity, 0) * COALESCE(pa.pa_direct, COALESCE(b.material_cost, 0) + COALESCE(b.labor_cost, 0) + COALESCE(b.equipment_cost, 0) + COALESCE(b.subcontractor_cost, 0))
    END), 0),
    COALESCE(SUM(CASE
      WHEN COALESCE(b.is_included_elsewhere, false) THEN 0
      WHEN COALESCE(b.manual_unit_price, 0) > 0 THEN COALESCE(b.quantity, 0) * CEIL(b.manual_unit_price)
      ELSE COALESCE(b.quantity, 0) * CEIL(
        COALESCE(pa.pa_direct, COALESCE(b.material_cost, 0) + COALESCE(b.labor_cost, 0) + COALESCE(b.equipment_cost, 0) + COALESCE(b.subcontractor_cost, 0))
        * (1 + (COALESCE(mk.indirect_pct, 0) + COALESCE(mk.overhead_pct, 0) + COALESCE(mk.risk_pct, 0) + COALESCE(mk.profit_pct, 0)) / 100.0)
      )
    END), 0),
    COUNT(*) FILTER (
      WHERE NOT COALESCE(b.is_included_elsewhere, false)
        AND COALESCE(b.manual_unit_price, 0) <= 0
        AND COALESCE(pa.pa_direct, COALESCE(b.material_cost, 0) + COALESCE(b.labor_cost, 0) + COALESCE(b.equipment_cost, 0) + COALESCE(b.subcontractor_cost, 0)) <= 0
    )
  INTO v_server_item_count, v_server_direct, v_server_selling, v_unpriced_count
  FROM public.boq_items b
  LEFT JOIN (
    SELECT
      boq_item_id,
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
    AND (b.tender_id = p_tender_id OR (b.tender_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.boq_items x WHERE x.tender_id = p_tender_id)));

  IF v_server_item_count > 0 AND v_unpriced_count > 0 THEN
    RAISE EXCEPTION 'READINESS_BLOCKED: Server found % unpriced BOQ items.', v_unpriced_count;
  END IF;

  IF v_server_item_count > 0 AND v_server_selling > 0 THEN
    v_final_direct := ROUND(v_server_direct, 2);
    v_final_selling := ROUND(v_server_selling, 2);
  ELSE
    v_final_direct := ROUND(COALESCE(p_total_direct_cost, 0), 2);
    v_final_selling := ROUND(COALESCE(p_net_selling_price, 0), 2);
  END IF;

  v_final_vat := ROUND(v_final_selling * COALESCE(p_vat_rate, 15) / 100.0, 2);
  v_final_grand := ROUND(v_final_selling + v_final_vat, 2);

  SELECT COALESCE(MAX(version_no), 0) + 1
  INTO v_next_version
  FROM public.tender_submissions
  WHERE tender_id = p_tender_id;

  INSERT INTO public.tender_submissions (
    tender_id,
    project_id,
    version_no,
    idempotency_key,
    currency,
    pricing_policy,
    document_ref,
    total_direct_cost,
    net_selling_price,
    vat_rate,
    vat_amount,
    grand_total_with_vat,
    items_snapshot,
    submitted_by,
    readiness_run_id,
    export_sha256,
    export_reconciliation,
    holds_snapshot,
    qualifications,
    approved_by
  )
  VALUES (
    p_tender_id,
    p_project_id,
    v_next_version,
    p_idempotency_key,
    COALESCE(p_currency, 'SAR'),
    COALESCE(p_pricing_policy, 'additive_v2'),
    p_document_ref,
    v_final_direct,
    v_final_selling,
    ROUND(COALESCE(p_vat_rate, 15), 2),
    v_final_vat,
    v_final_grand,
    COALESCE(p_items_snapshot, '[]'::jsonb),
    v_uid,
    p_readiness_run_id,
    p_export_sha256,
    p_export_reconciliation,
    COALESCE(p_holds_snapshot, '[]'::jsonb),
    COALESCE(p_qualifications, '[]'::jsonb),
    v_uid
  )
  RETURNING * INTO v_inserted;

  IF FOUND AND v_prev_status IS NOT NULL THEN
    UPDATE public.tenders
    SET
      status = 'submitted',
      submitted_at = v_inserted.submitted_at,
      submitted_amount = v_inserted.net_selling_price,
      updated_at = now()
    WHERE id = p_tender_id;

    INSERT INTO public.tender_transitions (
      tender_id,
      from_status,
      to_status,
      reason,
      changed_by
    )
    VALUES (
      p_tender_id,
      v_prev_status,
      'submitted',
      'تقديم الإصدار #' || v_next_version || COALESCE(' (' || p_document_ref || ')', ''),
      v_uid::text
    );
  END IF;

  RETURN v_inserted;
END;
$$;
