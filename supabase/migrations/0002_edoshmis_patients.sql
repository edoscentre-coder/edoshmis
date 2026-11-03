-- EDOSHMIS 0002 — the patient register. One record per person per
-- organisation, shared by every facility and department of it.

do $$ begin
  create type public.edoshmis_sex as enum ('male', 'female', 'intersex', 'unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.edoshmis_identifier_type as enum (
    'national_id', 'passport', 'birth_certificate', 'alien_id', 'refugee_id', 'sha_member', 'nhif_legacy', 'insurance_member', 'other'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.edoshmis_patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id) on delete restrict,
  registered_facility_id uuid references public.edoshmis_facilities (id),
  hospital_number text not null,
  first_name text not null check (length(trim(first_name)) between 1 and 80),
  middle_name text,
  last_name text not null check (length(trim(last_name)) between 1 and 80),
  sex public.edoshmis_sex not null,
  gender_identity text,
  date_of_birth date,
  -- When the exact date is not known: the age given, and it is flagged.
  dob_estimated boolean not null default false,
  phone text check (phone is null or phone ~ '^\+254[17][0-9]{8}$'),
  phone_alt text check (phone_alt is null or phone_alt ~ '^\+254[17][0-9]{8}$'),
  email text,
  county text,
  sub_county text,
  address text,
  occupation text,
  marital_status text,
  blood_group text check (blood_group is null or blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  photo_path text,
  -- Data Protection Act: consent recorded at registration.
  consent_data_processing boolean not null default false,
  consent_recorded_at timestamptz,
  consent_sms boolean not null default false,
  is_deceased boolean not null default false,
  deceased_at timestamptz,
  merged_into uuid references public.edoshmis_patients (id),
  created_by uuid references public.edoshmis_staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, hospital_number)
);
create index if not exists edoshmis_patients_name_idx on public.edoshmis_patients (organization_id, lower(last_name), lower(first_name));
create index if not exists edoshmis_patients_phone_idx on public.edoshmis_patients (organization_id, phone) where phone is not null;
create index if not exists edoshmis_patients_dob_idx on public.edoshmis_patients (organization_id, date_of_birth);

create table if not exists public.edoshmis_patient_identifiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id) on delete restrict,
  patient_id uuid not null references public.edoshmis_patients (id) on delete cascade,
  id_type public.edoshmis_identifier_type not null,
  value text not null check (length(trim(value)) between 2 and 60),
  issuer text,
  created_by uuid references public.edoshmis_staff (id),
  created_at timestamptz not null default now()
);
-- The same national ID or passport cannot belong to two people in one organisation.
create unique index if not exists edoshmis_patient_identifiers_uniq
  on public.edoshmis_patient_identifiers (organization_id, id_type, upper(regexp_replace(value, '\s', '', 'g')))
  where id_type in ('national_id', 'passport', 'birth_certificate', 'alien_id', 'refugee_id', 'sha_member');
create index if not exists edoshmis_patient_identifiers_patient_idx on public.edoshmis_patient_identifiers (patient_id);

create table if not exists public.edoshmis_patient_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id) on delete restrict,
  patient_id uuid not null references public.edoshmis_patients (id) on delete cascade,
  kind text not null check (kind in ('next_of_kin', 'emergency', 'guardian')),
  full_name text not null,
  relationship text,
  phone text check (phone is null or phone ~ '^\+254[17][0-9]{8}$'),
  national_id text,
  address text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_patient_contacts_patient_idx on public.edoshmis_patient_contacts (patient_id);

create table if not exists public.edoshmis_patient_allergies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id) on delete restrict,
  patient_id uuid not null references public.edoshmis_patients (id) on delete cascade,
  substance text not null check (length(trim(substance)) between 2 and 120),
  category text not null default 'drug' check (category in ('drug', 'food', 'environmental', 'other')),
  reaction text,
  severity text not null default 'unknown' check (severity in ('mild', 'moderate', 'severe', 'life_threatening', 'unknown')),
  status text not null default 'active' check (status in ('active', 'inactive', 'entered_in_error')),
  recorded_by uuid references public.edoshmis_staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists edoshmis_patient_allergies_patient_idx on public.edoshmis_patient_allergies (patient_id) where status = 'active';

-- "No known allergies" is a clinical statement, not the absence of rows.
alter table public.edoshmis_patients add column if not exists allergies_reviewed text
  check (allergies_reviewed is null or allergies_reviewed in ('nkda', 'has_allergies', 'unknown'));

create table if not exists public.edoshmis_patient_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id) on delete restrict,
  patient_id uuid not null references public.edoshmis_patients (id) on delete cascade,
  kind text not null check (kind in ('medical', 'surgical', 'family', 'social', 'chronic', 'obstetric', 'other')),
  description text not null check (length(trim(description)) between 2 and 500),
  icd10_code text,
  onset text,
  status text not null default 'active' check (status in ('active', 'resolved', 'entered_in_error')),
  recorded_by uuid references public.edoshmis_staff (id),
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_patient_history_patient_idx on public.edoshmis_patient_history (patient_id);

create table if not exists public.edoshmis_patient_alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id) on delete restrict,
  patient_id uuid not null references public.edoshmis_patients (id) on delete cascade,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  message text not null check (length(trim(message)) between 2 and 300),
  is_active boolean not null default true,
  created_by uuid references public.edoshmis_staff (id),
  created_at timestamptz not null default now(),
  resolved_by uuid references public.edoshmis_staff (id),
  resolved_at timestamptz
);
create index if not exists edoshmis_patient_alerts_patient_idx on public.edoshmis_patient_alerts (patient_id) where is_active;

create table if not exists public.edoshmis_patient_coverage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id) on delete restrict,
  patient_id uuid not null references public.edoshmis_patients (id) on delete cascade,
  payer_type text not null check (payer_type in ('sha', 'private_insurance', 'corporate', 'nhif_legacy')),
  payer_name text not null,
  member_number text not null,
  principal_name text,
  relationship_to_principal text,
  valid_from date,
  valid_to date,
  -- Verification is done against the payer's own system; until an approved
  -- integration exists this is recorded by hand, with who checked.
  verified_at timestamptz,
  verified_by uuid references public.edoshmis_staff (id),
  verification_note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_patient_coverage_patient_idx on public.edoshmis_patient_coverage (patient_id);

-- ---------------------------------------------------------------- duplicate detection

-- How hard to look for a duplicate is the organisation's choice:
-- settings.duplicate_rules = {"identifier": true, "name_dob": true, "phone_name": true}
-- (all on when unset). Returns candidates with the reason each matched.
create or replace function public.edoshmis_find_duplicates(
  p_org uuid, p_first text, p_last text, p_dob date, p_phone text, p_identifiers jsonb default '[]'::jsonb
) returns table (patient_id uuid, hospital_number text, full_name text, date_of_birth date, phone text, reasons text[])
language plpgsql stable security definer set search_path = '' as $$
declare
  rules jsonb := coalesce((select settings -> 'duplicate_rules' from public.edoshmis_organizations where id = p_org), '{}'::jsonb);
begin
  if not public.edoshmis_has_org_perm(p_org, 'patients.read') then
    raise exception 'You do not have permission to search patients.' using errcode = '42501';
  end if;
  return query
  with c as (
    select p.id, 'Same ' || replace(i.id_type::text, '_', ' ') as reason
    from public.edoshmis_patient_identifiers i
    join public.edoshmis_patients p on p.id = i.patient_id and p.deleted_at is null and p.merged_into is null
    join jsonb_to_recordset(coalesce(p_identifiers, '[]'::jsonb)) as x(id_type text, value text) on true
    where coalesce((rules ->> 'identifier')::boolean, true)
      and i.organization_id = p_org and i.id_type::text = x.id_type
      and upper(regexp_replace(i.value, '\s', '', 'g')) = upper(regexp_replace(x.value, '\s', '', 'g'))
    union all
    select p.id, 'Same name and date of birth'
    from public.edoshmis_patients p
    where coalesce((rules ->> 'name_dob')::boolean, true)
      and p.organization_id = p_org and p.deleted_at is null and p.merged_into is null
      and p_dob is not null and p.date_of_birth = p_dob
      and lower(p.last_name) = lower(trim(p_last)) and lower(p.first_name) = lower(trim(p_first))
    union all
    select p.id, 'Same phone and surname'
    from public.edoshmis_patients p
    where coalesce((rules ->> 'phone_name')::boolean, true)
      and p.organization_id = p_org and p.deleted_at is null and p.merged_into is null
      and p_phone is not null and p.phone = p_phone and lower(p.last_name) = lower(trim(p_last))
  )
  select p.id, p.hospital_number, trim(p.first_name || ' ' || coalesce(p.middle_name || ' ', '') || p.last_name),
         p.date_of_birth, p.phone, array_agg(distinct c.reason)
  from c join public.edoshmis_patients p on p.id = c.id
  group by p.id, p.hospital_number, p.first_name, p.middle_name, p.last_name, p.date_of_birth, p.phone;
end $$;

-- Register a patient, their identifiers and contacts in one transaction.
-- Refuses when duplicates exist unless the clerk confirms with a reason.
create or replace function public.edoshmis_register_patient(p_facility uuid, p jsonb, p_duplicate_override text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.edoshmis_facility_org(p_facility);
  v_staff uuid := public.edoshmis_require(p_facility, 'patients.register');
  v_id uuid;
  v_number text;
  v_dups int;
  v_code text;
begin
  select count(*) into v_dups from public.edoshmis_find_duplicates(
    v_org, p ->> 'first_name', p ->> 'last_name', nullif(p ->> 'date_of_birth', '')::date, nullif(p ->> 'phone', ''), coalesce(p -> 'identifiers', '[]'::jsonb));
  if v_dups > 0 and coalesce(trim(p_duplicate_override), '') = '' then
    raise exception 'Possible duplicate: % existing record(s) match. Confirm it is a different person and give a reason.', v_dups
      using errcode = 'P0001', hint = 'duplicate';
  end if;
  if not coalesce((p ->> 'consent_data_processing')::boolean, false) then
    raise exception 'Record the patient''s (or guardian''s) consent to their data being processed before registering.';
  end if;

  select code into v_code from public.edoshmis_facilities where id = p_facility;
  v_number := v_code || '-' || lpad(public.edoshmis_next_number(v_org, 'hospital_number')::text, 6, '0');

  insert into public.edoshmis_patients (
    organization_id, registered_facility_id, hospital_number, first_name, middle_name, last_name, sex, gender_identity,
    date_of_birth, dob_estimated, phone, phone_alt, email, county, sub_county, address, occupation, marital_status,
    blood_group, consent_data_processing, consent_recorded_at, consent_sms, allergies_reviewed, created_by)
  values (
    v_org, p_facility, v_number, trim(p ->> 'first_name'), nullif(trim(p ->> 'middle_name'), ''), trim(p ->> 'last_name'),
    (p ->> 'sex')::public.edoshmis_sex, nullif(p ->> 'gender_identity', ''),
    nullif(p ->> 'date_of_birth', '')::date, coalesce((p ->> 'dob_estimated')::boolean, false),
    nullif(p ->> 'phone', ''), nullif(p ->> 'phone_alt', ''), nullif(p ->> 'email', ''),
    nullif(p ->> 'county', ''), nullif(p ->> 'sub_county', ''), nullif(p ->> 'address', ''),
    nullif(p ->> 'occupation', ''), nullif(p ->> 'marital_status', ''), nullif(p ->> 'blood_group', ''),
    true, now(), coalesce((p ->> 'consent_sms')::boolean, false), nullif(p ->> 'allergies_reviewed', ''), v_staff)
  returning id into v_id;

  insert into public.edoshmis_patient_identifiers (organization_id, patient_id, id_type, value, created_by)
  select v_org, v_id, (x.id_type)::public.edoshmis_identifier_type, trim(x.value), v_staff
  from jsonb_to_recordset(coalesce(p -> 'identifiers', '[]'::jsonb)) as x(id_type text, value text)
  where coalesce(trim(x.value), '') <> '';

  insert into public.edoshmis_patient_contacts (organization_id, patient_id, kind, full_name, relationship, phone, is_primary)
  select v_org, v_id, x.kind, trim(x.full_name), nullif(x.relationship, ''), nullif(x.phone, ''), coalesce(x.is_primary, false)
  from jsonb_to_recordset(coalesce(p -> 'contacts', '[]'::jsonb)) as x(kind text, full_name text, relationship text, phone text, is_primary boolean)
  where coalesce(trim(x.full_name), '') <> '';

  perform public.edoshmis_audit(v_org, p_facility, 'patient.registered', 'patient', v_id::text, v_id, null,
    jsonb_build_object('hospital_number', v_number), nullif(trim(p_duplicate_override), ''));
  return v_id;
end $$;

-- ---------------------------------------------------------------- author stamping

-- Who wrote a record is never taken from the browser: the trigger sets it
-- from the session, for every table that has the column.
create or replace function public.edoshmis_stamp_org_author()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_staff uuid := public.edoshmis_staff_id(new.organization_id);
begin
  if v_staff is null and auth.uid() is not null then
    raise exception 'You are not active staff of this organisation.' using errcode = '42501';
  end if;
  if tg_table_name in ('edoshmis_patient_allergies', 'edoshmis_patient_history') then
    new.recorded_by := coalesce(v_staff, new.recorded_by);
  else
    new.created_by := coalesce(v_staff, new.created_by);
  end if;
  return new;
end $$;

drop trigger if exists edoshmis_patient_allergies_stamp on public.edoshmis_patient_allergies;
create trigger edoshmis_patient_allergies_stamp before insert on public.edoshmis_patient_allergies for each row execute function public.edoshmis_stamp_org_author();
drop trigger if exists edoshmis_patient_history_stamp on public.edoshmis_patient_history;
create trigger edoshmis_patient_history_stamp before insert on public.edoshmis_patient_history for each row execute function public.edoshmis_stamp_org_author();
drop trigger if exists edoshmis_patient_alerts_stamp on public.edoshmis_patient_alerts;
create trigger edoshmis_patient_alerts_stamp before insert on public.edoshmis_patient_alerts for each row execute function public.edoshmis_stamp_org_author();

drop trigger if exists edoshmis_patients_touch on public.edoshmis_patients;
create trigger edoshmis_patients_touch before update on public.edoshmis_patients for each row execute function public.edoshmis_touch_updated_at();
drop trigger if exists edoshmis_patient_allergies_touch on public.edoshmis_patient_allergies;
create trigger edoshmis_patient_allergies_touch before update on public.edoshmis_patient_allergies for each row execute function public.edoshmis_touch_updated_at();

do $$ declare t text; begin
  foreach t in array array['edoshmis_patients', 'edoshmis_patient_identifiers', 'edoshmis_patient_contacts', 'edoshmis_patient_allergies',
                           'edoshmis_patient_history', 'edoshmis_patient_alerts', 'edoshmis_patient_coverage'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after update or delete on public.%I for each row execute function public.edoshmis_audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS

alter table public.edoshmis_patients enable row level security;
alter table public.edoshmis_patient_identifiers enable row level security;
alter table public.edoshmis_patient_contacts enable row level security;
alter table public.edoshmis_patient_allergies enable row level security;
alter table public.edoshmis_patient_history enable row level security;
alter table public.edoshmis_patient_alerts enable row level security;
alter table public.edoshmis_patient_coverage enable row level security;

-- Demographics, identifiers, contacts and coverage: patients.read to see,
-- patients.edit to change. Registration itself is the function above.
drop policy if exists edoshmis_patients_read on public.edoshmis_patients;
create policy edoshmis_patients_read on public.edoshmis_patients for select to authenticated
  using (deleted_at is null and public.edoshmis_has_org_perm(organization_id, 'patients.read'));
drop policy if exists edoshmis_patients_edit on public.edoshmis_patients;
create policy edoshmis_patients_edit on public.edoshmis_patients for update to authenticated
  using (public.edoshmis_has_org_perm(organization_id, 'patients.edit')) with check (public.edoshmis_has_org_perm(organization_id, 'patients.edit'));

do $$ declare t text; begin
  foreach t in array array['edoshmis_patient_identifiers', 'edoshmis_patient_contacts', 'edoshmis_patient_coverage'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.edoshmis_has_org_perm(organization_id, ''patients.read''))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.edoshmis_has_org_perm(organization_id, ''patients.edit'')) with check (public.edoshmis_has_org_perm(organization_id, ''patients.edit''))', t || '_write', t);
  end loop;
end $$;

-- Allergies, history and alerts are clinical: patients.clinical, both ways.
-- Alerts are also shown to anyone who can find the patient — a "violent",
-- "same-name" or "infection risk" flag matters at the front desk too.
do $$ declare t text; begin
  foreach t in array array['edoshmis_patient_allergies', 'edoshmis_patient_history', 'edoshmis_patient_alerts'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.edoshmis_has_org_perm(organization_id, ''patients.clinical'')%s)',
      t || '_read', t, case when t = 'edoshmis_patient_alerts' then ' or public.edoshmis_has_org_perm(organization_id, ''patients.read'')' else '' end);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.edoshmis_has_org_perm(organization_id, ''patients.clinical''))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.edoshmis_has_org_perm(organization_id, ''patients.clinical'')) with check (public.edoshmis_has_org_perm(organization_id, ''patients.clinical''))', t || '_update', t);
  end loop;
end $$;
