# Setting up EDOSHMIS

## 1. Apply the database migrations

In the Supabase dashboard for **edos_db** (`kqpltwrhzbjfyxkttwzh`), go to **SQL editor**. Paste and run each file in `supabase/migrations`, **in order**:

```
0001_edoshmis_foundation.sql
0002_edoshmis_patients.sql
0003_edoshmis_ipd_admissions.sql
0004_edoshmis_clinical_documentation.sql
0005_edoshmis_medication.sql
0006_edoshmis_billing.sql
0007_edoshmis_discharge.sql
0008_edoshmis_staff_and_dashboard.sql
0009_edoshmis_grants.sql
```

These files only create `edoshmis_*` objects. They drop nothing and alter nothing that belongs to another product. Each can be run again safely.

## 2. Make yourself the EDOS Centre platform admin

There is deliberately no screen for this. Run it once in the SQL editor, using the email you sign in with:

```sql
insert into public.edoshmis_platform_admins (user_id)
select id from auth.users where lower(email) = lower('you@example.com')
on conflict do nothing;
```

If that email has no login in `edos_db` yet, create one first: Supabase dashboard → Authentication → Add user.

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
