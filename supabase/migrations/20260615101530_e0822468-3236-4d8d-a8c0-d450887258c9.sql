ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS division TEXT;
CREATE INDEX IF NOT EXISTS idx_resources_division ON public.resources(division);