-- EDOSHMIS 0010 — outpatients (OPD) and emergency (ED), and role defaults.
--
--   appointment (optional) → check-in: encounter, queue number, bill opened
--   → triage → consultation (signed, addenda after) → diagnoses, outpatient
--   prescriptions, lab/imaging orders (0011, 0012) → close the visit:
--   home, referred, admitted (through an admission request), left, died.
--
-- Emergency is the same encounter with kind = 'emergency', a triage
-- category on arrival, and an arrival mode.

-- ---------------------------------------------------------------- role defaults

-- What each standard role holds. New modules add their permissions here;
-- edoshmis_sync_roles() creates missing standard roles in an organisation
-- and adds (never removes) default permissions to its standard roles, so a
-- hospital's own changes are kept.
create table if not exists public.edoshmis_role_defaults (
  code text primary key,
  name text not null,
  description text,
  permissions text[] not null default '{}',
  -- True for roles that did not exist in the 0001 starter set: sync creates
  -- them in every organisation. Starter roles are created by
  -- edoshmis_seed_roles and only receive the extra permissions.
  creates boolean not null default false
);
alter table public.edoshmis_role_defaults enable row level security;
drop policy if exists edoshmis_role_defaults_read on public.edoshmis_role_defaults;
create policy edoshmis_role_defaults_read on public.edoshmis_role_defaults for select to authenticated using (true);

create or replace function public.edoshmis_add_role_default(p_code text, p_name text, p_description text, p_perms text[], p_creates boolean default false)
returns void language sql as $$
  insert into public.edoshmis_role_defaults (code, name, description, permissions, creates) values (p_code, p_name, p_description, p_perms, p_creates)
  on conflict (code) do update set
    permissions = (select array_agg(distinct x order by x) from unnest(public.edoshmis_role_defaults.permissions || excluded.permissions) x),
    name = excluded.name, description = coalesce(excluded.description, public.edoshmis_role_defaults.description),
    creates = public.edoshmis_role_defaults.creates or excluded.creates;
$$;

-- Any standard role, whenever it is created, starts with the current defaults.
create or replace function public.edoshmis_roles_apply_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare d text[];
begin
  if new.is_system then
    select permissions into d from public.edoshmis_role_defaults where code = new.code;
    if d is not null then new.permissions := (select array_agg(distinct x order by x) from unnest(new.permissions || d) x); end if;
  end if;
  return new;
end $$;
drop trigger if exists edoshmis_roles_apply_defaults on public.edoshmis_roles;
create trigger edoshmis_roles_apply_defaults before insert on public.edoshmis_roles for each row execute function public.edoshmis_roles_apply_defaults();

create or replace function public.edoshmis_sync_roles(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.edoshmis_roles (organization_id, code, name, description, permissions, is_system)
  select p_org, d.code, d.name, d.description, '{}', true from public.edoshmis_role_defaults d where d.creates
  on conflict (organization_id, code) do nothing;
  -- Add, never remove: permissions newly in the defaults reach existing standard roles.
  update public.edoshmis_roles r set permissions = (select array_agg(distinct x order by x) from unnest(r.permissions || d.permissions) x)
  from public.edoshmis_role_defaults d
  where r.organization_id = p_org and r.code = d.code and r.is_system and not (d.permissions <@ r.permissions);
end $$;

create or replace function public.edoshmis_sync_all_roles()
returns void language plpgsql security definer set search_path = '' as $$
declare o uuid;
begin
  for o in select id from public.edoshmis_organizations loop perform public.edoshmis_sync_roles(o); end loop;
end $$;

-- New organisations get the roles added after 0001 as well.
create or replace function public.edoshmis_roles_after_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.edoshmis_sync_roles(new.id);
  return new;
end $$;
drop trigger if exists edoshmis_organizations_sync_roles on public.edoshmis_organizations;
create trigger edoshmis_organizations_sync_roles after insert on public.edoshmis_organizations for each row execute function public.edoshmis_roles_after_org();

revoke all on function public.edoshmis_add_role_default(text, text, text, text[], boolean) from public, anon, authenticated;
revoke all on function public.edoshmis_sync_roles(uuid) from public, anon, authenticated;
revoke all on function public.edoshmis_sync_all_roles() from public, anon, authenticated;

-- ---------------------------------------------------------------- permissions

insert into public.edoshmis_permission_catalog (key, area, label) values
  ('opd.read', 'Outpatients', 'See the outpatient and emergency queue and consultations'),
  ('opd.register', 'Outpatients', 'Book appointments and check patients in'),
  ('opd.triage', 'Outpatients', 'Triage: record vital signs and the triage category'),
  ('opd.consult', 'Outpatients', 'Consult: notes, diagnoses, prescriptions, close the visit')
on conflict (key) do update set area = excluded.area, label = excluded.label;

select public.edoshmis_add_role_default('receptionist', 'Receptionist', 'Registers patients, books and checks in.', array['opd.read', 'opd.register']);
select public.edoshmis_add_role_default('triage_officer', 'Triage officer', 'Triages outpatients and emergency arrivals.', array['patients.read', 'patients.clinical', 'opd.read', 'opd.triage'], true);
select public.edoshmis_add_role_default('nurse', 'Nurse', null, array['opd.read', 'opd.triage']);
select public.edoshmis_add_role_default('nursing_officer', 'Nursing officer', null, array['opd.read', 'opd.triage']);
select public.edoshmis_add_role_default('clinical_officer', 'Clinical officer', null, array['opd.read', 'opd.triage', 'opd.consult']);
select public.edoshmis_add_role_default('medical_officer', 'Medical officer', null, array['opd.read', 'opd.triage', 'opd.consult']);
select public.edoshmis_add_role_default('consultant', 'Consultant', null, array['opd.read', 'opd.consult']);
select public.edoshmis_add_role_default('medical_superintendent', 'Medical superintendent', null, array['opd.read', 'opd.consult']);
select public.edoshmis_add_role_default('pharmacist', 'Pharmacist', null, array['opd.read']);
select public.edoshmis_add_role_default('cashier', 'Cashier', null, array['opd.read']);

-- ---------------------------------------------------------------- appointments

create table if not exists public.edoshmis_appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  department_id uuid references public.edoshmis_departments (id),
  clinician_id uuid references public.edoshmis_staff (id),
  scheduled_at timestamptz not null,
  duration_minutes int not null default 15 check (duration_minutes between 5 and 480),
  reason text,
  status text not null default 'booked' check (status in ('booked', 'checked_in', 'completed', 'cancelled', 'no_show')),
  booked_by uuid references public.edoshmis_staff (id),
  cancel_reason text,
  rescheduled_from uuid references public.edoshmis_appointments (id),
  encounter_id uuid references public.edoshmis_encounters (id),
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_appointments_day_idx on public.edoshmis_appointments (facility_id, scheduled_at);
create index if not exists edoshmis_appointments_patient_idx on public.edoshmis_appointments (patient_id, scheduled_at desc);

-- ---------------------------------------------------------------- encounter: visit fields

alter table public.edoshmis_encounters add column if not exists department_id uuid references public.edoshmis_departments (id);
alter table public.edoshmis_encounters add column if not exists appointment_id uuid references public.edoshmis_appointments (id);
alter table public.edoshmis_encounters add column if not exists queue_number int;
alter table public.edoshmis_encounters add column if not exists queue_date date;
alter table public.edoshmis_encounters add column if not exists stage text not null default 'waiting_triage';
alter table public.edoshmis_encounters add column if not exists triage_category text;
alter table public.edoshmis_encounters add column if not exists chief_complaint text;
alter table public.edoshmis_encounters add column if not exists arrival_mode text;
alter table public.edoshmis_encounters add column if not exists payment_category public.edoshmis_payment_category not null default 'cash';
alter table public.edoshmis_encounters add column if not exists assigned_clinician_id uuid references public.edoshmis_staff (id);
alter table public.edoshmis_encounters add column if not exists triaged_at timestamptz;
alter table public.edoshmis_encounters add column if not exists seen_at timestamptz;
alter table public.edoshmis_encounters add column if not exists outcome text;
alter table public.edoshmis_encounters add column if not exists outcome_note text;
alter table public.edoshmis_encounters add column if not exists follow_up_date date;
do $$ begin
  alter table public.edoshmis_encounters add constraint edoshmis_encounters_stage_chk
    check (stage in ('waiting_triage', 'waiting_doctor', 'with_doctor', 'investigations', 'pharmacy', 'billing', 'done'));
exception when duplicate_object then null; end $$;
do $$ begin
  -- Five-level triage, from immediate to non-urgent. The categories are a
  -- classification; which signs put a patient in which is the hospital's
  -- triage protocol, applied by the triage officer.
  alter table public.edoshmis_encounters add constraint edoshmis_encounters_triage_chk
    check (triage_category is null or triage_category in ('immediate', 'very_urgent', 'urgent', 'standard', 'non_urgent'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.edoshmis_encounters add constraint edoshmis_encounters_outcome_chk
    check (outcome is null or outcome in ('home', 'follow_up', 'referred', 'admitted', 'left_without_being_seen', 'left_against_advice', 'died', 'cancelled'));
exception when duplicate_object then null; end $$;
create unique index if not exists edoshmis_encounters_queue_uniq on public.edoshmis_encounters (facility_id, queue_date, kind, queue_number) where queue_number is not null;
create index if not exists edoshmis_encounters_open_idx on public.edoshmis_encounters (facility_id, kind, status) where status = 'open';

-- One open outpatient/emergency visit per patient per facility.
create unique index if not exists edoshmis_encounters_one_open_visit
  on public.edoshmis_encounters (facility_id, patient_id) where status = 'open' and kind in ('opd', 'emergency');

-- Billing accounts can belong to an encounter (OPD/ED) as well as an admission.
create unique index if not exists edoshmis_billing_accounts_encounter_uniq
  on public.edoshmis_billing_accounts (encounter_id) where admission_id is null and encounter_id is not null;

-- ---------------------------------------------------------------- triage, consultation, prescriptions

create table if not exists public.edoshmis_triage_records (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  encounter_id uuid not null references public.edoshmis_encounters (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  recorded_by uuid not null references public.edoshmis_staff (id),
  recorded_at timestamptz not null default now(),
  triage_category text not null check (triage_category in ('immediate', 'very_urgent', 'urgent', 'standard', 'non_urgent')),
  chief_complaint text not null check (length(trim(chief_complaint)) between 2 and 500),
  temperature numeric(4, 1) check (temperature is null or temperature between 25 and 45),
  pulse int check (pulse is null or pulse between 0 and 300),
  respiratory_rate int check (respiratory_rate is null or respiratory_rate between 0 and 120),
  systolic_bp int check (systolic_bp is null or systolic_bp between 0 and 300),
  diastolic_bp int check (diastolic_bp is null or diastolic_bp between 0 and 250),
  spo2 int check (spo2 is null or spo2 between 0 and 100),
  weight_kg numeric(5, 2) check (weight_kg is null or weight_kg between 0.2 and 400),
  height_cm numeric(5, 1) check (height_cm is null or height_cm between 20 and 260),
  muac_cm numeric(4, 1),
  pain_score int check (pain_score is null or pain_score between 0 and 10),
  blood_glucose_mmol numeric(4, 1),
  consciousness public.edoshmis_avpu,
  pregnant boolean,
  notes text,
  client_id uuid unique,
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_triage_records_encounter_idx on public.edoshmis_triage_records (encounter_id, recorded_at desc);

create table if not exists public.edoshmis_consultations (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  encounter_id uuid not null references public.edoshmis_encounters (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  author_id uuid not null references public.edoshmis_staff (id),
  author_designation text not null,
  presenting_complaint text,
  history text,
  examination text not null check (length(trim(examination)) between 2 and 20000),
  assessment text,
  plan text,
  status text not null default 'draft' check (status in ('draft', 'signed')),
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists edoshmis_consultations_encounter_idx on public.edoshmis_consultations (encounter_id);

create table if not exists public.edoshmis_consultation_addenda (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  consultation_id uuid not null references public.edoshmis_consultations (id),
  author_id uuid not null references public.edoshmis_staff (id),
  author_designation text not null,
  body text not null check (length(trim(body)) between 2 and 5000),
  created_at timestamptz not null default now()
);

create table if not exists public.edoshmis_outpatient_prescriptions (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  encounter_id uuid not null references public.edoshmis_encounters (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  drug_id uuid references public.edoshmis_drugs (id),
  drug_name text not null,
  dose numeric(10, 3) not null check (dose > 0),
  dose_unit text not null,
  route text not null,
  frequency text not null,
  duration_days int check (duration_days is null or duration_days between 1 and 365),
  quantity numeric(10, 2) not null check (quantity > 0),
  instructions text,
  allergy_override_reason text,
  status text not null default 'prescribed' check (status in ('prescribed', 'dispensed', 'cancelled')),
  prescribed_by uuid not null references public.edoshmis_staff (id),
  prescribed_at timestamptz not null default now(),
  dispensed_by uuid references public.edoshmis_staff (id),
  dispensed_at timestamptz,
  dispensed_quantity numeric(10, 2),
  batch_number text,
  expiry_date date,
  cancel_reason text
);
create index if not exists edoshmis_outpatient_rx_queue_idx on public.edoshmis_outpatient_prescriptions (facility_id, status) where status = 'prescribed';
create index if not exists edoshmis_outpatient_rx_encounter_idx on public.edoshmis_outpatient_prescriptions (encounter_id);

-- ---------------------------------------------------------------- functions

create or replace function public.edoshmis_open_encounter_account(p_encounter uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.edoshmis_encounters; v_id uuid; v_code text; v_year text;
begin
  select * into e from public.edoshmis_encounters where id = p_encounter;
  select id into v_id from public.edoshmis_billing_accounts where encounter_id = p_encounter and admission_id is null;
  if v_id is not null then return v_id; end if;
  select code into v_code from public.edoshmis_facilities where id = e.facility_id;
  v_year := to_char(now() at time zone 'Africa/Nairobi', 'YYYY');
  insert into public.edoshmis_billing_accounts (organization_id, facility_id, patient_id, encounter_id, account_number, payer_category)
  values (e.organization_id, e.facility_id, e.patient_id, e.id,
          v_code || '/' || case e.kind when 'emergency' then 'EDB' else 'OPB' end || '/' || v_year || '/' ||
          lpad(public.edoshmis_next_number(e.facility_id, 'op_account', v_year)::text, 6, '0'), e.payment_category)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.edoshmis_open_encounter_account(uuid) from public, anon, authenticated;

create or replace function public.edoshmis_book_appointment(p_facility uuid, a jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_staff uuid := public.edoshmis_require(p_facility, 'opd.register'); v_org uuid := public.edoshmis_facility_org(p_facility); v_id uuid; v_at timestamptz := (a ->> 'scheduled_at')::timestamptz;
begin
  if v_at is null then raise exception 'Choose the date and time.'; end if;
  if v_at < now() - interval '1 hour' then raise exception 'That time has passed.'; end if;
  if not exists (select 1 from public.edoshmis_patients where id = (a ->> 'patient_id')::uuid and organization_id = v_org) then raise exception 'Patient not found.'; end if;
  insert into public.edoshmis_appointments (organization_id, facility_id, patient_id, department_id, clinician_id, scheduled_at, duration_minutes, reason, booked_by, rescheduled_from)
  values (v_org, p_facility, (a ->> 'patient_id')::uuid, nullif(a ->> 'department_id', '')::uuid, nullif(a ->> 'clinician_id', '')::uuid, v_at,
          coalesce(nullif(a ->> 'duration_minutes', '')::int, 15), nullif(trim(a ->> 'reason'), ''), v_staff, nullif(a ->> 'rescheduled_from', '')::uuid)
  returning id into v_id;
  if nullif(a ->> 'rescheduled_from', '') is not null then
    update public.edoshmis_appointments set status = 'cancelled', cancel_reason = 'Rescheduled' where id = (a ->> 'rescheduled_from')::uuid and status = 'booked';
  end if;
  return v_id;
end $$;

create or replace function public.edoshmis_cancel_appointment(p_appointment uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare ap public.edoshmis_appointments;
begin
  select * into ap from public.edoshmis_appointments where id = p_appointment for update;
  if not found then raise exception 'Appointment not found.'; end if;
  perform public.edoshmis_require(ap.facility_id, 'opd.register');
  if ap.status <> 'booked' then raise exception 'This appointment is already %.', ap.status; end if;
  if p_status not in ('cancelled', 'no_show') then raise exception 'Unknown status.'; end if;
  if p_status = 'cancelled' and coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason.'; end if;
  update public.edoshmis_appointments set status = p_status, cancel_reason = nullif(trim(p_reason), '') where id = p_appointment;
end $$;

-- Check a patient in: an encounter with a queue number for the day, the
-- appointment marked, and a bill opened. Emergency arrivals may carry a
-- triage category from the door.
create or replace function public.edoshmis_check_in(p_facility uuid, c jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_staff uuid := public.edoshmis_require(p_facility, 'opd.register'); v_org uuid := public.edoshmis_facility_org(p_facility);
  v_kind text := coalesce(nullif(c ->> 'kind', ''), 'opd'); v_patient uuid := (c ->> 'patient_id')::uuid; v_id uuid; v_code text; v_year text;
  v_day date := (now() at time zone 'Africa/Nairobi')::date; v_q int; v_appt uuid := nullif(c ->> 'appointment_id', '')::uuid;
begin
  if v_kind not in ('opd', 'emergency') then raise exception 'Unknown visit type.'; end if;
  if not exists (select 1 from public.edoshmis_patients where id = v_patient and organization_id = v_org and deleted_at is null) then raise exception 'Patient not found.'; end if;
  if exists (select 1 from public.edoshmis_patients where id = v_patient and is_deceased) then raise exception 'This patient is recorded as deceased.'; end if;
  if exists (select 1 from public.edoshmis_encounters where facility_id = p_facility and patient_id = v_patient and status = 'open' and kind in ('opd', 'emergency')) then
    raise exception 'This patient already has an open visit here.';
  end if;
  if exists (select 1 from public.edoshmis_admissions where patient_id = v_patient and status in ('active', 'discharge_in_progress')) then
    raise exception 'This patient is currently admitted.';
  end if;
  select code into v_code from public.edoshmis_facilities where id = p_facility;
  v_year := to_char(now() at time zone 'Africa/Nairobi', 'YYYY');
  v_q := public.edoshmis_next_number(p_facility, 'queue_' || v_kind, v_day::text)::int;
  insert into public.edoshmis_encounters (organization_id, facility_id, patient_id, encounter_number, kind, created_by, department_id, appointment_id,
    queue_number, queue_date, stage, triage_category, chief_complaint, arrival_mode, payment_category, assigned_clinician_id)
  values (v_org, p_facility, v_patient,
          case v_kind when 'emergency' then 'ED' else 'OP' end || v_year || '-' || lpad(public.edoshmis_next_number(p_facility, 'encounter_' || v_kind, v_year)::text, 6, '0'),
          v_kind, v_staff, nullif(c ->> 'department_id', '')::uuid, v_appt, v_q, v_day, 'waiting_triage',
          nullif(c ->> 'triage_category', ''), nullif(trim(c ->> 'chief_complaint'), ''), nullif(c ->> 'arrival_mode', ''),
          coalesce(nullif(c ->> 'payment_category', ''), 'cash')::public.edoshmis_payment_category, nullif(c ->> 'clinician_id', '')::uuid)
  returning id into v_id;
  if v_appt is not null then
    update public.edoshmis_appointments set status = 'checked_in', encounter_id = v_id where id = v_appt and patient_id = v_patient and status = 'booked';
  end if;
  perform public.edoshmis_open_encounter_account(v_id);
  perform public.edoshmis_audit(v_org, p_facility, 'visit.checked_in', 'encounter', v_id::text, v_patient, null, c);
  return v_id;
end $$;

create or replace function public.edoshmis_set_visit_stage(p_encounter uuid, p_stage text, p_clinician uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.edoshmis_encounters;
begin
  select * into e from public.edoshmis_encounters where id = p_encounter for update;
  if not found or e.kind not in ('opd', 'emergency') then raise exception 'Visit not found.'; end if;
  if e.status <> 'open' then raise exception 'This visit is closed.'; end if;
  if not (public.edoshmis_has_perm(e.facility_id, 'opd.consult') or public.edoshmis_has_perm(e.facility_id, 'opd.triage') or public.edoshmis_has_perm(e.facility_id, 'opd.register')) then
    raise exception 'You do not have permission to move patients in the queue.' using errcode = '42501';
  end if;
  if p_stage = 'done' then raise exception 'Close the visit with its outcome instead.'; end if;
  update public.edoshmis_encounters set stage = p_stage,
    assigned_clinician_id = coalesce(p_clinician, assigned_clinician_id),
    seen_at = case when p_stage = 'with_doctor' and seen_at is null then now() else seen_at end
  where id = p_encounter;
end $$;

-- Close a visit. "Admitted" requires the admission request to exist (made
-- from the consultation); the admission itself closes nothing here — edoshmis_admit
-- closes this encounter when the patient reaches a bed.
create or replace function public.edoshmis_close_visit(p_encounter uuid, p_outcome text, p_note text default null, p_follow_up date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.edoshmis_encounters; v_staff uuid;
begin
  select * into e from public.edoshmis_encounters where id = p_encounter for update;
  if not found or e.kind not in ('opd', 'emergency') then raise exception 'Visit not found.'; end if;
  if e.status <> 'open' then raise exception 'This visit is already closed.'; end if;
  if p_outcome in ('left_without_being_seen', 'cancelled') then
    if not (public.edoshmis_has_perm(e.facility_id, 'opd.register') or public.edoshmis_has_perm(e.facility_id, 'opd.consult')) then
      raise exception 'You do not have permission to close this visit.' using errcode = '42501';
    end if;
  else
    v_staff := public.edoshmis_require(e.facility_id, 'opd.consult');
  end if;
  if p_outcome = 'admitted' and not exists (
      select 1 from public.edoshmis_admission_requests where source_encounter_id = p_encounter and status in ('pending', 'approved', 'admitted')) then
    raise exception 'Request the admission first (it links this visit), then close it as admitted.';
  end if;
  if p_outcome in ('referred', 'died', 'left_against_advice', 'left_without_being_seen', 'cancelled') and coalesce(trim(p_note), '') = '' then
    raise exception 'Add a note: where referred, or what happened.';
  end if;
  update public.edoshmis_encounters set
    status = case when p_outcome = 'cancelled' then 'cancelled' when p_outcome = 'admitted' then status else 'closed' end,
    stage = 'done', outcome = p_outcome, outcome_note = nullif(trim(p_note), ''), follow_up_date = p_follow_up,
    ended_at = case when p_outcome = 'admitted' then ended_at else now() end
  where id = p_encounter;
  if p_outcome = 'died' then update public.edoshmis_patients set is_deceased = true, deceased_at = now() where id = e.patient_id; end if;
  update public.edoshmis_appointments set status = 'completed' where encounter_id = p_encounter and status = 'checked_in';
  perform public.edoshmis_audit(e.organization_id, e.facility_id, 'visit.closed', 'encounter', p_encounter::text, e.patient_id, null,
    jsonb_build_object('outcome', p_outcome, 'follow_up', p_follow_up), p_note);
end $$;

create or replace function public.edoshmis_prescribe_outpatient(p_encounter uuid, o jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare e public.edoshmis_encounters; v_staff uuid; v_drug uuid := nullif(o ->> 'drug_id', '')::uuid; v_name text; v_allergies text; v_id uuid;
begin
  select * into e from public.edoshmis_encounters where id = p_encounter;
  if not found or e.kind not in ('opd', 'emergency') then raise exception 'Visit not found.'; end if;
  v_staff := public.edoshmis_require(e.facility_id, 'opd.consult');
  if e.status <> 'open' then raise exception 'This visit is closed.'; end if;
  if v_drug is not null then
    select trim(generic_name || coalesce(' ' || strength, '')) into v_name from public.edoshmis_drugs where id = v_drug and organization_id = e.organization_id and is_active;
    if v_name is null then raise exception 'That drug is not in the catalogue.'; end if;
  else
    v_name := trim(o ->> 'drug_name');
    if coalesce(v_name, '') = '' then raise exception 'Choose the drug.'; end if;
  end if;
  select string_agg(substance || ' (' || severity || ')', '; ') into v_allergies from public.edoshmis_allergy_conflicts(e.patient_id, v_drug, v_name);
  if v_allergies is not null and coalesce(trim(o ->> 'allergy_override_reason'), '') = '' then
    raise exception 'Allergy warning: % is recorded for this patient. Give a reason to prescribe anyway.', v_allergies using hint = 'allergy';
  end if;
  insert into public.edoshmis_outpatient_prescriptions (facility_id, encounter_id, patient_id, drug_id, drug_name, dose, dose_unit, route, frequency,
    duration_days, quantity, instructions, allergy_override_reason, prescribed_by)
  values (e.facility_id, p_encounter, e.patient_id, v_drug, v_name, (o ->> 'dose')::numeric, o ->> 'dose_unit', o ->> 'route', o ->> 'frequency',
    nullif(o ->> 'duration_days', '')::int, (o ->> 'quantity')::numeric, nullif(trim(o ->> 'instructions'), ''),
    case when v_allergies is not null then trim(o ->> 'allergy_override_reason') end, v_staff)
  returning id into v_id;
  perform public.edoshmis_audit(e.organization_id, e.facility_id, 'medication.prescribed_outpatient', 'outpatient_prescription', v_id::text, e.patient_id, null, o);
  return v_id;
end $$;

create or replace function public.edoshmis_dispense_outpatient(p_rx uuid, d jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare rx public.edoshmis_outpatient_prescriptions; v_staff uuid; v_tariff uuid; v_acct uuid;
begin
  select * into rx from public.edoshmis_outpatient_prescriptions where id = p_rx for update;
  if not found then raise exception 'Prescription not found.'; end if;
  v_staff := public.edoshmis_require(rx.facility_id, 'meds.verify');
  if rx.status <> 'prescribed' then raise exception 'This prescription is already %.', rx.status; end if;
  if nullif(d ->> 'expiry_date', '')::date < (now() at time zone 'Africa/Nairobi')::date then raise exception 'That batch has expired.'; end if;
  update public.edoshmis_outpatient_prescriptions set status = 'dispensed', dispensed_by = v_staff, dispensed_at = now(),
    dispensed_quantity = coalesce(nullif(d ->> 'quantity', '')::numeric, rx.quantity), batch_number = nullif(trim(d ->> 'batch_number'), ''),
    expiry_date = nullif(d ->> 'expiry_date', '')::date
  where id = p_rx;
  select tariff_id into v_tariff from public.edoshmis_drugs where id = rx.drug_id;
  select id into v_acct from public.edoshmis_billing_accounts where encounter_id = rx.encounter_id and admission_id is null and status = 'open';
  if v_tariff is not null and v_acct is not null then
    perform public.edoshmis_post_keyed_charge(v_acct, v_tariff, rx.drug_name, (now() at time zone 'Africa/Nairobi')::date,
      coalesce(nullif(d ->> 'quantity', '')::numeric, rx.quantity), null, 'op_dispense:' || rx.id::text, 'dispense', rx.id, v_staff);
  end if;
  perform public.edoshmis_audit(public.edoshmis_facility_org(rx.facility_id), rx.facility_id, 'medication.dispensed_outpatient', 'outpatient_prescription', p_rx::text, rx.patient_id, null, d);
end $$;

create or replace function public.edoshmis_cancel_outpatient_rx(p_rx uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare rx public.edoshmis_outpatient_prescriptions;
begin
  select * into rx from public.edoshmis_outpatient_prescriptions where id = p_rx for update;
  if not found then raise exception 'Prescription not found.'; end if;
  if not (public.edoshmis_has_perm(rx.facility_id, 'opd.consult') or public.edoshmis_has_perm(rx.facility_id, 'meds.verify')) then
    raise exception 'You do not have permission to cancel this.' using errcode = '42501';
  end if;
  if rx.status <> 'prescribed' then raise exception 'Only an undispensed prescription can be cancelled.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason.'; end if;
  update public.edoshmis_outpatient_prescriptions set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_rx;
end $$;

-- ---------------------------------------------------------------- triggers

-- Triage: author from the session; the visit moves to "waiting for doctor"
-- and takes the triage category.
create or replace function public.edoshmis_triage_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.edoshmis_encounters;
begin
  select * into e from public.edoshmis_encounters where id = new.encounter_id;
  if e.status <> 'open' then raise exception 'This visit is closed.'; end if;
  new.recorded_by := coalesce(public.edoshmis_staff_id(e.organization_id), new.recorded_by);
  new.patient_id := e.patient_id;
  new.facility_id := e.facility_id;
  return new;
end $$;
create or replace function public.edoshmis_triage_after()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.edoshmis_encounters set triage_category = new.triage_category, chief_complaint = coalesce(chief_complaint, new.chief_complaint),
    triaged_at = coalesce(triaged_at, new.recorded_at), stage = case when stage = 'waiting_triage' then 'waiting_doctor' else stage end
  where id = new.encounter_id;
  return new;
end $$;
drop trigger if exists edoshmis_triage_records_before on public.edoshmis_triage_records;
create trigger edoshmis_triage_records_before before insert on public.edoshmis_triage_records for each row execute function public.edoshmis_triage_before();
drop trigger if exists edoshmis_triage_records_after on public.edoshmis_triage_records;
create trigger edoshmis_triage_records_after after insert on public.edoshmis_triage_records for each row execute function public.edoshmis_triage_after();
drop trigger if exists edoshmis_triage_records_append_only on public.edoshmis_triage_records;
create trigger edoshmis_triage_records_append_only before update or delete on public.edoshmis_triage_records for each row execute function public.edoshmis_append_only();

-- Consultations: like clinical notes — author from the session, frozen once signed.
create or replace function public.edoshmis_consultation_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_staff uuid; v_des text; e public.edoshmis_encounters;
begin
  if tg_op = 'INSERT' then
    select * into e from public.edoshmis_encounters where id = new.encounter_id;
    if e.status <> 'open' then raise exception 'This visit is closed.'; end if;
    select s.id, s.designation::text into v_staff, v_des from public.edoshmis_staff s
    where s.organization_id = e.organization_id and s.user_id = auth.uid() and s.status = 'active';
    if v_staff is null then raise exception 'You are not active staff here.' using errcode = '42501'; end if;
    new.author_id := v_staff; new.author_designation := v_des; new.patient_id := e.patient_id; new.facility_id := e.facility_id;
    new.signed_at := case when new.status = 'signed' then now() end;
    update public.edoshmis_encounters set stage = case when stage in ('waiting_triage', 'waiting_doctor') then 'with_doctor' else stage end,
      seen_at = coalesce(seen_at, now()), assigned_clinician_id = coalesce(assigned_clinician_id, v_staff) where id = e.id;
    return new;
  end if;
  if old.status = 'signed' then raise exception 'A signed consultation cannot be changed. Add an addendum.'; end if;
  if new.author_id <> old.author_id or new.encounter_id <> old.encounter_id then raise exception 'The author and visit of a consultation cannot change.'; end if;
  if old.author_id <> public.edoshmis_staff_id(public.edoshmis_facility_org(old.facility_id)) then raise exception 'Only the author can edit their draft.'; end if;
  if new.status = 'signed' then new.signed_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists edoshmis_consultations_guard on public.edoshmis_consultations;
create trigger edoshmis_consultations_guard before insert or update on public.edoshmis_consultations for each row execute function public.edoshmis_consultation_guard();

create or replace function public.edoshmis_consultation_addendum_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_staff uuid; v_des text;
begin
  if not exists (select 1 from public.edoshmis_consultations where id = new.consultation_id and status = 'signed') then
    raise exception 'Only a signed consultation takes addenda; edit the draft instead.';
  end if;
  select s.id, s.designation::text into v_staff, v_des from public.edoshmis_staff s
  where s.organization_id = public.edoshmis_facility_org(new.facility_id) and s.user_id = auth.uid() and s.status = 'active';
  if v_staff is null then raise exception 'You are not active staff here.' using errcode = '42501'; end if;
  new.author_id := v_staff; new.author_designation := v_des;
  return new;
end $$;
drop trigger if exists edoshmis_consultation_addenda_stamp on public.edoshmis_consultation_addenda;
create trigger edoshmis_consultation_addenda_stamp before insert on public.edoshmis_consultation_addenda for each row execute function public.edoshmis_consultation_addendum_stamp();
drop trigger if exists edoshmis_consultation_addenda_append_only on public.edoshmis_consultation_addenda;
create trigger edoshmis_consultation_addenda_append_only before update or delete on public.edoshmis_consultation_addenda for each row execute function public.edoshmis_append_only();

do $$ declare t text; begin
  foreach t in array array['edoshmis_appointments', 'edoshmis_consultations', 'edoshmis_outpatient_prescriptions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after update or delete on public.%I for each row execute function public.edoshmis_audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS

alter table public.edoshmis_appointments enable row level security;
alter table public.edoshmis_triage_records enable row level security;
alter table public.edoshmis_consultations enable row level security;
alter table public.edoshmis_consultation_addenda enable row level security;
alter table public.edoshmis_outpatient_prescriptions enable row level security;

-- The queue (who is waiting, where) is visible to anyone who works it,
-- the front desk included; what the doctor wrote is clinical.
drop policy if exists edoshmis_appointments_read on public.edoshmis_appointments;
create policy edoshmis_appointments_read on public.edoshmis_appointments for select to authenticated using (public.edoshmis_has_perm(facility_id, 'opd.read'));

drop policy if exists edoshmis_triage_records_read on public.edoshmis_triage_records;
create policy edoshmis_triage_records_read on public.edoshmis_triage_records for select to authenticated
  using (public.edoshmis_has_perm(facility_id, 'opd.read') and (public.edoshmis_has_perm(facility_id, 'opd.triage') or public.edoshmis_has_perm(facility_id, 'opd.consult')));
drop policy if exists edoshmis_triage_records_insert on public.edoshmis_triage_records;
create policy edoshmis_triage_records_insert on public.edoshmis_triage_records for insert to authenticated with check (public.edoshmis_has_perm(facility_id, 'opd.triage'));

drop policy if exists edoshmis_consultations_read on public.edoshmis_consultations;
create policy edoshmis_consultations_read on public.edoshmis_consultations for select to authenticated
  using (public.edoshmis_has_perm(facility_id, 'opd.consult') or (public.edoshmis_has_perm(facility_id, 'opd.read') and public.edoshmis_has_org_perm(public.edoshmis_facility_org(facility_id), 'patients.clinical')));
drop policy if exists edoshmis_consultations_insert on public.edoshmis_consultations;
create policy edoshmis_consultations_insert on public.edoshmis_consultations for insert to authenticated with check (public.edoshmis_has_perm(facility_id, 'opd.consult'));
drop policy if exists edoshmis_consultations_update on public.edoshmis_consultations;
create policy edoshmis_consultations_update on public.edoshmis_consultations for update to authenticated
  using (public.edoshmis_has_perm(facility_id, 'opd.consult')) with check (public.edoshmis_has_perm(facility_id, 'opd.consult'));

drop policy if exists edoshmis_consultation_addenda_read on public.edoshmis_consultation_addenda;
create policy edoshmis_consultation_addenda_read on public.edoshmis_consultation_addenda for select to authenticated
  using (exists (select 1 from public.edoshmis_consultations c where c.id = consultation_id));
drop policy if exists edoshmis_consultation_addenda_insert on public.edoshmis_consultation_addenda;
create policy edoshmis_consultation_addenda_insert on public.edoshmis_consultation_addenda for insert to authenticated with check (public.edoshmis_has_perm(facility_id, 'opd.consult'));

drop policy if exists edoshmis_outpatient_prescriptions_read on public.edoshmis_outpatient_prescriptions;
create policy edoshmis_outpatient_prescriptions_read on public.edoshmis_outpatient_prescriptions for select to authenticated
  using (public.edoshmis_has_perm(facility_id, 'opd.consult') or public.edoshmis_has_perm(facility_id, 'meds.verify'));

-- Diagnoses on an outpatient visit: the consulting clinician records them.
-- (The 0003 policies already allow clinical.diagnose; opd.consult is added.)
drop policy if exists edoshmis_diagnoses_insert_opd on public.edoshmis_diagnoses;
create policy edoshmis_diagnoses_insert_opd on public.edoshmis_diagnoses for insert to authenticated
  with check (admission_id is null and encounter_id is not null and public.edoshmis_has_perm(facility_id, 'opd.consult'));
drop policy if exists edoshmis_diagnoses_read_opd on public.edoshmis_diagnoses;
create policy edoshmis_diagnoses_read_opd on public.edoshmis_diagnoses for select to authenticated
  using (admission_id is null and public.edoshmis_has_perm(facility_id, 'opd.consult'));

-- Apply the role defaults (this file's, and every later one's) to every organisation.
select public.edoshmis_sync_all_roles();
