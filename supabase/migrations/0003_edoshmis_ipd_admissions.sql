-- EDOSHMIS 0003 — inpatient core: tariffs, wards, beds, encounters,
-- admission requests, admissions, diagnoses, care team, bed allocations,
-- and the workflow functions that move a patient through them.
--
-- A bed can never hold two patients: every allocation goes through a
-- function that locks the bed row first, and two partial unique indexes
-- (one open allocation per bed, one per admission) refuse the second
-- writer even if something bypassed the lock.

do $$ begin
  create type public.edoshmis_ward_type as enum (
    'general_medical', 'surgical', 'paediatric', 'maternity', 'neonatal', 'icu', 'hdu', 'isolation', 'orthopaedic',
    'oncology', 'psychiatric', 'private', 'vip', 'emergency_observation', 'other'
  );
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.edoshmis_bed_status as enum ('available', 'occupied', 'reserved', 'cleaning', 'maintenance', 'blocked');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.edoshmis_admission_source as enum ('opd', 'emergency', 'theatre', 'referral', 'direct', 'transfer_in');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.edoshmis_priority as enum ('elective', 'urgent', 'emergency');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.edoshmis_request_status as enum ('pending', 'approved', 'rejected', 'admitted', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.edoshmis_admission_status as enum (
    'active', 'discharge_in_progress', 'discharged', 'discharged_ama', 'transferred_out', 'deceased', 'absconded'
  );
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.edoshmis_payment_category as enum ('cash', 'sha', 'insurance', 'corporate', 'waiver');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- tariffs

create table if not exists public.edoshmis_tariffs (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,30}$'),
  name text not null,
  category text not null check (category in (
    'bed', 'ward', 'consultation', 'ward_round', 'nursing', 'medication', 'laboratory', 'radiology', 'theatre',
    'procedure', 'consumable', 'supplies', 'oxygen', 'icu', 'hdu', 'deposit', 'other')),
  unit text not null default 'each',
  price numeric(12, 2) not null check (price >= 0),
  sha_price numeric(12, 2) check (sha_price is null or sha_price >= 0),
  sha_service_code text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, code)
);

-- ---------------------------------------------------------------- wards & beds

create table if not exists public.edoshmis_wards (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id) on delete restrict,
  department_id uuid references public.edoshmis_departments (id),
  name text not null check (length(trim(name)) between 2 and 80),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{0,11}$'),
  ward_type public.edoshmis_ward_type not null,
  -- Who admits to it: 'any', or only one sex — a female surgical ward.
  sex_restriction text not null default 'any' check (sex_restriction in ('any', 'male', 'female')),
  isolation_capacity int not null default 0 check (isolation_capacity >= 0),
  ward_manager_id uuid references public.edoshmis_staff (id),
  responsible_nurse_id uuid references public.edoshmis_staff (id),
  responsible_consultant_id uuid references public.edoshmis_staff (id),
  daily_tariff_id uuid references public.edoshmis_tariffs (id),
  status text not null default 'open' check (status in ('open', 'closed', 'restricted')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, code)
);

create table if not exists public.edoshmis_beds (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id) on delete restrict,
  ward_id uuid not null references public.edoshmis_wards (id) on delete restrict,
  bed_number text not null check (length(trim(bed_number)) between 1 and 20),
  room text,
  category text not null default 'standard' check (category in ('standard', 'private', 'semi_private', 'icu', 'hdu', 'cot', 'incubator', 'labour', 'other')),
  sex_restriction text not null default 'any' check (sex_restriction in ('any', 'male', 'female')),
  is_isolation boolean not null default false,
  status public.edoshmis_bed_status not null default 'available',
  status_note text,
  status_changed_at timestamptz not null default now(),
  -- Kept by the allocation functions; the allocations table is the history.
  current_admission_id uuid,
  daily_tariff_id uuid references public.edoshmis_tariffs (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (ward_id, bed_number)
);
create index if not exists edoshmis_beds_ward_idx on public.edoshmis_beds (ward_id, status);

-- Every status change of every bed, for turnaround and cleaning times.
create table if not exists public.edoshmis_bed_events (
  id bigint generated always as identity primary key,
  facility_id uuid not null,
  bed_id uuid not null references public.edoshmis_beds (id) on delete cascade,
  from_status public.edoshmis_bed_status,
  to_status public.edoshmis_bed_status not null,
  admission_id uuid,
  note text,
  staff_id uuid references public.edoshmis_staff (id),
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_bed_events_bed_idx on public.edoshmis_bed_events (bed_id, created_at desc);

-- Nurses see the wards they are assigned to (unless ipd.all_patients).
create table if not exists public.edoshmis_staff_wards (
  staff_id uuid not null references public.edoshmis_staff (id) on delete cascade,
  ward_id uuid not null references public.edoshmis_wards (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, ward_id)
);

-- ---------------------------------------------------------------- encounters

create table if not exists public.edoshmis_encounters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id) on delete restrict,
  facility_id uuid not null references public.edoshmis_facilities (id) on delete restrict,
  patient_id uuid not null references public.edoshmis_patients (id) on delete restrict,
  encounter_number text not null,
  kind text not null check (kind in ('opd', 'emergency', 'ipd', 'day_case')),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references public.edoshmis_staff (id),
  created_at timestamptz not null default now(),
  unique (facility_id, encounter_number)
);
create index if not exists edoshmis_encounters_patient_idx on public.edoshmis_encounters (patient_id, started_at desc);

-- ---------------------------------------------------------------- admissions

create table if not exists public.edoshmis_admission_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id) on delete restrict,
  facility_id uuid not null references public.edoshmis_facilities (id) on delete restrict,
  patient_id uuid not null references public.edoshmis_patients (id) on delete restrict,
  source_encounter_id uuid references public.edoshmis_encounters (id),
  source public.edoshmis_admission_source not null,
  priority public.edoshmis_priority not null default 'urgent',
  preferred_ward_id uuid references public.edoshmis_wards (id),
  responsible_consultant_id uuid references public.edoshmis_staff (id),
  provisional_diagnosis text not null check (length(trim(provisional_diagnosis)) between 2 and 300),
  provisional_icd10 text,
  indication text not null check (length(trim(indication)) between 2 and 2000),
  clinical_history text,
  initial_assessment text,
  payment_category public.edoshmis_payment_category not null default 'cash',
  referring_facility text,
  accompanying_person text,
  notes text,
  status public.edoshmis_request_status not null default 'pending',
  requested_by uuid references public.edoshmis_staff (id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.edoshmis_staff (id),
  decided_at timestamptz,
  decision_note text,
  admission_id uuid
);
create index if not exists edoshmis_admission_requests_open_idx on public.edoshmis_admission_requests (facility_id, status, requested_at);
-- A patient has at most one open request at a facility.
create unique index if not exists edoshmis_admission_requests_one_open
  on public.edoshmis_admission_requests (facility_id, patient_id) where status in ('pending', 'approved');

create table if not exists public.edoshmis_admissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id) on delete restrict,
  facility_id uuid not null references public.edoshmis_facilities (id) on delete restrict,
  patient_id uuid not null references public.edoshmis_patients (id) on delete restrict,
  encounter_id uuid not null references public.edoshmis_encounters (id),
  request_id uuid references public.edoshmis_admission_requests (id),
  admission_number text not null,
  admitted_at timestamptz not null default now(),
  source public.edoshmis_admission_source not null,
  priority public.edoshmis_priority not null,
  admitting_clinician_id uuid references public.edoshmis_staff (id),
  responsible_consultant_id uuid references public.edoshmis_staff (id),
  indication text not null,
  clinical_history text,
  initial_assessment text,
  patient_category text not null default 'general' check (patient_category in ('general', 'private', 'vip', 'staff', 'other')),
  payment_category public.edoshmis_payment_category not null,
  coverage_id uuid references public.edoshmis_patient_coverage (id),
  referring_facility text,
  accompanying_person text,
  consent_obtained boolean not null default false,
  consent_by text,
  notes text,
  -- "condition" is an SQL keyword, hence the longer name.
  clinical_condition text check (clinical_condition is null or clinical_condition in ('stable', 'fair', 'serious', 'critical', 'improving', 'deteriorating')),
  expected_discharge_date date,
  current_ward_id uuid references public.edoshmis_wards (id),
  current_bed_id uuid references public.edoshmis_beds (id),
  status public.edoshmis_admission_status not null default 'active',
  discharged_at timestamptz,
  created_by uuid references public.edoshmis_staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, admission_number)
);
create index if not exists edoshmis_admissions_active_idx on public.edoshmis_admissions (facility_id, status) where status in ('active', 'discharge_in_progress');
create index if not exists edoshmis_admissions_patient_idx on public.edoshmis_admissions (patient_id, admitted_at desc);
create index if not exists edoshmis_admissions_ward_idx on public.edoshmis_admissions (current_ward_id) where status in ('active', 'discharge_in_progress');
-- One open admission per patient per organisation.
create unique index if not exists edoshmis_admissions_one_open
  on public.edoshmis_admissions (organization_id, patient_id) where status in ('active', 'discharge_in_progress');

do $$ begin
  alter table public.edoshmis_beds add constraint edoshmis_beds_current_admission_fk
    foreign key (current_admission_id) references public.edoshmis_admissions (id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.edoshmis_admission_requests add constraint edoshmis_admission_requests_admission_fk
    foreign key (admission_id) references public.edoshmis_admissions (id);
exception when duplicate_object then null; end $$;

create table if not exists public.edoshmis_bed_allocations (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  admission_id uuid not null references public.edoshmis_admissions (id) on delete restrict,
  patient_id uuid not null references public.edoshmis_patients (id),
  ward_id uuid not null references public.edoshmis_wards (id),
  bed_id uuid not null references public.edoshmis_beds (id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check (end_reason is null or end_reason in ('transfer', 'discharge', 'death', 'absconded', 'transfer_out', 'correction')),
  reason text,
  allocated_by uuid references public.edoshmis_staff (id),
  ended_by uuid references public.edoshmis_staff (id),
  check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists edoshmis_bed_allocations_one_per_bed on public.edoshmis_bed_allocations (bed_id) where ended_at is null;
create unique index if not exists edoshmis_bed_allocations_one_per_admission on public.edoshmis_bed_allocations (admission_id) where ended_at is null;
create index if not exists edoshmis_bed_allocations_admission_idx on public.edoshmis_bed_allocations (admission_id, started_at);

create table if not exists public.edoshmis_bed_reservations (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  bed_id uuid not null references public.edoshmis_beds (id),
  request_id uuid references public.edoshmis_admission_requests (id),
  note text,
  reserved_until timestamptz not null,
  status text not null default 'held' check (status in ('held', 'used', 'released', 'expired')),
  reserved_by uuid references public.edoshmis_staff (id),
  created_at timestamptz not null default now()
);
create unique index if not exists edoshmis_bed_reservations_one_held on public.edoshmis_bed_reservations (bed_id) where status = 'held';

create table if not exists public.edoshmis_diagnoses (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  encounter_id uuid references public.edoshmis_encounters (id),
  admission_id uuid references public.edoshmis_admissions (id),
  rank text not null check (rank in ('primary', 'secondary')),
  kind text not null default 'working' check (kind in ('provisional', 'working', 'final')),
  description text not null check (length(trim(description)) between 2 and 300),
  icd10_code text check (icd10_code is null or icd10_code ~ '^[A-Z][0-9]{2}(\.[0-9A-Z]{1,4})?$'),
  status text not null default 'active' check (status in ('active', 'resolved', 'refuted', 'entered_in_error')),
  status_reason text,
  recorded_by uuid references public.edoshmis_staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists edoshmis_diagnoses_admission_idx on public.edoshmis_diagnoses (admission_id);

create table if not exists public.edoshmis_care_team (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  admission_id uuid not null references public.edoshmis_admissions (id) on delete cascade,
  staff_id uuid not null references public.edoshmis_staff (id),
  role text not null check (role in ('consultant', 'admitting', 'medical_officer', 'clinical_officer', 'primary_nurse', 'specialist', 'other')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  added_by uuid references public.edoshmis_staff (id)
);
create unique index if not exists edoshmis_care_team_open on public.edoshmis_care_team (admission_id, staff_id, role) where ended_at is null;

-- ---------------------------------------------------------------- access helper

-- Can the signed-in user see this admission's clinical record? They need
-- ipd.read at its facility and one of: ipd.all_patients, an assignment to
-- the ward the patient is on, or a place on the care team.
create or replace function public.edoshmis_can_see_admission(p_admission uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.edoshmis_admissions a
    where a.id = p_admission
      and public.edoshmis_has_perm(a.facility_id, 'ipd.read')
      and (
        public.edoshmis_has_perm(a.facility_id, 'ipd.all_patients')
        or exists (select 1 from public.edoshmis_staff_wards sw
                   where sw.ward_id = a.current_ward_id and sw.staff_id = public.edoshmis_staff_id(a.organization_id))
        or exists (select 1 from public.edoshmis_care_team ct
                   where ct.admission_id = a.id and ct.ended_at is null and ct.staff_id = public.edoshmis_staff_id(a.organization_id))
      )
  );
$$;

create or replace function public.edoshmis_can_see_ward(p_ward uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.edoshmis_wards w
    where w.id = p_ward and public.edoshmis_has_perm(w.facility_id, 'ipd.read')
      and (public.edoshmis_has_perm(w.facility_id, 'ipd.all_patients')
           or exists (select 1 from public.edoshmis_staff_wards sw
                      where sw.ward_id = w.id and sw.staff_id = public.edoshmis_staff_id(public.edoshmis_facility_org(w.facility_id))))
  );
$$;

-- Requires a permission and the right to see this admission; returns the staff id.
create or replace function public.edoshmis_require_admission(p_admission uuid, p_perm text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_fac uuid;
begin
  select facility_id into v_fac from public.edoshmis_admissions where id = p_admission;
  if v_fac is null then raise exception 'Admission not found.'; end if;
  if not public.edoshmis_can_see_admission(p_admission) then
    raise exception 'This patient is not on a ward you are assigned to, or under your care.' using errcode = '42501';
  end if;
  return public.edoshmis_require(v_fac, p_perm);
end $$;

-- ---------------------------------------------------------------- bed state

create or replace function public.edoshmis_bed_event(p_bed uuid, p_from public.edoshmis_bed_status, p_to public.edoshmis_bed_status,
  p_admission uuid, p_note text, p_staff uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.edoshmis_bed_events (facility_id, bed_id, from_status, to_status, admission_id, note, staff_id)
  select facility_id, id, p_from, p_to, p_admission, p_note, p_staff from public.edoshmis_beds where id = p_bed;
end $$;

-- Cleaning, maintenance, blocked, available. An occupied bed only changes
-- through transfer or discharge; a reserved one through its reservation.
create or replace function public.edoshmis_set_bed_status(p_bed uuid, p_status public.edoshmis_bed_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.edoshmis_beds; v_staff uuid;
begin
  select * into b from public.edoshmis_beds where id = p_bed for update;
  if not found then raise exception 'Bed not found.'; end if;
  v_staff := public.edoshmis_require(b.facility_id, 'ipd.manage_beds');
  if p_status in ('occupied', 'reserved') then
    raise exception 'A bed becomes occupied by admitting a patient, and reserved by reserving it.';
  end if;
  if b.status = 'occupied' then
    raise exception 'Bed % is occupied. Transfer or discharge the patient first.', b.bed_number;
  end if;
  if b.status = 'reserved' then
    raise exception 'Bed % is reserved. Release the reservation first.', b.bed_number;
  end if;
  if p_status in ('maintenance', 'blocked') and coalesce(trim(p_note), '') = '' then
    raise exception 'Say why the bed is out of service.';
  end if;
  update public.edoshmis_beds set status = p_status, status_note = nullif(trim(p_note), ''), status_changed_at = now() where id = p_bed;
  perform public.edoshmis_bed_event(p_bed, b.status, p_status, null, p_note, v_staff);
end $$;

create or replace function public.edoshmis_reserve_bed(p_bed uuid, p_request uuid, p_hours int, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.edoshmis_beds; v_staff uuid; v_id uuid;
begin
  select * into b from public.edoshmis_beds where id = p_bed for update;
  if not found then raise exception 'Bed not found.'; end if;
  v_staff := public.edoshmis_require(b.facility_id, 'ipd.allocate_bed');
  if b.status <> 'available' or not b.is_active then raise exception 'Bed % is not available to reserve.', b.bed_number; end if;
  if p_hours is null or p_hours < 1 or p_hours > 72 then raise exception 'Reserve for between 1 and 72 hours.'; end if;
  insert into public.edoshmis_bed_reservations (facility_id, bed_id, request_id, note, reserved_until, reserved_by)
  values (b.facility_id, p_bed, p_request, nullif(trim(p_note), ''), now() + make_interval(hours => p_hours), v_staff) returning id into v_id;
  update public.edoshmis_beds set status = 'reserved', status_note = nullif(trim(p_note), ''), status_changed_at = now() where id = p_bed;
  perform public.edoshmis_bed_event(p_bed, 'available', 'reserved', null, p_note, v_staff);
  return v_id;
end $$;

create or replace function public.edoshmis_release_reservation(p_reservation uuid, p_status text default 'released')
returns void language plpgsql security definer set search_path = '' as $$
declare r public.edoshmis_bed_reservations; v_staff uuid;
begin
  select * into r from public.edoshmis_bed_reservations where id = p_reservation for update;
  if not found or r.status <> 'held' then raise exception 'That reservation is not held.'; end if;
  v_staff := public.edoshmis_require(r.facility_id, 'ipd.allocate_bed');
  perform 1 from public.edoshmis_beds where id = r.bed_id for update;
  update public.edoshmis_bed_reservations set status = p_status where id = p_reservation;
  update public.edoshmis_beds set status = 'available', status_note = null, status_changed_at = now() where id = r.bed_id and status = 'reserved';
  perform public.edoshmis_bed_event(r.bed_id, 'reserved', 'available', null, 'Reservation ' || p_status, v_staff);
end $$;

-- Lapsed reservations go back to available. Run by the app on bed screens
-- (and safe to schedule): it only ever releases holds past their time.
create or replace function public.edoshmis_expire_reservations(p_facility uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  if not public.edoshmis_has_perm(p_facility, 'ipd.read') then return 0; end if;
  for r in select id, bed_id from public.edoshmis_bed_reservations
           where facility_id = p_facility and status = 'held' and reserved_until < now() for update skip locked loop
    update public.edoshmis_bed_reservations set status = 'expired' where id = r.id;
    update public.edoshmis_beds set status = 'available', status_note = null, status_changed_at = now() where id = r.bed_id and status = 'reserved';
    perform public.edoshmis_bed_event(r.bed_id, 'reserved', 'available', null, 'Reservation expired', null);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Lock a bed and check it can take this patient now. Used by admit and
-- transfer. A bed reserved for this very request counts as free.
create or replace function public.edoshmis_claim_bed(p_bed uuid, p_facility uuid, p_patient uuid, p_request uuid)
returns public.edoshmis_beds language plpgsql security definer set search_path = '' as $$
declare b public.edoshmis_beds; w public.edoshmis_wards; v_sex public.edoshmis_sex;
begin
  select * into b from public.edoshmis_beds where id = p_bed for update;
  if not found or b.facility_id <> p_facility then raise exception 'Bed not found at this facility.'; end if;
  if not b.is_active then raise exception 'Bed % is retired.', b.bed_number; end if;
  select * into w from public.edoshmis_wards where id = b.ward_id;
  if w.status = 'closed' then raise exception 'Ward % is closed.', w.name; end if;
  if b.status = 'reserved' then
    if p_request is null or not exists (select 1 from public.edoshmis_bed_reservations
        where bed_id = p_bed and status = 'held' and request_id = p_request) then
      raise exception 'Bed % is reserved for another patient.', b.bed_number;
    end if;
    update public.edoshmis_bed_reservations set status = 'used' where bed_id = p_bed and status = 'held';
  elsif b.status <> 'available' then
    raise exception 'Bed % is % — pick an available bed.', b.bed_number, b.status;
  end if;
  select sex into v_sex from public.edoshmis_patients where id = p_patient;
  if (w.sex_restriction <> 'any' and w.sex_restriction <> v_sex::text)
     or (b.sex_restriction <> 'any' and b.sex_restriction <> v_sex::text) then
    raise exception 'Bed % is for % patients only.', b.bed_number, coalesce(nullif(b.sex_restriction, 'any'), w.sex_restriction);
  end if;
  return b;
end $$;

-- ---------------------------------------------------------------- admission workflow

create or replace function public.edoshmis_request_admission(p_facility uuid, r jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_staff uuid := public.edoshmis_require(p_facility, 'ipd.request_admission'); v_org uuid := public.edoshmis_facility_org(p_facility); v_id uuid;
begin
  if not exists (select 1 from public.edoshmis_patients where id = (r ->> 'patient_id')::uuid and organization_id = v_org and deleted_at is null) then
    raise exception 'Patient not found.';
  end if;
  if exists (select 1 from public.edoshmis_admissions where patient_id = (r ->> 'patient_id')::uuid and status in ('active', 'discharge_in_progress')) then
    raise exception 'This patient is already admitted.';
  end if;
  insert into public.edoshmis_admission_requests (
    organization_id, facility_id, patient_id, source_encounter_id, source, priority, preferred_ward_id, responsible_consultant_id,
    provisional_diagnosis, provisional_icd10, indication, clinical_history, initial_assessment, payment_category,
    referring_facility, accompanying_person, notes, requested_by)
  values (
    v_org, p_facility, (r ->> 'patient_id')::uuid, nullif(r ->> 'source_encounter_id', '')::uuid,
    (r ->> 'source')::public.edoshmis_admission_source, coalesce(nullif(r ->> 'priority', ''), 'urgent')::public.edoshmis_priority,
    nullif(r ->> 'preferred_ward_id', '')::uuid, nullif(r ->> 'responsible_consultant_id', '')::uuid,
    trim(r ->> 'provisional_diagnosis'), nullif(upper(trim(r ->> 'provisional_icd10')), ''), trim(r ->> 'indication'),
    nullif(trim(r ->> 'clinical_history'), ''), nullif(trim(r ->> 'initial_assessment'), ''),
    coalesce(nullif(r ->> 'payment_category', ''), 'cash')::public.edoshmis_payment_category,
    nullif(trim(r ->> 'referring_facility'), ''), nullif(trim(r ->> 'accompanying_person'), ''), nullif(trim(r ->> 'notes'), ''), v_staff)
  returning id into v_id;
  perform public.edoshmis_audit(v_org, p_facility, 'admission.requested', 'admission_request', v_id::text, (r ->> 'patient_id')::uuid, null, r);
  return v_id;
end $$;

create or replace function public.edoshmis_decide_admission_request(p_request uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.edoshmis_admission_requests; v_staff uuid;
begin
  select * into q from public.edoshmis_admission_requests where id = p_request for update;
  if not found then raise exception 'Request not found.'; end if;
  v_staff := public.edoshmis_require(q.facility_id, 'ipd.approve_admission');
  if q.status <> 'pending' then raise exception 'This request has already been %.', q.status; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Give the reason for rejecting the admission.'; end if;
  update public.edoshmis_admission_requests
    set status = case when p_approve then 'approved'::public.edoshmis_request_status else 'rejected'::public.edoshmis_request_status end,
        decided_by = v_staff, decided_at = now(), decision_note = nullif(trim(p_note), '')
    where id = p_request;
  perform public.edoshmis_audit(q.organization_id, q.facility_id, case when p_approve then 'admission.approved' else 'admission.rejected' end,
    'admission_request', p_request::text, q.patient_id, null, null, p_note);
end $$;

create or replace function public.edoshmis_cancel_admission_request(p_request uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.edoshmis_admission_requests; v_staff uuid;
begin
  select * into q from public.edoshmis_admission_requests where id = p_request for update;
  if not found then raise exception 'Request not found.'; end if;
  v_staff := public.edoshmis_require(q.facility_id, 'ipd.request_admission');
  if q.status not in ('pending', 'approved') then raise exception 'This request is already %.', q.status; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say why the request is cancelled.'; end if;
  update public.edoshmis_admission_requests set status = 'cancelled', decision_note = trim(p_note), decided_by = v_staff, decided_at = now() where id = p_request;
  update public.edoshmis_bed_reservations set status = 'released' where request_id = p_request and status = 'held';
  update public.edoshmis_beds b set status = 'available', status_note = null, status_changed_at = now()
    where b.status = 'reserved' and not exists (select 1 from public.edoshmis_bed_reservations r where r.bed_id = b.id and r.status = 'held')
      and b.id in (select bed_id from public.edoshmis_bed_reservations where request_id = p_request);
  perform public.edoshmis_audit(q.organization_id, q.facility_id, 'admission.request_cancelled', 'admission_request', p_request::text, q.patient_id, null, null, p_note);
end $$;

-- Approved request → admission in a bed. One transaction: encounter,
-- admission, primary diagnosis, care team, allocation, bed occupied,
-- billing account (created in 0006 when that migration is present).
create or replace function public.edoshmis_admit(p_request uuid, p_bed uuid, a jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  q public.edoshmis_admission_requests; b public.edoshmis_beds; v_staff uuid; v_enc uuid; v_adm uuid; v_year text; v_num text; v_code text;
  v_consultant uuid;
begin
  select * into q from public.edoshmis_admission_requests where id = p_request for update;
  if not found then raise exception 'Request not found.'; end if;
  v_staff := public.edoshmis_require(q.facility_id, 'ipd.allocate_bed');
  if q.status <> 'approved' then raise exception 'Only an approved request can be admitted (this one is %).', q.status; end if;
  if exists (select 1 from public.edoshmis_admissions where organization_id = q.organization_id and patient_id = q.patient_id and status in ('active', 'discharge_in_progress')) then
    raise exception 'This patient is already admitted.';
  end if;
  b := public.edoshmis_claim_bed(p_bed, q.facility_id, q.patient_id, p_request);

  select code into v_code from public.edoshmis_facilities where id = q.facility_id;
  v_year := to_char(now() at time zone 'Africa/Nairobi', 'YYYY');
  insert into public.edoshmis_encounters (organization_id, facility_id, patient_id, encounter_number, kind, created_by)
  values (q.organization_id, q.facility_id, q.patient_id,
          'IP' || v_year || '-' || lpad(public.edoshmis_next_number(q.facility_id, 'encounter', v_year)::text, 6, '0'), 'ipd', v_staff)
  returning id into v_enc;
  if q.source_encounter_id is not null then
    update public.edoshmis_encounters set status = 'closed', ended_at = now() where id = q.source_encounter_id and status = 'open';
  end if;

  v_num := v_code || '/ADM/' || v_year || '/' || lpad(public.edoshmis_next_number(q.facility_id, 'admission', v_year)::text, 5, '0');
  v_consultant := coalesce(nullif(a ->> 'responsible_consultant_id', '')::uuid, q.responsible_consultant_id);
  insert into public.edoshmis_admissions (
    organization_id, facility_id, patient_id, encounter_id, request_id, admission_number, source, priority,
    admitting_clinician_id, responsible_consultant_id, indication, clinical_history, initial_assessment, patient_category,
    payment_category, coverage_id, referring_facility, accompanying_person, consent_obtained, consent_by, notes,
    expected_discharge_date, current_ward_id, current_bed_id, created_by)
  values (
    q.organization_id, q.facility_id, q.patient_id, v_enc, q.id, v_num, q.source, q.priority,
    q.requested_by, v_consultant, q.indication, q.clinical_history, q.initial_assessment,
    coalesce(nullif(a ->> 'patient_category', ''), 'general'), q.payment_category, nullif(a ->> 'coverage_id', '')::uuid,
    q.referring_facility, q.accompanying_person, coalesce((a ->> 'consent_obtained')::boolean, false), nullif(trim(a ->> 'consent_by'), ''),
    coalesce(nullif(trim(a ->> 'notes'), ''), q.notes), nullif(a ->> 'expected_discharge_date', '')::date, b.ward_id, b.id, v_staff)
  returning id into v_adm;

  insert into public.edoshmis_diagnoses (facility_id, patient_id, encounter_id, admission_id, rank, kind, description, icd10_code, recorded_by)
  values (q.facility_id, q.patient_id, v_enc, v_adm, 'primary', 'provisional', q.provisional_diagnosis, q.provisional_icd10, q.requested_by);

  insert into public.edoshmis_care_team (facility_id, admission_id, staff_id, role, added_by)
  select q.facility_id, v_adm, s, r, v_staff
  from (values (v_consultant, 'consultant'), (q.requested_by, 'admitting')) as t (s, r)
  where s is not null
  on conflict do nothing;

  insert into public.edoshmis_bed_allocations (facility_id, admission_id, patient_id, ward_id, bed_id, allocated_by, reason)
  values (q.facility_id, v_adm, q.patient_id, b.ward_id, b.id, v_staff, 'Admission');
  update public.edoshmis_beds set status = 'occupied', current_admission_id = v_adm, status_note = null, status_changed_at = now() where id = b.id;
  perform public.edoshmis_bed_event(b.id, b.status, 'occupied', v_adm, 'Admitted ' || v_num, v_staff);

  update public.edoshmis_admission_requests set status = 'admitted', admission_id = v_adm where id = q.id;

  -- Billing account, when the billing migration is installed.
  if to_regprocedure('public.edoshmis_open_billing_account(uuid)') is not null then
    perform public.edoshmis_open_billing_account(v_adm);
  end if;

  perform public.edoshmis_audit(q.organization_id, q.facility_id, 'admission.admitted', 'admission', v_adm::text, q.patient_id, null,
    jsonb_build_object('admission_number', v_num, 'bed_id', b.id, 'ward_id', b.ward_id));
  return v_adm;
end $$;

-- Move to another bed. The old allocation is closed (history kept), the old
-- bed goes for cleaning, the admission, its notes and its bill carry on.
create or replace function public.edoshmis_transfer_bed(p_admission uuid, p_bed uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare ad public.edoshmis_admissions; b public.edoshmis_beds; v_staff uuid; v_old uuid;
begin
  select * into ad from public.edoshmis_admissions where id = p_admission for update;
  if not found then raise exception 'Admission not found.'; end if;
  v_staff := public.edoshmis_require(ad.facility_id, 'ipd.transfer');
  if ad.status not in ('active', 'discharge_in_progress') then raise exception 'This admission is closed.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason for the transfer.'; end if;
  if ad.current_bed_id = p_bed then raise exception 'The patient is already in that bed.'; end if;
  v_old := ad.current_bed_id;
  -- Lock both beds in a fixed order so two crossing transfers cannot deadlock.
  perform 1 from public.edoshmis_beds where id in (v_old, p_bed) order by id for update;
  b := public.edoshmis_claim_bed(p_bed, ad.facility_id, ad.patient_id, null);

  update public.edoshmis_bed_allocations set ended_at = now(), end_reason = 'transfer', ended_by = v_staff
    where admission_id = p_admission and ended_at is null;
  if v_old is not null then
    update public.edoshmis_beds set status = 'cleaning', current_admission_id = null, status_note = 'After transfer', status_changed_at = now() where id = v_old;
    perform public.edoshmis_bed_event(v_old, 'occupied', 'cleaning', p_admission, 'Patient transferred out', v_staff);
  end if;
  insert into public.edoshmis_bed_allocations (facility_id, admission_id, patient_id, ward_id, bed_id, allocated_by, reason)
  values (ad.facility_id, p_admission, ad.patient_id, b.ward_id, b.id, v_staff, trim(p_reason));
  update public.edoshmis_beds set status = 'occupied', current_admission_id = p_admission, status_note = null, status_changed_at = now() where id = b.id;
  perform public.edoshmis_bed_event(b.id, b.status, 'occupied', p_admission, 'Transferred in', v_staff);
  update public.edoshmis_admissions set current_ward_id = b.ward_id, current_bed_id = b.id, updated_at = now() where id = p_admission;
  perform public.edoshmis_audit(ad.organization_id, ad.facility_id, 'admission.transferred', 'admission', p_admission::text, ad.patient_id,
    jsonb_build_object('bed_id', v_old), jsonb_build_object('bed_id', b.id, 'ward_id', b.ward_id), p_reason);
end $$;

create or replace function public.edoshmis_update_admission(p_admission uuid, a jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare ad public.edoshmis_admissions; v_staff uuid;
begin
  select * into ad from public.edoshmis_admissions where id = p_admission for update;
  if not found then raise exception 'Admission not found.'; end if;
  v_staff := public.edoshmis_require_admission(p_admission, 'clinical.notes');
  if ad.status not in ('active', 'discharge_in_progress') then raise exception 'This admission is closed.'; end if;
  update public.edoshmis_admissions set
    clinical_condition = case when a ? 'condition' then nullif(a ->> 'condition', '') else clinical_condition end,
    expected_discharge_date = case when a ? 'expected_discharge_date' then nullif(a ->> 'expected_discharge_date', '')::date else expected_discharge_date end,
    updated_at = now()
  where id = p_admission;
  perform public.edoshmis_audit(ad.organization_id, ad.facility_id, 'admission.updated', 'admission', p_admission::text, ad.patient_id,
    jsonb_build_object('condition', ad.clinical_condition, 'expected_discharge_date', ad.expected_discharge_date), a);
end $$;

create or replace function public.edoshmis_set_care_team(p_admission uuid, p_staff uuid, p_role text, p_add boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare ad public.edoshmis_admissions; v_staff uuid;
begin
  select * into ad from public.edoshmis_admissions where id = p_admission;
  v_staff := public.edoshmis_require_admission(p_admission, 'clinical.care_team');
  if p_add then
    insert into public.edoshmis_care_team (facility_id, admission_id, staff_id, role, added_by)
    values (ad.facility_id, p_admission, p_staff, p_role, v_staff) on conflict do nothing;
    if p_role = 'consultant' then
      update public.edoshmis_care_team set ended_at = now() where admission_id = p_admission and role = 'consultant' and staff_id <> p_staff and ended_at is null;
      update public.edoshmis_admissions set responsible_consultant_id = p_staff, updated_at = now() where id = p_admission;
    end if;
  else
    update public.edoshmis_care_team set ended_at = now() where admission_id = p_admission and staff_id = p_staff and role = p_role and ended_at is null;
  end if;
  perform public.edoshmis_audit(ad.organization_id, ad.facility_id, case when p_add then 'care_team.added' else 'care_team.removed' end,
    'admission', p_admission::text, ad.patient_id, null, jsonb_build_object('staff_id', p_staff, 'role', p_role));
end $$;

-- ---------------------------------------------------------------- triggers

drop trigger if exists edoshmis_wards_touch on public.edoshmis_wards;
create trigger edoshmis_wards_touch before update on public.edoshmis_wards for each row execute function public.edoshmis_touch_updated_at();
drop trigger if exists edoshmis_tariffs_touch on public.edoshmis_tariffs;
create trigger edoshmis_tariffs_touch before update on public.edoshmis_tariffs for each row execute function public.edoshmis_touch_updated_at();
drop trigger if exists edoshmis_diagnoses_touch on public.edoshmis_diagnoses;
create trigger edoshmis_diagnoses_touch before update on public.edoshmis_diagnoses for each row execute function public.edoshmis_touch_updated_at();

do $$ declare t text; begin
  foreach t in array array['edoshmis_tariffs', 'edoshmis_wards', 'edoshmis_beds', 'edoshmis_diagnoses', 'edoshmis_staff_wards'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.edoshmis_audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- Diagnoses written directly (not through admit) are stamped and checked.
create or replace function public.edoshmis_stamp_diagnosis()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- A direct write is stamped and permission-checked here; one made by a
    -- workflow function (admit) has been checked there and names its author.
    if current_user = 'authenticated' then
      new.recorded_by := public.edoshmis_staff_id(public.edoshmis_facility_org(new.facility_id));
      if new.admission_id is not null then
        perform public.edoshmis_require_admission(new.admission_id, 'clinical.diagnose');
      end if;
    end if;
  else
    -- A diagnosis is never rewritten: only its status moves on.
    if new.description is distinct from old.description or new.icd10_code is distinct from old.icd10_code
       or new.rank is distinct from old.rank or new.patient_id is distinct from old.patient_id then
      raise exception 'A diagnosis cannot be rewritten. Mark it resolved, refuted or entered in error, and add the new one.';
    end if;
    if new.status in ('refuted', 'entered_in_error') and coalesce(trim(new.status_reason), '') = '' then
      raise exception 'Give the reason.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists edoshmis_diagnoses_stamp on public.edoshmis_diagnoses;
create trigger edoshmis_diagnoses_stamp before insert or update on public.edoshmis_diagnoses for each row execute function public.edoshmis_stamp_diagnosis();

-- ---------------------------------------------------------------- RLS

alter table public.edoshmis_tariffs enable row level security;
alter table public.edoshmis_wards enable row level security;
alter table public.edoshmis_beds enable row level security;
alter table public.edoshmis_bed_events enable row level security;
alter table public.edoshmis_staff_wards enable row level security;
alter table public.edoshmis_encounters enable row level security;
alter table public.edoshmis_admission_requests enable row level security;
alter table public.edoshmis_admissions enable row level security;
alter table public.edoshmis_bed_allocations enable row level security;
alter table public.edoshmis_bed_reservations enable row level security;
alter table public.edoshmis_diagnoses enable row level security;
alter table public.edoshmis_care_team enable row level security;

-- Configuration: any staff of the organisation reads; admins write.
drop policy if exists edoshmis_tariffs_read on public.edoshmis_tariffs;
create policy edoshmis_tariffs_read on public.edoshmis_tariffs for select to authenticated using (public.edoshmis_is_member(public.edoshmis_facility_org(facility_id)));
drop policy if exists edoshmis_tariffs_write on public.edoshmis_tariffs;
create policy edoshmis_tariffs_write on public.edoshmis_tariffs for all to authenticated
  using (public.edoshmis_has_perm(facility_id, 'admin.tariffs')) with check (public.edoshmis_has_perm(facility_id, 'admin.tariffs'));

drop policy if exists edoshmis_wards_read on public.edoshmis_wards;
create policy edoshmis_wards_read on public.edoshmis_wards for select to authenticated using (public.edoshmis_is_member(public.edoshmis_facility_org(facility_id)));
drop policy if exists edoshmis_wards_write on public.edoshmis_wards;
create policy edoshmis_wards_write on public.edoshmis_wards for all to authenticated
  using (public.edoshmis_has_perm(facility_id, 'admin.wards')) with check (public.edoshmis_has_perm(facility_id, 'admin.wards'));

-- Beds: the board is visible to inpatient staff and to whoever sets wards
-- up. Status changes go through the functions; admins add and retire beds.
drop policy if exists edoshmis_beds_read on public.edoshmis_beds;
create policy edoshmis_beds_read on public.edoshmis_beds for select to authenticated
  using (public.edoshmis_has_perm(facility_id, 'ipd.read') or public.edoshmis_has_perm(facility_id, 'admin.wards'));
drop policy if exists edoshmis_beds_insert on public.edoshmis_beds;
create policy edoshmis_beds_insert on public.edoshmis_beds for insert to authenticated
  with check (public.edoshmis_has_perm(facility_id, 'admin.wards') and status = 'available' and current_admission_id is null);
drop policy if exists edoshmis_beds_update on public.edoshmis_beds;
create policy edoshmis_beds_update on public.edoshmis_beds for update to authenticated
  using (public.edoshmis_has_perm(facility_id, 'admin.wards')) with check (public.edoshmis_has_perm(facility_id, 'admin.wards'));

-- Admins may only change a bed's description, never its occupancy.
create or replace function public.edoshmis_guard_bed_update()
returns trigger language plpgsql as $$
begin
  -- Inside the security-definer workflow functions current_user is their
  -- owner; a direct edit through the API runs as 'authenticated'.
  if current_user = 'authenticated'
     and (new.status is distinct from old.status or new.current_admission_id is distinct from old.current_admission_id) then
    raise exception 'Bed status changes go through the bed board, not a direct edit.';
  end if;
  if current_user = 'authenticated' and old.status = 'occupied' and not new.is_active then
    raise exception 'An occupied bed cannot be retired.';
  end if;
  return new;
end $$;
drop trigger if exists edoshmis_beds_guard on public.edoshmis_beds;
create trigger edoshmis_beds_guard before update on public.edoshmis_beds for each row execute function public.edoshmis_guard_bed_update();

drop policy if exists edoshmis_bed_events_read on public.edoshmis_bed_events;
create policy edoshmis_bed_events_read on public.edoshmis_bed_events for select to authenticated using (public.edoshmis_has_perm(facility_id, 'ipd.read'));

drop policy if exists edoshmis_staff_wards_read on public.edoshmis_staff_wards;
create policy edoshmis_staff_wards_read on public.edoshmis_staff_wards for select to authenticated
  using (exists (select 1 from public.edoshmis_wards w where w.id = ward_id and public.edoshmis_is_member(public.edoshmis_facility_org(w.facility_id))));
drop policy if exists edoshmis_staff_wards_write on public.edoshmis_staff_wards;
create policy edoshmis_staff_wards_write on public.edoshmis_staff_wards for all to authenticated
  using (exists (select 1 from public.edoshmis_wards w where w.id = ward_id and (public.edoshmis_has_perm(w.facility_id, 'admin.staff') or public.edoshmis_has_perm(w.facility_id, 'admin.wards'))))
  with check (exists (select 1 from public.edoshmis_wards w where w.id = ward_id and (public.edoshmis_has_perm(w.facility_id, 'admin.staff') or public.edoshmis_has_perm(w.facility_id, 'admin.wards'))));

drop policy if exists edoshmis_encounters_read on public.edoshmis_encounters;
create policy edoshmis_encounters_read on public.edoshmis_encounters for select to authenticated using (public.edoshmis_has_org_perm(organization_id, 'patients.read'));

-- Requests are seen by whoever works admissions at the facility.
drop policy if exists edoshmis_admission_requests_read on public.edoshmis_admission_requests;
create policy edoshmis_admission_requests_read on public.edoshmis_admission_requests for select to authenticated
  using (public.edoshmis_has_perm(facility_id, 'ipd.read') or public.edoshmis_has_perm(facility_id, 'ipd.request_admission'));

-- The admission row itself (who, where, since when) is the census: visible
-- to inpatient staff at the facility and to billing. Its clinical content
-- lives in the child tables, which use edoshmis_can_see_admission.
drop policy if exists edoshmis_admissions_read on public.edoshmis_admissions;
create policy edoshmis_admissions_read on public.edoshmis_admissions for select to authenticated
  using (public.edoshmis_has_perm(facility_id, 'ipd.read') or public.edoshmis_has_perm(facility_id, 'billing.read'));

drop policy if exists edoshmis_bed_allocations_read on public.edoshmis_bed_allocations;
create policy edoshmis_bed_allocations_read on public.edoshmis_bed_allocations for select to authenticated
  using (public.edoshmis_has_perm(facility_id, 'ipd.read') or public.edoshmis_has_perm(facility_id, 'billing.read'));
drop policy if exists edoshmis_bed_reservations_read on public.edoshmis_bed_reservations;
create policy edoshmis_bed_reservations_read on public.edoshmis_bed_reservations for select to authenticated using (public.edoshmis_has_perm(facility_id, 'ipd.read'));

drop policy if exists edoshmis_diagnoses_read on public.edoshmis_diagnoses;
create policy edoshmis_diagnoses_read on public.edoshmis_diagnoses for select to authenticated
  using (case when admission_id is not null then public.edoshmis_can_see_admission(admission_id)
              else public.edoshmis_has_org_perm(public.edoshmis_facility_org(facility_id), 'patients.clinical') end);
drop policy if exists edoshmis_diagnoses_insert on public.edoshmis_diagnoses;
create policy edoshmis_diagnoses_insert on public.edoshmis_diagnoses for insert to authenticated
  with check (public.edoshmis_has_perm(facility_id, 'clinical.diagnose'));
drop policy if exists edoshmis_diagnoses_update on public.edoshmis_diagnoses;
create policy edoshmis_diagnoses_update on public.edoshmis_diagnoses for update to authenticated
  using (public.edoshmis_has_perm(facility_id, 'clinical.diagnose') and (admission_id is null or public.edoshmis_can_see_admission(admission_id)))
  with check (public.edoshmis_has_perm(facility_id, 'clinical.diagnose'));

drop policy if exists edoshmis_care_team_read on public.edoshmis_care_team;
create policy edoshmis_care_team_read on public.edoshmis_care_team for select to authenticated using (public.edoshmis_has_perm(facility_id, 'ipd.read'));

revoke all on function public.edoshmis_claim_bed(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.edoshmis_bed_event(uuid, public.edoshmis_bed_status, public.edoshmis_bed_status, uuid, text, uuid) from public, anon, authenticated;
