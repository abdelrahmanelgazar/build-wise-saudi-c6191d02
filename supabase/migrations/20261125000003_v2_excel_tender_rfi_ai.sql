-- Taqdiri V2 Expansion Migration (2026-11-25)
-- Implements remaining roadmap capabilities across:
-- 1. EXCEL_BOQ_PRICING_PLAN.md: Original workbook versioning, SHA-256 checksum, cell-coordinate writeback & carry-forward row tagging
-- 2. TENDER_PLATFORM_DEVELOPMENT_PLAN.md: Per-tender pricing isolation (tender_id), RFI/Addenda tracking, and Go/No-Go evaluations

-- ── 1. BOQ Excel Workbook Versions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.boq_excel_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tender_id uuid REFERENCES public.tenders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  file_sha256 text NOT NULL,
  sheet_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  writeback_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  original_workbook_b64 text,
  imported_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boq_excel_versions_project
  ON public.boq_excel_versions (project_id, created_at DESC);

-- ── 2. Per-Tender Isolation & Excel Cell Traceability Columns ────────────────
ALTER TABLE public.boq_items
  ADD COLUMN IF NOT EXISTS tender_id uuid REFERENCES public.tenders(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS excel_version_id uuid REFERENCES public.boq_excel_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS excel_row_index integer,
  ADD COLUMN IF NOT EXISTS rate_cell_ref text,
  ADD COLUMN IF NOT EXISTS total_cell_ref text,
  ADD COLUMN IF NOT EXISTS note_cell_ref text,
  ADD COLUMN IF NOT EXISTS row_kind text NOT NULL DEFAULT 'item'
    CHECK (row_kind IN ('group', 'item', 'carry_forward', 'brought_forward', 'summary'));

CREATE INDEX IF NOT EXISTS idx_boq_items_project_tender
  ON public.boq_items (project_id, tender_id);

ALTER TABLE public.price_analysis_items
  ADD COLUMN IF NOT EXISTS tender_id uuid REFERENCES public.tenders(id) ON DELETE CASCADE;

ALTER TABLE public.price_analysis_markup
  ADD COLUMN IF NOT EXISTS tender_id uuid REFERENCES public.tenders(id) ON DELETE CASCADE;

ALTER TABLE public.assembly_coverage_records
  ADD COLUMN IF NOT EXISTS tender_id uuid REFERENCES public.tenders(id) ON DELETE CASCADE;

ALTER TABLE public.supplier_quotes
  ADD COLUMN IF NOT EXISTS tender_id uuid REFERENCES public.tenders(id) ON DELETE CASCADE;

-- ── 3. Project & Tender RFI / Addenda Log ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_rfi_addenda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tender_id uuid REFERENCES public.tenders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  entry_type text NOT NULL DEFAULT 'rfi' CHECK (entry_type IN ('rfi', 'addendum', 'clarification')),
  ref_no text NOT NULL,
  title text NOT NULL,
  question_text text,
  response_text text,
  impacted_boq_item_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  cost_impact_sar numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'answered', 'incorporated', 'closed')),
  due_date date,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_rfi_addenda_project
  ON public.project_rfi_addenda (project_id, created_at DESC);

-- ── 4. Tender Go / No-Go Evaluation Scorecard ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tender_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tender_id uuid REFERENCES public.tenders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  technical_fit_score integer NOT NULL DEFAULT 3 CHECK (technical_fit_score BETWEEN 1 AND 5),
  commercial_capacity_score integer NOT NULL DEFAULT 3 CHECK (commercial_capacity_score BETWEEN 1 AND 5),
  client_relationship_score integer NOT NULL DEFAULT 3 CHECK (client_relationship_score BETWEEN 1 AND 5),
  margin_attractiveness_score integer NOT NULL DEFAULT 3 CHECK (margin_attractiveness_score BETWEEN 1 AND 5),
  risk_exposure_score integer NOT NULL DEFAULT 3 CHECK (risk_exposure_score BETWEEN 1 AND 5),
  overall_score numeric(5,2) NOT NULL DEFAULT 60,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'go', 'conditional_go', 'no_go')),
  decision_rationale text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, tender_id)
);

-- ── 5. Row-Level Security Policies ───────────────────────────────────────────
ALTER TABLE public.boq_excel_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_rfi_addenda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS boq_excel_versions_owner_all ON public.boq_excel_versions;
CREATE POLICY boq_excel_versions_owner_all ON public.boq_excel_versions
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = boq_excel_versions.project_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = boq_excel_versions.project_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS project_rfi_addenda_owner_all ON public.project_rfi_addenda;
CREATE POLICY project_rfi_addenda_owner_all ON public.project_rfi_addenda
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_rfi_addenda.project_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = project_rfi_addenda.project_id AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS tender_evaluations_owner_all ON public.tender_evaluations;
CREATE POLICY tender_evaluations_owner_all ON public.tender_evaluations
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = tender_evaluations.project_id AND p.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = tender_evaluations.project_id AND p.user_id = auth.uid()
  )
);
