-- EDOSHMIS 0007 — discharge.
--
--   initiate (doctor) → summary → medication reconciliation → investigations
--   reviewed → billing, pharmacy and nursing clearances → authorise (senior
--   clinician) → bed released, admission closed, bill closed.
--
-- The bed is released and the admission closed only by authorisation, and
-- authorisation refuses until every step is done. Death, absconding,
-- leaving against advice and transfer out use the same path with what does
-- not apply marked "not applicable" by the person responsible for it.

do $$ begin
  create type public.edoshmis_discharge_type as enum ('routine', 'against_medical_advice', 'transfer_out', 'death', 'absconded');
exception when duplicate_object then null; end $$;

create table if not exists public.edoshmis_discharges (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  admission_id uuid not null references public.edoshmis_admissions (id),
  discharge_type public.edoshmis_discharge_type not null,
  status text not null default 'initiated' check (status in ('initiated', 'authorised', 'cancelled')),
  initiated_by uuid not null references public.edoshmis_staff (id),
  initiated_at timestamptz not null default now(),
  -- Summary
  hospital_course text,
  treatment_received text,
  investigation_summary text,
  procedures_performed text,
  condition_at_discharge text,
  discharge_medications text,
  patient_instructions text,
  follow_up_date date,
  follow_up_with text,
  referral_to text,
  referral_reason text,
  destination text,
  -- Death
  time_of_death timestamptz,
  cause_of_death text,
  -- Steps
  summary_completed_by uuid references public.edoshmis_staff (id),
  summary_completed_at timestamptz,
  meds_reconciled_by uuid references public.edoshmis_staff (id),
  meds_reconciled_at timestamptz,
  investigations_reviewed_by uuid references public.edoshmis_staff (id),
  investigations_reviewed_at timestamptz,
  authorised_by uuid references public.edoshmis_staff (id),
  authorised_at timestamptz,
  discharged_at timestamptz,
  cancelled_by uuid references public.edoshmis_staff (id),
  cancel_reason text,
  updated_at timestamptz not null default now()
);
-- One live discharge per admission (a cancelled one may be followed by another).
create unique index if not exists edoshmis_discharges_one_live on public.edoshmis_discharges (admission_id) where status <> 'cancelled';

create table if not exists public.edoshmis_discharge_clearances (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  discharge_id uuid not null references public.edoshmis_discharges (id) on delete cascade,
  kind text not null check (kind in ('billing', 'pharmacy', 'nursing')),
  status text not null default 'pending' check (status in ('pending', 'cleared', 'not_applicable', 'deferred')),
  note text,
  cleared_by uuid references public.edoshmis_staff (id),
  cleared_at timestamptz,
  unique (discharge_id, kind)
);

-- Final diagnoses come from edoshmis_diagnoses (kind = 'final').

create or replace function public.edoshmis_initiate_discharge(p_admission uuid, p_type public.edoshmis_discharge_type, d jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare ad public.edoshmis_admissions; v_staff uuid; v_id uuid;
begin
  select * into ad from public.edoshmis_admissions where id = p_admission for update;
  if not found then raise exception 'Admission not found.'; end if;
  v_staff := public.edoshmis_require_admission(p_admission, 'discharge.initiate');
  if ad.status <> 'active' then raise exception 'This admission is not active (it is %).', ad.status; end if;
  if p_type = 'death' and nullif(d ->> 'time_of_death', '') is null then raise exception 'Record the time of death.'; end if;
  insert into public.edoshmis_discharges (facility_id, patient_id, admission_id, discharge_type, initiated_by, time_of_death, cause_of_death, destination)
  values (ad.facility_id, ad.patient_id, p_admission, p_type, v_staff, nullif(d ->> 'time_of_death', '')::timestamptz,
          nullif(trim(d ->> 'cause_of_death'), ''), nullif(trim(d ->> 'destination'), ''))
  returning id into v_id;
  insert into public.edoshmis_discharge_clearances (facility_id, discharge_id, kind)
  select ad.facility_id, v_id, k from unnest(array['billing', 'pharmacy', 'nursing']) k;
  update public.edoshmis_admissions set status = 'discharge_in_progress', updated_at = now() where id = p_admission;
  perform public.edoshmis_audit(ad.organization_id, ad.facility_id, 'discharge.initiated', 'discharge', v_id::text, ad.patient_id, null,
    jsonb_build_object('type', p_type));
  return v_id;
end $$;

-- Save the summary; with p_complete, mark it complete (needs the core fields).
create or replace function public.edoshmis_save_discharge_summary(p_discharge uuid, d jsonb, p_complete boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare dc public.edoshmis_discharges; v_staff uuid;
begin
  select * into dc from public.edoshmis_discharges where id = p_discharge for update;
  if not found or dc.status <> 'initiated' then raise exception 'This discharge is not open.'; end if;
  v_staff := public.edoshmis_require_admission(dc.admission_id, 'discharge.initiate');
  update public.edoshmis_discharges set
    hospital_course = coalesce(nullif(trim(d ->> 'hospital_course'), ''), hospital_course),
    treatment_received = coalesce(nullif(trim(d ->> 'treatment_received'), ''), treatment_received),
    investigation_summary = coalesce(nullif(trim(d ->> 'investigation_summary'), ''), investigation_summary),
    procedures_performed = coalesce(nullif(trim(d ->> 'procedures_performed'), ''), procedures_performed),
    condition_at_discharge = coalesce(nullif(trim(d ->> 'condition_at_discharge'), ''), condition_at_discharge),
    discharge_medications = coalesce(nullif(trim(d ->> 'discharge_medications'), ''), discharge_medications),
    patient_instructions = coalesce(nullif(trim(d ->> 'patient_instructions'), ''), patient_instructions),
    follow_up_date = coalesce(nullif(d ->> 'follow_up_date', '')::date, follow_up_date),
    follow_up_with = coalesce(nullif(trim(d ->> 'follow_up_with'), ''), follow_up_with),
    referral_to = coalesce(nullif(trim(d ->> 'referral_to'), ''), referral_to),
    referral_reason = coalesce(nullif(trim(d ->> 'referral_reason'), ''), referral_reason),
    destination = coalesce(nullif(trim(d ->> 'destination'), ''), destination),
    cause_of_death = coalesce(nullif(trim(d ->> 'cause_of_death'), ''), cause_of_death),
    updated_at = now()
  where id = p_discharge;
  if p_complete then
    select * into dc from public.edoshmis_discharges where id = p_discharge;
    if coalesce(dc.hospital_course, '') = '' or coalesce(dc.condition_at_discharge, '') = '' then
      raise exception 'Write the hospital course and the condition at discharge before completing the summary.';
    end if;
    if dc.discharge_type = 'transfer_out' and coalesce(dc.referral_to, '') = '' then raise exception 'Name the receiving facility.'; end if;
    if dc.discharge_type = 'death' and coalesce(dc.cause_of_death, '') = '' then raise exception 'Record the cause of death (as certified).'; end if;
    if not exists (select 1 from public.edoshmis_diagnoses where admission_id = dc.admission_id and kind = 'final' and status = 'active') then
      raise exception 'Record the final diagnosis before completing the summary.';
    end if;
    update public.edoshmis_discharges set summary_completed_by = v_staff, summary_completed_at = now() where id = p_discharge;
  end if;
end $$;

create or replace function public.edoshmis_discharge_step(p_discharge uuid, p_step text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare dc public.edoshmis_discharges; v_staff uuid; v_active int;
begin
  select * into dc from public.edoshmis_discharges where id = p_discharge for update;
  if not found or dc.status <> 'initiated' then raise exception 'This discharge is not open.'; end if;
  v_staff := public.edoshmis_require_admission(dc.admission_id, 'discharge.initiate');
  if p_step = 'meds_reconciled' then
    -- Every inpatient order must be decided: stopped, or carried into the discharge medication list.
    select count(*) into v_active from public.edoshmis_medication_orders where admission_id = dc.admission_id and status in ('prescribed', 'on_hold');
    if v_active > 0 then raise exception '% order(s) are still awaiting pharmacy or on hold. Stop them or have them verified first.', v_active; end if;
    if dc.discharge_type in ('routine', 'transfer_out') and coalesce(dc.discharge_medications, '') = '' and coalesce(trim(p_note), '') = '' then
      raise exception 'List the discharge medication, or note that there is none.';
    end if;
    update public.edoshmis_discharges set meds_reconciled_by = v_staff, meds_reconciled_at = now(),
      discharge_medications = coalesce(discharge_medications, nullif(trim(p_note), '')) where id = p_discharge;
  elsif p_step = 'investigations_reviewed' then
    update public.edoshmis_discharges set investigations_reviewed_by = v_staff, investigations_reviewed_at = now(),
      investigation_summary = coalesce(investigation_summary, nullif(trim(p_note), '')) where id = p_discharge;
  else
    raise exception 'Unknown step.';
  end if;
  perform public.edoshmis_audit(public.edoshmis_facility_org(dc.facility_id), dc.facility_id, 'discharge.' || p_step, 'discharge', p_discharge::text, dc.patient_id, null, null, p_note);
end $$;

-- Billing clears on a zero (or credit) balance; a balance left owing must
-- be deferred with a reason (credit approved, payer to settle).
create or replace function public.edoshmis_clear_discharge(p_discharge uuid, p_kind text, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare dc public.edoshmis_discharges; v_staff uuid; v_balance numeric;
begin
  select * into dc from public.edoshmis_discharges where id = p_discharge for update;
  if not found or dc.status <> 'initiated' then raise exception 'This discharge is not open.'; end if;
  if p_kind not in ('billing', 'pharmacy', 'nursing') then raise exception 'Unknown clearance.'; end if;
  v_staff := public.edoshmis_require(dc.facility_id, 'discharge.clear_' || p_kind);
  if p_status not in ('cleared', 'not_applicable', 'deferred', 'pending') then raise exception 'Unknown status.'; end if;
  if p_status in ('not_applicable', 'deferred') and coalesce(trim(p_note), '') = '' then raise exception 'Give the reason.'; end if;
  if p_kind = 'billing' and p_status = 'cleared' then
    perform public.edoshmis_post_bed_charges(dc.admission_id);
    select coalesce(sum(b.balance), 0) into v_balance from public.edoshmis_account_balances b where b.admission_id = dc.admission_id;
    if v_balance > 0 then
      raise exception 'KSh % is still owed. Take payment, or defer the clearance with the reason (credit approved, payer to settle).',
        to_char(v_balance, 'FM999,999,990.00');
    end if;
  end if;
  update public.edoshmis_discharge_clearances set status = p_status, note = nullif(trim(p_note), ''),
    cleared_by = case when p_status = 'pending' then null else v_staff end, cleared_at = case when p_status = 'pending' then null else now() end
  where discharge_id = p_discharge and kind = p_kind;
  perform public.edoshmis_audit(public.edoshmis_facility_org(dc.facility_id), dc.facility_id, 'discharge.clearance', 'discharge', p_discharge::text, dc.patient_id, null,
    jsonb_build_object('kind', p_kind, 'status', p_status), p_note);
end $$;

create or replace function public.edoshmis_authorise_discharge(p_discharge uuid, p_discharged_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  dc public.edoshmis_discharges; ad public.edoshmis_admissions; v_staff uuid; v_missing text[] := '{}'; v_at timestamptz; v_status public.edoshmis_admission_status;
  v_end text; v_bed uuid;
begin
  select * into dc from public.edoshmis_discharges where id = p_discharge for update;
  if not found or dc.status <> 'initiated' then raise exception 'This discharge is not open.'; end if;
  select * into ad from public.edoshmis_admissions where id = dc.admission_id for update;
  v_staff := public.edoshmis_require_admission(dc.admission_id, 'discharge.authorize');

  if dc.summary_completed_at is null then v_missing := array_append(v_missing, 'discharge summary'); end if;
  if dc.meds_reconciled_at is null then v_missing := array_append(v_missing, 'medication reconciliation'); end if;
  if dc.investigations_reviewed_at is null then v_missing := array_append(v_missing, 'investigations review'); end if;
  v_missing := v_missing || coalesce((select array_agg(kind || ' clearance' order by kind) from public.edoshmis_discharge_clearances
                                       where discharge_id = p_discharge and status = 'pending'), '{}');
  if cardinality(v_missing) > 0 then
    raise exception 'Not ready to discharge. Still to do: %.', array_to_string(v_missing, ', ');
  end if;

  v_at := coalesce(p_discharged_at, case when dc.discharge_type = 'death' then dc.time_of_death end, now());
  if v_at > now() + interval '5 minutes' or v_at < ad.admitted_at then raise exception 'The discharge time must be between admission and now.'; end if;
  v_status := case dc.discharge_type
    when 'routine' then 'discharged' when 'against_medical_advice' then 'discharged_ama' when 'transfer_out' then 'transferred_out'
    when 'death' then 'deceased' when 'absconded' then 'absconded' end;
  v_end := case dc.discharge_type when 'death' then 'death' when 'absconded' then 'absconded' when 'transfer_out' then 'transfer_out' else 'discharge' end;

  v_bed := ad.current_bed_id;
  if v_bed is not null then perform 1 from public.edoshmis_beds where id = v_bed for update; end if;
  update public.edoshmis_bed_allocations set ended_at = greatest(v_at, started_at), end_reason = v_end, ended_by = v_staff where admission_id = ad.id and ended_at is null;
  if v_bed is not null then
    update public.edoshmis_beds set status = 'cleaning', current_admission_id = null, status_note = 'After discharge', status_changed_at = now() where id = v_bed;
    perform public.edoshmis_bed_event(v_bed, 'occupied', 'cleaning', ad.id, 'Discharged', v_staff);
  end if;

  update public.edoshmis_admissions set status = v_status, discharged_at = v_at, current_bed_id = null, updated_at = now() where id = ad.id;
  update public.edoshmis_encounters set status = 'closed', ended_at = v_at where id = ad.encounter_id;
  update public.edoshmis_discharges set status = 'authorised', authorised_by = v_staff, authorised_at = now(), discharged_at = v_at, updated_at = now() where id = p_discharge;
  -- Remaining scheduled doses lapse with the admission.
  update public.edoshmis_medication_administrations set status = 'discontinued', reason = 'Patient discharged', recorded_at = now()
    where admission_id = ad.id and status = 'scheduled';
  update public.edoshmis_medication_orders set status = 'completed' where admission_id = ad.id and status = 'verified';
  -- Final bed-days, then the bill closes — unless billing clearance was
  -- deferred, in which case it stays open for the balance to be paid.
  perform public.edoshmis_post_bed_charges(ad.id);
  update public.edoshmis_billing_accounts set status = 'closed', closed_at = now() where admission_id = ad.id
    and not exists (select 1 from public.edoshmis_discharge_clearances where discharge_id = p_discharge and kind = 'billing' and status = 'deferred');
  if dc.discharge_type = 'death' then
    update public.edoshmis_patients set is_deceased = true, deceased_at = v_at where id = ad.patient_id;
  end if;
  perform public.edoshmis_audit(ad.organization_id, ad.facility_id, 'discharge.authorised', 'admission', ad.id::text, ad.patient_id, null,
    jsonb_build_object('type', dc.discharge_type, 'discharged_at', v_at, 'bed_id', v_bed));
end $$;

create or replace function public.edoshmis_cancel_discharge(p_discharge uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare dc public.edoshmis_discharges; v_staff uuid;
begin
  select * into dc from public.edoshmis_discharges where id = p_discharge for update;
  if not found or dc.status <> 'initiated' then raise exception 'This discharge is not open.'; end if;
  v_staff := public.edoshmis_require_admission(dc.admission_id, 'discharge.initiate');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason.'; end if;
  update public.edoshmis_discharges set status = 'cancelled', cancelled_by = v_staff, cancel_reason = trim(p_reason), updated_at = now() where id = p_discharge;
  update public.edoshmis_admissions set status = 'active', updated_at = now() where id = dc.admission_id and status = 'discharge_in_progress';
  perform public.edoshmis_audit(public.edoshmis_facility_org(dc.facility_id), dc.facility_id, 'discharge.cancelled', 'discharge', p_discharge::text, dc.patient_id, null, null, p_reason);
end $$;

-- ---------------------------------------------------------------- RLS

alter table public.edoshmis_discharges enable row level security;
alter table public.edoshmis_discharge_clearances enable row level security;

-- Clinicians see the discharge through the admission; the clearing
-- departments see the clearance list (not the summary) for their work.
drop policy if exists edoshmis_discharges_read on public.edoshmis_discharges;
create policy edoshmis_discharges_read on public.edoshmis_discharges for select to authenticated using (public.edoshmis_can_see_admission(admission_id));
drop policy if exists edoshmis_discharge_clearances_read on public.edoshmis_discharge_clearances;
create policy edoshmis_discharge_clearances_read on public.edoshmis_discharge_clearances for select to authenticated
  using (public.edoshmis_has_perm(facility_id, 'ipd.read') or public.edoshmis_has_perm(facility_id, 'discharge.clear_' || kind));
