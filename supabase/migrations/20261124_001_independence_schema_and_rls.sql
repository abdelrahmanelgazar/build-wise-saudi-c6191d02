-- Taqdiri Independent Schema Migration (2026-11-24)
-- Implements Section 2 of PLATFORM_INDEPENDENCE_AND_NAVIGATION_PLAN.md:
-- 1. Companies & Company-Client Links
-- 2. Explicit business columns migrating away from cell_styles workarounds
-- 3. Supplier quotes & versioned quote items
-- 4. Immutable tender_submissions + atomic submit_tender_version RPC
-- 5. Five-role workspace RBAC & RLS policies

-- ── 1. Companies & Links ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  name text NOT NULL,
  code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_client_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, company_id, client_id)
);

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_client_link_id uuid REFERENCES public.company_client_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_name text;

-- ── 2. Explicit Business Columns (Idempotent Backfill from cell_styles) ─────
ALTER TABLE public.boq_items
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS manual_unit_price numeric(14,4),
  ADD COLUMN IF NOT EXISTS is_included_elsewhere boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rate_source text CHECK (rate_source IN ('analysis', 'manual', 'imported', 'none')),
  ADD COLUMN IF NOT EXISTS pricing_status text CHECK (pricing_status IN ('priced', 'unpriced', 'included')),
  ADD COLUMN IF NOT EXISTS imported_unit_rate numeric(14,4);

UPDATE public.boq_items
SET note = COALESCE(note, cell_styles->>'note')
WHERE note IS NULL AND cell_styles ? 'note';

ALTER TABLE public.price_analysis_items
  ADD COLUMN IF NOT EXISTS material_category text CHECK (material_category IN ('primary', 'accessory')),
  ADD COLUMN IF NOT EXISTS quote_id uuid,
  ADD COLUMN IF NOT EXISTS quote_version integer,
  ADD COLUMN IF NOT EXISTS line_note text,
  ADD COLUMN IF NOT EXISTS copied_unit_price numeric(14,4),
  ADD COLUMN IF NOT EXISTS copied_unit text,
  ADD COLUMN IF NOT EXISTS consumption_rate numeric(14,6);

UPDATE public.price_analysis_items
SET
  material_category = COALESCE(
    material_category,
    CASE WHEN cell_styles->>'material_category' IN ('primary', 'accessory') THEN cell_styles->>'material_category' ELSE NULL END
  ),
  line_note = COALESCE(line_note, cell_styles->>'note', cell_styles->>'line_note')
WHERE (material_category IS NULL OR line_note IS NULL) AND cell_styles IS NOT NULL;

-- ── 3. Supplier Quotes & Versions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supplier_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  supplier_name text NOT NULL,
  quote_no text,
  quote_date date,
  currency text NOT NULL DEFAULT 'SAR',
  scope text,
  delivery_terms text,
  validity_date date,
  version_no integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.supplier_quotes(id) ON DELETE CASCADE,
  resource_id uuid,
  specification text NOT NULL,
  pricing_unit text NOT NULL,
  pack_size numeric(14,4) NOT NULL DEFAULT 1,
  pack_price numeric(14,4) NOT NULL DEFAULT 0,
  unit_price numeric(14,4) NOT NULL DEFAULT 0,
  waste_pct numeric(6,2) NOT NULL DEFAULT 0,
  terms text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 4. Immutable Tender Submissions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tender_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tender_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  version_no integer NOT NULL,
  idempotency_key text NOT NULL,
  currency text NOT NULL DEFAULT 'SAR',
  pricing_policy text NOT NULL DEFAULT 'additive_v2',
  document_ref text,
  total_direct_cost numeric(16,2) NOT NULL,
  net_selling_price numeric(16,2) NOT NULL,
  vat_rate numeric(6,2) NOT NULL DEFAULT 15,
  vat_amount numeric(16,2) NOT NULL,
  grand_total_with_vat numeric(16,2) NOT NULL,
  items_snapshot jsonb NOT NULL,
  submitted_by uuid NOT NULL DEFAULT auth.uid(),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tender_id, version_no),
  UNIQUE (tender_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION public.prevent_tender_submission_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Submitted tender versions are immutable; create a new revision instead.';
END;
$$;

DROP TRIGGER IF EXISTS trg_tender_submissions_immutable ON public.tender_submissions;
CREATE TRIGGER trg_tender_submissions_immutable
BEFORE UPDATE OR DELETE ON public.tender_submissions
FOR EACH ROW EXECUTE FUNCTION public.prevent_tender_submission_mutation();

-- ── 5. Five-Role Workspace RBAC ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_role') THEN
    CREATE TYPE public.workspace_role AS ENUM (
      'pricing_engineer',
      'procurement',
      'discipline_reviewer',
      'approver',
      'data_admin'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.workspace_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role public.workspace_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, role)
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_client_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;

-- Default-deny + scoped membership policies
CREATE POLICY companies_workspace_read ON public.companies
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = companies.workspace_id AND m.user_id = auth.uid()
  )
);

CREATE POLICY companies_data_admin_write ON public.companies
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = companies.workspace_id AND m.user_id = auth.uid() AND m.role = 'data_admin'
  )
);

CREATE POLICY tender_submissions_read ON public.tender_submissions
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = tender_submissions.project_id AND p.user_id = auth.uid()
  )
);

CREATE POLICY tender_submissions_approver_insert ON public.tender_submissions
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.user_id = auth.uid() AND m.role IN ('approver', 'data_admin')
  )
);
