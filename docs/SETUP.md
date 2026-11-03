# Setting up EDOSHMIS

## 1. Apply the database migrations

**Automatically (recommended).** Add the database connection string to `.env.local`: Supabase dashboard → Project Settings → Database → Connection string (Session pooler), with the database password filled in.

```
DATABASE_URL=postgresql://postgres.kqpltwrhzbjfyxkttwzh:YOUR-PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

Then run:

```
npm run migrate -- --dry   # see what will run
npm run migrate            # apply it
```

The runner applies each file in its own transaction; a file that fails is rolled back completely. It records what it applied in `edoshmis_schema_migrations`, so later runs only apply new files. `0099_edoshmis_grants.sql` re-runs every time and always last.

**By hand.** In the Supabase SQL editor, paste and run each file in `supabase/migrations` in number order, with nothing highlighted. Finish with `0099_edoshmis_grants.sql`, and run it again after any new migration.

Every file only creates `edoshmis_*` objects and is safe to run twice.

## 2. Make yourself the EDOS Centre platform admin

There is deliberately no screen for this. Run it once in the SQL editor, using the email you sign in with:

```sql
insert into public.edoshmis_platform_admins (user_id)
select id from auth.users where lower(email) = lower('you@example.com')
on conflict do nothing;
```

If that email has no login in `edos_db` yet, create one first: Supabase dashboard → Authentication → Add user, with **Auto Confirm User** ticked.

**Signing in.** Logins in `edos_db` are shared by every EDOS app on that project. Use that email and its password at `/login`. If you never set a password, or the user shows as *Waiting for verification*, go to Supabase dashboard → Authentication → Users → the user → **Send password recovery**, or delete the user and re-add it with a password and Auto Confirm.

## 3. Run the app

```
npm install
npm run dev
```

`.env.local` needs four values (they are the same as EDOS Lend's, since both use `edos_db`):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # server only — never exposed to the browser
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## 4. First hospital

1. Sign in, then open **/platform** and create the hospital: organisation, first facility and code, and its administrator's email.
2. The administrator signs in and sets up the hospital in this order:
   1. **Tariffs**: at least a bed-day price per ward type.
   2. **Facility & wards**: wards, then beds.
   3. **Staff & roles**: clinicians, nurses (with their wards), pharmacy, cashiers.
   4. **Clinical settings**: the drug catalogue. The hospital's clinical lead enters and approves the early-warning bands and escalation rules.
3. Register a patient, then request, approve and admit them.

## 5. Tests

```
npm test
```

This runs the migrations on an in-process Postgres (PGlite), then the whole synthetic inpatient journey with RLS enforced. No network or database access is needed.
