-- Taqdiri CSI 01-10 Assemblies, Supplier Quotes & Scope Lineage Migration (2026-11-25)
-- Implements CSI_01_10_ASSEMBLIES_PLAN.md Sections 4.1, 4.4, and 4.5:
-- 1. Extend supplier_quotes & supplier_quote_items with price validity, city, VAT, transport,
--    unit conversion factors, scope tags, minimum order charge, and shift hours.
-- 2. Extend price_analysis_items with explicit supplier_quote_id, quote_item_id, scope_tag,
--    rate_kind (supply/install/composite/reference), and execution_method.
-- 3. Add assembly_coverage_records to track BOQ <-> CSI 01-10 assembly coverage and gaps.

-- ── 1. Extend supplier_quotes & supplier_quote_items ───────────────────────────
ALTER TABLE public.supplier_quotes
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'quoted'
    CHECK (status IN ('quoted', 'reference', 'expired')),
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS vat_included boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transport_included boolean NOT NULL DEFAULT true;

ALTER TABLE public.supplier_quote_items
  ADD COLUMN IF NOT EXISTS scope_tag text,
  ADD COLUMN IF NOT EXISTS unit_conversion_factor numeric(14,6) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_unit text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS vat_included boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transport_included boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS min_order_qty numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_order_charge numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shift_hours numeric(8,2) NOT NULL DEFAULT 8;

-- ── 2. Extend price_analysis_items for Quote Line & Scope Traceability ─────────
ALTER TABLE public.price_analysis_items
  ADD COLUMN IF NOT EXISTS supplier_quote_id uuid REFERENCES public.supplier_quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quote_item_id uuid REFERENCES public.supplier_quote_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope_tag text,
  ADD COLUMN IF NOT EXISTS rate_kind text CHECK (rate_kind IN ('supply', 'install', 'composite', 'reference')),
  ADD COLUMN IF NOT EXISTS execution_method text;

CREATE INDEX IF NOT EXISTS idx_price_analysis_items_quote_item
  ON public.price_analysis_items (quote_item_id)
  WHERE quote_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_price_analysis_items_scope_tag
  ON public.price_analysis_items (boq_item_id, scope_tag)
  WHERE scope_tag IS NOT NULL;

-- ── 3. Assembly Coverage Registry (BOQ <-> CSI 01-10 Lineage) ──────────────────
CREATE TABLE IF NOT EXISTS public.assembly_coverage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  boq_item_id uuid NOT NULL REFERENCES public.boq_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  assembly_id text NOT NULL,
  assembly_code text,
  assembly_version integer NOT NULL DEFAULT 1,
  csi_division text,
  coverage_status text NOT NULL DEFAULT 'matched'
    CHECK (coverage_status IN ('matched', 'gap', 'manual', 'reference_only')),
  included_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, boq_item_id)
);

ALTER TABLE public.assembly_coverage_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assembly_coverage_owner_select ON public.assembly_coverage_records;
CREATE POLICY assembly_coverage_owner_select ON public.assembly_coverage_records
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = assembly_coverage_records.project_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS assembly_coverage_owner_write ON public.assembly_coverage_records;
CREATE POLICY assembly_coverage_owner_write ON public.assembly_coverage_records
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = assembly_coverage_records.project_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = assembly_coverage_records.project_id AND p.user_id = auth.uid()
  )
);
