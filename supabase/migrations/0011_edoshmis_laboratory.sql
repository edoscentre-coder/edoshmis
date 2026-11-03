-- EDOSHMIS 0011 — laboratory (EDOSHMIS's own; independent of EDOS LMIS).
--
--   order (ward or clinic) → specimen collected, barcode/accession issued →
--   received in the lab → results entered → validated → released to the
--   clinician. Critical values must be communicated, with read-back, and
--   that is recorded.
--
-- Reference ranges and critical limits are the lab's, entered per test
-- parameter; nothing is pre-loaded. A result is flagged only against a range
-- that has been entered.

insert into public.edoshmis_permission_catalog (key, area, label) values
  ('lab.read', 'Laboratory', 'See laboratory orders and validated results'),
  ('lab.order', 'Laboratory', 'Order laboratory tests'),
  ('lab.collect', 'Laboratory', 'Collect specimens and print labels'),
  ('lab.process', 'Laboratory', 'Receive specimens and enter results'),
  ('lab.validate', 'Laboratory', 'Validate and release results, amend validated results'),
  ('lab.configure', 'Laboratory', 'Manage the test catalogue, parameters and reference ranges')
on conflict (key) do update set area = excluded.area, label = excluded.label;

select public.edoshmis_add_role_default('lab_technologist', 'Laboratory technologist', 'Receives specimens, enters and validates results.',
  array['patients.read', 'lab.read', 'lab.collect', 'lab.process', 'lab.validate', 'lab.configure', 'opd.read'], true);
select public.edoshmis_add_role_default('consultant', 'Consultant', null, array['lab.read', 'lab.order']);
select public.edoshmis_add_role_default('medical_officer', 'Medical officer', null, array['lab.read', 'lab.order']);
select public.edoshmis_add_role_default('clinical_officer', 'Clinical officer', null, array['lab.read', 'lab.order']);
select public.edoshmis_add_role_default('medical_superintendent', 'Medical superintendent', null, array['lab.read', 'lab.order']);
select public.edoshmis_add_role_default('nurse', 'Nurse', null, array['lab.read', 'lab.collect']);
select public.edoshmis_add_role_default('nursing_officer', 'Nursing officer', null, array['lab.read', 'lab.collect']);
select public.edoshmis_add_role_default('ward_manager', 'Ward manager', null, array['lab.read', 'lab.collect']);
select public.edoshmis_add_role_default('hospital_admin', 'Hospital administrator', null, array['lab.configure']);

create table if not exists public.edoshmis_lab_tests (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,20}$'),
  name text not null,
  discipline text not null check (discipline in ('haematology', 'biochemistry', 'microbiology', 'serology', 'immunology', 'parasitology', 'urinalysis', 'histopathology', 'cytology', 'blood_bank', 'molecular', 'other')),
  specimen_type text not null,
  container text,
  turnaround_hours int check (turnaround_hours is null or turnaround_hours between 0 and 720),
  tariff_id uuid references public.edoshmis_tariffs (id),
  instructions text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (facility_id, code)
);

create table if not exists public.edoshmis_lab_parameters (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.edoshmis_lab_tests (id) on delete cascade,
  name text not null,
  unit text,
  value_type text not null default 'numeric' check (value_type in ('numeric', 'text', 'choice')),
  choices text[],
  abnormal_choices text[],
  -- Reference range: per sex and age band where it differs; null = any.
  sex text check (sex is null or sex in ('male', 'female')),
  age_min_years numeric,
  age_max_years numeric,
  ref_low numeric,
  ref_high numeric,
  ref_text text,
  critical_low numeric,
  critical_high numeric,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_lab_parameters_test_idx on public.edoshmis_lab_parameters (test_id, sort_order);

create table if not exists public.edoshmis_lab_orders (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  encounter_id uuid references public.edoshmis_encounters (id),
  admission_id uuid references public.edoshmis_admissions (id),
  order_number text not null,
  priority text not null default 'routine' check (priority in ('routine', 'urgent', 'stat')),
  clinical_info text,
  status text not null default 'ordered' check (status in ('ordered', 'collected', 'received', 'in_progress', 'resulted', 'validated', 'cancelled', 'rejected')),
  ordered_by uuid not null references public.edoshmis_staff (id),
  ordered_at timestamptz not null default now(),
  accession text,
  collected_by uuid references public.edoshmis_staff (id),
  collected_at timestamptz,
  received_by uuid references public.edoshmis_staff (id),
  received_at timestamptz,
  validated_by uuid references public.edoshmis_staff (id),
  validated_at timestamptz,
  cancel_reason text,
  unique (facility_id, order_number),
  check (encounter_id is not null or admission_id is not null)
);
create unique index if not exists edoshmis_lab_orders_accession_uniq on public.edoshmis_lab_orders (facility_id, accession) where accession is not null;
create index if not exists edoshmis_lab_orders_worklist_idx on public.edoshmis_lab_orders (facility_id, status, ordered_at);
create index if not exists edoshmis_lab_orders_patient_idx on public.edoshmis_lab_orders (patient_id, ordered_at desc);

create table if not exists public.edoshmis_lab_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.edoshmis_lab_orders (id) on delete cascade,
  test_id uuid not null references public.edoshmis_lab_tests (id),
  test_name text not null,
  status text not null default 'pending' check (status in ('pending', 'resulted', 'validated', 'cancelled')),
  comment text,
  unique (order_id, test_id)
);

-- Results are versioned: amending a validated result adds a new current
-- version with a reason; the old one stays, marked superseded.
create table if not exists public.edoshmis_lab_results (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  order_id uuid not null references public.edoshmis_lab_orders (id),
  item_id uuid not null references public.edoshmis_lab_order_items (id),
  parameter_id uuid not null references public.edoshmis_lab_parameters (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  value_text text not null,
  value_numeric numeric,
  unit text,
  ref_display text,
  flag text check (flag is null or flag in ('normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal')),
  is_current boolean not null default true,
  version int not null default 1,
  amend_reason text,
  entered_by uuid not null references public.edoshmis_staff (id),
  entered_at timestamptz not null default now()
);
create unique index if not exists edoshmis_lab_results_current_uniq on public.edoshmis_lab_results (item_id, parameter_id) where is_current;
create index if not exists edoshmis_lab_results_order_idx on public.edoshmis_lab_results (order_id);

create table if not exists public.edoshmis_lab_critical_calls (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  result_id uuid not null references public.edoshmis_lab_results (id),
  order_id uuid not null references public.edoshmis_lab_orders (id),
  communicated_to text not null,
  read_back boolean not null,
  communicated_by uuid not null references public.edoshmis_staff (id),
  communicated_at timestamptz not null default now(),
  note text
);

-- ---------------------------------------------------------------- helpers

-- Who may see an order's results: the lab, or the clinicians of the
-- admission / visit it belongs to.
create or replace function public.edoshmis_can_see_lab_order(p_order uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.edoshmis_lab_orders o
    where o.id = p_order and (
      public.edoshmis_has_perm(o.facility_id, 'lab.process') or public.edoshmis_has_perm(o.facility_id, 'lab.validate')
      or (public.edoshmis_has_perm(o.facility_id, 'lab.read') and (
            (o.admission_id is not null and public.edoshmis_can_see_admission(o.admission_id))
         or (o.admission_id is null and (public.edoshmis_has_perm(o.facility_id, 'opd.consult') or public.edoshmis_has_perm(o.facility_id, 'opd.triage'))))))
  );
$$;

-- The reference row that applies to this patient (most specific wins).
create or replace function public.edoshmis_lab_flag(p_param uuid, p_patient uuid, p_value numeric, p_text text)
returns table (flag text, ref_display text) language plpgsql stable security definer set search_path = '' as $$
declare pr public.edoshmis_lab_parameters; v_sex text; v_age numeric;
begin
  select * into pr from public.edoshmis_lab_parameters where id = p_param;
  select sex::text, extract(epoch from age(now(), date_of_birth::timestamp)) / 31557600.0 into v_sex, v_age from public.edoshmis_patients where id = p_patient;
  -- A more specific band for this sex/age, on the same test and parameter name, takes precedence.
  select * into pr from public.edoshmis_lab_parameters x
  where x.test_id = pr.test_id and x.name = pr.name
    and (x.sex is null or x.sex = v_sex)
    and (x.age_min_years is null or (v_age is not null and v_age >= x.age_min_years))
    and (x.age_max_years is null or (v_age is not null and v_age < x.age_max_years))
  order by (x.sex is not null)::int + (x.age_min_years is not null or x.age_max_years is not null)::int desc, x.sort_order
  limit 1;
  if pr.value_type = 'numeric' then
    return query select
      case
        when p_value is null then null
        when pr.critical_low is not null and p_value < pr.critical_low then 'critical_low'
        when pr.critical_high is not null and p_value > pr.critical_high then 'critical_high'
        when pr.ref_low is not null and p_value < pr.ref_low then 'low'
        when pr.ref_high is not null and p_value > pr.ref_high then 'high'
        when pr.ref_low is not null or pr.ref_high is not null then 'normal'
      end,
      coalesce(pr.ref_text, case when pr.ref_low is not null or pr.ref_high is not null
        then coalesce(pr.ref_low::text, '') || ' – ' || coalesce(pr.ref_high::text, '') || coalesce(' ' || pr.unit, '') end);
  else
    return query select case when pr.abnormal_choices is not null and p_text = any (pr.abnormal_choices) then 'abnormal'
                             when pr.abnormal_choices is not null then 'normal' end, pr.ref_text;
  end if;
end $$;

-- ---------------------------------------------------------------- workflow

create or replace function public.edoshmis_order_lab(p_facility uuid, o jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_staff uuid := public.edoshmis_require(p_facility, 'lab.order'); v_adm uuid := nullif(o ->> 'admission_id', '')::uuid;
  v_enc uuid := nullif(o ->> 'encounter_id', '')::uuid; v_patient uuid; v_id uuid; v_code text; v_year text; v_acct uuid; t record; n int := 0;
begin
  if v_adm is not null then
    perform public.edoshmis_require_admission(v_adm, 'lab.order');
    select patient_id into v_patient from public.edoshmis_admissions where id = v_adm and status in ('active', 'discharge_in_progress');
    select id into v_acct from public.edoshmis_billing_accounts where admission_id = v_adm and status = 'open';
  elsif v_enc is not null then
    select patient_id into v_patient from public.edoshmis_encounters where id = v_enc and facility_id = p_facility and status = 'open';
    select id into v_acct from public.edoshmis_billing_accounts where encounter_id = v_enc and admission_id is null and status = 'open';
  end if;
  if v_patient is null then raise exception 'Order from an active admission or an open visit.'; end if;
  if jsonb_array_length(coalesce(o -> 'test_ids', '[]'::jsonb)) = 0 then raise exception 'Choose at least one test.'; end if;
  select code into v_code from public.edoshmis_facilities where id = p_facility;
  v_year := to_char(now() at time zone 'Africa/Nairobi', 'YYYY');
  insert into public.edoshmis_lab_orders (facility_id, patient_id, encounter_id, admission_id, order_number, priority, clinical_info, ordered_by)
  values (p_facility, v_patient, v_enc, v_adm, v_code || '/LAB/' || v_year || '/' || lpad(public.edoshmis_next_number(p_facility, 'lab_order', v_year)::text, 6, '0'),
          coalesce(nullif(o ->> 'priority', ''), 'routine'), nullif(trim(o ->> 'clinical_info'), ''), v_staff)
  returning id into v_id;
  for t in select lt.* from public.edoshmis_lab_tests lt
           where lt.facility_id = p_facility and lt.is_active and lt.id in (select (x)::uuid from jsonb_array_elements_text(o -> 'test_ids') x) loop
    insert into public.edoshmis_lab_order_items (order_id, test_id, test_name) values (v_id, t.id, t.name);
    if t.tariff_id is not null and v_acct is not null then
      perform public.edoshmis_post_keyed_charge(v_acct, t.tariff_id, t.name, (now() at time zone 'Africa/Nairobi')::date, 1, null,
        'lab:' || v_id::text || ':' || t.id::text, 'lab', v_id, v_staff);
    end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'None of those tests is in this facility''s catalogue.'; end if;
  perform public.edoshmis_audit(public.edoshmis_facility_org(p_facility), p_facility, 'lab.ordered', 'lab_order', v_id::text, v_patient, null, o);
  return v_id;
end $$;

create or replace function public.edoshmis_lab_step(p_order uuid, p_step text, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare lo public.edoshmis_lab_orders; v_staff uuid; v_acc text; v_code text;
begin
  select * into lo from public.edoshmis_lab_orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  if p_step = 'collect' then
    v_staff := public.edoshmis_require(lo.facility_id, 'lab.collect');
    if lo.status <> 'ordered' then raise exception 'This specimen is already %.', lo.status; end if;
    select code into v_code from public.edoshmis_facilities where id = lo.facility_id;
    v_acc := v_code || to_char(now() at time zone 'Africa/Nairobi', 'YYMMDD') || lpad(public.edoshmis_next_number(lo.facility_id, 'accession', to_char(now() at time zone 'Africa/Nairobi', 'YYYYMMDD'))::text, 4, '0');
    update public.edoshmis_lab_orders set status = 'collected', accession = v_acc, collected_by = v_staff, collected_at = now() where id = p_order;
  elsif p_step = 'receive' then
    v_staff := public.edoshmis_require(lo.facility_id, 'lab.process');
    if lo.status <> 'collected' then raise exception 'Collect the specimen first (it is %).', lo.status; end if;
    update public.edoshmis_lab_orders set status = 'received', received_by = v_staff, received_at = now() where id = p_order;
  elsif p_step = 'reject' then
    v_staff := public.edoshmis_require(lo.facility_id, 'lab.process');
    if lo.status not in ('collected', 'received') then raise exception 'Only a collected specimen can be rejected.'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Say why the specimen is rejected (haemolysed, clotted, unlabelled…).'; end if;
    -- The specimen is rejected; the order goes back for recollection.
    update public.edoshmis_lab_orders set status = 'ordered', accession = null, collected_by = null, collected_at = null, received_by = null, received_at = null,
      cancel_reason = 'Specimen rejected: ' || trim(p_note) where id = p_order;
  elsif p_step = 'cancel' then
    if not (public.edoshmis_has_perm(lo.facility_id, 'lab.order') or public.edoshmis_has_perm(lo.facility_id, 'lab.process')) then
      raise exception 'You do not have permission to cancel this order.' using errcode = '42501';
    end if;
    if lo.status in ('validated', 'cancelled') then raise exception 'This order is already %.', lo.status; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Give the reason.'; end if;
    update public.edoshmis_lab_orders set status = 'cancelled', cancel_reason = trim(p_note) where id = p_order;
    update public.edoshmis_lab_order_items set status = 'cancelled' where order_id = p_order and status <> 'validated';
  else
    raise exception 'Unknown step.';
  end if;
  perform public.edoshmis_audit(public.edoshmis_facility_org(lo.facility_id), lo.facility_id, 'lab.' || p_step, 'lab_order', p_order::text, lo.patient_id, null, null, p_note);
  return v_acc;
end $$;

-- Enter (or re-enter, before validation) the results of one test.
-- r = [{"parameter_id": "...", "value": "..."}]
create or replace function public.edoshmis_enter_lab_results(p_item uuid, r jsonb, p_amend_reason text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare it public.edoshmis_lab_order_items; lo public.edoshmis_lab_orders; v_staff uuid; x record; fl record; v_num numeric; n int := 0; v_prev public.edoshmis_lab_results;
begin
  select * into it from public.edoshmis_lab_order_items where id = p_item for update;
  if not found then raise exception 'Test not found.'; end if;
  select * into lo from public.edoshmis_lab_orders where id = it.order_id for update;
  if it.status = 'validated' then
    v_staff := public.edoshmis_require(lo.facility_id, 'lab.validate');
    if coalesce(trim(p_amend_reason), '') = '' then raise exception 'This result is validated. Give the reason to amend it.'; end if;
  else
    v_staff := public.edoshmis_require(lo.facility_id, 'lab.process');
    if lo.status not in ('received', 'in_progress', 'resulted') then raise exception 'Receive the specimen before entering results (it is %).', lo.status; end if;
  end if;
  for x in select * from jsonb_to_recordset(r) as t (parameter_id uuid, value text) where coalesce(trim(t.value), '') <> '' loop
    if not exists (select 1 from public.edoshmis_lab_parameters where id = x.parameter_id and test_id = it.test_id) then raise exception 'Unknown parameter for this test.'; end if;
    v_num := case when trim(x.value) ~ '^-?[0-9]+(\.[0-9]+)?$' then trim(x.value)::numeric end;
    select * into fl from public.edoshmis_lab_flag(x.parameter_id, lo.patient_id, v_num, trim(x.value));
    select * into v_prev from public.edoshmis_lab_results where item_id = p_item and parameter_id = x.parameter_id and is_current;
    if v_prev.id is not null then
      if v_prev.value_text = trim(x.value) then continue; end if;
      update public.edoshmis_lab_results set is_current = false where id = v_prev.id;
    end if;
    insert into public.edoshmis_lab_results (facility_id, order_id, item_id, parameter_id, patient_id, value_text, value_numeric, unit, ref_display, flag, version, amend_reason, entered_by)
    select lo.facility_id, lo.id, p_item, x.parameter_id, lo.patient_id, trim(x.value), v_num, p.unit, fl.ref_display, fl.flag,
           coalesce(v_prev.version, 0) + 1, case when it.status = 'validated' then trim(p_amend_reason) end, v_staff
    from public.edoshmis_lab_parameters p where p.id = x.parameter_id;
    n := n + 1;
  end loop;
  if it.status <> 'validated' then
    update public.edoshmis_lab_order_items set status = 'resulted' where id = p_item;
    update public.edoshmis_lab_orders set status = case when exists (select 1 from public.edoshmis_lab_order_items where order_id = lo.id and status = 'pending') then 'in_progress' else 'resulted' end
    where id = lo.id;
  end if;
  perform public.edoshmis_audit(public.edoshmis_facility_org(lo.facility_id), lo.facility_id,
    case when it.status = 'validated' then 'lab.result_amended' else 'lab.resulted' end, 'lab_order', lo.id::text, lo.patient_id, null, r, p_amend_reason);
  return n;
end $$;

-- Validate an order. Refused while a critical value has not been phoned through.
create or replace function public.edoshmis_validate_lab(p_order uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare lo public.edoshmis_lab_orders; v_staff uuid; v_crit int;
begin
  select * into lo from public.edoshmis_lab_orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  v_staff := public.edoshmis_require(lo.facility_id, 'lab.validate');
  if lo.status <> 'resulted' then raise exception 'Every test must have results before validation (the order is %).', lo.status; end if;
  select count(*) into v_crit from public.edoshmis_lab_results r
  where r.order_id = p_order and r.is_current and r.flag in ('critical_low', 'critical_high')
    and not exists (select 1 from public.edoshmis_lab_critical_calls c where c.result_id = r.id);
  if v_crit > 0 then raise exception '% critical value(s) not yet communicated. Phone them to the clinician and record it first.', v_crit; end if;
  update public.edoshmis_lab_order_items set status = 'validated' where order_id = p_order and status = 'resulted';
  update public.edoshmis_lab_orders set status = 'validated', validated_by = v_staff, validated_at = now() where id = p_order;
  perform public.edoshmis_audit(public.edoshmis_facility_org(lo.facility_id), lo.facility_id, 'lab.validated', 'lab_order', p_order::text, lo.patient_id);
end $$;

create or replace function public.edoshmis_record_critical_call(p_result uuid, p_to text, p_read_back boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.edoshmis_lab_results; v_staff uuid;
begin
  select * into r from public.edoshmis_lab_results where id = p_result;
  if not found then raise exception 'Result not found.'; end if;
  v_staff := public.edoshmis_require(r.facility_id, 'lab.process');
  if coalesce(trim(p_to), '') = '' then raise exception 'Name who the result was given to.'; end if;
  if not p_read_back then raise exception 'A critical result must be read back by the receiver.'; end if;
  insert into public.edoshmis_lab_critical_calls (facility_id, result_id, order_id, communicated_to, read_back, communicated_by, note)
  values (r.facility_id, p_result, r.order_id, trim(p_to), p_read_back, v_staff, nullif(trim(p_note), ''));
  perform public.edoshmis_audit(public.edoshmis_facility_org(r.facility_id), r.facility_id, 'lab.critical_communicated', 'lab_result', p_result::text, r.patient_id, null,
    jsonb_build_object('to', p_to, 'value', r.value_text));
end $$;

-- Results are only ever written by the functions above.
create or replace function public.edoshmis_lab_results_guard()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then raise exception 'Results are entered through the lab worklist.'; end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'is_current') is distinct from (to_jsonb(old) - 'is_current') then
    raise exception 'A result is never edited; a new version is added.';
  end if;
  if tg_op = 'DELETE' then raise exception 'Results are never deleted.'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists edoshmis_lab_results_guard on public.edoshmis_lab_results;
create trigger edoshmis_lab_results_guard before update or delete on public.edoshmis_lab_results for each row execute function public.edoshmis_lab_results_guard();
drop trigger if exists edoshmis_lab_critical_calls_append_only on public.edoshmis_lab_critical_calls;
create trigger edoshmis_lab_critical_calls_append_only before update or delete on public.edoshmis_lab_critical_calls for each row execute function public.edoshmis_append_only();

do $$ declare t text; begin
  foreach t in array array['edoshmis_lab_tests', 'edoshmis_lab_parameters'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.edoshmis_audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- RLS

alter table public.edoshmis_lab_tests enable row level security;
alter table public.edoshmis_lab_parameters enable row level security;
alter table public.edoshmis_lab_orders enable row level security;
alter table public.edoshmis_lab_order_items enable row level security;
alter table public.edoshmis_lab_results enable row level security;
alter table public.edoshmis_lab_critical_calls enable row level security;

drop policy if exists edoshmis_lab_tests_read on public.edoshmis_lab_tests;
create policy edoshmis_lab_tests_read on public.edoshmis_lab_tests for select to authenticated using (public.edoshmis_is_member(public.edoshmis_facility_org(facility_id)));
drop policy if exists edoshmis_lab_tests_write on public.edoshmis_lab_tests;
create policy edoshmis_lab_tests_write on public.edoshmis_lab_tests for all to authenticated
  using (public.edoshmis_has_perm(facility_id, 'lab.configure')) with check (public.edoshmis_has_perm(facility_id, 'lab.configure'));
drop policy if exists edoshmis_lab_parameters_read on public.edoshmis_lab_parameters;
create policy edoshmis_lab_parameters_read on public.edoshmis_lab_parameters for select to authenticated
  using (exists (select 1 from public.edoshmis_lab_tests t where t.id = test_id and public.edoshmis_is_member(public.edoshmis_facility_org(t.facility_id))));
drop policy if exists edoshmis_lab_parameters_write on public.edoshmis_lab_parameters;
create policy edoshmis_lab_parameters_write on public.edoshmis_lab_parameters for all to authenticated
  using (exists (select 1 from public.edoshmis_lab_tests t where t.id = test_id and public.edoshmis_has_perm(t.facility_id, 'lab.configure')))
  with check (exists (select 1 from public.edoshmis_lab_tests t where t.id = test_id and public.edoshmis_has_perm(t.facility_id, 'lab.configure')));

-- Orders and their tests: the lab sees its worklist; collectors see what
-- is waiting to be collected; clinicians see their patients' orders.
drop policy if exists edoshmis_lab_orders_read on public.edoshmis_lab_orders;
create policy edoshmis_lab_orders_read on public.edoshmis_lab_orders for select to authenticated
  using (public.edoshmis_can_see_lab_order(id) or public.edoshmis_has_perm(facility_id, 'lab.collect'));
drop policy if exists edoshmis_lab_order_items_read on public.edoshmis_lab_order_items;
create policy edoshmis_lab_order_items_read on public.edoshmis_lab_order_items for select to authenticated
  using (exists (select 1 from public.edoshmis_lab_orders o where o.id = order_id));
-- Results: the lab always; clinicians once validated (or, for urgent work,
-- as soon as entered — flagged as unvalidated on screen).
drop policy if exists edoshmis_lab_results_read on public.edoshmis_lab_results;
create policy edoshmis_lab_results_read on public.edoshmis_lab_results for select to authenticated using (public.edoshmis_can_see_lab_order(order_id));
drop policy if exists edoshmis_lab_critical_calls_read on public.edoshmis_lab_critical_calls;
create policy edoshmis_lab_critical_calls_read on public.edoshmis_lab_critical_calls for select to authenticated using (public.edoshmis_can_see_lab_order(order_id));

select public.edoshmis_sync_all_roles();
