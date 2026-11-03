-- EDOSHMIS 0009 — least privilege on grants.
--
-- Supabase's default privileges give anon and authenticated everything on
-- new objects in public. RLS already returns nothing to anon, but EDOSHMIS
-- has no public pages at all, so the signed-out role gets nothing: no table,
-- no view, no function. Signed-in users keep what RLS and the functions'
-- own checks allow. Run after 0001–0008; safe to run again.

do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relname like 'edoshmis\_%' and c.relkind in ('r', 'v', 'm') loop
    execute format('revoke all on public.%I from anon', r.relname);
  end loop;

  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'edoshmis\_%' loop
    execute format('revoke all on function %s from public, anon', r.sig);
  end loop;
end $$;

-- Internal helpers stay callable only by the functions that use them
-- (re-stated here in case an earlier file's revoke was skipped).
revoke all on function public.edoshmis_next_number(uuid, text, text) from authenticated;
revoke all on function public.edoshmis_audit(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text) from authenticated;
revoke all on function public.edoshmis_seed_roles(uuid) from authenticated;
revoke all on function public.edoshmis_claim_bed(uuid, uuid, uuid, uuid) from authenticated;
revoke all on function public.edoshmis_bed_event(uuid, public.edoshmis_bed_status, public.edoshmis_bed_status, uuid, text, uuid) from authenticated;
revoke all on function public.edoshmis_post_keyed_charge(uuid, uuid, text, date, numeric, numeric, text, text, uuid, uuid) from authenticated;
revoke all on function public.edoshmis_open_billing_account(uuid) from authenticated;
