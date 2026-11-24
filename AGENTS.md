# Taqdiri (تقديري) — Project Engineering Rules

- Preserve the TanStack Start runtime and Supabase clients; this keeps deployment and authentication bound to the project's independent hosting and database.
- Keep estimation pages under the authenticated layout and enforce ownership in database RLS policies; browser filters are not access boundaries.
- Manage database schema changes via reviewed SQL migrations in `supabase/migrations/`.
- Keep model/AI API keys out of browser code; invoke AI services only through server functions or edge functions.
- Track source data, user identity mapping, and stored file imports separately from source code; a repository does not contain hosted records.
- Keep language dictionaries and text-direction detection in shared browser-safe modules; restore saved language after hydration so SSR remains consistent.
