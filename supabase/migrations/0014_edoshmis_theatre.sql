-- EDOSHMIS 0014 — theatre and surgery.
--
--   requested → scheduled (theatre, time, team; no overlapping bookings)
--   → sign in (WHO checklist, before anaesthesia) → in theatre → time out
--   (before incision) → operation note → sign out (before leaving theatre)
--   → recovery → completed.
--
-- The three checklist phases are each confirmed by a named person at a
-- recorded time; the database refuses to move a patient into theatre
-- without consent and sign-in, or out of theatre without sign-out.

insert into public.edoshmis_permission_catalog (key, area, label) values
  ('theatre.read', 'Theatre', 'See the theatre list and surgical records'),
  ('theatre.schedule', 'Theatre', 'Request and schedule surgery'),
  ('theatre.perform', 'Theatre', 'Run the checklist, write operation and recovery notes'),
  ('theatre.anaesthesia', 'Theatre', 'Anaesthetic assessment and record'),
  ('theatre.configure', 'Theatre', 'Set up theatres')
on conflict (key) do update set area = excluded.area, label = excluded.label;

select public.edoshmis_add_role_default('theatre_staff', 'Theatre nurse', 'Scrub and circulating nurses: checklist, consumables, recovery.', array['patients.read', 'patients.clinical', 'theatre.read', 'theatre.perform', 'stores.read'], true);
select public.edoshmis_add_role_default('anaesthetist', 'Anaesthetist', 'Anaesthetic assessment, record and recovery.', array['patients.read', 'patients.clinical', 'theatre.read', 'theatre.perform', 'theatre.anaesthesia', 'ipd.read', 'ipd.all_patients'], true);
select public.edoshmis_add_role_default('consultant', 'Consultant', null, array['theatre.read', 'theatre.schedule', 'theatre.perform']);
select public.edoshmis_add_role_default('medical_officer', 'Medical officer', null, array['theatre.read', 'theatre.schedule', 'theatre.perform']);
select public.edoshmis_add_role_default('medical_superintendent', 'Medical superintendent', null, array['theatre.read', 'theatre.schedule']);
select public.edoshmis_add_role_default('nursing_officer', 'Nursing officer', null, array['theatre.read']);
select public.edoshmis_add_role_default('nurse', 'Nurse', null, array['theatre.read']);
select public.edoshmis_add_role_default('hospital_admin', 'Hospital administrator', null, array['theatre.configure']);

create table if not exists public.edoshmis_theatres (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  name text not null,
  code text not null,
  store_id uuid references public.edoshmis_stores (id),
  tariff_id uuid references public.edoshmis_tariffs (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (facility_id, code)
);

create table if not exists public.edoshmis_surgeries (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  admission_id uuid references public.edoshmis_admissions (id),
  encounter_id uuid references public.edoshmis_encounters (id),
  surgery_number text not null,
  procedure_name text not null check (length(trim(procedure_name)) between 2 and 300),
  procedure_code text,
  laterality text check (laterality is null or laterality in ('left', 'right', 'bilateral', 'not_applicable')),
  urgency public.edoshmis_priority not null default 'elective',
  indication text,
  status text not null default 'requested' check (status in ('requested', 'scheduled', 'in_theatre', 'recovery', 'completed', 'cancelled')),
  requested_by uuid not null references public.edoshmis_staff (id),
  requested_at timestamptz not null default now(),
  theatre_id uuid references public.edoshmis_theatres (id),
  scheduled_start timestamptz,
  duration_minutes int check (duration_minutes is null or duration_minutes between 10 and 1440),
  surgeon_id uuid references public.edoshmis_staff (id),
  assistant_id uuid references public.edoshmis_staff (id),
  anaesthetist_id uuid references public.edoshmis_staff (id),
  scrub_nurse_id uuid references public.edoshmis_staff (id),
  consent_obtained boolean not null default false,
  consent_by text,
  consent_at timestamptz,
  -- Pre-operative and anaesthetic assessment
  pre_op_assessment text,
  asa_class text check (asa_class is null or asa_class in ('I', 'II', 'III', 'IV', 'V', 'VI')),
  anaesthesia_type text check (anaesthesia_type is null or anaesthesia_type in ('general', 'spinal', 'epidural', 'regional', 'local', 'sedation', 'combined')),
  fasting_confirmed boolean,
  anaesthesia_record text,
  -- WHO checklist phases: who confirmed, when, and the answers
  sign_in_by uuid references public.edoshmis_staff (id),
  sign_in_at timestamptz,
  sign_in jsonb,
  time_out_by uuid references public.edoshmis_staff (id),
  time_out_at timestamptz,
  time_out jsonb,
  sign_out_by uuid references public.edoshmis_staff (id),
  sign_out_at timestamptz,
  sign_out jsonb,
  -- Operation
  entered_theatre_at timestamptz,
  incision_at timestamptz,
  closure_at timestamptz,
  findings text,
  procedure_details text,
  blood_loss_ml int check (blood_loss_ml is null or blood_loss_ml between 0 and 20000),
  specimens text,
  complications text,
  post_op_instructions text,
  note_by uuid references public.edoshmis_staff (id),
  note_at timestamptz,
  -- Recovery
  recovery_in_at timestamptz,
  recovery_notes text,
  recovery_out_at timestamptz,
  destination text,
  cancel_reason text,
  updated_at timestamptz not null default now(),
  unique (facility_id, surgery_number),
  check (admission_id is not null or encounter_id is not null)
);
create index if not exists edoshmis_surgeries_list_idx on public.edoshmis_surgeries (facility_id, scheduled_start);
create index if not exists edoshmis_surgeries_admission_idx on public.edoshmis_surgeries (admission_id);

create table if not exists public.edoshmis_surgery_implants (
  id uuid primary key default gen_random_uuid(),
  surgery_id uuid not null references public.edoshmis_surgeries (id),
  facility_id uuid not null references public.edoshmis_facilities (id),
  description text not null,
  manufacturer text,
  lot_number text,
  serial_number text,
  site text,
  recorded_by uuid not null references public.edoshmis_staff (id),
  recorded_at timestamptz not null default now()
);

create table if not exists public.edoshmis_surgery_consumables (
  id uuid primary key default gen_random_uuid(),
  surgery_id uuid not null references public.edoshmis_surgeries (id),
  facility_id uuid not null references public.edoshmis_facilities (id),
  item_id uuid not null references public.edoshmis_stock_items (id),
  quantity numeric(12, 2) not null check (quantity > 0),
  batches jsonb,
  recorded_by uuid not null references public.edoshmis_staff (id),
  recorded_at timestamptz not null default now()
);

create or replace function public.edoshmis_can_see_surgery(p_surgery uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.edoshmis_surgeries s where s.id = p_surgery and (
      public.edoshmis_has_perm(s.facility_id, 'theatre.perform') or public.edoshmis_has_perm(s.facility_id, 'theatre.anaesthesia')
      or (public.edoshmis_has_perm(s.facility_id, 'theatre.read') and (
            (s.admission_id is not null and public.edoshmis_can_see_admission(s.admission_id))
         or (s.admission_id is null and public.edoshmis_has_perm(s.facility_id, 'opd.consult')))))
  );
$$;

-- ---------------------------------------------------------------- workflow

create or replace function public.edoshmis_request_surgery(p_facility uuid, r jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_staff uuid := public.edoshmis_require(p_facility, 'theatre.schedule'); v_adm uuid := nullif(r ->> 'admission_id', '')::uuid; v_enc uuid := nullif(r ->> 'encounter_id', '')::uuid;
  v_patient uuid; v_id uuid; v_code text; v_year text;
begin
  if v_adm is not null then
    perform public.edoshmis_require_admission(v_adm, 'theatre.schedule');
    select patient_id into v_patient from public.edoshmis_admissions where id = v_adm and status in ('active', 'discharge_in_progress');
  elsif v_enc is not null then
    select patient_id into v_patient from public.edoshmis_encounters where id = v_enc and facility_id = p_facility and status = 'open';
  end if;
  if v_patient is null then raise exception 'Book surgery from an active admission or an open visit (day case).'; end if;
  select code into v_code from public.edoshmis_facilities where id = p_facility;
  v_year := to_char(now() at time zone 'Africa/Nairobi', 'YYYY');
  insert into public.edoshmis_surgeries (facility_id, patient_id, admission_id, encounter_id, surgery_number, procedure_name, procedure_code, laterality, urgency, indication, requested_by, surgeon_id)
  values (p_facility, v_patient, v_adm, v_enc, v_code || '/OT/' || v_year || '/' || lpad(public.edoshmis_next_number(p_facility, 'surgery', v_year)::text, 5, '0'),
          trim(r ->> 'procedure_name'), nullif(trim(r ->> 'procedure_code'), ''), nullif(r ->> 'laterality', ''), coalesce(nullif(r ->> 'urgency', ''), 'elective')::public.edoshmis_priority,
          nullif(trim(r ->> 'indication'), ''), v_staff, nullif(r ->> 'surgeon_id', '')::uuid)
  returning id into v_id;
  perform public.edoshmis_audit(public.edoshmis_facility_org(p_facility), p_facility, 'theatre.requested', 'surgery', v_id::text, v_patient, null, r);
  return v_id;
end $$;

-- Book (or re-book) a theatre slot. Refuses an overlap with another
-- booking in the same theatre; the theatre row is locked while checking.
create or replace function public.edoshmis_schedule_surgery(p_surgery uuid, d jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare su public.edoshmis_surgeries; v_staff uuid; v_th uuid := (d ->> 'theatre_id')::uuid; v_start timestamptz := (d ->> 'scheduled_start')::timestamptz;
  v_dur int := coalesce(nullif(d ->> 'duration_minutes', '')::int, 60); v_clash text;
begin
  select * into su from public.edoshmis_surgeries where id = p_surgery for update;
  if not found then raise exception 'Surgery not found.'; end if;
  v_staff := public.edoshmis_require(su.facility_id, 'theatre.schedule');
  if su.status not in ('requested', 'scheduled') then raise exception 'This surgery is already %.', su.status; end if;
  if v_th is null or v_start is null then raise exception 'Choose the theatre and the start time.'; end if;
  perform 1 from public.edoshmis_theatres where id = v_th and facility_id = su.facility_id and is_active for update;
  if not found then raise exception 'Theatre not found.'; end if;
  select surgery_number || ' (' || procedure_name || ')' into v_clash from public.edoshmis_surgeries
  where theatre_id = v_th and id <> p_surgery and status in ('scheduled', 'in_theatre')
    and tstzrange(scheduled_start, scheduled_start + make_interval(mins => coalesce(duration_minutes, 60))) && tstzrange(v_start, v_start + make_interval(mins => v_dur))
  limit 1;
  if v_clash is not null then raise exception 'That theatre is already booked then: %.', v_clash; end if;
  update public.edoshmis_surgeries set status = 'scheduled', theatre_id = v_th, scheduled_start = v_start, duration_minutes = v_dur,
    surgeon_id = coalesce(nullif(d ->> 'surgeon_id', '')::uuid, surgeon_id), assistant_id = coalesce(nullif(d ->> 'assistant_id', '')::uuid, assistant_id),
    anaesthetist_id = coalesce(nullif(d ->> 'anaesthetist_id', '')::uuid, anaesthetist_id), scrub_nurse_id = coalesce(nullif(d ->> 'scrub_nurse_id', '')::uuid, scrub_nurse_id),
    updated_at = now()
  where id = p_surgery;
  perform public.edoshmis_audit(public.edoshmis_facility_org(su.facility_id), su.facility_id, 'theatre.scheduled', 'surgery', p_surgery::text, su.patient_id, null, d);
end $$;

-- Everything recorded on the way: consent, assessments, checklist phases,
-- the operation note, recovery. Each step checks what must come first.
create or replace function public.edoshmis_surgery_step(p_surgery uuid, p_step text, d jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare su public.edoshmis_surgeries; v_staff uuid; v_acct uuid; v_tariff uuid;
begin
  select * into su from public.edoshmis_surgeries where id = p_surgery for update;
  if not found then raise exception 'Surgery not found.'; end if;
  if su.status in ('completed', 'cancelled') and p_step <> 'note' then raise exception 'This surgery is %.', su.status; end if;

  if p_step = 'consent' then
    v_staff := public.edoshmis_require(su.facility_id, 'theatre.perform');
    if coalesce(trim(d ->> 'consent_by'), '') = '' then raise exception 'Name who gave consent.'; end if;
    update public.edoshmis_surgeries set consent_obtained = true, consent_by = trim(d ->> 'consent_by'), consent_at = now(), updated_at = now() where id = p_surgery;
  elsif p_step = 'pre_op' then
    v_staff := public.edoshmis_require(su.facility_id, 'theatre.anaesthesia');
    update public.edoshmis_surgeries set pre_op_assessment = coalesce(nullif(trim(d ->> 'pre_op_assessment'), ''), pre_op_assessment),
      asa_class = coalesce(nullif(d ->> 'asa_class', ''), asa_class), anaesthesia_type = coalesce(nullif(d ->> 'anaesthesia_type', ''), anaesthesia_type),
      fasting_confirmed = coalesce((d ->> 'fasting_confirmed')::boolean, fasting_confirmed), anaesthetist_id = coalesce(anaesthetist_id, v_staff), updated_at = now()
    where id = p_surgery;
  elsif p_step = 'sign_in' then
    v_staff := public.edoshmis_require(su.facility_id, 'theatre.perform');
    if su.status <> 'scheduled' then raise exception 'Schedule the surgery first.'; end if;
    if not su.consent_obtained then raise exception 'Consent must be recorded before sign-in.'; end if;
    if exists (select 1 from jsonb_each_text(coalesce(d -> 'answers', '{}'::jsonb)) x where x.value = 'false') then
      raise exception 'Every sign-in item must be confirmed before anaesthesia. Resolve what is not, then sign in.';
    end if;
    update public.edoshmis_surgeries set sign_in = d -> 'answers', sign_in_by = v_staff, sign_in_at = now(), status = 'in_theatre', entered_theatre_at = coalesce(entered_theatre_at, now()), updated_at = now()
    where id = p_surgery;
  elsif p_step = 'time_out' then
    v_staff := public.edoshmis_require(su.facility_id, 'theatre.perform');
    if su.status <> 'in_theatre' or su.sign_in_at is null then raise exception 'Sign in before the time out.'; end if;
    if exists (select 1 from jsonb_each_text(coalesce(d -> 'answers', '{}'::jsonb)) x where x.value = 'false') then
      raise exception 'Every time-out item must be confirmed before the incision.';
    end if;
    update public.edoshmis_surgeries set time_out = d -> 'answers', time_out_by = v_staff, time_out_at = now(), incision_at = coalesce(nullif(d ->> 'incision_at', '')::timestamptz, now()), updated_at = now()
    where id = p_surgery;
  elsif p_step = 'anaesthesia_record' then
    v_staff := public.edoshmis_require(su.facility_id, 'theatre.anaesthesia');
    update public.edoshmis_surgeries set anaesthesia_record = trim(d ->> 'anaesthesia_record'), updated_at = now() where id = p_surgery;
  elsif p_step = 'note' then
    v_staff := public.edoshmis_require(su.facility_id, 'theatre.perform');
    if su.time_out_at is null then raise exception 'Record the time out before the operation note.'; end if;
    if su.note_at is not null and su.note_by <> v_staff then raise exception 'The operation note was written by someone else; add to it through the surgical team lead.'; end if;
    if coalesce(trim(d ->> 'procedure_details'), '') = '' then raise exception 'Describe the procedure.'; end if;
    update public.edoshmis_surgeries set findings = nullif(trim(d ->> 'findings'), ''), procedure_details = trim(d ->> 'procedure_details'),
      blood_loss_ml = nullif(d ->> 'blood_loss_ml', '')::int, specimens = nullif(trim(d ->> 'specimens'), ''), complications = nullif(trim(d ->> 'complications'), ''),
      post_op_instructions = nullif(trim(d ->> 'post_op_instructions'), ''), closure_at = coalesce(nullif(d ->> 'closure_at', '')::timestamptz, closure_at, now()),
      note_by = v_staff, note_at = coalesce(note_at, now()), updated_at = now()
    where id = p_surgery;
  elsif p_step = 'sign_out' then
    v_staff := public.edoshmis_require(su.facility_id, 'theatre.perform');
    if su.status <> 'in_theatre' then raise exception 'The patient is not in theatre.'; end if;
    if su.note_at is null then raise exception 'Write the operation note before sign-out.'; end if;
    if exists (select 1 from jsonb_each_text(coalesce(d -> 'answers', '{}'::jsonb)) x where x.value = 'false') then
      raise exception 'Every sign-out item (counts, specimen labels, equipment) must be confirmed before the patient leaves theatre.';
    end if;
    update public.edoshmis_surgeries set sign_out = d -> 'answers', sign_out_by = v_staff, sign_out_at = now(), status = 'recovery', recovery_in_at = now(), updated_at = now() where id = p_surgery;
    -- Theatre fee, once.
    select tariff_id into v_tariff from public.edoshmis_theatres where id = su.theatre_id;
    select id into v_acct from public.edoshmis_billing_accounts
    where status = 'open' and ((su.admission_id is not null and admission_id = su.admission_id) or (su.admission_id is null and encounter_id = su.encounter_id and admission_id is null));
    if v_tariff is not null and v_acct is not null then
      perform public.edoshmis_post_keyed_charge(v_acct, v_tariff, 'Theatre: ' || su.procedure_name, (now() at time zone 'Africa/Nairobi')::date, 1, null, 'theatre:' || su.id::text, 'surgery', su.id, v_staff);
    end if;
  elsif p_step = 'recovery_out' then
    v_staff := public.edoshmis_require(su.facility_id, 'theatre.perform');
    if su.status <> 'recovery' then raise exception 'The patient is not in recovery.'; end if;
    if coalesce(trim(d ->> 'destination'), '') = '' then raise exception 'Say where the patient goes from recovery.'; end if;
    update public.edoshmis_surgeries set recovery_notes = nullif(trim(d ->> 'recovery_notes'), ''), recovery_out_at = now(), destination = trim(d ->> 'destination'), status = 'completed', updated_at = now()
    where id = p_surgery;
  elsif p_step = 'cancel' then
    v_staff := public.edoshmis_require(su.facility_id, 'theatre.schedule');
    if su.status not in ('requested', 'scheduled') then raise exception 'Only surgery not yet started can be cancelled.'; end if;
    if coalesce(trim(d ->> 'reason'), '') = '' then raise exception 'Give the reason.'; end if;
    update public.edoshmis_surgeries set status = 'cancelled', cancel_reason = trim(d ->> 'reason'), updated_at = now() where id = p_surgery;
  else
    raise exception 'Unknown step.';
  end if;
  perform public.edoshmis_audit(public.edoshmis_facility_org(su.facility_id), su.facility_id, 'theatre.' || p_step, 'surgery', p_surgery::text, su.patient_id, null, d);
end $$;

create or replace function public.edoshmis_surgery_consumable(p_surgery uuid, p_item uuid, p_qty numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare su public.edoshmis_surgeries; v_staff uuid; v_store uuid; used jsonb;
begin
  select * into su from public.edoshmis_surgeries where id = p_surgery;
  v_staff := public.edoshmis_require(su.facility_id, 'theatre.perform');
  if su.status not in ('in_theatre', 'recovery') then raise exception 'Record consumables while the patient is in theatre or recovery.'; end if;
  select store_id into v_store from public.edoshmis_theatres where id = su.theatre_id;
  if v_store is null then raise exception 'This theatre has no store linked; set one under Theatre setup.'; end if;
  used := public.edoshmis_stock_take_fefo(v_store, p_item, p_qty, 'issue', 'surgery', p_surgery, su.patient_id, null, v_staff);
  insert into public.edoshmis_surgery_consumables (surgery_id, facility_id, item_id, quantity, batches, recorded_by) values (p_surgery, su.facility_id, p_item, p_qty, used, v_staff);
end $$;

create or replace function public.edoshmis_surgery_implant(p_surgery uuid, d jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare su public.edoshmis_surgeries; v_staff uuid;
begin
  select * into su from public.edoshmis_surgeries where id = p_surgery;
  v_staff := public.edoshmis_require(su.facility_id, 'theatre.perform');
  if su.status not in ('in_theatre', 'recovery', 'completed') then raise exception 'Implants are recorded once the operation has started.'; end if;
  if coalesce(trim(d ->> 'description'), '') = '' or (coalesce(trim(d ->> 'lot_number'), '') = '' and coalesce(trim(d ->> 'serial_number'), '') = '') then
    raise exception 'Describe the implant and give its lot or serial number (for traceability).';
  end if;
  insert into public.edoshmis_surgery_implants (surgery_id, facility_id, description, manufacturer, lot_number, serial_number, site, recorded_by)
  values (p_surgery, su.facility_id, trim(d ->> 'description'), nullif(trim(d ->> 'manufacturer'), ''), nullif(trim(d ->> 'lot_number'), ''), nullif(trim(d ->> 'serial_number'), ''), nullif(trim(d ->> 'site'), ''), v_staff);
end $$;

drop trigger if exists edoshmis_surgery_implants_append_only on public.edoshmis_surgery_implants;
create trigger edoshmis_surgery_implants_append_only before update or delete on public.edoshmis_surgery_implants for each row execute function public.edoshmis_append_only();
drop trigger if exists edoshmis_surgery_consumables_append_only on public.edoshmis_surgery_consumables;
create trigger edoshmis_surgery_consumables_append_only before update or delete on public.edoshmis_surgery_consumables for each row execute function public.edoshmis_append_only();
drop trigger if exists edoshmis_theatres_audit on public.edoshmis_theatres;
create trigger edoshmis_theatres_audit after insert or update or delete on public.edoshmis_theatres for each row execute function public.edoshmis_audit_trigger();

alter table public.edoshmis_theatres enable row level security;
alter table public.edoshmis_surgeries enable row level security;
alter table public.edoshmis_surgery_implants enable row level security;
alter table public.edoshmis_surgery_consumables enable row level security;

drop policy if exists edoshmis_theatres_read on public.edoshmis_theatres;
create policy edoshmis_theatres_read on public.edoshmis_theatres for select to authenticated using (public.edoshmis_is_member(public.edoshmis_facility_org(facility_id)));
drop policy if exists edoshmis_theatres_write on public.edoshmis_theatres;
create policy edoshmis_theatres_write on public.edoshmis_theatres for all to authenticated
  using (public.edoshmis_has_perm(facility_id, 'theatre.configure')) with check (public.edoshmis_has_perm(facility_id, 'theatre.configure'));
-- The theatre list (who, when, where, what) is for anyone with theatre.read;
-- the clinical detail is on the same row, so it follows the same rule.
drop policy if exists edoshmis_surgeries_read on public.edoshmis_surgeries;
create policy edoshmis_surgeries_read on public.edoshmis_surgeries for select to authenticated
  using (public.edoshmis_has_perm(facility_id, 'theatre.read') or public.edoshmis_can_see_surgery(id));
drop policy if exists edoshmis_surgery_implants_read on public.edoshmis_surgery_implants;
create policy edoshmis_surgery_implants_read on public.edoshmis_surgery_implants for select to authenticated using (public.edoshmis_can_see_surgery(surgery_id));
drop policy if exists edoshmis_surgery_consumables_read on public.edoshmis_surgery_consumables;
create policy edoshmis_surgery_consumables_read on public.edoshmis_surgery_consumables for select to authenticated using (public.edoshmis_can_see_surgery(surgery_id));

select public.edoshmis_sync_all_roles();
