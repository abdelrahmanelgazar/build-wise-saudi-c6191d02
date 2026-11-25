-- Taqdiri RLS Completeness, Workspace Isolation & Atomic Tender Submission RPC (2026-11-26)
-- Addresses CLOUD_RELEASE_PLAN.md Section 2 (001 & 002 audit findings):
-- 1. Complete missing RLS policies for company_client_links, supplier_quotes, supplier_quote_items, workspace_memberships.
-- 2. Tighten tender_submissions_approver_insert & read policies to match workspace/project scope.
-- 3. Provide atomic transactional submit_tender_version RPC used by client-tender-service.ts.

-- ── 1. Workspace Memberships RLS Policies ─────────────────────────────────────
DROP POLICY IF EXISTS workspace_memberships_self_or_admin_read ON public.workspace_memberships;
CREATE POLICY workspace_memberships_self_or_admin_read ON public.workspace_memberships
FOR SELECT USING (
  user_id = auth.uid()
  OR workspace_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.workspace_memberships admin_m
    WHERE admin_m.workspace_id = workspace_memberships.workspace_id
      AND admin_m.user_id = auth.uid()
      AND admin_m.role = 'data_admin'
  )
);

DROP POLICY IF EXISTS workspace_memberships_admin_write ON public.workspace_memberships;
CREATE POLICY workspace_memberships_admin_write ON public.workspace_memberships
FOR ALL USING (
  workspace_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.workspace_memberships admin_m
    WHERE admin_m.workspace_id = workspace_memberships.workspace_id
      AND admin_m.user_id = auth.uid()
      AND admin_m.role = 'data_admin'
  )
)
WITH CHECK (
  workspace_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.workspace_memberships admin_m
    WHERE admin_m.workspace_id = workspace_memberships.workspace_id
      AND admin_m.user_id = auth.uid()
      AND admin_m.role = 'data_admin'
  )
);

-- ── 2. Company-Client Links RLS Policies ──────────────────────────────────────
DROP POLICY IF EXISTS company_client_links_workspace_read ON public.company_client_links;
CREATE POLICY company_client_links_workspace_read ON public.company_client_links
FOR SELECT USING (
  workspace_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = company_client_links.workspace_id AND m.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS company_client_links_data_admin_write ON public.company_client_links;
CREATE POLICY company_client_links_data_admin_write ON public.company_client_links
FOR ALL USING (
  workspace_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = company_client_links.workspace_id
      AND m.user_id = auth.uid()
      AND m.role = 'data_admin'
  )
)
WITH CHECK (
  workspace_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = company_client_links.workspace_id
      AND m.user_id = auth.uid()
      AND m.role = 'data_admin'
  )
);

-- ── 3. Supplier Quotes & Quote Items RLS Policies ─────────────────────────────
DROP POLICY IF EXISTS supplier_quotes_scoped_read ON public.supplier_quotes;
CREATE POLICY supplier_quotes_scoped_read ON public.supplier_quotes
FOR SELECT USING (
  workspace_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = supplier_quotes.workspace_id AND m.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = supplier_quotes.project_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS supplier_quotes_scoped_write ON public.supplier_quotes;
CREATE POLICY supplier_quotes_scoped_write ON public.supplier_quotes
FOR ALL USING (
  workspace_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = supplier_quotes.workspace_id
      AND m.user_id = auth.uid()
      AND m.role IN ('procurement', 'pricing_engineer', 'data_admin')
  )
  OR EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = supplier_quotes.project_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  workspace_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = supplier_quotes.workspace_id
      AND m.user_id = auth.uid()
      AND m.role IN ('procurement', 'pricing_engineer', 'data_admin')
  )
  OR EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = supplier_quotes.project_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS supplier_quote_items_scoped_all ON public.supplier_quote_items;
CREATE POLICY supplier_quote_items_scoped_all ON public.supplier_quote_items
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.supplier_quotes sq
    LEFT JOIN public.projects p ON p.id = sq.project_id
    WHERE sq.id = supplier_quote_items.quote_id
      AND (
        sq.workspace_id = auth.uid()
        OR p.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_memberships m
          WHERE m.workspace_id = sq.workspace_id AND m.user_id = auth.uid()
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.supplier_quotes sq
    LEFT JOIN public.projects p ON p.id = sq.project_id
    WHERE sq.id = supplier_quote_items.quote_id
      AND (
        sq.workspace_id = auth.uid()
        OR p.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_memberships m
          WHERE m.workspace_id = sq.workspace_id
            AND m.user_id = auth.uid()
            AND m.role IN ('procurement', 'pricing_engineer', 'data_admin')
        )
      )
  )
);

-- ── 4. Scoped Tender Submissions Policies ─────────────────────────────────────
DROP POLICY IF EXISTS tender_submissions_read ON public.tender_submissions;
CREATE POLICY tender_submissions_read ON public.tender_submissions
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    LEFT JOIN public.companies c ON c.id = p.company_id
    WHERE p.id = tender_submissions.project_id
      AND (
        p.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.workspace_memberships m
          WHERE m.workspace_id = COALESCE(c.workspace_id, p.user_id)
            AND m.user_id = auth.uid()
        )
      )
  )
);

DROP POLICY IF EXISTS tender_submissions_approver_insert ON public.tender_submissions;
CREATE POLICY tender_submissions_approver_insert ON public.tender_submissions
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    LEFT JOIN public.companies c ON c.id = p.company_id
    WHERE p.id = tender_submissions.project_id
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

-- ── 5. Atomic Transactional Tender Submission RPC ─────────────────────────────
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
  p_items_snapshot jsonb DEFAULT '[]'::jsonb
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
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to submit tender version.';
  END IF;

  -- Check ownership or workspace approver/data_admin role scoped strictly to target project
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

  -- Lock parent tender row if present to prevent concurrent version races
  SELECT status INTO v_prev_status
  FROM public.tenders
  WHERE id = p_tender_id
  FOR UPDATE;

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
    submitted_by
  )
  VALUES (
    p_tender_id,
    p_project_id,
    v_next_version,
    p_idempotency_key,
    COALESCE(p_currency, 'SAR'),
    COALESCE(p_pricing_policy, 'additive_v2'),
    p_document_ref,
    ROUND(COALESCE(p_total_direct_cost, 0), 2),
    ROUND(COALESCE(p_net_selling_price, 0), 2),
    ROUND(COALESCE(p_vat_rate, 15), 2),
    ROUND(COALESCE(p_vat_amount, 0), 2),
    ROUND(COALESCE(p_grand_total_with_vat, 0), 2),
    COALESCE(p_items_snapshot, '[]'::jsonb),
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
