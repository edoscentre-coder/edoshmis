-- EDOSHMIS 0012 — radiology and imaging.
--
--   order → scheduled → performed (radiographer) → reported (radiologist)
--   → validated and released. A validated report is frozen; corrections are
--   addenda. Images live in the modality / PACS; the order carries the
--   accession number and, once integrated, the study UID.

insert into public.edoshmis_permission_catalog (key, area, label) values
  ('imaging.read', 'Imaging', 'See imaging orders and released reports'),
  ('imaging.order', 'Imaging', 'Order imaging examinations'),
  ('imaging.perform', 'Imaging', 'Schedule and perform examinations (radiographer)'),
  ('imaging.report', 'Imaging', 'Report examinations (radiologist)'),
  ('imaging.validate', 'Imaging', 'Validate and release reports'),
  ('imaging.configure', 'Imaging', 'Manage the imaging catalogue')
on conflict (key) do update set area = excluded.area, label = excluded.label;

select public.edoshmis_add_role_default('radiographer', 'Radiographer', 'Schedules and performs examinations.', array['patients.read', 'imaging.read', 'imaging.perform', 'opd.read'], true);
select public.edoshmis_add_role_default('radiologist', 'Radiologist', 'Reports and validates examinations.', array['patients.read', 'patients.clinical', 'imaging.read', 'imaging.perform', 'imaging.report', 'imaging.validate', 'imaging.configure', 'opd.read'], true);
select public.edoshmis_add_role_default('consultant', 'Consultant', null, array['imaging.read', 'imaging.order']);
select public.edoshmis_add_role_default('medical_officer', 'Medical officer', null, array['imaging.read', 'imaging.order']);
select public.edoshmis_add_role_default('clinical_officer', 'Clinical officer', null, array['imaging.read', 'imaging.order']);
select public.edoshmis_add_role_default('medical_superintendent', 'Medical superintendent', null, array['imaging.read', 'imaging.order']);
select public.edoshmis_add_role_default('nurse', 'Nurse', null, array['imaging.read']);
select public.edoshmis_add_role_default('hospital_admin', 'Hospital administrator', null, array['imaging.configure']);

create table if not exists public.edoshmis_imaging_exams (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,20}$'),
  name text not null,
  modality text not null check (modality in ('xray', 'ultrasound', 'ct', 'mri', 'mammography', 'fluoroscopy', 'dexa', 'other')),
  body_part text,
  uses_contrast boolean not null default false,
  ionising boolean not null default true,
  preparation text,
  tariff_id uuid references public.edoshmis_tariffs (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (facility_id, code)
);

create table if not exists public.edoshmis_imaging_orders (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  encounter_id uuid references public.edoshmis_encounters (id),
  admission_id uuid references public.edoshmis_admissions (id),
  exam_id uuid not null references public.edoshmis_imaging_exams (id),
  exam_name text not null,
  accession_number text not null,
  priority text not null default 'routine' check (priority in ('routine', 'urgent', 'stat')),
  clinical_indication text not null check (length(trim(clinical_indication)) between 2 and 2000),
  pregnancy_status text check (pregnancy_status is null or pregnancy_status in ('not_pregnant', 'pregnant', 'unknown', 'not_applicable')),
  status text not null default 'ordered' check (status in ('ordered', 'scheduled', 'performed', 'reported', 'validated', 'cancelled')),
  ordered_by uuid not null references public.edoshmis_staff (id),
  ordered_at timestamptz not null default now(),
  scheduled_for timestamptz,
  performed_by uuid references public.edoshmis_staff (id),
  performed_at timestamptz,
  technique text,
  contrast_given text,
  pacs_study_uid text,
  findings text,
  impression text,
  reported_by uuid references public.edoshmis_staff (id),
  reported_at timestamptz,
  validated_by uuid references public.edoshmis_staff (id),
  validated_at timestamptz,
  cancel_reason text,
  unique (facility_id, accession_number),
  check (encounter_id is not null or admission_id is not null)
);
create index if not exists edoshmis_imaging_orders_worklist_idx on public.edoshmis_imaging_orders (facility_id, status, ordered_at);
create index if not exists edoshmis_imaging_orders_patient_idx on public.edoshmis_imaging_orders (patient_id, ordered_at desc);

create table if not exists public.edoshmis_imaging_addenda (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  order_id uuid not null references public.edoshmis_imaging_orders (id),
  author_id uuid not null references public.edoshmis_staff (id),
  body text not null check (length(trim(body)) between 2 and 5000),
  created_at timestamptz not null default now()
);

create or replace function public.edoshmis_can_see_imaging_order(p_order uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.edoshmis_imaging_orders o
    where o.id = p_order and (
      public.edoshmis_has_perm(o.facility_id, 'imaging.perform') or public.edoshmis_has_perm(o.facility_id, 'imaging.report')
      or (public.edoshmis_has_perm(o.facility_id, 'imaging.read') and (
            (o.admission_id is not null and public.edoshmis_can_see_admission(o.admission_id))
         or (o.admission_id is null and (public.edoshmis_has_perm(o.facility_id, 'opd.consult') or public.edoshmis_has_perm(o.facility_id, 'opd.triage'))))))
  );
$$;

create or replace function public.edoshmis_order_imaging(p_facility uuid, o jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_staff uuid := public.edoshmis_require(p_facility, 'imaging.order'); v_adm uuid := nullif(o ->> 'admission_id', '')::uuid;
  v_enc uuid := nullif(o ->> 'encounter_id', '')::uuid; v_patient uuid; v_sex text; ex public.edoshmis_imaging_exams; v_id uuid; v_code text; v_acct uuid;
  v_preg text := nullif(o ->> 'pregnancy_status', '');
begin
  if v_adm is not null then
    perform public.edoshmis_require_admission(v_adm, 'imaging.order');
    select patient_id into v_patient from public.edoshmis_admissions where id = v_adm and status in ('active', 'discharge_in_progress');
    select id into v_acct from public.edoshmis_billing_accounts where admission_id = v_adm and status = 'open';
  elsif v_enc is not null then
    select patient_id into v_patient from public.edoshmis_encounters where id = v_enc and facility_id = p_facility and status = 'open';
    select id into v_acct from public.edoshmis_billing_accounts where encounter_id = v_enc and admission_id is null and status = 'open';
  end if;
  if v_patient is null then raise exception 'Order from an active admission or an open visit.'; end if;
  select * into ex from public.edoshmis_imaging_exams where id = (o ->> 'exam_id')::uuid and facility_id = p_facility and is_active;
  if not found then raise exception 'Choose an examination from the catalogue.'; end if;
  select sex::text into v_sex from public.edoshmis_patients where id = v_patient;
  -- Ionising exams on a female patient need the pregnancy status stated (not assumed).
  if ex.ionising and v_sex = 'female' and v_preg is null then raise exception 'State the pregnancy status before ordering an ionising examination.'; end if;
  select code into v_code from public.edoshmis_facilities where id = p_facility;
  insert into public.edoshmis_imaging_orders (facility_id, patient_id, encounter_id, admission_id, exam_id, exam_name, accession_number, priority, clinical_indication, pregnancy_status, ordered_by)
  values (p_facility, v_patient, v_enc, v_adm, ex.id, ex.name,
          v_code || 'RAD' || to_char(now() at time zone 'Africa/Nairobi', 'YYMMDD') || lpad(public.edoshmis_next_number(p_facility, 'rad_accession', to_char(now() at time zone 'Africa/Nairobi', 'YYYYMMDD'))::text, 4, '0'),
          coalesce(nullif(o ->> 'priority', ''), 'routine'), trim(o ->> 'clinical_indication'), coalesce(v_preg, case when v_sex <> 'female' then 'not_applicable' end), v_staff)
  returning id into v_id;
  if ex.tariff_id is not null and v_acct is not null then
    perform public.edoshmis_post_keyed_charge(v_acct, ex.tariff_id, ex.name, (now() at time zone 'Africa/Nairobi')::date, 1, null, 'imaging:' || v_id::text, 'imaging', v_id, v_staff);
  end if;
  perform public.edoshmis_audit(public.edoshmis_facility_org(p_facility), p_facility, 'imaging.ordered', 'imaging_order', v_id::text, v_patient, null, o);
  return v_id;
end $$;

create or replace function public.edoshmis_imaging_step(p_order uuid, p_step text, d jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare io public.edoshmis_imaging_orders; v_staff uuid;
begin
  select * into io from public.edoshmis_imaging_orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  if p_step = 'schedule' then
    v_staff := public.edoshmis_require(io.facility_id, 'imaging.perform');
    if io.status not in ('ordered', 'scheduled') then raise exception 'This examination is already %.', io.status; end if;
    update public.edoshmis_imaging_orders set status = 'scheduled', scheduled_for = (d ->> 'scheduled_for')::timestamptz where id = p_order;
  elsif p_step = 'perform' then
    v_staff := public.edoshmis_require(io.facility_id, 'imaging.perform');
    if io.status not in ('ordered', 'scheduled') then raise exception 'This examination is already %.', io.status; end if;
    update public.edoshmis_imaging_orders set status = 'performed', performed_by = v_staff, performed_at = coalesce(nullif(d ->> 'performed_at', '')::timestamptz, now()),
      technique = nullif(trim(d ->> 'technique'), ''), contrast_given = nullif(trim(d ->> 'contrast_given'), ''), pacs_study_uid = nullif(trim(d ->> 'pacs_study_uid'), '')
    where id = p_order;
  elsif p_step = 'report' then
    v_staff := public.edoshmis_require(io.facility_id, 'imaging.report');
    if io.status not in ('performed', 'reported') then raise exception 'The examination must be performed before it is reported (it is %).', io.status; end if;
    if coalesce(trim(d ->> 'findings'), '') = '' or coalesce(trim(d ->> 'impression'), '') = '' then raise exception 'Write the findings and the impression.'; end if;
    update public.edoshmis_imaging_orders set status = 'reported', findings = trim(d ->> 'findings'), impression = trim(d ->> 'impression'), reported_by = v_staff, reported_at = now() where id = p_order;
  elsif p_step = 'validate' then
    v_staff := public.edoshmis_require(io.facility_id, 'imaging.validate');
    if io.status <> 'reported' then raise exception 'Only a reported examination can be validated.'; end if;
    update public.edoshmis_imaging_orders set status = 'validated', validated_by = v_staff, validated_at = now() where id = p_order;
  elsif p_step = 'cancel' then
    if not (public.edoshmis_has_perm(io.facility_id, 'imaging.order') or public.edoshmis_has_perm(io.facility_id, 'imaging.perform')) then
      raise exception 'You do not have permission to cancel this.' using errcode = '42501';
    end if;
    if io.status in ('performed', 'reported', 'validated', 'cancelled') then raise exception 'This examination is already %.', io.status; end if;
    if coalesce(trim(d ->> 'reason'), '') = '' then raise exception 'Give the reason.'; end if;
    update public.edoshmis_imaging_orders set status = 'cancelled', cancel_reason = trim(d ->> 'reason') where id = p_order;
  elsif p_step = 'addendum' then
    v_staff := public.edoshmis_require(io.facility_id, 'imaging.report');
    if io.status <> 'validated' then raise exception 'Edit the report itself until it is validated.'; end if;
    if coalesce(trim(d ->> 'body'), '') = '' then raise exception 'Write the addendum.'; end if;
    insert into public.edoshmis_imaging_addenda (facility_id, order_id, author_id, body) values (io.facility_id, p_order, v_staff, trim(d ->> 'body'));
  else
    raise exception 'Unknown step.';
  end if;
  perform public.edoshmis_audit(public.edoshmis_facility_org(io.facility_id), io.facility_id, 'imaging.' || p_step, 'imaging_order', p_order::text, io.patient_id, null, d);
end $$;

drop trigger if exists edoshmis_imaging_addenda_append_only on public.edoshmis_imaging_addenda;
create trigger edoshmis_imaging_addenda_append_only before update or delete on public.edoshmis_imaging_addenda for each row execute function public.edoshmis_append_only();
drop trigger if exists edoshmis_imaging_exams_audit on public.edoshmis_imaging_exams;
create trigger edoshmis_imaging_exams_audit after insert or update or delete on public.edoshmis_imaging_exams for each row execute function public.edoshmis_audit_trigger();

alter table public.edoshmis_imaging_exams enable row level security;
alter table public.edoshmis_imaging_orders enable row level security;
alter table public.edoshmis_imaging_addenda enable row level security;

drop policy if exists edoshmis_imaging_exams_read on public.edoshmis_imaging_exams;
create policy edoshmis_imaging_exams_read on public.edoshmis_imaging_exams for select to authenticated using (public.edoshmis_is_member(public.edoshmis_facility_org(facility_id)));
drop policy if exists edoshmis_imaging_exams_write on public.edoshmis_imaging_exams;
create policy edoshmis_imaging_exams_write on public.edoshmis_imaging_exams for all to authenticated
  using (public.edoshmis_has_perm(facility_id, 'imaging.configure')) with check (public.edoshmis_has_perm(facility_id, 'imaging.configure'));
drop policy if exists edoshmis_imaging_orders_read on public.edoshmis_imaging_orders;
create policy edoshmis_imaging_orders_read on public.edoshmis_imaging_orders for select to authenticated using (public.edoshmis_can_see_imaging_order(id));
drop policy if exists edoshmis_imaging_addenda_read on public.edoshmis_imaging_addenda;
create policy edoshmis_imaging_addenda_read on public.edoshmis_imaging_addenda for select to authenticated using (public.edoshmis_can_see_imaging_order(order_id));

select public.edoshmis_sync_all_roles();
