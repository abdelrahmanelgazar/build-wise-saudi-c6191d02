-- Add English name column to resources table
ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS name_en TEXT;
