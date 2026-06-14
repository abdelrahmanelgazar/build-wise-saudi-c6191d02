ALTER TABLE public.price_analysis_items
  ADD COLUMN IF NOT EXISTS cell_styles jsonb,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_pa_items_boq_sort
  ON public.price_analysis_items (boq_item_id, sort_order);