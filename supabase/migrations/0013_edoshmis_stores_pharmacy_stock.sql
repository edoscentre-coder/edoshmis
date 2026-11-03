-- EDOSHMIS 0013 — stores and pharmacy stock: items, stores, suppliers,
-- purchase orders, goods received (batches with expiry), requisitions,
-- transfers, issues and adjustments — all through one append-only ledger.
--
-- Stock leaves a store first-expiry-first-out (FEFO): the batch that
-- expires soonest goes first, and an expired batch never leaves except as
-- a write-off. Dispensing a drug that is linked to a stock item takes it
-- from the facility's dispensing store automatically.

insert into public.edoshmis_permission_catalog (key, area, label) values
  ('stores.read', 'Stores', 'See stock levels, batches and movements'),
  ('stores.receive', 'Stores', 'Receive goods against purchase orders'),
  ('stores.issue', 'Stores', 'Issue and transfer stock, fulfil requisitions'),
  ('stores.adjust', 'Stores', 'Adjust stock and write off expired or damaged stock'),
  ('stores.requisition', 'Stores', 'Requisition stock for a department or ward'),
  ('procurement.order', 'Procurement', 'Raise purchase orders, manage suppliers'),
  ('procurement.approve', 'Procurement', 'Approve purchase orders'),
  ('stores.configure', 'Stores', 'Set up stores and stock items')
on conflict (key) do update set area = excluded.area, label = excluded.label;

select public.edoshmis_add_role_default('storekeeper', 'Storekeeper', 'Receives, issues and counts stock.', array['stores.read', 'stores.receive', 'stores.issue', 'stores.adjust', 'stores.configure'], true);
select public.edoshmis_add_role_default('procurement_officer', 'Procurement officer', 'Suppliers and purchase orders.', array['stores.read', 'procurement.order'], true);
select public.edoshmis_add_role_default('pharmacist', 'Pharmacist', null, array['stores.read', 'stores.receive', 'stores.issue', 'stores.adjust', 'stores.requisition', 'stores.configure']);
select public.edoshmis_add_role_default('accountant', 'Accountant', null, array['stores.read', 'procurement.approve']);
select public.edoshmis_add_role_default('hospital_admin', 'Hospital administrator', null, array['stores.read', 'stores.configure', 'procurement.approve']);
select public.edoshmis_add_role_default('ward_manager', 'Ward manager', null, array['stores.read', 'stores.requisition']);
select public.edoshmis_add_role_default('nursing_officer', 'Nursing officer', null, array['stores.read', 'stores.requisition']);

create table if not exists public.edoshmis_stores (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  name text not null,
  code text not null check (code ~ '^[A-Z0-9][A-Z0-9-]{1,15}$'),
  kind text not null check (kind in ('main_store', 'pharmacy', 'ward', 'theatre', 'laboratory', 'other')),
  ward_id uuid references public.edoshmis_wards (id),
  -- The store dispensing draws from (one per facility).
  is_dispensing boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (facility_id, code)
);
create unique index if not exists edoshmis_stores_one_dispensing on public.edoshmis_stores (facility_id) where is_dispensing and is_active;

create table if not exists public.edoshmis_stock_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id),
  code text not null,
  name text not null,
  category text not null check (category in ('drug', 'consumable', 'reagent', 'surgical', 'linen', 'equipment', 'stationery', 'other')),
  unit text not null,
  drug_id uuid unique references public.edoshmis_drugs (id),
  is_controlled boolean not null default false,
  reorder_level numeric(12, 2) not null default 0 check (reorder_level >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table if not exists public.edoshmis_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.edoshmis_organizations (id),
  name text not null,
  kra_pin text,
  phone text,
  email text,
  address text,
  payment_terms text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.edoshmis_stock_batches (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.edoshmis_stores (id),
  item_id uuid not null references public.edoshmis_stock_items (id),
  batch_number text not null,
  expiry_date date,
  unit_cost numeric(12, 2) not null default 0 check (unit_cost >= 0),
  quantity numeric(12, 2) not null default 0 check (quantity >= 0),
  supplier_id uuid references public.edoshmis_suppliers (id),
  received_at timestamptz not null default now(),
  unique (store_id, item_id, batch_number, expiry_date)
);
create index if not exists edoshmis_stock_batches_fefo_idx on public.edoshmis_stock_batches (store_id, item_id, expiry_date nulls last) where quantity > 0;

-- Every change to a batch quantity, signed: + in, − out. The controlled-drug
-- register is this ledger filtered to controlled items.
create table if not exists public.edoshmis_stock_movements (
  id bigint generated always as identity primary key,
  facility_id uuid not null references public.edoshmis_facilities (id),
  store_id uuid not null references public.edoshmis_stores (id),
  item_id uuid not null references public.edoshmis_stock_items (id),
  batch_id uuid not null references public.edoshmis_stock_batches (id),
  quantity numeric(12, 2) not null check (quantity <> 0),
  balance_after numeric(12, 2) not null,
  kind text not null check (kind in ('receipt', 'issue', 'transfer_out', 'transfer_in', 'dispense', 'adjustment', 'write_off', 'return')),
  reference_type text,
  reference_id uuid,
  patient_id uuid references public.edoshmis_patients (id),
  reason text,
  staff_id uuid references public.edoshmis_staff (id),
  witness_id uuid references public.edoshmis_staff (id),
  created_at timestamptz not null default now()
);
create index if not exists edoshmis_stock_movements_item_idx on public.edoshmis_stock_movements (store_id, item_id, created_at desc);

create table if not exists public.edoshmis_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  supplier_id uuid not null references public.edoshmis_suppliers (id),
  store_id uuid not null references public.edoshmis_stores (id),
  po_number text not null,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled')),
  notes text,
  raised_by uuid not null references public.edoshmis_staff (id),
  raised_at timestamptz not null default now(),
  approved_by uuid references public.edoshmis_staff (id),
  approved_at timestamptz,
  cancel_reason text,
  unique (facility_id, po_number)
);

create table if not exists public.edoshmis_purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.edoshmis_purchase_orders (id) on delete cascade,
  item_id uuid not null references public.edoshmis_stock_items (id),
  quantity numeric(12, 2) not null check (quantity > 0),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  received_quantity numeric(12, 2) not null default 0,
  unique (po_id, item_id)
);

create table if not exists public.edoshmis_requisitions (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.edoshmis_facilities (id),
  from_store_id uuid not null references public.edoshmis_stores (id),
  to_store_id uuid not null references public.edoshmis_stores (id),
  requisition_number text not null,
  status text not null default 'requested' check (status in ('requested', 'fulfilled', 'partially_fulfilled', 'rejected', 'cancelled')),
  requested_by uuid not null references public.edoshmis_staff (id),
  requested_at timestamptz not null default now(),
  fulfilled_by uuid references public.edoshmis_staff (id),
  fulfilled_at timestamptz,
  note text,
  unique (facility_id, requisition_number),
  check (from_store_id <> to_store_id)
);

create table if not exists public.edoshmis_requisition_lines (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.edoshmis_requisitions (id) on delete cascade,
  item_id uuid not null references public.edoshmis_stock_items (id),
  quantity numeric(12, 2) not null check (quantity > 0),
  issued_quantity numeric(12, 2) not null default 0,
  unique (requisition_id, item_id)
);

-- On-hand per store and item, and what is about to expire.
create or replace view public.edoshmis_stock_levels with (security_invoker = true) as
select b.store_id, s.facility_id, b.item_id, i.name as item_name, i.unit, i.category, i.is_controlled, i.reorder_level,
       sum(b.quantity) as on_hand,
       sum(b.quantity) filter (where b.expiry_date is not null and b.expiry_date < (now() at time zone 'Africa/Nairobi')::date) as expired,
       min(b.expiry_date) filter (where b.quantity > 0 and (b.expiry_date is null or b.expiry_date >= (now() at time zone 'Africa/Nairobi')::date)) as next_expiry,
       sum(b.quantity * b.unit_cost) as value
from public.edoshmis_stock_batches b
join public.edoshmis_stores s on s.id = b.store_id
join public.edoshmis_stock_items i on i.id = b.item_id
group by b.store_id, s.facility_id, b.item_id, i.name, i.unit, i.category, i.is_controlled, i.reorder_level;

-- ---------------------------------------------------------------- ledger core

-- Move stock on one batch and write the ledger row. Internal.
create or replace function public.edoshmis_stock_move(p_batch uuid, p_qty numeric, p_kind text, p_ref_type text, p_ref uuid, p_patient uuid, p_reason text, p_staff uuid, p_witness uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.edoshmis_stock_batches; v_fac uuid;
begin
  select * into b from public.edoshmis_stock_batches where id = p_batch for update;
  if b.quantity + p_qty < 0 then raise exception 'Not enough stock in batch % (has %).', b.batch_number, b.quantity; end if;
  update public.edoshmis_stock_batches set quantity = quantity + p_qty where id = p_batch;
  select facility_id into v_fac from public.edoshmis_stores where id = b.store_id;
  insert into public.edoshmis_stock_movements (facility_id, store_id, item_id, batch_id, quantity, balance_after, kind, reference_type, reference_id, patient_id, reason, staff_id, witness_id)
  values (v_fac, b.store_id, b.item_id, p_batch, p_qty, b.quantity + p_qty, p_kind, p_ref_type, p_ref, p_patient, p_reason, p_staff, p_witness);
end $$;

-- Take p_qty of an item out of a store, FEFO across unexpired batches.
-- Returns the batches used as [{batch_id, batch_number, expiry_date, quantity}].
create or replace function public.edoshmis_stock_take_fefo(p_store uuid, p_item uuid, p_qty numeric, p_kind text, p_ref_type text, p_ref uuid, p_patient uuid, p_reason text, p_staff uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare left_ numeric := p_qty; b record; take numeric; used jsonb := '[]'::jsonb; v_today date := (now() at time zone 'Africa/Nairobi')::date; v_avail numeric;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be more than zero.'; end if;
  select coalesce(sum(quantity), 0) into v_avail from public.edoshmis_stock_batches
  where store_id = p_store and item_id = p_item and quantity > 0 and (expiry_date is null or expiry_date >= v_today);
  if v_avail < p_qty then
    raise exception 'Only % in stock (unexpired) — % needed.', v_avail, p_qty using hint = 'stock';
  end if;
  for b in select id, batch_number, expiry_date, quantity from public.edoshmis_stock_batches
           where store_id = p_store and item_id = p_item and quantity > 0 and (expiry_date is null or expiry_date >= v_today)
           order by expiry_date nulls last, received_at for update loop
    exit when left_ <= 0;
    take := least(b.quantity, left_);
    perform public.edoshmis_stock_move(b.id, -take, p_kind, p_ref_type, p_ref, p_patient, p_reason, p_staff);
    used := used || jsonb_build_object('batch_id', b.id, 'batch_number', b.batch_number, 'expiry_date', b.expiry_date, 'quantity', take);
    left_ := left_ - take;
  end loop;
  return used;
end $$;

revoke all on function public.edoshmis_stock_move(uuid, numeric, text, text, uuid, uuid, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.edoshmis_stock_take_fefo(uuid, uuid, numeric, text, text, uuid, uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- procurement

create or replace function public.edoshmis_create_po(p_facility uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_staff uuid := public.edoshmis_require(p_facility, 'procurement.order'); v_id uuid; v_code text; v_year text; l record; n int := 0;
begin
  select code into v_code from public.edoshmis_facilities where id = p_facility;
  v_year := to_char(now() at time zone 'Africa/Nairobi', 'YYYY');
  insert into public.edoshmis_purchase_orders (facility_id, supplier_id, store_id, po_number, status, notes, raised_by)
  values (p_facility, (p ->> 'supplier_id')::uuid, (p ->> 'store_id')::uuid,
          v_code || '/PO/' || v_year || '/' || lpad(public.edoshmis_next_number(p_facility, 'po', v_year)::text, 5, '0'), 'submitted', nullif(trim(p ->> 'notes'), ''), v_staff)
  returning id into v_id;
  for l in select * from jsonb_to_recordset(coalesce(p -> 'lines', '[]'::jsonb)) as t (item_id uuid, quantity numeric, unit_cost numeric) where t.quantity > 0 loop
    insert into public.edoshmis_purchase_order_lines (po_id, item_id, quantity, unit_cost) values (v_id, l.item_id, l.quantity, coalesce(l.unit_cost, 0));
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Add at least one item.'; end if;
  perform public.edoshmis_audit(public.edoshmis_facility_org(p_facility), p_facility, 'procurement.po_raised', 'purchase_order', v_id::text, null, null, p);
  return v_id;
end $$;

create or replace function public.edoshmis_decide_po(p_po uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare po public.edoshmis_purchase_orders; v_staff uuid;
begin
  select * into po from public.edoshmis_purchase_orders where id = p_po for update;
  if not found then raise exception 'Purchase order not found.'; end if;
  v_staff := public.edoshmis_require(po.facility_id, 'procurement.approve');
  if po.status <> 'submitted' then raise exception 'This order is already %.', po.status; end if;
  if po.raised_by = v_staff then raise exception 'Someone other than the person who raised it must approve a purchase order.'; end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason.'; end if;
  update public.edoshmis_purchase_orders set status = case when p_approve then 'approved' else 'cancelled' end,
    approved_by = case when p_approve then v_staff end, approved_at = case when p_approve then now() end, cancel_reason = case when p_approve then null else trim(p_reason) end
  where id = p_po;
  perform public.edoshmis_audit(public.edoshmis_facility_org(po.facility_id), po.facility_id, case when p_approve then 'procurement.po_approved' else 'procurement.po_rejected' end, 'purchase_order', p_po::text, null, null, null, p_reason);
end $$;

-- Goods received: lines [{line_id, quantity, batch_number, expiry_date, unit_cost}]
create or replace function public.edoshmis_receive_goods(p_po uuid, r jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare po public.edoshmis_purchase_orders; v_staff uuid; l record; pl public.edoshmis_purchase_order_lines; v_batch uuid; n int := 0;
begin
  select * into po from public.edoshmis_purchase_orders where id = p_po for update;
  if not found then raise exception 'Purchase order not found.'; end if;
  v_staff := public.edoshmis_require(po.facility_id, 'stores.receive');
  if po.status not in ('approved', 'partially_received') then raise exception 'Only an approved order can be received (this one is %).', po.status; end if;
  for l in select * from jsonb_to_recordset(r) as t (line_id uuid, quantity numeric, batch_number text, expiry_date date, unit_cost numeric) where t.quantity > 0 loop
    select * into pl from public.edoshmis_purchase_order_lines where id = l.line_id and po_id = p_po for update;
    if not found then raise exception 'Line not on this order.'; end if;
    if pl.received_quantity + l.quantity > pl.quantity then raise exception 'More received than ordered for one line (% of %).', pl.received_quantity + l.quantity, pl.quantity; end if;
    if coalesce(trim(l.batch_number), '') = '' then raise exception 'Enter the batch number for every line received.'; end if;
    if l.expiry_date is not null and l.expiry_date <= (now() at time zone 'Africa/Nairobi')::date then raise exception 'Batch % has already expired; do not receive it.', l.batch_number; end if;
    insert into public.edoshmis_stock_batches (store_id, item_id, batch_number, expiry_date, unit_cost, quantity, supplier_id)
    values (po.store_id, pl.item_id, trim(l.batch_number), l.expiry_date, coalesce(l.unit_cost, pl.unit_cost), 0, po.supplier_id)
    on conflict (store_id, item_id, batch_number, expiry_date) do update set unit_cost = excluded.unit_cost
    returning id into v_batch;
    perform public.edoshmis_stock_move(v_batch, l.quantity, 'receipt', 'purchase_order', p_po, null, null, v_staff);
    update public.edoshmis_purchase_order_lines set received_quantity = received_quantity + l.quantity where id = pl.id;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Enter what was received.'; end if;
  update public.edoshmis_purchase_orders set status = case when exists (select 1 from public.edoshmis_purchase_order_lines where po_id = p_po and received_quantity < quantity)
    then 'partially_received' else 'received' end where id = p_po;
  perform public.edoshmis_audit(public.edoshmis_facility_org(po.facility_id), po.facility_id, 'stores.goods_received', 'purchase_order', p_po::text, null, null, r);
end $$;

-- ---------------------------------------------------------------- requisitions, transfers, adjustments

create or replace function public.edoshmis_requisition(p_facility uuid, r jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_staff uuid := public.edoshmis_require(p_facility, 'stores.requisition'); v_id uuid; v_code text; l record; n int := 0;
begin
  select code into v_code from public.edoshmis_facilities where id = p_facility;
  insert into public.edoshmis_requisitions (facility_id, from_store_id, to_store_id, requisition_number, requested_by, note)
  values (p_facility, (r ->> 'from_store_id')::uuid, (r ->> 'to_store_id')::uuid,
          v_code || '/REQ/' || lpad(public.edoshmis_next_number(p_facility, 'requisition', to_char(now() at time zone 'Africa/Nairobi', 'YYYY'))::text, 6, '0'), v_staff, nullif(trim(r ->> 'note'), ''))
  returning id into v_id;
  for l in select * from jsonb_to_recordset(coalesce(r -> 'lines', '[]'::jsonb)) as t (item_id uuid, quantity numeric) where t.quantity > 0 loop
    insert into public.edoshmis_requisition_lines (requisition_id, item_id, quantity) values (v_id, l.item_id, l.quantity);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Add at least one item.'; end if;
  return v_id;
end $$;

-- Fulfil a requisition: FEFO out of the issuing store, the same batches into the receiving one.
create or replace function public.edoshmis_fulfil_requisition(p_req uuid, p_lines jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare rq public.edoshmis_requisitions; v_staff uuid; l record; give numeric; used jsonb; u record; v_batch uuid; src public.edoshmis_stock_batches;
begin
  select * into rq from public.edoshmis_requisitions where id = p_req for update;
  if not found then raise exception 'Requisition not found.'; end if;
  v_staff := public.edoshmis_require(rq.facility_id, 'stores.issue');
  if rq.status not in ('requested', 'partially_fulfilled') then raise exception 'This requisition is already %.', rq.status; end if;
  for l in select rl.* from public.edoshmis_requisition_lines rl where rl.requisition_id = p_req and rl.issued_quantity < rl.quantity loop
    give := coalesce((select (x ->> 'quantity')::numeric from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x where (x ->> 'line_id')::uuid = l.id), l.quantity - l.issued_quantity);
    continue when give <= 0;
    used := public.edoshmis_stock_take_fefo(rq.from_store_id, l.item_id, give, 'transfer_out', 'requisition', p_req, null, null, v_staff);
    for u in select * from jsonb_to_recordset(used) as t (batch_id uuid, quantity numeric) loop
      select * into src from public.edoshmis_stock_batches where id = u.batch_id;
      insert into public.edoshmis_stock_batches (store_id, item_id, batch_number, expiry_date, unit_cost, quantity, supplier_id)
      values (rq.to_store_id, src.item_id, src.batch_number, src.expiry_date, src.unit_cost, 0, src.supplier_id)
      on conflict (store_id, item_id, batch_number, expiry_date) do nothing;
      select id into v_batch from public.edoshmis_stock_batches where store_id = rq.to_store_id and item_id = src.item_id and batch_number = src.batch_number and expiry_date is not distinct from src.expiry_date;
      perform public.edoshmis_stock_move(v_batch, u.quantity, 'transfer_in', 'requisition', p_req, null, null, v_staff);
    end loop;
    update public.edoshmis_requisition_lines set issued_quantity = issued_quantity + give where id = l.id;
  end loop;
  update public.edoshmis_requisitions set fulfilled_by = v_staff, fulfilled_at = now(),
    status = case when exists (select 1 from public.edoshmis_requisition_lines where requisition_id = p_req and issued_quantity < quantity) then 'partially_fulfilled' else 'fulfilled' end
  where id = p_req;
  perform public.edoshmis_audit(public.edoshmis_facility_org(rq.facility_id), rq.facility_id, 'stores.requisition_fulfilled', 'requisition', p_req::text);
end $$;

-- Count correction or write-off on one batch, always with a reason;
-- controlled items need a witness.
create or replace function public.edoshmis_adjust_stock(p_batch uuid, p_qty numeric, p_kind text, p_reason text, p_witness uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.edoshmis_stock_batches; v_fac uuid; v_staff uuid; v_controlled boolean;
begin
  select * into b from public.edoshmis_stock_batches where id = p_batch;
  if not found then raise exception 'Batch not found.'; end if;
  select facility_id into v_fac from public.edoshmis_stores where id = b.store_id;
  v_staff := public.edoshmis_require(v_fac, 'stores.adjust');
  if p_kind not in ('adjustment', 'write_off', 'return') then raise exception 'Unknown adjustment.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason (count difference, expired, damaged…).'; end if;
  if p_kind in ('write_off', 'return') and p_qty > 0 then raise exception 'A write-off or return takes stock out (use a negative quantity).'; end if;
  select is_controlled into v_controlled from public.edoshmis_stock_items where id = b.item_id;
  if v_controlled and (p_witness is null or p_witness = v_staff) then raise exception 'A controlled item needs a second staff member as witness.'; end if;
  perform public.edoshmis_stock_move(p_batch, p_qty, p_kind, 'adjustment', null, null, trim(p_reason), v_staff, case when v_controlled then p_witness end);
  perform public.edoshmis_audit(public.edoshmis_facility_org(v_fac), v_fac, 'stores.' || p_kind, 'stock_batch', p_batch::text, null, null, jsonb_build_object('quantity', p_qty), p_reason);
end $$;

-- Opening balance when a store first starts using the system.
create or replace function public.edoshmis_opening_stock(p_store uuid, p_item uuid, p_batch text, p_expiry date, p_qty numeric, p_cost numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_fac uuid; v_staff uuid; v_batch uuid;
begin
  select facility_id into v_fac from public.edoshmis_stores where id = p_store;
  v_staff := public.edoshmis_require(v_fac, 'stores.adjust');
  if p_qty is null or p_qty <= 0 then raise exception 'Enter the quantity counted.'; end if;
  if coalesce(trim(p_batch), '') = '' then raise exception 'Enter the batch number.'; end if;
  insert into public.edoshmis_stock_batches (store_id, item_id, batch_number, expiry_date, unit_cost, quantity)
  values (p_store, p_item, trim(p_batch), p_expiry, coalesce(p_cost, 0), 0)
  on conflict (store_id, item_id, batch_number, expiry_date) do nothing;
  select id into v_batch from public.edoshmis_stock_batches where store_id = p_store and item_id = p_item and batch_number = trim(p_batch) and expiry_date is not distinct from p_expiry;
  perform public.edoshmis_stock_move(v_batch, p_qty, 'adjustment', 'opening_balance', null, null, 'Opening balance', v_staff);
end $$;

-- ---------------------------------------------------------------- dispensing draws stock

-- When a dispensed drug is linked to a stock item and the facility has a
-- dispensing store, take it FEFO. Without that set-up nothing is deducted
-- (stock is not tracked for it yet). Not enough unexpired stock stops the dispense.
create or replace function public.edoshmis_dispense_from_stock(p_facility uuid, p_drug uuid, p_qty numeric, p_ref_type text, p_ref uuid, p_patient uuid, p_staff uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item uuid; v_store uuid;
begin
  if p_drug is null then return null; end if;
  select id into v_item from public.edoshmis_stock_items where drug_id = p_drug and is_active;
  select id into v_store from public.edoshmis_stores where facility_id = p_facility and is_dispensing and is_active;
  if v_item is null or v_store is null then return null; end if;
  return public.edoshmis_stock_take_fefo(v_store, v_item, p_qty, 'dispense', p_ref_type, p_ref, p_patient, null, p_staff);
end $$;
revoke all on function public.edoshmis_dispense_from_stock(uuid, uuid, numeric, text, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.edoshmis_ip_dispense_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare mo public.edoshmis_medication_orders; used jsonb;
begin
  select * into mo from public.edoshmis_medication_orders where id = new.order_id;
  used := public.edoshmis_dispense_from_stock(new.facility_id, mo.drug_id, new.quantity, 'medication_dispense', new.id, mo.patient_id, new.dispensed_by);
  if used is not null and new.batch_number is null then
    new.batch_number := (select string_agg(x ->> 'batch_number', ', ') from jsonb_array_elements(used) x);
    new.expiry_date := (select min((x ->> 'expiry_date')::date) from jsonb_array_elements(used) x);
  end if;
  return new;
end $$;
drop trigger if exists edoshmis_medication_dispenses_stock on public.edoshmis_medication_dispenses;
create trigger edoshmis_medication_dispenses_stock before insert on public.edoshmis_medication_dispenses for each row execute function public.edoshmis_ip_dispense_stock();

create or replace function public.edoshmis_op_dispense_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare used jsonb;
begin
  if new.status = 'dispensed' and old.status = 'prescribed' then
    used := public.edoshmis_dispense_from_stock(new.facility_id, new.drug_id, coalesce(new.dispensed_quantity, new.quantity), 'outpatient_dispense', new.id, new.patient_id, new.dispensed_by);
    if used is not null and new.batch_number is null then
      new.batch_number := (select string_agg(x ->> 'batch_number', ', ') from jsonb_array_elements(used) x);
      new.expiry_date := (select min((x ->> 'expiry_date')::date) from jsonb_array_elements(used) x);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists edoshmis_outpatient_prescriptions_stock on public.edoshmis_outpatient_prescriptions;
create trigger edoshmis_outpatient_prescriptions_stock before update on public.edoshmis_outpatient_prescriptions for each row execute function public.edoshmis_op_dispense_stock();

-- ---------------------------------------------------------------- guards, audit, RLS

drop trigger if exists edoshmis_stock_movements_append_only on public.edoshmis_stock_movements;
create trigger edoshmis_stock_movements_append_only before update or delete on public.edoshmis_stock_movements for each row execute function public.edoshmis_append_only();
create or replace function public.edoshmis_batch_guard()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then raise exception 'Stock changes go through receipts, issues and adjustments.'; end if;
  return coalesce(new, old);
end $$;
drop trigger if exists edoshmis_stock_batches_guard on public.edoshmis_stock_batches;
create trigger edoshmis_stock_batches_guard before insert or update or delete on public.edoshmis_stock_batches for each row execute function public.edoshmis_batch_guard();

do $$ declare t text; begin
  foreach t in array array['edoshmis_stores', 'edoshmis_stock_items', 'edoshmis_suppliers', 'edoshmis_purchase_orders'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.edoshmis_audit_trigger()', t || '_audit', t);
  end loop;
end $$;

alter table public.edoshmis_stores enable row level security;
alter table public.edoshmis_stock_items enable row level security;
alter table public.edoshmis_suppliers enable row level security;
alter table public.edoshmis_stock_batches enable row level security;
alter table public.edoshmis_stock_movements enable row level security;
alter table public.edoshmis_purchase_orders enable row level security;
alter table public.edoshmis_purchase_order_lines enable row level security;
alter table public.edoshmis_requisitions enable row level security;
alter table public.edoshmis_requisition_lines enable row level security;

drop policy if exists edoshmis_stores_read on public.edoshmis_stores;
create policy edoshmis_stores_read on public.edoshmis_stores for select to authenticated using (public.edoshmis_is_member(public.edoshmis_facility_org(facility_id)));
drop policy if exists edoshmis_stores_write on public.edoshmis_stores;
create policy edoshmis_stores_write on public.edoshmis_stores for all to authenticated
  using (public.edoshmis_has_perm(facility_id, 'stores.configure')) with check (public.edoshmis_has_perm(facility_id, 'stores.configure'));
drop policy if exists edoshmis_stock_items_read on public.edoshmis_stock_items;
create policy edoshmis_stock_items_read on public.edoshmis_stock_items for select to authenticated using (public.edoshmis_is_member(organization_id));
drop policy if exists edoshmis_stock_items_write on public.edoshmis_stock_items;
create policy edoshmis_stock_items_write on public.edoshmis_stock_items for all to authenticated
  using (public.edoshmis_has_org_perm(organization_id, 'stores.configure')) with check (public.edoshmis_has_org_perm(organization_id, 'stores.configure'));
drop policy if exists edoshmis_suppliers_read on public.edoshmis_suppliers;
create policy edoshmis_suppliers_read on public.edoshmis_suppliers for select to authenticated
  using (public.edoshmis_has_org_perm(organization_id, 'stores.read') or public.edoshmis_has_org_perm(organization_id, 'procurement.order'));
drop policy if exists edoshmis_suppliers_write on public.edoshmis_suppliers;
create policy edoshmis_suppliers_write on public.edoshmis_suppliers for all to authenticated
  using (public.edoshmis_has_org_perm(organization_id, 'procurement.order')) with check (public.edoshmis_has_org_perm(organization_id, 'procurement.order'));

drop policy if exists edoshmis_stock_batches_read on public.edoshmis_stock_batches;
create policy edoshmis_stock_batches_read on public.edoshmis_stock_batches for select to authenticated
  using (exists (select 1 from public.edoshmis_stores s where s.id = store_id and (public.edoshmis_has_perm(s.facility_id, 'stores.read') or public.edoshmis_has_perm(s.facility_id, 'meds.verify'))));
drop policy if exists edoshmis_stock_movements_read on public.edoshmis_stock_movements;
create policy edoshmis_stock_movements_read on public.edoshmis_stock_movements for select to authenticated using (public.edoshmis_has_perm(facility_id, 'stores.read'));
drop policy if exists edoshmis_purchase_orders_read on public.edoshmis_purchase_orders;
create policy edoshmis_purchase_orders_read on public.edoshmis_purchase_orders for select to authenticated
  using (public.edoshmis_has_perm(facility_id, 'stores.read') or public.edoshmis_has_perm(facility_id, 'procurement.order') or public.edoshmis_has_perm(facility_id, 'procurement.approve'));
drop policy if exists edoshmis_purchase_order_lines_read on public.edoshmis_purchase_order_lines;
create policy edoshmis_purchase_order_lines_read on public.edoshmis_purchase_order_lines for select to authenticated
  using (exists (select 1 from public.edoshmis_purchase_orders po where po.id = po_id));
drop policy if exists edoshmis_requisitions_read on public.edoshmis_requisitions;
create policy edoshmis_requisitions_read on public.edoshmis_requisitions for select to authenticated
  using (public.edoshmis_has_perm(facility_id, 'stores.read') or public.edoshmis_has_perm(facility_id, 'stores.requisition'));
drop policy if exists edoshmis_requisition_lines_read on public.edoshmis_requisition_lines;
create policy edoshmis_requisition_lines_read on public.edoshmis_requisition_lines for select to authenticated
  using (exists (select 1 from public.edoshmis_requisitions r where r.id = requisition_id));

select public.edoshmis_sync_all_roles();
