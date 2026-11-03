# Retiring the old `edoshms_` hospital product

EDOSHMIS (`edoshmis_*`) replaces the earlier hospital product (`edoshms_*`) in `edos_db`. Decision taken 2026-11-03: **archive, keep EDOS LMIS working.**

| Script | What it does |
|---|---|
| `01_archive_edoshms.sql` | Freezes the 46 hospital-only `edoshms_` tables read-only, with triggers that block every insert, update, delete and truncate (the service role too) and with write grants revoked. **The data is kept.** The 5 identity tables EDOS LMIS signs in through (`tenants`, `user_profiles`, `branches`, `roles`, `user_roles`) and their helper functions are not touched. It ends with a check query listing every table and its state. |
| `02_unarchive_edoshms.sql` | Removes the freeze, if it is ever needed again. |

Run them in the Supabase SQL editor for `edos_db`: paste the **whole** file, with nothing selected.

These are **not** EDOSHMIS migrations. They sit apart from `supabase/migrations` on purpose, and the test suite does not run them.

**After archiving:**
- Deleting an `edoshms_tenants` row whose children cascade into archived tables will be refused. That is intended: nothing is lost by accident.
- The data can still be read for history or a later import. Moving those 3 tenants' patients into EDOSHMIS would be a separate, deliberate import.
