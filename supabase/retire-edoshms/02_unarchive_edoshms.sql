-- Undo 01_archive_edoshms.sql: remove the read-only freeze from the old
-- edoshms_ tables and give the write grants back to signed-in users.
-- (Grants restored are those Supabase gives by default; RLS still applies.)

do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and c.relname like 'edoshms\_%'
  loop
    execute format('drop trigger if exists edoshms_retired_block on public.%I', t.relname);
    execute format('drop trigger if exists edoshms_retired_block_truncate on public.%I', t.relname);
    execute format('grant insert, update, delete on public.%I to authenticated', t.relname);
    execute format('comment on table public.%I is null', t.relname);
  end loop;
end $$;

drop function if exists public.edoshms_retired_block();
