<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# EDOSHMIS house rules

- Every database object is prefixed `edoshmis_` — tables, types, functions, policies, storage paths.
- `edos_db` is shared with EDOS POS, the older `edoshms_` hospital product, EDOS LMIS, EDOS Lend, Crane and others. Never touch an object outside the `edoshmis_` namespace.
- Migrations in `supabase/migrations` are applied by hand in the Supabase SQL editor, in order. Each must be safe to run twice.
- Table access goes through the signed-in session (`lib/supabase/server.ts`) so RLS is the boundary. The service-role client (`lib/supabase/admin.ts`) is only for the Auth Admin API.
- Workflows that change several rows (admit, allocate a bed, transfer, discharge, charge) are `security definer` functions — one transaction, permission-checked inside.
- Signed clinical notes are never edited; corrections are addenda.
- No clinical threshold is hard-coded. Early-warning bands come from `edoshmis_observation_bands`, configured per facility.
