-- Drop the old unique constraint that didn't include sheet_name
ALTER TABLE public.boq_items DROP CONSTRAINT IF EXISTS boq_items_user_project_itemno_key;

-- Add the new unique constraint that includes sheet_name to allow duplicate item_no across different sheets
ALTER TABLE public.boq_items ADD CONSTRAINT boq_items_user_project_sheet_itemno_key UNIQUE (user_id, project_id, sheet_name, item_no);
