-- EDOSHMIS 0001 — foundation: organisations, facilities, departments, staff,
-- roles and permissions, numbering, audit.
--
-- edos_db is shared with EDOS POS, the older edoshms_ hospital product, EDOS
-- LMIS, EDOS Lend, Crane and others. Everything here is prefixed edoshmis_ —
-- tables, types, functions, triggers and policies — and nothing outside that
-- namespace is read or changed. Note that the older product owns unprefixed
-- enum types such as public.admission_status and public.bed_status, which is
-- why every type below carries the prefix too.
--
-- Safe to run twice: create ... if not exists, create or replace, and
-- duplicate_object guards on types.

-- ---------------------------------------------------------------- types

do $$ begin
  create type public.edoshmis_staff_status as enum ('active', 'suspended', 'left');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.edoshmis_designation as enum (
    'consultant', 'medical_officer', 'clinical_officer', 'intern', 'nursing_officer', 'ward_manager', 'nurse',
    'midwife', 'pharmacist', 'pharmaceutical_technologist', 'lab_technologist', 'radiologist', 'radiographer',
    'anaesthetist', 'theatre_staff', 'paediatrician', 'receptionist', 'triage_officer', 'cashier', 'accountant',
    'claims_officer', 'procurement_officer', 'storekeeper', 'hr_officer', 'records_officer', 'ambulance_staff',
    'mortuary_staff', 'it_admin', 'administrator', 'medical_superintendent', 'hospital_director', 'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.edoshmis_facility_level as enum (
    'level_2', 'level_3', 'level_4', 'level_5', 'level_6', 'nursing_home', 'medical_centre', 'specialist_clinic', 'other'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- platform

-- The people at EDOS Centre allowed to create a hospital organisation. Seeded
-- by hand (see docs/SETUP.md); there is deliberately no API that adds a row.
-- Being a platform admin grants no access to any hospital's patients.
create table if not exists public.edoshmis_platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- organisation

create table if not exists public.edoshmis_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  legal_name text,
  kra_pin text,
  email text,
  phone text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.edoshmis_facilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 160),
  code text not null check (code ~ '^[A-Z0-9]{2,8}$'),
  level public.edoshmis_facility_level not null default 'other',
  mfl_code text,
  sha_facility_code text,
  county text,
  sub_county text,
  address text,
  phone text,
  email text,
  timezone text not null default 'Africa/Nairobi',
  operating_hours jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);
create index if not exists edoshmis_facilities_org_idx on public.edoshmis_facilities (organization_id);

create table if not exists public.edoshmis_departments (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id) on delete restrict,
  name text not null,
  code text not null,
  kind text not null default 'clinical' check (kind in ('clinical', 'nursing', 'diagnostic', 'pharmacy', 'finance', 'administration', 'support')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (facility_id, code)
);

-- ---------------------------------------------------------------- staff & access

create table if not exists public.edoshmis_staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  staff_number text,
  full_name text not null check (length(trim(full_name)) between 2 and 160),
  designation public.edoshmis_designation not null,
  department_id uuid references public.edoshmis_departments (id),
  -- Professional registration: KMPDC, NCK, PPB, KMLTTB, Clinical Officers Council…
  regulator text,
  registration_number text,
  registration_expiry date,
  phone text,
  email text,
  status public.edoshmis_staff_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists edoshmis_staff_user_idx on public.edoshmis_staff (user_id);

-- Permissions are plain keys (see edoshmis_permission_catalog). A role is a
-- named set of them, per organisation, so a hospital can tailor its own.
create table if not exists public.edoshmis_permission_catalog (
  key text primary key,
  area text not null,
  label text not null
);

create table if not exists public.edoshmis_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null,
  description text,
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code)
);

-- A staff member holds a role at one facility, or at every facility of the
-- organisation when facility_id is null.
create table if not exists public.edoshmis_staff_roles (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.edoshmis_staff (id) on delete cascade,
  role_id uuid not null references public.edoshmis_roles (id) on delete cascade,
  facility_id uuid references public.edoshmis_facilities (id) on delete cascade,
  granted_by uuid references public.edoshmis_staff (id),
  created_at timestamptz not null default now()
);
create unique index if not exists edoshmis_staff_roles_uniq
  on public.edoshmis_staff_roles (staff_id, role_id, coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ---------------------------------------------------------------- numbering

create table if not exists public.edoshmis_counters (
  scope_id uuid not null,
  kind text not null,
  period text not null default '',
  last_value bigint not null default 0,
  primary key (scope_id, kind, period)
);

-- ---------------------------------------------------------------- audit

-- Append-only. Written by triggers and by the workflow functions; nobody,
-- the service role included, updates or deletes a row (see the guard below).
create table if not exists public.edoshmis_audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid,
  facility_id uuid,
  actor_user_id uuid,
  actor_staff_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  patient_id uuid,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_audit_org_time_idx on public.edoshmis_audit_logs (organization_id, created_at desc);
create index if not exists edoshmis_audit_patient_idx on public.edoshmis_audit_logs (patient_id, created_at desc) where patient_id is not null;

-- Who opened which patient's record — the Data Protection Act access log.
create table if not exists public.edoshmis_access_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  facility_id uuid,
  patient_id uuid not null,
  user_id uuid not null,
  staff_id uuid,
  context text not null,
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_access_patient_idx on public.edoshmis_access_logs (patient_id, created_at desc);

create table if not exists public.edoshmis_login_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  organization_id uuid,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_login_user_idx on public.edoshmis_login_events (user_id, created_at desc);

-- ---------------------------------------------------------------- helpers

create or replace function public.edoshmis_is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.edoshmis_platform_admins where user_id = auth.uid());
$$;

create or replace function public.edoshmis_facility_org(p_facility uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select organization_id from public.edoshmis_facilities where id = p_facility;
$$;

-- The signed-in user's active staff row in an organisation.
create or replace function public.edoshmis_staff_id(p_org uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select s.id from public.edoshmis_staff s
  where s.organization_id = p_org and s.user_id = auth.uid() and s.status = 'active';
$$;

create or replace function public.edoshmis_is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.edoshmis_staff_id(p_org) is not null;
$$;

-- Does the signed-in user hold `p_perm` at this facility? A role granted with
-- no facility counts at every facility of its organisation.
create or replace function public.edoshmis_has_perm(p_facility uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.edoshmis_facilities f
    join public.edoshmis_staff s on s.organization_id = f.organization_id and s.user_id = auth.uid() and s.status = 'active'
    join public.edoshmis_staff_roles sr on sr.staff_id = s.id and (sr.facility_id is null or sr.facility_id = f.id)
    join public.edoshmis_roles r on r.id = sr.role_id
    where f.id = p_facility and p_perm = any (r.permissions)
  );
$$;

-- Held at any facility of the organisation — for organisation-wide records
-- such as the patient register.
create or replace function public.edoshmis_has_org_perm(p_org uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.edoshmis_staff s
    join public.edoshmis_staff_roles sr on sr.staff_id = s.id
    join public.edoshmis_roles r on r.id = sr.role_id
    where s.organization_id = p_org and s.user_id = auth.uid() and s.status = 'active' and p_perm = any (r.permissions)
  );
$$;

create or replace function public.edoshmis_require(p_facility uuid, p_perm text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_staff uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not public.edoshmis_has_perm(p_facility, p_perm) then
    raise exception 'You do not have permission to do this (%).', p_perm using errcode = '42501';
  end if;
  v_staff := public.edoshmis_staff_id(public.edoshmis_facility_org(p_facility));
  return v_staff;
end $$;

-- Next number in a sequence, gap-free per scope and period, safe under
-- concurrency (the row lock serialises callers).
create or replace function public.edoshmis_next_number(p_scope uuid, p_kind text, p_period text default '')
returns bigint language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  insert into public.edoshmis_counters (scope_id, kind, period, last_value)
  values (p_scope, p_kind, coalesce(p_period, ''), 1)
  on conflict (scope_id, kind, period) do update set last_value = public.edoshmis_counters.last_value + 1
  returning last_value into v;
  return v;
end $$;

create or replace function public.edoshmis_audit(
  p_org uuid, p_facility uuid, p_action text, p_entity_type text, p_entity_id text,
  p_patient uuid default null, p_before jsonb default null, p_after jsonb default null, p_reason text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.edoshmis_audit_logs (organization_id, facility_id, actor_user_id, actor_staff_id, action, entity_type, entity_id, patient_id, before, after, reason)
  values (p_org, p_facility, auth.uid(), case when p_org is null then null else public.edoshmis_staff_id(p_org) end,
          p_action, p_entity_type, p_entity_id, p_patient, p_before, p_after, p_reason);
end $$;

-- Generic row-change trigger. Reads organization_id / facility_id /
-- patient_id from the row when the table has them.
create or replace function public.edoshmis_audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  v_org uuid := nullif(r ->> 'organization_id', '')::uuid;
  v_fac uuid := nullif(r ->> 'facility_id', '')::uuid;
begin
  if v_org is null and v_fac is not null then v_org := public.edoshmis_facility_org(v_fac); end if;
  perform public.edoshmis_audit(
    v_org, v_fac, lower(tg_op), tg_table_name, r ->> 'id', nullif(r ->> 'patient_id', '')::uuid,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create or replace function public.edoshmis_append_only()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only.', tg_table_name using errcode = '42501';
end $$;

drop trigger if exists edoshmis_audit_logs_append_only on public.edoshmis_audit_logs;
create trigger edoshmis_audit_logs_append_only before update or delete on public.edoshmis_audit_logs
  for each row execute function public.edoshmis_append_only();
drop trigger if exists edoshmis_access_logs_append_only on public.edoshmis_access_logs;
create trigger edoshmis_access_logs_append_only before update or delete on public.edoshmis_access_logs
  for each row execute function public.edoshmis_append_only();

create or replace function public.edoshmis_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------- permission catalogue

insert into public.edoshmis_permission_catalog (key, area, label) values
  ('admin.facility', 'Administration', 'Edit the organisation and facilities'),
  ('admin.staff', 'Administration', 'Add, suspend and assign staff'),
  ('admin.roles', 'Administration', 'Create and change roles'),
  ('admin.wards', 'Administration', 'Set up wards and beds'),
  ('admin.tariffs', 'Administration', 'Set prices'),
  ('admin.clinical_config', 'Administration', 'Configure observation bands, escalation rules, drugs and interactions'),
  ('audit.read', 'Administration', 'Read the audit and access logs'),
  ('reports.read', 'Reports', 'See dashboards and reports'),
  ('patients.read', 'Patients', 'Find patients and see demographics'),
  ('patients.register', 'Patients', 'Register patients'),
  ('patients.edit', 'Patients', 'Edit patient demographics'),
  ('patients.clinical', 'Patients', 'See and record allergies, history and alerts'),
  ('ipd.read', 'Inpatients', 'See inpatients on assigned wards'),
  ('ipd.all_patients', 'Inpatients', 'See inpatients on every ward'),
  ('ipd.request_admission', 'Inpatients', 'Request an admission'),
  ('ipd.approve_admission', 'Inpatients', 'Approve or reject admission requests'),
  ('ipd.allocate_bed', 'Inpatients', 'Admit to a bed, reserve beds'),
  ('ipd.transfer', 'Inpatients', 'Move a patient to another bed'),
  ('ipd.manage_beds', 'Inpatients', 'Mark beds cleaned, under maintenance or blocked'),
  ('clinical.notes', 'Clinical', 'Write and sign clinical notes and ward rounds'),
  ('clinical.diagnose', 'Clinical', 'Record and change diagnoses'),
  ('clinical.care_team', 'Clinical', 'Change the care team and responsible consultant'),
  ('nursing.notes', 'Nursing', 'Write nursing notes and assessments'),
  ('vitals.record', 'Nursing', 'Record observations'),
  ('vitals.escalate', 'Nursing', 'Acknowledge and resolve escalations'),
  ('fluids.record', 'Nursing', 'Record intake and output'),
  ('meds.prescribe', 'Medication', 'Prescribe and discontinue medication'),
  ('meds.verify', 'Medication', 'Verify and dispense prescriptions (pharmacy)'),
  ('meds.administer', 'Medication', 'Record administration on the eMAR'),
  ('procedures.order', 'Procedures', 'Request and authorise procedures'),
  ('procedures.perform', 'Procedures', 'Record procedure notes and outcomes'),
  ('billing.read', 'Billing', 'See bills and payments'),
  ('billing.charge', 'Billing', 'Post charges'),
  ('billing.payment', 'Billing', 'Receive payments and deposits'),
  ('billing.adjust', 'Billing', 'Give discounts and reverse charges'),
  ('discharge.initiate', 'Discharge', 'Start a discharge and write the summary'),
  ('discharge.clear_billing', 'Discharge', 'Give billing clearance'),
  ('discharge.clear_pharmacy', 'Discharge', 'Give pharmacy clearance'),
  ('discharge.clear_nursing', 'Discharge', 'Give nursing clearance'),
  ('discharge.authorize', 'Discharge', 'Authorise the discharge and release the bed')
on conflict (key) do update set area = excluded.area, label = excluded.label;

-- The roles every new organisation starts with. Each is a starting point the
-- hospital can change; none of them is "everything". The administrator runs
-- the system and does not, by that alone, read clinical notes.
create or replace function public.edoshmis_seed_roles(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.edoshmis_roles (organization_id, code, name, description, permissions, is_system) values
  (p_org, 'hospital_admin', 'Hospital administrator', 'Runs the system: staff, roles, wards, prices, settings. No clinical access.',
    array['admin.facility','admin.staff','admin.roles','admin.wards','admin.tariffs','admin.clinical_config','audit.read','reports.read','patients.read'], true),
  (p_org, 'medical_superintendent', 'Medical superintendent', 'Clinical lead with sight of every ward and the reports.',
    array['reports.read','audit.read','patients.read','patients.clinical','ipd.read','ipd.all_patients','ipd.request_admission','ipd.approve_admission','ipd.allocate_bed','ipd.transfer','clinical.notes','clinical.diagnose','clinical.care_team','procedures.order','meds.prescribe','discharge.initiate','discharge.authorize','billing.read'], true),
  (p_org, 'consultant', 'Consultant', 'Admits, leads rounds, prescribes, authorises discharge.',
    array['patients.read','patients.clinical','ipd.read','ipd.all_patients','ipd.request_admission','ipd.approve_admission','clinical.notes','clinical.diagnose','clinical.care_team','meds.prescribe','procedures.order','procedures.perform','discharge.initiate','discharge.authorize','reports.read'], true),
  (p_org, 'medical_officer', 'Medical officer', 'Ward rounds, prescribing, discharge summaries.',
    array['patients.read','patients.clinical','ipd.read','ipd.all_patients','ipd.request_admission','clinical.notes','clinical.diagnose','meds.prescribe','procedures.order','procedures.perform','discharge.initiate'], true),
  (p_org, 'clinical_officer', 'Clinical officer', 'Ward rounds and prescribing.',
    array['patients.read','patients.clinical','ipd.read','ipd.request_admission','clinical.notes','clinical.diagnose','meds.prescribe','procedures.order','discharge.initiate'], true),
  (p_org, 'nursing_officer', 'Nursing officer', 'Nursing lead across wards.',
    array['patients.read','patients.clinical','ipd.read','ipd.all_patients','ipd.allocate_bed','ipd.transfer','ipd.manage_beds','nursing.notes','vitals.record','vitals.escalate','fluids.record','meds.administer','discharge.clear_nursing','reports.read'], true),
  (p_org, 'ward_manager', 'Ward manager', 'Runs a ward: beds, admissions to it, nursing clearance.',
    array['patients.read','patients.clinical','ipd.read','ipd.allocate_bed','ipd.transfer','ipd.manage_beds','nursing.notes','vitals.record','vitals.escalate','fluids.record','meds.administer','discharge.clear_nursing'], true),
  (p_org, 'nurse', 'Nurse', 'Patients on assigned wards: observations, eMAR, nursing notes.',
    array['patients.read','patients.clinical','ipd.read','ipd.manage_beds','nursing.notes','vitals.record','vitals.escalate','fluids.record','meds.administer'], true),
  (p_org, 'pharmacist', 'Pharmacist', 'Verifies and dispenses; pharmacy clearance.',
    array['patients.read','patients.clinical','ipd.read','ipd.all_patients','meds.verify','discharge.clear_pharmacy'], true),
  (p_org, 'receptionist', 'Receptionist', 'Registers patients.',
    array['patients.read','patients.register','patients.edit'], true),
  (p_org, 'cashier', 'Cashier', 'Bills and payments. No clinical notes.',
    array['patients.read','billing.read','billing.charge','billing.payment','discharge.clear_billing'], true),
  (p_org, 'accountant', 'Accountant', 'Billing oversight, adjustments, reports.',
    array['patients.read','billing.read','billing.charge','billing.payment','billing.adjust','discharge.clear_billing','reports.read'], true),
  (p_org, 'records_officer', 'Medical records officer', 'Patient register and records.',
    array['patients.read','patients.register','patients.edit','patients.clinical','audit.read'], true)
  on conflict (organization_id, code) do nothing;
end $$;

-- Platform admin creates a hospital organisation, its first facility, the
-- standard roles, and makes `p_admin_user` its administrator.
create or replace function public.edoshmis_create_organization(
  p_name text, p_facility_name text, p_facility_code text, p_admin_user uuid, p_admin_name text,
  p_level public.edoshmis_facility_level default 'other', p_county text default null, p_mfl_code text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_fac uuid; v_staff uuid;
begin
  if not public.edoshmis_is_platform_admin() then
    raise exception 'Only EDOS Centre can create a hospital organisation.' using errcode = '42501';
  end if;
  insert into public.edoshmis_organizations (name, created_by) values (trim(p_name), auth.uid()) returning id into v_org;
  insert into public.edoshmis_facilities (organization_id, name, code, level, county, mfl_code)
  values (v_org, trim(p_facility_name), upper(trim(p_facility_code)), p_level, p_county, p_mfl_code) returning id into v_fac;
  perform public.edoshmis_seed_roles(v_org);
  insert into public.edoshmis_staff (organization_id, user_id, full_name, designation)
  values (v_org, p_admin_user, trim(p_admin_name), 'administrator') returning id into v_staff;
  insert into public.edoshmis_staff_roles (staff_id, role_id)
  select v_staff, id from public.edoshmis_roles where organization_id = v_org and code = 'hospital_admin';
  perform public.edoshmis_audit(v_org, v_fac, 'organization.created', 'organization', v_org::text, null, null,
    jsonb_build_object('name', p_name, 'facility', p_facility_name, 'admin', p_admin_name));
  return v_org;
end $$;

create or replace function public.edoshmis_record_login(p_user_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.edoshmis_login_events (user_id, organization_id, user_agent)
  select auth.uid(), (select organization_id from public.edoshmis_staff where user_id = auth.uid() and status = 'active' limit 1), left(p_user_agent, 300);
end $$;

create or replace function public.edoshmis_log_access(p_patient uuid, p_facility uuid, p_context text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.edoshmis_patients where id = p_patient;
  if v_org is null or not public.edoshmis_is_member(v_org) then return; end if;
  insert into public.edoshmis_access_logs (organization_id, facility_id, patient_id, user_id, staff_id, context)
  values (v_org, p_facility, p_patient, auth.uid(), public.edoshmis_staff_id(v_org), left(p_context, 80));
end $$;

-- ---------------------------------------------------------------- triggers

drop trigger if exists edoshmis_organizations_touch on public.edoshmis_organizations;
create trigger edoshmis_organizations_touch before update on public.edoshmis_organizations for each row execute function public.edoshmis_touch_updated_at();
drop trigger if exists edoshmis_facilities_touch on public.edoshmis_facilities;
create trigger edoshmis_facilities_touch before update on public.edoshmis_facilities for each row execute function public.edoshmis_touch_updated_at();
drop trigger if exists edoshmis_staff_touch on public.edoshmis_staff;
create trigger edoshmis_staff_touch before update on public.edoshmis_staff for each row execute function public.edoshmis_touch_updated_at();
drop trigger if exists edoshmis_roles_touch on public.edoshmis_roles;
create trigger edoshmis_roles_touch before update on public.edoshmis_roles for each row execute function public.edoshmis_touch_updated_at();

drop trigger if exists edoshmis_facilities_audit on public.edoshmis_facilities;
create trigger edoshmis_facilities_audit after insert or update on public.edoshmis_facilities for each row execute function public.edoshmis_audit_trigger();
drop trigger if exists edoshmis_staff_audit on public.edoshmis_staff;
create trigger edoshmis_staff_audit after insert or update on public.edoshmis_staff for each row execute function public.edoshmis_audit_trigger();
drop trigger if exists edoshmis_roles_audit on public.edoshmis_roles;
create trigger edoshmis_roles_audit after insert or update or delete on public.edoshmis_roles for each row execute function public.edoshmis_audit_trigger();
drop trigger if exists edoshmis_staff_roles_audit on public.edoshmis_staff_roles;
create trigger edoshmis_staff_roles_audit after insert or delete on public.edoshmis_staff_roles for each row execute function public.edoshmis_audit_trigger();

-- ---------------------------------------------------------------- RLS

alter table public.edoshmis_platform_admins enable row level security;
alter table public.edoshmis_organizations enable row level security;
alter table public.edoshmis_facilities enable row level security;
alter table public.edoshmis_departments enable row level security;
alter table public.edoshmis_staff enable row level security;
alter table public.edoshmis_permission_catalog enable row level security;
alter table public.edoshmis_roles enable row level security;
alter table public.edoshmis_staff_roles enable row level security;
alter table public.edoshmis_counters enable row level security;
alter table public.edoshmis_audit_logs enable row level security;
alter table public.edoshmis_access_logs enable row level security;
alter table public.edoshmis_login_events enable row level security;

drop policy if exists edoshmis_platform_admins_self on public.edoshmis_platform_admins;
create policy edoshmis_platform_admins_self on public.edoshmis_platform_admins for select to authenticated using (user_id = auth.uid());

drop policy if exists edoshmis_organizations_read on public.edoshmis_organizations;
create policy edoshmis_organizations_read on public.edoshmis_organizations for select to authenticated
  using (public.edoshmis_is_member(id) or public.edoshmis_is_platform_admin());
drop policy if exists edoshmis_organizations_edit on public.edoshmis_organizations;
create policy edoshmis_organizations_edit on public.edoshmis_organizations for update to authenticated
  using (public.edoshmis_has_org_perm(id, 'admin.facility')) with check (public.edoshmis_has_org_perm(id, 'admin.facility'));

drop policy if exists edoshmis_facilities_read on public.edoshmis_facilities;
create policy edoshmis_facilities_read on public.edoshmis_facilities for select to authenticated
  using (public.edoshmis_is_member(organization_id) or public.edoshmis_is_platform_admin());
drop policy if exists edoshmis_facilities_write on public.edoshmis_facilities;
create policy edoshmis_facilities_write on public.edoshmis_facilities for all to authenticated
  using (public.edoshmis_has_org_perm(organization_id, 'admin.facility')) with check (public.edoshmis_has_org_perm(organization_id, 'admin.facility'));

drop policy if exists edoshmis_departments_read on public.edoshmis_departments;
create policy edoshmis_departments_read on public.edoshmis_departments for select to authenticated
  using (public.edoshmis_is_member(public.edoshmis_facility_org(facility_id)));
drop policy if exists edoshmis_departments_write on public.edoshmis_departments;
create policy edoshmis_departments_write on public.edoshmis_departments for all to authenticated
  using (public.edoshmis_has_perm(facility_id, 'admin.facility')) with check (public.edoshmis_has_perm(facility_id, 'admin.facility'));

-- Colleagues can see each other's name and designation — every clinical
-- record shows its author. Changes go through admin.staff.
drop policy if exists edoshmis_staff_read on public.edoshmis_staff;
create policy edoshmis_staff_read on public.edoshmis_staff for select to authenticated
  using (user_id = auth.uid() or public.edoshmis_is_member(organization_id));
drop policy if exists edoshmis_staff_write on public.edoshmis_staff;
create policy edoshmis_staff_write on public.edoshmis_staff for all to authenticated
  using (public.edoshmis_has_org_perm(organization_id, 'admin.staff')) with check (public.edoshmis_has_org_perm(organization_id, 'admin.staff'));

drop policy if exists edoshmis_permission_catalog_read on public.edoshmis_permission_catalog;
create policy edoshmis_permission_catalog_read on public.edoshmis_permission_catalog for select to authenticated using (true);

drop policy if exists edoshmis_roles_read on public.edoshmis_roles;
create policy edoshmis_roles_read on public.edoshmis_roles for select to authenticated using (public.edoshmis_is_member(organization_id));
drop policy if exists edoshmis_roles_write on public.edoshmis_roles;
create policy edoshmis_roles_write on public.edoshmis_roles for all to authenticated
  using (public.edoshmis_has_org_perm(organization_id, 'admin.roles')) with check (public.edoshmis_has_org_perm(organization_id, 'admin.roles'));

drop policy if exists edoshmis_staff_roles_read on public.edoshmis_staff_roles;
create policy edoshmis_staff_roles_read on public.edoshmis_staff_roles for select to authenticated
  using (exists (select 1 from public.edoshmis_staff s where s.id = staff_id and (s.user_id = auth.uid() or public.edoshmis_is_member(s.organization_id))));
drop policy if exists edoshmis_staff_roles_write on public.edoshmis_staff_roles;
create policy edoshmis_staff_roles_write on public.edoshmis_staff_roles for all to authenticated
  using (exists (select 1 from public.edoshmis_staff s where s.id = staff_id and public.edoshmis_has_org_perm(s.organization_id, 'admin.staff')))
  with check (exists (select 1 from public.edoshmis_staff s where s.id = staff_id and public.edoshmis_has_org_perm(s.organization_id, 'admin.staff')));

-- Counters: no policy — only the security-definer numbering function touches them.

drop policy if exists edoshmis_audit_logs_read on public.edoshmis_audit_logs;
create policy edoshmis_audit_logs_read on public.edoshmis_audit_logs for select to authenticated
  using (organization_id is not null and public.edoshmis_has_org_perm(organization_id, 'audit.read'));
drop policy if exists edoshmis_access_logs_read on public.edoshmis_access_logs;
create policy edoshmis_access_logs_read on public.edoshmis_access_logs for select to authenticated
  using (public.edoshmis_has_org_perm(organization_id, 'audit.read'));
drop policy if exists edoshmis_login_events_read on public.edoshmis_login_events;
create policy edoshmis_login_events_read on public.edoshmis_login_events for select to authenticated
  using (user_id = auth.uid() or (organization_id is not null and public.edoshmis_has_org_perm(organization_id, 'audit.read')));

-- Functions run as their owner; ordinary callers may only execute them.
revoke all on function public.edoshmis_next_number(uuid, text, text) from public, anon, authenticated;
revoke all on function public.edoshmis_audit(uuid, uuid, text, text, text, uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.edoshmis_seed_roles(uuid) from public, anon, authenticated;
