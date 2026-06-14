ALTER TABLE public.boq_items ADD COLUMN IF NOT EXISTS description_en TEXT;
ALTER TABLE public.price_analysis_items ADD COLUMN IF NOT EXISTS description_en TEXT;