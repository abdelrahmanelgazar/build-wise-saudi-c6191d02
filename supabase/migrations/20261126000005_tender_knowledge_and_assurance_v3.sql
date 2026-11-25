-- Taqdiri V3.0 Knowledge Libraries, Price Evidence, Assemblies, Indirect Costs,
-- Tender Readiness, Hold Management, Normalized Comparisons, BOQ Diffs & Submission Governance (2026-11-26)
-- Implements TENDER_KNOWLEDGE_IMPLEMENTATION_PLAN.md & Taqdeeri_Development_Master_Plan_V3.0.md.

-- ── 1. Knowledge Item Templates & Immutable Versions (DEV-301 / DEV-303 / DEV-305 / DEV-306) ──
CREATE TABLE IF NOT EXISTS public.knowledge_item_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  csi_section_code text,
  discipline text,
  category_type text NOT NULL DEFAULT 'project_item'
    CHECK (category_type IN ('section_item', 'project_item', 'indirect_cost', 'typical_assembly')),
  scope text NOT NULL DEFAULT 'project' CHECK (scope IN ('project', 'company')),
  title_ar text NOT NULL,
  title_en text,
  unit text NOT NULL,
  source_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  source_tender_id uuid REFERENCES public.tenders(id) ON DELETE SET NULL,
  source_analysis_boq_item_id uuid REFERENCES public.boq_items(id) ON DELETE SET NULL,
  current_version_id uuid,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'approved', 'archived')),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS public.knowledge_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.knowledge_item_templates(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  version_no integer NOT NULL DEFAULT 1,
  basis text NOT NULL DEFAULT 'direct_cost' CHECK (basis = 'direct_cost'),
  direct_unit_cost numeric(14,4) NOT NULL DEFAULT 0 CHECK (direct_unit_cost >= 0),
  unit text NOT NULL,
  title_ar text NOT NULL,
  title_en text,
  description_ar text,
  description_en text,
  execution_method text,
  included_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  assumptions text,
  source_context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  resources_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  formula_schema jsonb,
  content_hash text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_review', 'approved', 'returned', 'archived')),
  reviewer_notes text,
  reviewed_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version_no),
  UNIQUE (template_id, idempotency_key)
);

-- Prevent mutation of published/approved template versions (immutable once approved)
CREATE OR REPLACE FUNCTION public.prevent_approved_template_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' AND (
    NEW.direct_unit_cost IS DISTINCT FROM OLD.direct_unit_cost
    OR NEW.resources_snapshot IS DISTINCT FROM OLD.resources_snapshot
    OR NEW.unit IS DISTINCT FROM OLD.unit
    OR NEW.basis IS DISTINCT FROM OLD.basis
    OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
  ) THEN
    RAISE EXCEPTION 'Approved knowledge template versions are immutable; create a new version instead.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_knowledge_template_versions_immutable ON public.knowledge_template_versions;
CREATE TRIGGER trg_knowledge_template_versions_immutable
BEFORE UPDATE ON public.knowledge_template_versions
FOR EACH ROW EXECUTE FUNCTION public.prevent_approved_template_version_mutation();

-- ── 2. Knowledge Price Evidence & Quotations Extensions (DEV-302 / DEV-304 / M-02 / M-05) ──
CREATE TABLE IF NOT EXISTS public.knowledge_price_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  resource_id uuid REFERENCES public.resources(id) ON DELETE SET NULL,
  assembly_template_id uuid REFERENCES public.knowledge_item_templates(id) ON DELETE SET NULL,
  source_type text NOT NULL
    CHECK (source_type IN ('supplier_quote', 'analysis_line', 'procurement_historical', 'manual_override')),
  source_record_id uuid,
  supplier_quote_id uuid REFERENCES public.supplier_quotes(id) ON DELETE SET NULL,
  quote_item_id uuid REFERENCES public.supplier_quote_items(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  tender_id uuid REFERENCES public.tenders(id) ON DELETE SET NULL,
  boq_item_id uuid REFERENCES public.boq_items(id) ON DELETE SET NULL,
  source_analysis_line_id uuid,
  resource_type text NOT NULL CHECK (resource_type IN ('material', 'labor', 'equipment', 'subcontractor')),
  material_category text CHECK (material_category IN ('primary', 'accessory')),
  csi_division text,
  title_ar text NOT NULL,
  title_en text,
  unit text NOT NULL,
  purchase_unit text,
  conversion_factor numeric(14,6) NOT NULL DEFAULT 1,
  direct_unit_price numeric(14,4) NOT NULL CHECK (direct_unit_price >= 0),
  original_quote_price numeric(14,4),
  override_reason text,
  currency text NOT NULL DEFAULT 'SAR',
  tax_basis text NOT NULL DEFAULT 'unknown' CHECK (tax_basis IN ('included', 'excluded', 'unknown')),
  price_basis text NOT NULL DEFAULT 'reference' CHECK (price_basis IN ('supply', 'supply_install', 'delivered', 'reference')),
  price_date date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date,
  region text,
  confidence text NOT NULL DEFAULT 'C' CHECK (confidence IN ('A', 'B', 'C', 'D')),
  verification_status text NOT NULL DEFAULT 'draft'
    CHECK (verification_status IN ('draft', 'pending_review', 'approved', 'needs_review', 'rejected')),
  reusable boolean NOT NULL DEFAULT false,
  scope text NOT NULL DEFAULT 'project' CHECK (scope IN ('general', 'project', 'typical_assembly')),
  linked_assembly_code text,
  source_context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_price_evidence_source_line_scope
  ON public.knowledge_price_evidence (source_analysis_line_id, scope)
  WHERE source_analysis_line_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_price_evidence_idempotency
  ON public.knowledge_price_evidence (workspace_id, idempotency_key);

ALTER TABLE public.supplier_quotes
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'project',
  ADD COLUMN IF NOT EXISTS linked_assembly_code text,
  ADD COLUMN IF NOT EXISTS reusable boolean NOT NULL DEFAULT false;

-- ── 3. Estimate Versions, Holds, Readiness, Comparisons & BOQ Diffs (DEV-306..DEV-311) ──
CREATE TABLE IF NOT EXISTS public.estimate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tender_id uuid REFERENCES public.tenders(id) ON DELETE CASCADE,
  boq_revision_id uuid,
  version_no integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft', 'internal_review', 'approved_for_submission', 'submitted', 'superseded')),
  engine_version text NOT NULL DEFAULT 'v3.0',
  rounding_policy text NOT NULL DEFAULT 'roundup_integer_sar',
  row_version integer NOT NULL DEFAULT 1,
  last_readiness_hash text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.indirect_cost_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tender_id uuid REFERENCES public.tenders(id) ON DELETE CASCADE,
  estimate_version_id uuid REFERENCES public.estimate_versions(id) ON DELETE CASCADE,
  cost_scope_id text NOT NULL,
  category text NOT NULL,
  title_ar text NOT NULL,
  title_en text,
  driver text NOT NULL CHECK (driver IN ('quantity', 'time', 'headcount_histogram', 'equipment_histogram', 'event', 'lump_sum', 'percentage')),
  recovery_mode text NOT NULL DEFAULT 'preliminaries_boq'
    CHECK (recovery_mode IN ('preliminaries_boq', 'distributed_overhead', 'separate_commercial')),
  periods jsonb NOT NULL DEFAULT '[]'::jsonb,
  unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  total_cost numeric(16,2) NOT NULL DEFAULT 0,
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tender_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tender_id uuid NOT NULL,
  estimate_version_id uuid REFERENCES public.estimate_versions(id) ON DELETE CASCADE,
  hold_ref text NOT NULL,
  subject text NOT NULL,
  reason_code text NOT NULL,
  severity text NOT NULL DEFAULT 'high' CHECK (severity IN ('blocker', 'high', 'medium', 'low')),
  impact_type text NOT NULL DEFAULT 'unknown' CHECK (impact_type IN ('add', 'deduct', 'range', 'unknown')),
  impact_group text,
  direct_cost_impact numeric(16,2),
  direct_cost_max numeric(16,2),
  selling_impact numeric(16,2),
  included_in_current_price boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'SAR',
  assignee text NOT NULL,
  due_date date,
  target_boq_item_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_packages jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_resolution text,
  status text NOT NULL DEFAULT 'Open'
    CHECK (status IN ('Open', 'InProgress', 'AwaitingResponse', 'PendingReview', 'Closed', 'AcceptedRisk', 'Cancelled')),
  resolved_by uuid,
  accepted_by uuid,
  approval_reason text,
  carried_from_hold_id uuid REFERENCES public.tender_holds(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.readiness_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tender_id uuid NOT NULL,
  estimate_version_id uuid REFERENCES public.estimate_versions(id) ON DELETE CASCADE,
  input_hash text NOT NULL,
  rule_version text NOT NULL DEFAULT 'v3.0',
  as_of_date date NOT NULL DEFAULT CURRENT_DATE,
  overall_state text NOT NULL CHECK (overall_state IN ('NOT_READY', 'READY_WITH_APPROVED_QUALIFICATIONS', 'READY')),
  blockers_count integer NOT NULL DEFAULT 0,
  warnings_count integer NOT NULL DEFAULT 0,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  evaluated_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.comparison_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tender_id uuid,
  title_ar text NOT NULL,
  title_en text,
  target_unit text NOT NULL,
  work_quantity numeric(14,4) NOT NULL DEFAULT 1,
  scope_baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_offer_id text,
  selection_rationale text,
  approved_by uuid,
  offers_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  version_no integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.boq_diff_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  tender_id uuid,
  old_revision_id uuid,
  new_revision_id uuid,
  old_label text NOT NULL,
  new_label text NOT NULL,
  mappings jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  approved_by uuid,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.knowledge_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  company_id uuid,
  actor_id uuid NOT NULL DEFAULT auth.uid(),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tender_submissions
  ADD COLUMN IF NOT EXISTS estimate_version_id uuid,
  ADD COLUMN IF NOT EXISTS readiness_run_id uuid,
  ADD COLUMN IF NOT EXISTS export_sha256 text,
  ADD COLUMN IF NOT EXISTS export_reconciliation jsonb,
  ADD COLUMN IF NOT EXISTS holds_snapshot jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS qualifications jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_proof text;

-- ── 4. Tenant-Isolated RLS Policies ──────────────────────────────────────────
ALTER TABLE public.knowledge_item_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_price_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indirect_cost_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tender_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.readiness_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comparison_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.boq_diff_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY knowledge_item_templates_tenant_select ON public.knowledge_item_templates
FOR SELECT USING (
  workspace_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.workspace_id = knowledge_item_templates.workspace_id AND m.user_id = auth.uid())
);

CREATE POLICY knowledge_item_templates_tenant_write ON public.knowledge_item_templates
FOR ALL USING (
  workspace_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.workspace_id = knowledge_item_templates.workspace_id AND m.user_id = auth.uid() AND m.role IN ('pricing_engineer', 'discipline_reviewer', 'approver', 'data_admin'))
)
WITH CHECK (
  workspace_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.workspace_id = knowledge_item_templates.workspace_id AND m.user_id = auth.uid() AND m.role IN ('pricing_engineer', 'discipline_reviewer', 'approver', 'data_admin'))
);

CREATE POLICY knowledge_template_versions_tenant_all ON public.knowledge_template_versions
FOR ALL USING (
  workspace_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.workspace_id = knowledge_template_versions.workspace_id AND m.user_id = auth.uid())
)
WITH CHECK (
  workspace_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.workspace_id = knowledge_template_versions.workspace_id AND m.user_id = auth.uid())
);

CREATE POLICY knowledge_price_evidence_tenant_all ON public.knowledge_price_evidence
FOR ALL USING (
  workspace_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.workspace_id = knowledge_price_evidence.workspace_id AND m.user_id = auth.uid())
)
WITH CHECK (
  workspace_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.workspace_id = knowledge_price_evidence.workspace_id AND m.user_id = auth.uid())
);

CREATE POLICY estimate_versions_owner_all ON public.estimate_versions
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = estimate_versions.project_id AND (p.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.workspace_id = estimate_versions.workspace_id AND m.user_id = auth.uid())))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = estimate_versions.project_id AND (p.user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.workspace_id = estimate_versions.workspace_id AND m.user_id = auth.uid())))
);

CREATE POLICY indirect_cost_lines_owner_all ON public.indirect_cost_lines
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = indirect_cost_lines.project_id AND p.user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = indirect_cost_lines.project_id AND p.user_id = auth.uid())
);

CREATE POLICY tender_holds_owner_all ON public.tender_holds
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tender_holds.project_id AND p.user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = tender_holds.project_id AND p.user_id = auth.uid())
);

CREATE POLICY readiness_runs_owner_all ON public.readiness_runs
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = readiness_runs.project_id AND p.user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = readiness_runs.project_id AND p.user_id = auth.uid())
);

CREATE POLICY comparison_packages_owner_all ON public.comparison_packages
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = comparison_packages.project_id AND p.user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = comparison_packages.project_id AND p.user_id = auth.uid())
);

CREATE POLICY boq_diff_runs_owner_all ON public.boq_diff_runs
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = boq_diff_runs.project_id AND p.user_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.projects p WHERE p.id = boq_diff_runs.project_id AND p.user_id = auth.uid())
);

CREATE POLICY knowledge_audit_logs_read ON public.knowledge_audit_logs
FOR SELECT USING (
  workspace_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.workspace_id = knowledge_audit_logs.workspace_id AND m.user_id = auth.uid())
);

CREATE POLICY knowledge_audit_logs_insert ON public.knowledge_audit_logs
FOR INSERT WITH CHECK (
  workspace_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.workspace_memberships m WHERE m.workspace_id = knowledge_audit_logs.workspace_id AND m.user_id = auth.uid())
);

-- Indexes for fast multi-tenant library & tender assurance queries
CREATE INDEX IF NOT EXISTS idx_knowledge_templates_scope_status
  ON public.knowledge_item_templates (workspace_id, category_type, scope, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_price_evidence_lookup
  ON public.knowledge_price_evidence (workspace_id, scope, verification_status, price_date DESC);
CREATE INDEX IF NOT EXISTS idx_tender_holds_tender_status
  ON public.tender_holds (project_id, tender_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_readiness_runs_tender
  ON public.readiness_runs (project_id, tender_id, created_at DESC);
