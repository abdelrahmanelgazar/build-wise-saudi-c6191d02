ALTER TABLE public.boq_items
  ADD COLUMN IF NOT EXISTS raw_row jsonb,
  ADD COLUMN IF NOT EXISTS cell_styles jsonb;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS excel_headers jsonb;

ALTER TYPE resource_type ADD VALUE IF NOT EXISTS 'subcontractor';