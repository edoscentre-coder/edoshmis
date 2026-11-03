-- EDOSHMIS 0005 — inpatient medication: drug catalogue, interactions,
-- prescribing, pharmacy verification and dispensing, and the eMAR.
--
-- Three separate acts by (normally) three separate people, each recorded:
--   prescribe (meds.prescribe) → verify & dispense (meds.verify) → administer (meds.administer).
-- Allergy and interaction checks run on the hospital's own data — the
-- patient's recorded allergies and the interaction pairs the pharmacy has
-- entered. Nothing clinical is pre-loaded; an empty interaction table means
-- no interaction warnings, and the screen says so.

do $$ begin
  create type public.edoshmis_mar_status as enum ('scheduled', 'administered', 'delayed', 'missed', 'refused', 'withheld', 'discontinued');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.edoshmis_order_status as enum ('prescribed', 'verified', 'on_hold', 'discontinued', 'completed', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.edoshmis_drugs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id),
  generic_name text not null check (length(trim(generic_name)) between 2 and 120),
  brand_name text,
  drug_class text,
  form text not null check (form in ('tablet', 'capsule', 'syrup', 'suspension', 'injection', 'infusion', 'cream', 'ointment', 'drops', 'inhaler', 'suppository', 'patch', 'other')),
  strength text,
  default_route text,
  is_controlled boolean not null default false,
  tariff_id uuid references public.edoshmis_tariffs (id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists edoshmis_drugs_uniq on public.edoshmis_drugs (organization_id, lower(generic_name), coalesce(lower(strength), ''), form);

create table if not exists public.edoshmis_drug_interactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id),
  drug_a uuid not null references public.edoshmis_drugs (id) on delete cascade,
  drug_b uuid not null references public.edoshmis_drugs (id) on delete cascade,
  severity text not null check (severity in ('minor', 'moderate', 'major', 'contraindicated')),
  description text not null,
  source text not null,
  created_at timestamptz not null default now(),
  check (drug_a < drug_b),
  unique (drug_a, drug_b)
);

create table if not exists public.edoshmis_medication_orders (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  admission_id uuid not null references public.edoshmis_admissions (id),
  drug_id uuid references public.edoshmis_drugs (id),
  drug_name text not null,
  dose numeric(10, 3) not null check (dose > 0),
  dose_unit text not null check (dose_unit in ('mg', 'g', 'mcg', 'ml', 'units', 'iu', 'mmol', 'tablet', 'capsule', 'puff', 'drop', 'sachet', 'other')),
  route text not null check (route in ('oral', 'iv', 'im', 'sc', 'sl', 'pr', 'pv', 'topical', 'inhaled', 'nebulised', 'ng', 'ophthalmic', 'otic', 'nasal', 'other')),
  frequency text not null check (frequency in ('stat', 'od', 'bd', 'tds', 'qds', 'q4h', 'q6h', 'q8h', 'q12h', 'nocte', 'mane', 'weekly', 'prn', 'custom')),
  -- Local (Africa/Nairobi) times the doses fall due. Empty for PRN and stat.
  schedule_times time[] not null default '{}',
  is_prn boolean not null default false,
  prn_indication text,
  prn_max_doses_per_day int check (prn_max_doses_per_day is null or prn_max_doses_per_day between 1 and 48),
  start_at timestamptz not null default now(),
  end_at timestamptz,
  instructions text,
  reconciliation text not null default 'new' check (reconciliation in ('new', 'continued_from_home', 'changed_from_home')),
  status public.edoshmis_order_status not null default 'prescribed',
  prescribed_by uuid not null references public.edoshmis_staff (id),
  prescriber_designation text not null,
  prescribed_at timestamptz not null default now(),
  allergy_override_reason text,
  interaction_override_reason text,
  verified_by uuid references public.edoshmis_staff (id),
  verified_at timestamptz,
  verify_note text,
  discontinued_by uuid references public.edoshmis_staff (id),
  discontinued_at timestamptz,
  discontinue_reason text,
  check (end_at is null or end_at > start_at),
  check (not is_prn or coalesce(trim(prn_indication), '') <> '')
);
create index if not exists edoshmis_medication_orders_admission_idx on public.edoshmis_medication_orders (admission_id, status);
create index if not exists edoshmis_medication_orders_pharmacy_idx on public.edoshmis_medication_orders (facility_id, status) where status = 'prescribed';

create table if not exists public.edoshmis_medication_dispenses (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  order_id uuid not null references public.edoshmis_medication_orders (id),
  admission_id uuid not null references public.edoshmis_admissions (id),
  quantity numeric(10, 2) not null check (quantity > 0),
  unit text not null,
  batch_number text,
  expiry_date date,
  dispensed_by uuid not null references public.edoshmis_staff (id),
  dispensed_at timestamptz not null default now(),
  note text
);
create index if not exists edoshmis_medication_dispenses_order_idx on public.edoshmis_medication_dispenses (order_id);

create table if not exists public.edoshmis_medication_administrations (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  order_id uuid not null references public.edoshmis_medication_orders (id),
  admission_id uuid not null references public.edoshmis_admissions (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  scheduled_for timestamptz,
  status public.edoshmis_mar_status not null default 'scheduled',
  administered_at timestamptz,
  dose_given text,
  reason text,
  administered_by uuid references public.edoshmis_staff (id),
  witness_id uuid references public.edoshmis_staff (id),
  recorded_at timestamptz,
  client_id uuid unique,
  entered_in_error boolean not null default false,
  error_reason text,
  created_at timestamptz not null default now()
);
create unique index if not exists edoshmis_mar_slot_uniq on public.edoshmis_medication_administrations (order_id, scheduled_for) where scheduled_for is not null;
create index if not exists edoshmis_mar_admission_idx on public.edoshmis_medication_administrations (admission_id, scheduled_for);

-- ---------------------------------------------------------------- checks

-- Allergy matches: the drug's generic or brand name or class against the
-- patient's active allergies, either way round ("penicillin" catches
-- "amoxicillin" only if the pharmacy set drug_class = 'penicillin').
create or replace function public.edoshmis_allergy_conflicts(p_patient uuid, p_drug uuid, p_drug_name text)
returns table (substance text, severity text, reaction text)
language sql stable security definer set search_path = '' as $$
  with d as (
    select lower(coalesce(dr.generic_name, p_drug_name)) as g, lower(coalesce(dr.brand_name, '')) as b, lower(coalesce(dr.drug_class, '')) as c
    from (select 1) one left join public.edoshmis_drugs dr on dr.id = p_drug
  )
  select a.substance, a.severity, a.reaction
  from public.edoshmis_patient_allergies a, d
  where a.patient_id = p_patient and a.status = 'active' and a.category in ('drug', 'other')
    and (position(lower(a.substance) in d.g) > 0 or position(d.g in lower(a.substance)) > 0
         or (d.b <> '' and position(lower(a.substance) in d.b) > 0)
         or (d.c <> '' and (position(lower(a.substance) in d.c) > 0 or position(d.c in lower(a.substance)) > 0)));
$$;

create or replace function public.edoshmis_interaction_conflicts(p_admission uuid, p_drug uuid)
returns table (other_drug text, severity text, description text, source text)
language sql stable security definer set search_path = '' as $$
  select o.drug_name, i.severity, i.description, i.source
  from public.edoshmis_medication_orders o
  join public.edoshmis_drug_interactions i
    on (i.drug_a = least(o.drug_id, p_drug) and i.drug_b = greatest(o.drug_id, p_drug))
  where o.admission_id = p_admission and o.status in ('prescribed', 'verified', 'on_hold') and o.drug_id is not null and p_drug is not null
    and o.drug_id <> p_drug;
$$;

-- ---------------------------------------------------------------- prescribing

create or replace function public.edoshmis_prescribe(p_admission uuid, o jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  ad public.edoshmis_admissions; v_staff uuid; v_des text; v_drug uuid := nullif(o ->> 'drug_id', '')::uuid; v_name text;
  v_allergies text; v_inter text; v_id uuid; v_freq text := o ->> 'frequency'; v_prn boolean := coalesce((o ->> 'is_prn')::boolean, false);
  v_times time[];
begin
  select * into ad from public.edoshmis_admissions where id = p_admission;
  v_staff := public.edoshmis_require_admission(p_admission, 'meds.prescribe');
  if ad.status not in ('active', 'discharge_in_progress') then raise exception 'This admission is closed.'; end if;
  select designation::text into v_des from public.edoshmis_staff where id = v_staff;

  if v_drug is not null then
    select trim(generic_name || coalesce(' ' || strength, '')) into v_name from public.edoshmis_drugs
    where id = v_drug and organization_id = ad.organization_id and is_active;
    if v_name is null then raise exception 'That drug is not in the catalogue.'; end if;
  else
    v_name := trim(o ->> 'drug_name');
    if coalesce(v_name, '') = '' then raise exception 'Choose the drug.'; end if;
  end if;

  select string_agg(substance || ' (' || severity || coalesce(', ' || reaction, '') || ')', '; ') into v_allergies
  from public.edoshmis_allergy_conflicts(ad.patient_id, v_drug, v_name);
  if v_allergies is not null and coalesce(trim(o ->> 'allergy_override_reason'), '') = '' then
    raise exception 'Allergy warning: % is recorded for this patient. Give a reason to prescribe anyway.', v_allergies using hint = 'allergy';
  end if;

  select string_agg(other_drug || ' — ' || severity || ': ' || description, '; ') into v_inter
  from public.edoshmis_interaction_conflicts(p_admission, v_drug);
  if v_inter is not null and coalesce(trim(o ->> 'interaction_override_reason'), '') = '' then
    raise exception 'Interaction warning with current medication: %. Give a reason to prescribe anyway.', v_inter using hint = 'interaction';
  end if;

  v_times := coalesce((select array_agg(t::time order by t::time) from jsonb_array_elements_text(coalesce(o -> 'schedule_times', '[]'::jsonb)) t), '{}');
  if v_prn or v_freq in ('prn', 'stat') then
    v_times := '{}';
  elsif cardinality(v_times) = 0 then
    raise exception 'Set the times the doses fall due.';
  end if;

  insert into public.edoshmis_medication_orders (
    facility_id, patient_id, admission_id, drug_id, drug_name, dose, dose_unit, route, frequency, schedule_times,
    is_prn, prn_indication, prn_max_doses_per_day, start_at, end_at, instructions, reconciliation,
    prescribed_by, prescriber_designation, allergy_override_reason, interaction_override_reason)
  values (
    ad.facility_id, ad.patient_id, p_admission, v_drug, v_name, (o ->> 'dose')::numeric, o ->> 'dose_unit', o ->> 'route', v_freq, v_times,
    v_prn or v_freq = 'prn', nullif(trim(o ->> 'prn_indication'), ''), nullif(o ->> 'prn_max_doses_per_day', '')::int,
    coalesce(nullif(o ->> 'start_at', '')::timestamptz, now()), nullif(o ->> 'end_at', '')::timestamptz, nullif(trim(o ->> 'instructions'), ''),
    coalesce(nullif(o ->> 'reconciliation', ''), 'new'), v_staff, v_des,
    case when v_allergies is not null then trim(o ->> 'allergy_override_reason') end,
    case when v_inter is not null then trim(o ->> 'interaction_override_reason') end)
  returning id into v_id;

  perform public.edoshmis_audit(ad.organization_id, ad.facility_id, 'medication.prescribed', 'medication_order', v_id::text, ad.patient_id, null,
    o || jsonb_build_object('allergy_warning', v_allergies, 'interaction_warning', v_inter));
  return v_id;
end $$;

create or replace function public.edoshmis_verify_order(p_order uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare mo public.edoshmis_medication_orders; v_staff uuid;
begin
  select * into mo from public.edoshmis_medication_orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  v_staff := public.edoshmis_require(mo.facility_id, 'meds.verify');
  if mo.status <> 'prescribed' then raise exception 'This order is already %.', mo.status; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Say why the order is not verified, so the prescriber can correct it.'; end if;
  update public.edoshmis_medication_orders
    set status = case when p_approve then 'verified'::public.edoshmis_order_status else 'rejected'::public.edoshmis_order_status end,
        verified_by = v_staff, verified_at = now(), verify_note = nullif(trim(p_note), '')
    where id = p_order;
  perform public.edoshmis_audit(public.edoshmis_facility_org(mo.facility_id), mo.facility_id,
    case when p_approve then 'medication.verified' else 'medication.rejected' end, 'medication_order', p_order::text, mo.patient_id, null, null, p_note);
end $$;

create or replace function public.edoshmis_dispense(p_order uuid, d jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare mo public.edoshmis_medication_orders; v_staff uuid; v_id uuid;
begin
  select * into mo from public.edoshmis_medication_orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  v_staff := public.edoshmis_require(mo.facility_id, 'meds.verify');
  if mo.status <> 'verified' then raise exception 'Verify the order before dispensing it.'; end if;
  if nullif(d ->> 'expiry_date', '')::date < (now() at time zone 'Africa/Nairobi')::date then
    raise exception 'That batch has expired.';
  end if;
  insert into public.edoshmis_medication_dispenses (facility_id, order_id, admission_id, quantity, unit, batch_number, expiry_date, dispensed_by, note)
  values (mo.facility_id, p_order, mo.admission_id, (d ->> 'quantity')::numeric, coalesce(nullif(d ->> 'unit', ''), mo.dose_unit),
          nullif(trim(d ->> 'batch_number'), ''), nullif(d ->> 'expiry_date', '')::date, v_staff, nullif(trim(d ->> 'note'), ''))
  returning id into v_id;
  perform public.edoshmis_audit(public.edoshmis_facility_org(mo.facility_id), mo.facility_id, 'medication.dispensed', 'medication_dispense', v_id::text, mo.patient_id, null, d);
  return v_id;
end $$;

create or replace function public.edoshmis_discontinue_order(p_order uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare mo public.edoshmis_medication_orders; v_staff uuid;
begin
  select * into mo from public.edoshmis_medication_orders where id = p_order for update;
  if not found then raise exception 'Order not found.'; end if;
  v_staff := public.edoshmis_require_admission(mo.admission_id, 'meds.prescribe');
  if mo.status in ('discontinued', 'completed', 'rejected') then raise exception 'This order is already %.', mo.status; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason for stopping it.'; end if;
  update public.edoshmis_medication_orders set status = 'discontinued', discontinued_by = v_staff, discontinued_at = now(), discontinue_reason = trim(p_reason) where id = p_order;
  update public.edoshmis_medication_administrations set status = 'discontinued', reason = 'Order discontinued: ' || trim(p_reason), recorded_at = now()
    where order_id = p_order and status = 'scheduled';
  perform public.edoshmis_audit(public.edoshmis_facility_org(mo.facility_id), mo.facility_id, 'medication.discontinued', 'medication_order', p_order::text, mo.patient_id, null, null, p_reason);
end $$;

-- ---------------------------------------------------------------- eMAR

-- Lay out the due doses of every verified, scheduled order for an
-- admission from the start of yesterday to `p_hours` ahead. Idempotent:
-- an existing slot is never re-created or reset.
create or replace function public.edoshmis_generate_mar(p_admission uuid, p_hours int default 24)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not public.edoshmis_can_see_admission(p_admission) then raise exception 'Not your patient.' using errcode = '42501'; end if;
  with slots as (
    select o.id as order_id, o.facility_id, o.admission_id, o.patient_id,
           ((d.day + t.t) at time zone 'Africa/Nairobi') as due
    from public.edoshmis_medication_orders o
    cross join lateral unnest(o.schedule_times) as t (t)
    cross join lateral generate_series(((now() at time zone 'Africa/Nairobi')::date - 1)::timestamp,
                                       ((now() + make_interval(hours => least(greatest(p_hours, 1), 72))) at time zone 'Africa/Nairobi')::date::timestamp,
                                       interval '1 day') as d (day)
    where o.admission_id = p_admission and o.status = 'verified' and not o.is_prn
  )
  insert into public.edoshmis_medication_administrations (facility_id, order_id, admission_id, patient_id, scheduled_for)
  select s.facility_id, s.order_id, s.admission_id, s.patient_id, s.due
  from slots s join public.edoshmis_medication_orders o on o.id = s.order_id
  where s.due >= o.start_at and (o.end_at is null or s.due < o.end_at)
    and s.due <= now() + make_interval(hours => least(greatest(p_hours, 1), 72))
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Record a dose: against a scheduled slot (p_slot) or, for PRN/stat, a new
-- one on the order (p_order). Anything other than "administered" needs a
-- reason; a controlled drug given needs a second, different staff witness.
create or replace function public.edoshmis_record_administration(p_slot uuid, p_order uuid, p_status public.edoshmis_mar_status, d jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  ma public.edoshmis_medication_administrations; mo public.edoshmis_medication_orders; v_staff uuid; v_controlled boolean;
  v_witness uuid := nullif(d ->> 'witness_id', '')::uuid; v_id uuid; v_today int;
begin
  if p_slot is not null then
    select * into ma from public.edoshmis_medication_administrations where id = p_slot for update;
    if not found then raise exception 'Dose not found.'; end if;
    if ma.status <> 'scheduled' and not (ma.status = 'delayed' and p_status in ('administered', 'missed', 'refused', 'withheld')) then
      raise exception 'This dose is already recorded as %.', ma.status;
    end if;
    p_order := ma.order_id;
  end if;
  select * into mo from public.edoshmis_medication_orders where id = p_order;
  if not found then raise exception 'Order not found.'; end if;
  v_staff := public.edoshmis_require_admission(mo.admission_id, 'meds.administer');
  if mo.status <> 'verified' then raise exception 'Only a pharmacy-verified order can be given (this one is %).', mo.status; end if;
  if p_status = 'scheduled' or p_status = 'discontinued' then raise exception 'Choose what happened to the dose.'; end if;
  if p_status <> 'administered' and coalesce(trim(d ->> 'reason'), '') = '' then raise exception 'Give the reason the dose was %.', p_status; end if;

  select coalesce(dr.is_controlled, false) into v_controlled from (select 1) one left join public.edoshmis_drugs dr on dr.id = mo.drug_id;
  if p_status = 'administered' and v_controlled then
    if v_witness is null or v_witness = v_staff then raise exception 'A controlled drug needs a second staff member as witness.'; end if;
    if not exists (select 1 from public.edoshmis_staff where id = v_witness and status = 'active' and organization_id = public.edoshmis_facility_org(mo.facility_id)) then
      raise exception 'The witness is not active staff here.';
    end if;
  end if;

  if p_slot is null then
    if not mo.is_prn and mo.frequency <> 'stat' then raise exception 'Record a scheduled order against its due time.'; end if;
    if mo.is_prn and mo.prn_max_doses_per_day is not null and p_status = 'administered' then
      select count(*) into v_today from public.edoshmis_medication_administrations
      where order_id = p_order and status = 'administered' and administered_at > now() - interval '24 hours';
      if v_today >= mo.prn_max_doses_per_day then
        raise exception 'The prescribed maximum of % doses in 24 hours has been given.', mo.prn_max_doses_per_day;
      end if;
    end if;
    insert into public.edoshmis_medication_administrations (facility_id, order_id, admission_id, patient_id, status, administered_at, dose_given, reason,
      administered_by, witness_id, recorded_at, client_id)
    values (mo.facility_id, p_order, mo.admission_id, mo.patient_id, p_status,
      case when p_status = 'administered' then coalesce(nullif(d ->> 'administered_at', '')::timestamptz, now()) end,
      coalesce(nullif(trim(d ->> 'dose_given'), ''), mo.dose::text || ' ' || mo.dose_unit), nullif(trim(d ->> 'reason'), ''),
      v_staff, case when v_controlled then v_witness end, now(), nullif(d ->> 'client_id', '')::uuid)
    on conflict (client_id) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.edoshmis_medication_administrations where client_id = (d ->> 'client_id')::uuid;
    end if;
    return v_id;
  end if;

  update public.edoshmis_medication_administrations set
    status = p_status,
    administered_at = case when p_status = 'administered' then coalesce(nullif(d ->> 'administered_at', '')::timestamptz, now()) end,
    dose_given = case when p_status = 'administered' then coalesce(nullif(trim(d ->> 'dose_given'), ''), mo.dose::text || ' ' || mo.dose_unit) end,
    reason = nullif(trim(d ->> 'reason'), ''), administered_by = v_staff, witness_id = case when v_controlled then v_witness end, recorded_at = now()
  where id = p_slot;
  return p_slot;
end $$;

-- A recorded dose is frozen; the only change is "entered in error".
create or replace function public.edoshmis_mar_guard()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    if (to_jsonb(new) - array['entered_in_error', 'error_reason']) is distinct from (to_jsonb(old) - array['entered_in_error', 'error_reason']) then
      raise exception 'A recorded dose is never edited. Mark it entered in error.';
    end if;
    if new.entered_in_error and coalesce(trim(new.error_reason), '') = '' then raise exception 'Give the reason.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists edoshmis_mar_guard on public.edoshmis_medication_administrations;
create trigger edoshmis_mar_guard before update on public.edoshmis_medication_administrations for each row execute function public.edoshmis_mar_guard();

do $$ declare t text; begin
  foreach t in array array['edoshmis_drugs', 'edoshmis_drug_interactions', 'edoshmis_medication_administrations'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after update or delete on public.%I for each row execute function public.edoshmis_audit_trigger()', t || '_audit', t);
  end loop;
end $$;
drop trigger if exists edoshmis_drugs_touch on public.edoshmis_drugs;
create trigger edoshmis_drugs_touch before update on public.edoshmis_drugs for each row execute function public.edoshmis_touch_updated_at();

-- ---------------------------------------------------------------- RLS

alter table public.edoshmis_drugs enable row level security;
alter table public.edoshmis_drug_interactions enable row level security;
alter table public.edoshmis_medication_orders enable row level security;
alter table public.edoshmis_medication_dispenses enable row level security;
alter table public.edoshmis_medication_administrations enable row level security;

drop policy if exists edoshmis_drugs_read on public.edoshmis_drugs;
create policy edoshmis_drugs_read on public.edoshmis_drugs for select to authenticated using (public.edoshmis_is_member(organization_id));
drop policy if exists edoshmis_drugs_write on public.edoshmis_drugs;
create policy edoshmis_drugs_write on public.edoshmis_drugs for all to authenticated
  using (public.edoshmis_has_org_perm(organization_id, 'admin.clinical_config') or public.edoshmis_has_org_perm(organization_id, 'meds.verify'))
  with check (public.edoshmis_has_org_perm(organization_id, 'admin.clinical_config') or public.edoshmis_has_org_perm(organization_id, 'meds.verify'));
drop policy if exists edoshmis_drug_interactions_read on public.edoshmis_drug_interactions;
create policy edoshmis_drug_interactions_read on public.edoshmis_drug_interactions for select to authenticated using (public.edoshmis_is_member(organization_id));
drop policy if exists edoshmis_drug_interactions_write on public.edoshmis_drug_interactions;
create policy edoshmis_drug_interactions_write on public.edoshmis_drug_interactions for all to authenticated
  using (public.edoshmis_has_org_perm(organization_id, 'admin.clinical_config') or public.edoshmis_has_org_perm(organization_id, 'meds.verify'))
  with check (public.edoshmis_has_org_perm(organization_id, 'admin.clinical_config') or public.edoshmis_has_org_perm(organization_id, 'meds.verify'));

-- Orders: the care team sees them through the admission; the pharmacy sees
-- every order at its facility (it verifies them) without the notes.
drop policy if exists edoshmis_medication_orders_read on public.edoshmis_medication_orders;
create policy edoshmis_medication_orders_read on public.edoshmis_medication_orders for select to authenticated
  using (public.edoshmis_can_see_admission(admission_id) or public.edoshmis_has_perm(facility_id, 'meds.verify'));
drop policy if exists edoshmis_medication_dispenses_read on public.edoshmis_medication_dispenses;
create policy edoshmis_medication_dispenses_read on public.edoshmis_medication_dispenses for select to authenticated
  using (public.edoshmis_can_see_admission(admission_id) or public.edoshmis_has_perm(facility_id, 'meds.verify'));
drop policy if exists edoshmis_medication_administrations_read on public.edoshmis_medication_administrations;
create policy edoshmis_medication_administrations_read on public.edoshmis_medication_administrations for select to authenticated
  using (public.edoshmis_can_see_admission(admission_id) or public.edoshmis_has_perm(facility_id, 'meds.verify'));
drop policy if exists edoshmis_medication_administrations_error on public.edoshmis_medication_administrations;
create policy edoshmis_medication_administrations_error on public.edoshmis_medication_administrations for update to authenticated
  using (public.edoshmis_has_perm(facility_id, 'meds.administer') and public.edoshmis_can_see_admission(admission_id))
  with check (public.edoshmis_has_perm(facility_id, 'meds.administer'));
