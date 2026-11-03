-- EDOSHMIS 0006 — inpatient billing: one account per admission (or
-- outpatient encounter), charges, payments, deposits, adjustments.
--
-- Nothing is charged twice: a charge that comes from something — a bed-day,
-- a dispense, a procedure — carries a charge_key unique within its account,
-- so posting it again is a no-op. Nothing is deleted either: a wrong charge
-- is reversed by a negative one that points at it.

create table if not exists public.edoshmis_billing_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id),
  facility_id uuid not null references public.edoshmis_facilities (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  admission_id uuid unique references public.edoshmis_admissions (id),
  encounter_id uuid references public.edoshmis_encounters (id),
  account_number text not null,
  payer_category public.edoshmis_payment_category not null default 'cash',
  coverage_id uuid references public.edoshmis_patient_coverage (id),
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (facility_id, account_number)
);

create table if not exists public.edoshmis_charges (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  account_id uuid not null references public.edoshmis_billing_accounts (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  tariff_id uuid references public.edoshmis_tariffs (id),
  category text not null,
  description text not null,
  service_date date not null default ((now() at time zone 'Africa/Nairobi')::date),
  quantity numeric(10, 2) not null default 1 check (quantity <> 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  amount numeric(14, 2) generated always as (round(quantity * unit_price, 2)) stored,
  charge_key text,
  source_type text,
  source_id uuid,
  reverses_id uuid references public.edoshmis_charges (id),
  reason text,
  posted_by uuid references public.edoshmis_staff (id),
  posted_at timestamptz not null default now()
);
create unique index if not exists edoshmis_charges_key_uniq on public.edoshmis_charges (account_id, charge_key) where charge_key is not null;
create unique index if not exists edoshmis_charges_one_reversal on public.edoshmis_charges (reverses_id) where reverses_id is not null;
create index if not exists edoshmis_charges_account_idx on public.edoshmis_charges (account_id, service_date);

create table if not exists public.edoshmis_payments (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  account_id uuid not null references public.edoshmis_billing_accounts (id),
  patient_id uuid not null references public.edoshmis_patients (id),
  receipt_number text not null,
  kind text not null default 'payment' check (kind in ('deposit', 'payment', 'refund', 'waiver', 'payer_settlement')),
  method text not null check (method in ('cash', 'mpesa', 'card', 'bank_transfer', 'cheque', 'sha', 'insurance', 'corporate', 'waiver')),
  amount numeric(14, 2) not null check (amount > 0),
  reference text,
  payer_name text,
  note text,
  received_by uuid references public.edoshmis_staff (id),
  received_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.edoshmis_staff (id),
  void_reason text,
  unique (facility_id, receipt_number)
);
create index if not exists edoshmis_payments_account_idx on public.edoshmis_payments (account_id);
-- An M-Pesa code is used once per facility.
create unique index if not exists edoshmis_payments_mpesa_uniq on public.edoshmis_payments (facility_id, upper(reference))
  where method = 'mpesa' and reference is not null and voided_at is null;

-- Running balance: charges minus money in, refunds added back.
create or replace view public.edoshmis_account_balances with (security_invoker = true) as
select a.id as account_id, a.facility_id, a.patient_id, a.admission_id, a.status,
       coalesce(c.total, 0)::numeric(14, 2) as charges,
       coalesce(p.paid, 0)::numeric(14, 2) as paid,
       coalesce(p.deposits, 0)::numeric(14, 2) as deposits,
       coalesce(p.refunds, 0)::numeric(14, 2) as refunds,
       (coalesce(c.total, 0) - coalesce(p.paid, 0) + coalesce(p.refunds, 0))::numeric(14, 2) as balance
from public.edoshmis_billing_accounts a
left join (select account_id, sum(amount) as total from public.edoshmis_charges group by account_id) c on c.account_id = a.id
left join (
  select account_id,
         sum(amount) filter (where kind <> 'refund') as paid,
         sum(amount) filter (where kind = 'deposit') as deposits,
         sum(amount) filter (where kind = 'refund') as refunds
  from public.edoshmis_payments where voided_at is null group by account_id
) p on p.account_id = a.id;

-- ---------------------------------------------------------------- functions

create or replace function public.edoshmis_open_billing_account(p_admission uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare ad public.edoshmis_admissions; v_id uuid; v_code text; v_year text;
begin
  select * into ad from public.edoshmis_admissions where id = p_admission;
  if not found then raise exception 'Admission not found.'; end if;
  select id into v_id from public.edoshmis_billing_accounts where admission_id = p_admission;
  if v_id is not null then return v_id; end if;
  select code into v_code from public.edoshmis_facilities where id = ad.facility_id;
  v_year := to_char(now() at time zone 'Africa/Nairobi', 'YYYY');
  insert into public.edoshmis_billing_accounts (organization_id, facility_id, patient_id, admission_id, encounter_id, account_number, payer_category, coverage_id)
  values (ad.organization_id, ad.facility_id, ad.patient_id, p_admission, ad.encounter_id,
          v_code || '/IPB/' || v_year || '/' || lpad(public.edoshmis_next_number(ad.facility_id, 'ip_account', v_year)::text, 5, '0'),
          ad.payment_category, ad.coverage_id)
  returning id into v_id;
  return v_id;
end $$;

-- Internal: insert a keyed charge on an account, ignoring repeats.
create or replace function public.edoshmis_post_keyed_charge(p_account uuid, p_tariff uuid, p_desc text, p_date date, p_qty numeric,
  p_price numeric, p_key text, p_source_type text, p_source_id uuid, p_staff uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.edoshmis_billing_accounts; t public.edoshmis_tariffs; v_id uuid; v_price numeric;
begin
  select * into a from public.edoshmis_billing_accounts where id = p_account;
  if a.status <> 'open' then raise exception 'This bill is closed.'; end if;
  if p_tariff is not null then select * into t from public.edoshmis_tariffs where id = p_tariff and facility_id = a.facility_id; end if;
  v_price := coalesce(p_price, case when a.payer_category = 'sha' and t.sha_price is not null then t.sha_price else t.price end);
  if v_price is null then raise exception 'No price for this item — set it under Tariffs.'; end if;
  insert into public.edoshmis_charges (facility_id, account_id, patient_id, tariff_id, category, description, service_date, quantity, unit_price,
    charge_key, source_type, source_id, posted_by)
  values (a.facility_id, p_account, a.patient_id, p_tariff, coalesce(t.category, 'other'), coalesce(nullif(trim(p_desc), ''), t.name), p_date,
          coalesce(p_qty, 1), v_price, p_key, p_source_type, p_source_id, p_staff)
  on conflict (account_id, charge_key) where charge_key is not null do nothing
  returning id into v_id;
  return v_id;
end $$;

-- Bed-days from admission to today (or discharge), one per calendar day in
-- Nairobi, priced by the bed's tariff, else its ward's. The bed counted for
-- a day is the one the patient was in at the end of it (or now, today).
-- Run as often as you like: each day is keyed and charged once.
create or replace function public.edoshmis_post_bed_charges(p_admission uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  ad public.edoshmis_admissions; v_acct uuid; v_staff uuid; d date; v_end date; v_at timestamptz; al record; v_tariff uuid; n int := 0; v_id uuid;
begin
  select * into ad from public.edoshmis_admissions where id = p_admission;
  if not found then raise exception 'Admission not found.'; end if;
  if auth.uid() is not null then
    if not (public.edoshmis_has_perm(ad.facility_id, 'billing.charge') or public.edoshmis_has_perm(ad.facility_id, 'ipd.allocate_bed')
            or public.edoshmis_has_perm(ad.facility_id, 'discharge.authorize')) then
      raise exception 'You do not have permission to post charges.' using errcode = '42501';
    end if;
    v_staff := public.edoshmis_staff_id(ad.organization_id);
  end if;
  v_acct := public.edoshmis_open_billing_account(p_admission);
  d := (ad.admitted_at at time zone 'Africa/Nairobi')::date;
  v_end := (coalesce(ad.discharged_at, now()) at time zone 'Africa/Nairobi')::date;
  -- Same-day discharge is still one bed-day; a discharge day after midnight is not an extra one.
  if v_end > d and ad.discharged_at is not null then v_end := v_end - 1; end if;
  while d <= v_end loop
    v_at := least(((d + 1)::timestamp at time zone 'Africa/Nairobi') - interval '1 second', coalesce(ad.discharged_at, now()));
    select ba.bed_id, ba.ward_id into al from public.edoshmis_bed_allocations ba
    where ba.admission_id = p_admission and ba.started_at <= v_at and (ba.ended_at is null or ba.ended_at > v_at)
    order by ba.started_at desc limit 1;
    if al.bed_id is null then
      select ba.bed_id, ba.ward_id into al from public.edoshmis_bed_allocations ba where ba.admission_id = p_admission order by ba.started_at desc limit 1;
    end if;
    select coalesce(b.daily_tariff_id, w.daily_tariff_id) into v_tariff
    from public.edoshmis_beds b join public.edoshmis_wards w on w.id = b.ward_id where b.id = al.bed_id;
    if v_tariff is not null then
      v_id := public.edoshmis_post_keyed_charge(v_acct, v_tariff, null, d, 1, null, 'bed:' || d::text, 'bed_day', al.bed_id, v_staff);
      if v_id is not null then n := n + 1; end if;
    end if;
    d := d + 1;
  end loop;
  return n;
end $$;

create or replace function public.edoshmis_post_charge(p_account uuid, c jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.edoshmis_billing_accounts; v_staff uuid; v_id uuid; v_key text := nullif(trim(c ->> 'charge_key'), '');
begin
  select * into a from public.edoshmis_billing_accounts where id = p_account;
  if not found then raise exception 'Bill not found.'; end if;
  v_staff := public.edoshmis_require(a.facility_id, 'billing.charge');
  if nullif(c ->> 'tariff_id', '') is null and nullif(c ->> 'unit_price', '') is null then raise exception 'Choose a priced item or enter a price.'; end if;
  if nullif(c ->> 'unit_price', '') is not null and nullif(c ->> 'tariff_id', '') is not null and not public.edoshmis_has_perm(a.facility_id, 'billing.adjust') then
    raise exception 'Only someone who can adjust bills may change a listed price.';
  end if;
  v_id := public.edoshmis_post_keyed_charge(p_account, nullif(c ->> 'tariff_id', '')::uuid, c ->> 'description',
    coalesce(nullif(c ->> 'service_date', '')::date, (now() at time zone 'Africa/Nairobi')::date),
    coalesce(nullif(c ->> 'quantity', '')::numeric, 1), nullif(c ->> 'unit_price', '')::numeric, v_key, 'manual', null, v_staff);
  if v_id is null then raise exception 'That item has already been charged on this bill.'; end if;
  perform public.edoshmis_audit(a.organization_id, a.facility_id, 'billing.charged', 'charge', v_id::text, a.patient_id, null, c);
  return v_id;
end $$;

-- Reverse a charge in full, with a reason. Discounts are a reversal of
-- part of a charge: a negative line pointing at it.
create or replace function public.edoshmis_adjust_charge(p_charge uuid, p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.edoshmis_charges; v_staff uuid; v_id uuid; a public.edoshmis_billing_accounts;
begin
  select * into c from public.edoshmis_charges where id = p_charge for update;
  if not found or c.reverses_id is not null then raise exception 'Charge not found.'; end if;
  select * into a from public.edoshmis_billing_accounts where id = c.account_id;
  v_staff := public.edoshmis_require(c.facility_id, 'billing.adjust');
  if a.status <> 'open' then raise exception 'This bill is closed.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > c.amount then raise exception 'The adjustment must be between 0 and %.', c.amount; end if;
  insert into public.edoshmis_charges (facility_id, account_id, patient_id, tariff_id, category, description, service_date, quantity, unit_price, reverses_id, reason, posted_by, source_type)
  values (c.facility_id, c.account_id, c.patient_id, c.tariff_id, c.category,
          case when p_amount = c.amount then 'Reversal: ' else 'Discount: ' end || c.description,
          c.service_date, -1, p_amount, c.id, trim(p_reason), v_staff, 'adjustment')
  returning id into v_id;
  perform public.edoshmis_audit(a.organization_id, a.facility_id, 'billing.adjusted', 'charge', p_charge::text, a.patient_id, to_jsonb(c),
    jsonb_build_object('amount', p_amount), p_reason);
  return v_id;
end $$;

create or replace function public.edoshmis_receive_payment(p_account uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.edoshmis_billing_accounts; v_staff uuid; v_id uuid; v_code text; v_ref text; v_kind text := coalesce(nullif(p ->> 'kind', ''), 'payment');
  v_method text := p ->> 'method';
begin
  select * into a from public.edoshmis_billing_accounts where id = p_account for update;
  if not found then raise exception 'Bill not found.'; end if;
  v_staff := public.edoshmis_require(a.facility_id, 'billing.payment');
  if a.status <> 'open' and v_kind <> 'refund' then raise exception 'This bill is closed.'; end if;
  if v_kind in ('waiver', 'refund') and not public.edoshmis_has_perm(a.facility_id, 'billing.adjust') then
    raise exception 'Only someone who can adjust bills may record a %.', v_kind;
  end if;
  v_ref := nullif(upper(regexp_replace(coalesce(p ->> 'reference', ''), '[\s-]', '', 'g')), '');
  if v_method = 'mpesa' and (v_ref is null or v_ref !~ '^[A-Z0-9]{8,12}$') then
    raise exception 'Enter the M-Pesa transaction code from the confirmation SMS (e.g. SGH7XK2LMN).';
  end if;
  if v_method in ('card', 'bank_transfer', 'cheque') and v_ref is null then raise exception 'Enter the reference.'; end if;
  if v_kind in ('waiver', 'refund') and coalesce(trim(p ->> 'note'), '') = '' then raise exception 'Give the reason.'; end if;
  select code into v_code from public.edoshmis_facilities where id = a.facility_id;
  insert into public.edoshmis_payments (facility_id, account_id, patient_id, receipt_number, kind, method, amount, reference, payer_name, note, received_by)
  values (a.facility_id, p_account, a.patient_id,
          v_code || '/RCT/' || lpad(public.edoshmis_next_number(a.facility_id, 'receipt', to_char(now() at time zone 'Africa/Nairobi', 'YYYY'))::text, 6, '0'),
          v_kind, v_method, (p ->> 'amount')::numeric, v_ref, nullif(trim(p ->> 'payer_name'), ''), nullif(trim(p ->> 'note'), ''), v_staff)
  returning id into v_id;
  perform public.edoshmis_audit(a.organization_id, a.facility_id, 'billing.payment', 'payment', v_id::text, a.patient_id, null, p);
  return v_id;
exception when unique_violation then
  raise exception 'That M-Pesa code has already been recorded at this facility.';
end $$;

-- A dispense posts its medication charge when the drug has a price.
create or replace function public.edoshmis_charge_dispense()
returns trigger language plpgsql security definer set search_path = '' as $$
declare mo public.edoshmis_medication_orders; v_tariff uuid; v_acct uuid;
begin
  select * into mo from public.edoshmis_medication_orders where id = new.order_id;
  select tariff_id into v_tariff from public.edoshmis_drugs where id = mo.drug_id;
  if v_tariff is null then return new; end if;
  select id into v_acct from public.edoshmis_billing_accounts where admission_id = new.admission_id and status = 'open';
  if v_acct is null then return new; end if;
  perform public.edoshmis_post_keyed_charge(v_acct, v_tariff, mo.drug_name, (new.dispensed_at at time zone 'Africa/Nairobi')::date,
    new.quantity, null, 'dispense:' || new.id::text, 'dispense', new.id, new.dispensed_by);
  return new;
end $$;
drop trigger if exists edoshmis_medication_dispenses_charge on public.edoshmis_medication_dispenses;
create trigger edoshmis_medication_dispenses_charge after insert on public.edoshmis_medication_dispenses for each row execute function public.edoshmis_charge_dispense();

-- Charges and payments are never edited or deleted.
drop trigger if exists edoshmis_charges_append_only on public.edoshmis_charges;
create trigger edoshmis_charges_append_only before update or delete on public.edoshmis_charges for each row execute function public.edoshmis_append_only();
create or replace function public.edoshmis_payment_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Payments are never deleted. Void it with a reason.'; end if;
  if (to_jsonb(new) - array['voided_at', 'voided_by', 'void_reason']) is distinct from (to_jsonb(old) - array['voided_at', 'voided_by', 'void_reason']) then
    raise exception 'A payment is never edited. Void it with a reason and record it again.';
  end if;
  return new;
end $$;
drop trigger if exists edoshmis_payments_guard on public.edoshmis_payments;
create trigger edoshmis_payments_guard before update or delete on public.edoshmis_payments for each row execute function public.edoshmis_payment_guard();

create or replace function public.edoshmis_void_payment(p_payment uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare py public.edoshmis_payments; v_staff uuid;
begin
  select * into py from public.edoshmis_payments where id = p_payment for update;
  if not found or py.voided_at is not null then raise exception 'Payment not found or already voided.'; end if;
  v_staff := public.edoshmis_require(py.facility_id, 'billing.adjust');
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason.'; end if;
  update public.edoshmis_payments set voided_at = now(), voided_by = v_staff, void_reason = trim(p_reason) where id = p_payment;
  perform public.edoshmis_audit(public.edoshmis_facility_org(py.facility_id), py.facility_id, 'billing.payment_voided', 'payment', p_payment::text, py.patient_id, to_jsonb(py), null, p_reason);
end $$;

-- ---------------------------------------------------------------- RLS

alter table public.edoshmis_billing_accounts enable row level security;
alter table public.edoshmis_charges enable row level security;
alter table public.edoshmis_payments enable row level security;

-- Billing is visible to billing staff and to whoever authorises discharge
-- (the outstanding balance is part of that decision) — never the reverse:
-- a cashier gets no clinical note from any of this.
do $$ declare t text; begin
  foreach t in array array['edoshmis_billing_accounts', 'edoshmis_charges', 'edoshmis_payments'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.edoshmis_has_perm(facility_id, ''billing.read'') or public.edoshmis_has_perm(facility_id, ''discharge.authorize''))', t || '_read', t);
  end loop;
end $$;

revoke all on function public.edoshmis_post_keyed_charge(uuid, uuid, text, date, numeric, numeric, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.edoshmis_open_billing_account(uuid) from public, anon, authenticated;
