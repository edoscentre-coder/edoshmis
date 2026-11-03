-- Retire the older EDOS hospital product (edoshms_*) — ARCHIVE, not delete.
--
-- Decided by EDOS Centre on 2026-11-03: EDOSHMIS (edoshmis_*) replaces it.
-- Every hospital-only edoshms_ table is frozen read-only: its data stays,
-- nobody (anon, signed-in users, the service role) can insert, change or
-- delete a row. The five identity tables EDOS LMIS signs in through are
-- left exactly as they are, so LMIS keeps working:
--   edoshms_tenants, edoshms_user_profiles, edoshms_branches,
--   edoshms_roles, edoshms_user_roles
-- and so are the helper functions LMIS calls (edoshms_get_tenant_id,
-- edoshms_get_branch_id, edoshms_is_platform_admin, edoshms_is_tenant_admin).
--
-- Reversible: 02_unarchive_edoshms.sql removes the freeze.
-- Safe to run twice. Tables that do not exist are skipped.

create or replace function public.edoshms_retired_block()
returns trigger language plpgsql as $$
begin
  raise exception '% is archived (the old EDOS hospital product was retired on 2026-11-03; EDOSHMIS replaces it). It is read-only.', tg_table_name
    using errcode = '42501';
end $$;

do $$
declare
  keep text[] := array['edoshms_tenants', 'edoshms_user_profiles', 'edoshms_branches', 'edoshms_roles', 'edoshms_user_roles'];
  t record;
  n int := 0;
begin
  for t in
    select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and c.relname like 'edoshms\_%' and not (c.relname = any (keep))
    order by c.relname
  loop
    -- Block writes for everyone, the service role included.
    execute format('drop trigger if exists edoshms_retired_block on public.%I', t.relname);
    execute format('create trigger edoshms_retired_block before insert or update or delete on public.%I for each row execute function public.edoshms_retired_block()', t.relname);
    execute format('drop trigger if exists edoshms_retired_block_truncate on public.%I', t.relname);
    execute format('create trigger edoshms_retired_block_truncate before truncate on public.%I for each statement execute function public.edoshms_retired_block()', t.relname);
    -- And take the write grants away from the API roles.
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t.relname);
    execute format('comment on table public.%I is %L', t.relname, 'ARCHIVED 2026-11-03 — old EDOS hospital product, read-only. Replaced by edoshmis_*.');
    n := n + 1;
  end loop;
  raise notice 'Archived % edoshms_ table(s); kept % identity table(s) for EDOS LMIS.', n, cardinality(keep);
end $$;

-- Check: every archived table, and that the LMIS ones are untouched.
select c.relname as table_name,
       case when c.relname in ('edoshms_tenants', 'edoshms_user_profiles', 'edoshms_branches', 'edoshms_roles', 'edoshms_user_roles')
            then 'kept for LMIS' else 'archived (read-only)' end as state,
       exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'edoshms_retired_block') as frozen
from pg_class c join pg_namespace s on s.oid = c.relnamespace
where s.nspname = 'public' and c.relkind = 'r' and c.relname like 'edoshms\_%'
order by 2, 1;
