-- EDOSHMIS 0004 — clinical documentation on an admission: doctors' notes
-- and ward rounds (signed, then only addended), nursing notes and care
-- plans, observations with a configurable early-warning score, escalations,
-- fluid balance, and procedures.
--
-- No clinical threshold lives in this file. The early-warning score is the
-- sum of the bands a facility has configured (and a named clinician has
-- approved) in edoshmis_observation_bands; with no bands, there is no score.

do $$ begin
  create type public.edoshmis_avpu as enum ('alert', 'new_confusion', 'voice', 'pain', 'unresponsive');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- doctors' notes

create table if not exists public.edoshmis_clinical_notes (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  admission_id uuid not null references public.edoshmis_admissions (id),
  note_type text not null check (note_type in ('admission', 'ward_round', 'progress', 'consult', 'specialist_review', 'procedure', 'discharge_readiness', 'other')),
  author_id uuid not null references public.edoshmis_staff (id),
  author_designation text not null,
  -- SOAP-style; findings is required, the rest may be empty on a short note.
  subjective text,
  findings text not null check (length(trim(findings)) between 2 and 20000),
  assessment text,
  plan text,
  -- Ward-round outcomes recorded alongside the note.
  discharge_ready boolean,
  specialist_requested text,
  status text not null default 'draft' check (status in ('draft', 'signed')),
  signed_at timestamptz,
  ai_assisted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists edoshmis_clinical_notes_admission_idx on public.edoshmis_clinical_notes (admission_id, created_at desc);

create table if not exists public.edoshmis_nursing_notes (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  admission_id uuid not null references public.edoshmis_admissions (id),
  category text not null check (category in (
    'general', 'assessment', 'intervention', 'handover', 'hygiene', 'feeding', 'education', 'wound_care',
    'fall_risk', 'pressure_injury', 'pain', 'shift_report', 'incident')),
  shift text not null check (shift in ('morning', 'afternoon', 'night')),
  author_id uuid not null references public.edoshmis_staff (id),
  author_designation text not null,
  body text not null check (length(trim(body)) between 2 and 10000),
  -- Structured scores where the category has one (fall risk, Braden, pain).
  -- The tool and its scale are named, not assumed.
  score_tool text,
  score numeric,
  client_id uuid unique,
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_nursing_notes_admission_idx on public.edoshmis_nursing_notes (admission_id, created_at desc);

-- Corrections to a signed doctor's note or any nursing note.
create table if not exists public.edoshmis_note_addenda (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  admission_id uuid not null references public.edoshmis_admissions (id),
  clinical_note_id uuid references public.edoshmis_clinical_notes (id),
  nursing_note_id uuid references public.edoshmis_nursing_notes (id),
  author_id uuid not null references public.edoshmis_staff (id),
  author_designation text not null,
  body text not null check (length(trim(body)) between 2 and 5000),
  created_at timestamptz not null default now(),
  check ((clinical_note_id is null) <> (nursing_note_id is null))
);
create index if not exists edoshmis_note_addenda_admission_idx on public.edoshmis_note_addenda (admission_id);

create table if not exists public.edoshmis_nursing_care_plans (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  admission_id uuid not null references public.edoshmis_admissions (id),
  nursing_diagnosis text not null,
  goal text not null,
  interventions text not null,
  evaluation text,
  status text not null default 'active' check (status in ('active', 'achieved', 'discontinued')),
  author_id uuid not null references public.edoshmis_staff (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_by uuid references public.edoshmis_staff (id),
  closed_at timestamptz
);
create index if not exists edoshmis_nursing_care_plans_admission_idx on public.edoshmis_nursing_care_plans (admission_id);

-- ---------------------------------------------------------------- observations

-- One row per scored band of one parameter. Parameter names are fixed so
-- the scoring function can read them; the numbers are the facility's.
create table if not exists public.edoshmis_observation_bands (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  scheme text not null default 'adult' check (scheme in ('adult', 'paediatric', 'maternity', 'neonatal')),
  parameter text not null check (parameter in ('respiratory_rate', 'spo2', 'supplemental_o2', 'systolic_bp', 'pulse', 'temperature', 'consciousness')),
  -- Inclusive range for numeric parameters; for consciousness / O2 the matching value.
  min_value numeric,
  max_value numeric,
  match_value text,
  score int not null check (score between 0 and 10),
  approved_by text not null,
  approved_at date not null,
  created_at timestamptz not null default now(),
  check (min_value is not null or max_value is not null or match_value is not null)
);
create index if not exists edoshmis_observation_bands_fac_idx on public.edoshmis_observation_bands (facility_id, scheme, parameter);

-- What a total score (or one parameter scoring at least `single_parameter`) means.
create table if not exists public.edoshmis_escalation_rules (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  scheme text not null default 'adult',
  min_total int,
  single_parameter int,
  level text not null check (level in ('low', 'medium', 'high')),
  response text not null,
  repeat_minutes int,
  approved_by text not null,
  approved_at date not null,
  created_at timestamptz not null default now(),
  check (min_total is not null or single_parameter is not null)
);

create table if not exists public.edoshmis_observations (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  admission_id uuid not null references public.edoshmis_admissions (id),
  scheme text not null default 'adult',
  observed_at timestamptz not null default now(),
  recorded_by uuid not null references public.edoshmis_staff (id),
  temperature numeric(4, 1) check (temperature is null or temperature between 25 and 45),
  pulse int check (pulse is null or pulse between 0 and 300),
  respiratory_rate int check (respiratory_rate is null or respiratory_rate between 0 and 120),
  systolic_bp int check (systolic_bp is null or systolic_bp between 0 and 300),
  diastolic_bp int check (diastolic_bp is null or diastolic_bp between 0 and 250),
  spo2 int check (spo2 is null or spo2 between 0 and 100),
  supplemental_o2 boolean,
  o2_flow_l_min numeric(4, 1),
  weight_kg numeric(5, 2) check (weight_kg is null or weight_kg between 0.2 and 400),
  height_cm numeric(5, 1) check (height_cm is null or height_cm between 20 and 260),
  bmi numeric(5, 1) generated always as (
    case when weight_kg is not null and height_cm is not null and height_cm > 0
         then round((weight_kg / ((height_cm / 100.0) * (height_cm / 100.0)))::numeric, 1) end) stored,
  pain_score int check (pain_score is null or pain_score between 0 and 10),
  blood_glucose_mmol numeric(4, 1) check (blood_glucose_mmol is null or blood_glucose_mmol between 0 and 60),
  consciousness public.edoshmis_avpu,
  extra jsonb not null default '{}'::jsonb,
  notes text,
  ews_score int,
  ews_breakdown jsonb,
  ews_level text,
  -- Offline capture: the device's own id makes a re-sent reading a no-op.
  client_id uuid unique,
  captured_offline boolean not null default false,
  entered_in_error boolean not null default false,
  error_reason text,
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_observations_admission_idx on public.edoshmis_observations (admission_id, observed_at desc);

create table if not exists public.edoshmis_escalations (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  admission_id uuid not null references public.edoshmis_admissions (id),
  observation_id uuid references public.edoshmis_observations (id),
  level text not null check (level in ('low', 'medium', 'high')),
  reason text not null,
  response_expected text,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  acknowledged_by uuid references public.edoshmis_staff (id),
  acknowledged_at timestamptz,
  resolved_by uuid references public.edoshmis_staff (id),
  resolved_at timestamptz,
  outcome text,
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_escalations_open_idx on public.edoshmis_escalations (facility_id, status) where status <> 'resolved';

-- ---------------------------------------------------------------- fluids

create table if not exists public.edoshmis_fluid_entries (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  admission_id uuid not null references public.edoshmis_admissions (id),
  recorded_at timestamptz not null default now(),
  direction text not null check (direction in ('in', 'out')),
  category text not null check (category in ('oral', 'iv', 'enteral', 'blood', 'urine', 'drain', 'vomitus', 'stool', 'aspirate', 'other')),
  volume_ml int not null check (volume_ml between 1 and 10000),
  description text,
  recorded_by uuid not null references public.edoshmis_staff (id),
  client_id uuid unique,
  entered_in_error boolean not null default false,
  error_reason text,
  created_at timestamptz not null default now(),
  check ((direction = 'in' and category in ('oral', 'iv', 'enteral', 'blood', 'other'))
      or (direction = 'out' and category in ('urine', 'drain', 'vomitus', 'stool', 'aspirate', 'other')))
);
create index if not exists edoshmis_fluid_entries_admission_idx on public.edoshmis_fluid_entries (admission_id, recorded_at);

-- ---------------------------------------------------------------- procedures

create table if not exists public.edoshmis_procedures (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  admission_id uuid not null references public.edoshmis_admissions (id),
  name text not null check (length(trim(name)) between 2 and 200),
  code text,
  indication text,
  urgency public.edoshmis_priority not null default 'elective',
  status text not null default 'requested' check (status in ('requested', 'authorised', 'scheduled', 'done', 'cancelled')),
  requested_by uuid not null references public.edoshmis_staff (id),
  requested_at timestamptz not null default now(),
  authorised_by uuid references public.edoshmis_staff (id),
  authorised_at timestamptz,
  scheduled_for timestamptz,
  consent_obtained boolean not null default false,
  consent_by text,
  responsible_clinician_id uuid references public.edoshmis_staff (id),
  performed_by uuid references public.edoshmis_staff (id),
  performed_at timestamptz,
  procedure_note text,
  outcome text,
  complications text,
  post_procedure_monitoring text,
  follow_up text,
  cancel_reason text,
  updated_at timestamptz not null default now()
);
create index if not exists edoshmis_procedures_admission_idx on public.edoshmis_procedures (admission_id);

-- ---------------------------------------------------------------- scoring

create or replace function public.edoshmis_score_observation(o public.edoshmis_observations)
returns table (total int, breakdown jsonb, level text, response text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_total int := 0; v_bd jsonb := '{}'::jsonb; v_any boolean := false; v_max int := 0; p text; v numeric; vt text; s int;
begin
  if not exists (select 1 from public.edoshmis_observation_bands b where b.facility_id = o.facility_id and b.scheme = o.scheme) then
    return query select null::int, null::jsonb, null::text, null::text; return;
  end if;
  foreach p in array array['respiratory_rate', 'spo2', 'supplemental_o2', 'systolic_bp', 'pulse', 'temperature', 'consciousness'] loop
    v := case p when 'respiratory_rate' then o.respiratory_rate when 'spo2' then o.spo2 when 'systolic_bp' then o.systolic_bp
                when 'pulse' then o.pulse when 'temperature' then o.temperature end;
    vt := case p when 'supplemental_o2' then o.supplemental_o2::text when 'consciousness' then o.consciousness::text end;
    if v is null and vt is null then continue; end if;
    select b.score into s from public.edoshmis_observation_bands b
    where b.facility_id = o.facility_id and b.scheme = o.scheme and b.parameter = p
      and (case when vt is not null then b.match_value = vt
                else (b.min_value is null or v >= b.min_value) and (b.max_value is null or v <= b.max_value) end)
    order by b.score desc limit 1;
    if s is not null then
      v_any := true; v_total := v_total + s; v_max := greatest(v_max, s); v_bd := v_bd || jsonb_build_object(p, s);
    end if;
  end loop;
  if not v_any then return query select null::int, null::jsonb, null::text, null::text; return; end if;
  return query
    select v_total, v_bd, r.level, r.response
    from (select null::text as level, null::text as response) d
    left join lateral (
      select er.level, er.response from public.edoshmis_escalation_rules er
      where er.facility_id = o.facility_id and er.scheme = o.scheme
        and ((er.min_total is not null and v_total >= er.min_total) or (er.single_parameter is not null and v_max >= er.single_parameter))
      order by case er.level when 'high' then 3 when 'medium' then 2 else 1 end desc limit 1
    ) r on true;
end $$;

-- Stamps the recorder, scores the reading, and opens an escalation when a
-- configured rule says so. Runs before insert so the score is stored with
-- the reading it was computed from.
create or replace function public.edoshmis_observation_before()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sc record;
begin
  if tg_op = 'UPDATE' then
    -- bmi is generated, so it is not yet computed in a before trigger.
    if (to_jsonb(new) - array['entered_in_error', 'error_reason', 'bmi']) is distinct from (to_jsonb(old) - array['entered_in_error', 'error_reason', 'bmi']) then
      raise exception 'An observation is never edited. Mark it entered in error and record it again.';
    end if;
    if new.entered_in_error and coalesce(trim(new.error_reason), '') = '' then raise exception 'Give the reason.'; end if;
    return new;
  end if;
  new.recorded_by := coalesce(public.edoshmis_staff_id(public.edoshmis_facility_org(new.facility_id)), new.recorded_by);
  if new.observed_at > now() + interval '5 minutes' then raise exception 'An observation cannot be in the future.'; end if;
  select * into sc from public.edoshmis_score_observation(new);
  new.ews_score := sc.total; new.ews_breakdown := sc.breakdown; new.ews_level := sc.level;
  return new;
end $$;

create or replace function public.edoshmis_observation_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sc record;
begin
  if new.ews_level is null then return new; end if;
  select * into sc from public.edoshmis_score_observation(new);
  insert into public.edoshmis_escalations (facility_id, patient_id, admission_id, observation_id, level, reason, response_expected)
  values (new.facility_id, new.patient_id, new.admission_id, new.id, new.ews_level,
          'Early warning score ' || new.ews_score, sc.response);
  return new;
end $$;

drop trigger if exists edoshmis_observations_before on public.edoshmis_observations;
create trigger edoshmis_observations_before before insert or update on public.edoshmis_observations for each row execute function public.edoshmis_observation_before();
drop trigger if exists edoshmis_observations_after on public.edoshmis_observations;
create trigger edoshmis_observations_after after insert on public.edoshmis_observations for each row execute function public.edoshmis_observation_after();

-- ---------------------------------------------------------------- authoring guards

-- Author and designation come from the session. A signed note is frozen.
create or replace function public.edoshmis_clinical_note_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_staff uuid; v_des text;
begin
  if tg_op = 'INSERT' then
    select s.id, s.designation::text into v_staff, v_des from public.edoshmis_staff s
    where s.organization_id = public.edoshmis_facility_org(new.facility_id) and s.user_id = auth.uid() and s.status = 'active';
    if v_staff is null then raise exception 'You are not active staff here.' using errcode = '42501'; end if;
    new.author_id := v_staff; new.author_designation := v_des;
    if new.status = 'signed' then new.signed_at := now(); else new.signed_at := null; end if;
    select patient_id into new.patient_id from public.edoshmis_admissions where id = new.admission_id;
    return new;
  end if;
  if old.status = 'signed' then
    raise exception 'A signed note cannot be changed. Add an addendum.';
  end if;
  if new.author_id <> old.author_id or new.author_designation <> old.author_designation or new.admission_id <> old.admission_id then
    raise exception 'The author and admission of a note cannot change.';
  end if;
  if old.author_id <> public.edoshmis_staff_id(public.edoshmis_facility_org(old.facility_id)) then
    raise exception 'Only the author can edit their draft.';
  end if;
  if new.status = 'signed' then new.signed_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists edoshmis_clinical_notes_guard on public.edoshmis_clinical_notes;
create trigger edoshmis_clinical_notes_guard before insert or update on public.edoshmis_clinical_notes for each row execute function public.edoshmis_clinical_note_guard();

-- Nursing notes, addenda, care plans, fluids, procedures: author from session.
create or replace function public.edoshmis_stamp_admission_author()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_staff uuid; v_des text; v_patient uuid;
begin
  select s.id, s.designation::text into v_staff, v_des from public.edoshmis_staff s
  where s.organization_id = public.edoshmis_facility_org(new.facility_id) and s.user_id = auth.uid() and s.status = 'active';
  if v_staff is null and auth.uid() is not null then raise exception 'You are not active staff here.' using errcode = '42501'; end if;
  select patient_id into v_patient from public.edoshmis_admissions where id = new.admission_id;
  case tg_table_name
    when 'edoshmis_nursing_notes' then new.author_id := v_staff; new.author_designation := v_des; new.patient_id := v_patient;
    when 'edoshmis_note_addenda' then new.author_id := v_staff; new.author_designation := v_des;
    when 'edoshmis_nursing_care_plans' then new.author_id := v_staff; new.patient_id := v_patient;
    when 'edoshmis_fluid_entries' then new.recorded_by := v_staff; new.patient_id := v_patient;
    when 'edoshmis_procedures' then new.requested_by := v_staff; new.patient_id := v_patient;
    when 'edoshmis_observations' then new.patient_id := v_patient;
    else null;
  end case;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['edoshmis_nursing_notes', 'edoshmis_note_addenda', 'edoshmis_nursing_care_plans', 'edoshmis_fluid_entries', 'edoshmis_procedures', 'edoshmis_observations'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_stamp', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.edoshmis_stamp_admission_author()', t || '_stamp', t);
  end loop;
end $$;

-- Nursing notes and addenda are final when written.
do $$ declare t text; begin
  foreach t in array array['edoshmis_nursing_notes', 'edoshmis_note_addenda'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_append_only', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.edoshmis_append_only()', t || '_append_only', t);
  end loop;
end $$;

create or replace function public.edoshmis_fluid_guard()
returns trigger language plpgsql as $$
begin
  if (to_jsonb(new) - array['entered_in_error', 'error_reason']) is distinct from (to_jsonb(old) - array['entered_in_error', 'error_reason']) then
    raise exception 'A fluid entry is never edited. Mark it entered in error and record it again.';
  end if;
  if new.entered_in_error and coalesce(trim(new.error_reason), '') = '' then raise exception 'Give the reason.'; end if;
  return new;
end $$;
drop trigger if exists edoshmis_fluid_entries_guard on public.edoshmis_fluid_entries;
create trigger edoshmis_fluid_entries_guard before update on public.edoshmis_fluid_entries for each row execute function public.edoshmis_fluid_guard();

-- No writing onto a closed admission.
create or replace function public.edoshmis_admission_open_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.edoshmis_admissions where id = new.admission_id and status in ('active', 'discharge_in_progress')) then
    raise exception 'This admission is closed; nothing more can be recorded on it.';
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['edoshmis_clinical_notes', 'edoshmis_nursing_notes', 'edoshmis_nursing_care_plans', 'edoshmis_observations', 'edoshmis_fluid_entries', 'edoshmis_procedures'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_open', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.edoshmis_admission_open_guard()', t || '_open', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['edoshmis_clinical_notes', 'edoshmis_nursing_care_plans', 'edoshmis_observations', 'edoshmis_escalations',
                           'edoshmis_fluid_entries', 'edoshmis_procedures', 'edoshmis_observation_bands', 'edoshmis_escalation_rules'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after update or delete on public.%I for each row execute function public.edoshmis_audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- workflow functions

create or replace function public.edoshmis_add_addendum(p_note_kind text, p_note uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_adm uuid; v_fac uuid; v_id uuid; v_perm text;
begin
  if p_note_kind = 'clinical' then
    select admission_id, facility_id into v_adm, v_fac from public.edoshmis_clinical_notes where id = p_note and status = 'signed';
    v_perm := 'clinical.notes';
  elsif p_note_kind = 'nursing' then
    select admission_id, facility_id into v_adm, v_fac from public.edoshmis_nursing_notes where id = p_note;
    v_perm := 'nursing.notes';
  end if;
  if v_adm is null then raise exception 'Note not found (only signed notes take addenda; edit a draft instead).'; end if;
  perform public.edoshmis_require_admission(v_adm, v_perm);
  -- Addenda can follow a discharged admission: a correction is still owed.
  insert into public.edoshmis_note_addenda (facility_id, admission_id, clinical_note_id, nursing_note_id, author_id, author_designation, body)
  values (v_fac, v_adm, case when p_note_kind = 'clinical' then p_note end, case when p_note_kind = 'nursing' then p_note end,
          '00000000-0000-0000-0000-000000000000', '', trim(p_body))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.edoshmis_update_escalation(p_escalation uuid, p_action text, p_outcome text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.edoshmis_escalations; v_staff uuid;
begin
  select * into e from public.edoshmis_escalations where id = p_escalation for update;
  if not found then raise exception 'Escalation not found.'; end if;
  v_staff := public.edoshmis_require_admission(e.admission_id, 'vitals.escalate');
  if p_action = 'acknowledge' and e.status = 'open' then
    update public.edoshmis_escalations set status = 'acknowledged', acknowledged_by = v_staff, acknowledged_at = now() where id = p_escalation;
  elsif p_action = 'resolve' and e.status <> 'resolved' then
    if coalesce(trim(p_outcome), '') = '' then raise exception 'Record what was done.'; end if;
    update public.edoshmis_escalations set status = 'resolved', resolved_by = v_staff, resolved_at = now(), outcome = trim(p_outcome),
      acknowledged_by = coalesce(acknowledged_by, v_staff), acknowledged_at = coalesce(acknowledged_at, now()) where id = p_escalation;
  else
    raise exception 'That escalation is already %.', e.status;
  end if;
end $$;

create or replace function public.edoshmis_update_procedure(p_procedure uuid, p_action text, d jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare pr public.edoshmis_procedures; v_staff uuid;
begin
  select * into pr from public.edoshmis_procedures where id = p_procedure for update;
  if not found then raise exception 'Procedure not found.'; end if;
  if p_action = 'authorise' then
    v_staff := public.edoshmis_require_admission(pr.admission_id, 'procedures.order');
    if pr.status <> 'requested' then raise exception 'Only a requested procedure can be authorised.'; end if;
    update public.edoshmis_procedures set status = 'authorised', authorised_by = v_staff, authorised_at = now(), updated_at = now(),
      responsible_clinician_id = coalesce(nullif(d ->> 'responsible_clinician_id', '')::uuid, responsible_clinician_id) where id = p_procedure;
  elsif p_action = 'schedule' then
    v_staff := public.edoshmis_require_admission(pr.admission_id, 'procedures.order');
    if pr.status not in ('authorised', 'scheduled') then raise exception 'Authorise the procedure before scheduling it.'; end if;
    update public.edoshmis_procedures set status = 'scheduled', scheduled_for = (d ->> 'scheduled_for')::timestamptz,
      consent_obtained = coalesce((d ->> 'consent_obtained')::boolean, consent_obtained), consent_by = coalesce(nullif(trim(d ->> 'consent_by'), ''), consent_by),
      updated_at = now() where id = p_procedure;
  elsif p_action = 'record' then
    v_staff := public.edoshmis_require_admission(pr.admission_id, 'procedures.perform');
    if pr.status not in ('authorised', 'scheduled') then raise exception 'Only an authorised procedure can be recorded as done.'; end if;
    if not (pr.consent_obtained or coalesce((d ->> 'consent_obtained')::boolean, false)) then
      raise exception 'Record consent before recording the procedure.';
    end if;
    if coalesce(trim(d ->> 'procedure_note'), '') = '' then raise exception 'Write the procedure note.'; end if;
    update public.edoshmis_procedures set status = 'done', performed_by = v_staff, performed_at = coalesce((d ->> 'performed_at')::timestamptz, now()),
      consent_obtained = true, consent_by = coalesce(nullif(trim(d ->> 'consent_by'), ''), consent_by),
      procedure_note = trim(d ->> 'procedure_note'), outcome = nullif(trim(d ->> 'outcome'), ''), complications = nullif(trim(d ->> 'complications'), ''),
      post_procedure_monitoring = nullif(trim(d ->> 'post_procedure_monitoring'), ''), follow_up = nullif(trim(d ->> 'follow_up'), ''), updated_at = now()
    where id = p_procedure;
  elsif p_action = 'cancel' then
    v_staff := public.edoshmis_require_admission(pr.admission_id, 'procedures.order');
    if pr.status = 'done' then raise exception 'A completed procedure cannot be cancelled.'; end if;
    if coalesce(trim(d ->> 'reason'), '') = '' then raise exception 'Give the reason.'; end if;
    update public.edoshmis_procedures set status = 'cancelled', cancel_reason = trim(d ->> 'reason'), updated_at = now() where id = p_procedure;
  else
    raise exception 'Unknown action.';
  end if;
end $$;

-- ---------------------------------------------------------------- RLS

alter table public.edoshmis_clinical_notes enable row level security;
alter table public.edoshmis_nursing_notes enable row level security;
alter table public.edoshmis_note_addenda enable row level security;
alter table public.edoshmis_nursing_care_plans enable row level security;
alter table public.edoshmis_observation_bands enable row level security;
alter table public.edoshmis_escalation_rules enable row level security;
alter table public.edoshmis_observations enable row level security;
alter table public.edoshmis_escalations enable row level security;
alter table public.edoshmis_fluid_entries enable row level security;
alter table public.edoshmis_procedures enable row level security;

-- Read: anyone who can see the admission. Write: the matching permission,
-- on an admission they can see.
do $$ declare r record; begin
  for r in select * from (values
    ('edoshmis_clinical_notes', 'clinical.notes'),
    ('edoshmis_nursing_notes', 'nursing.notes'),
    ('edoshmis_nursing_care_plans', 'nursing.notes'),
    ('edoshmis_observations', 'vitals.record'),
    ('edoshmis_fluid_entries', 'fluids.record'),
    ('edoshmis_procedures', 'procedures.order')
  ) as t (tbl, perm) loop
    execute format('drop policy if exists %I on public.%I', r.tbl || '_read', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using (public.edoshmis_can_see_admission(admission_id))', r.tbl || '_read', r.tbl);
    execute format('drop policy if exists %I on public.%I', r.tbl || '_insert', r.tbl);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.edoshmis_has_perm(facility_id, %L) and public.edoshmis_can_see_admission(admission_id))', r.tbl || '_insert', r.tbl, r.perm);
    if r.tbl <> 'edoshmis_nursing_notes' and r.tbl <> 'edoshmis_procedures' then
      execute format('drop policy if exists %I on public.%I', r.tbl || '_update', r.tbl);
      execute format('create policy %I on public.%I for update to authenticated using (public.edoshmis_has_perm(facility_id, %L) and public.edoshmis_can_see_admission(admission_id)) with check (public.edoshmis_has_perm(facility_id, %L))', r.tbl || '_update', r.tbl, r.perm, r.perm);
    end if;
  end loop;
end $$;

drop policy if exists edoshmis_note_addenda_read on public.edoshmis_note_addenda;
create policy edoshmis_note_addenda_read on public.edoshmis_note_addenda for select to authenticated using (public.edoshmis_can_see_admission(admission_id));
drop policy if exists edoshmis_escalations_read on public.edoshmis_escalations;
create policy edoshmis_escalations_read on public.edoshmis_escalations for select to authenticated using (public.edoshmis_can_see_admission(admission_id));

drop policy if exists edoshmis_observation_bands_read on public.edoshmis_observation_bands;
create policy edoshmis_observation_bands_read on public.edoshmis_observation_bands for select to authenticated using (public.edoshmis_is_member(public.edoshmis_facility_org(facility_id)));
drop policy if exists edoshmis_observation_bands_write on public.edoshmis_observation_bands;
create policy edoshmis_observation_bands_write on public.edoshmis_observation_bands for all to authenticated
  using (public.edoshmis_has_perm(facility_id, 'admin.clinical_config')) with check (public.edoshmis_has_perm(facility_id, 'admin.clinical_config'));
drop policy if exists edoshmis_escalation_rules_read on public.edoshmis_escalation_rules;
create policy edoshmis_escalation_rules_read on public.edoshmis_escalation_rules for select to authenticated using (public.edoshmis_is_member(public.edoshmis_facility_org(facility_id)));
drop policy if exists edoshmis_escalation_rules_write on public.edoshmis_escalation_rules;
create policy edoshmis_escalation_rules_write on public.edoshmis_escalation_rules for all to authenticated
  using (public.edoshmis_has_perm(facility_id, 'admin.clinical_config')) with check (public.edoshmis_has_perm(facility_id, 'admin.clinical_config'));
