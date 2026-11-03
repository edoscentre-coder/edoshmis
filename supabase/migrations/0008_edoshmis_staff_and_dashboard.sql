-- EDOSHMIS 0008 — staff onboarding and the dashboard in one round trip.

-- Find a sign-in by email. edos_db's auth.users is shared by every EDOS
-- product, so a nurse who already uses another EDOS app keeps one login.
-- Only callers who may add staff (or EDOS Centre) can ask.
create or replace function public.edoshmis_auth_user_by_email(p_email text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  if not (public.edoshmis_is_platform_admin() or exists (
      select 1 from public.edoshmis_staff s join public.edoshmis_staff_roles sr on sr.staff_id = s.id
      join public.edoshmis_roles r on r.id = sr.role_id
      where s.user_id = auth.uid() and s.status = 'active' and 'admin.staff' = any (r.permissions))) then
    raise exception 'You do not have permission to add staff.' using errcode = '42501';
  end if;
  select id into v from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  return v;
end $$;

-- Add (or re-activate) a staff member with their roles and wards.
create or replace function public.edoshmis_add_staff(p_org uuid, p_user uuid, s jsonb, p_roles text[], p_facility uuid default null, p_wards uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_me uuid; v_id uuid;
begin
  if not public.edoshmis_has_org_perm(p_org, 'admin.staff') then raise exception 'You do not have permission to add staff.' using errcode = '42501'; end if;
  v_me := public.edoshmis_staff_id(p_org);
  if p_facility is not null and public.edoshmis_facility_org(p_facility) <> p_org then raise exception 'Facility not found.'; end if;
  if coalesce(cardinality(p_roles), 0) = 0 then raise exception 'Give the staff member at least one role.'; end if;
  insert into public.edoshmis_staff (organization_id, user_id, staff_number, full_name, designation, regulator, registration_number, registration_expiry, phone, email)
  values (p_org, p_user, nullif(trim(s ->> 'staff_number'), ''), trim(s ->> 'full_name'), (s ->> 'designation')::public.edoshmis_designation,
          nullif(trim(s ->> 'regulator'), ''), nullif(trim(s ->> 'registration_number'), ''), nullif(s ->> 'registration_expiry', '')::date,
          nullif(trim(s ->> 'phone'), ''), nullif(trim(s ->> 'email'), ''))
  on conflict (organization_id, user_id) do update set status = 'active', full_name = excluded.full_name, designation = excluded.designation
  returning id into v_id;
  insert into public.edoshmis_staff_roles (staff_id, role_id, facility_id, granted_by)
  select v_id, r.id, p_facility, v_me from public.edoshmis_roles r where r.organization_id = p_org and r.code = any (p_roles)
  on conflict do nothing;
  insert into public.edoshmis_staff_wards (staff_id, ward_id)
  select v_id, w from unnest(coalesce(p_wards, '{}')) w
  where exists (select 1 from public.edoshmis_wards x where x.id = w and public.edoshmis_facility_org(x.facility_id) = p_org)
  on conflict do nothing;
  return v_id;
end $$;

-- Everything the dashboard shows, counted in the database. Each section is
-- returned only when the caller's permissions cover it; a cashier gets the
-- money, a nurse the ward, nobody gets a number they could not drill into.
create or replace function public.edoshmis_dashboard(p_facility uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  out jsonb := '{}'::jsonb;
  v_org uuid := public.edoshmis_facility_org(p_facility);
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  if not public.edoshmis_is_member(v_org) then raise exception 'Not your facility.' using errcode = '42501'; end if;

  if public.edoshmis_has_perm(p_facility, 'ipd.read') or public.edoshmis_has_perm(p_facility, 'reports.read') then
    out := out || jsonb_build_object(
      'beds', (select jsonb_build_object(
          'total', count(*) filter (where is_active),
          'available', count(*) filter (where is_active and status = 'available'),
          'occupied', count(*) filter (where status = 'occupied'),
          'reserved', count(*) filter (where status = 'reserved'),
          'cleaning', count(*) filter (where status = 'cleaning'),
          'out_of_service', count(*) filter (where is_active and status in ('maintenance', 'blocked')))
        from public.edoshmis_beds where facility_id = p_facility),
      'census', (select count(*) from public.edoshmis_admissions where facility_id = p_facility and status in ('active', 'discharge_in_progress')),
      'admitted_today', (select count(*) from public.edoshmis_admissions where facility_id = p_facility and (admitted_at at time zone 'Africa/Nairobi')::date = v_today),
      'discharged_today', (select count(*) from public.edoshmis_admissions where facility_id = p_facility and (discharged_at at time zone 'Africa/Nairobi')::date = v_today),
      'pending_requests', (select count(*) filter (where status = 'pending') from public.edoshmis_admission_requests where facility_id = p_facility),
      'awaiting_bed', (select count(*) filter (where status = 'approved') from public.edoshmis_admission_requests where facility_id = p_facility),
      'discharges_in_progress', (select count(*) from public.edoshmis_admissions where facility_id = p_facility and status = 'discharge_in_progress'),
      'expected_discharge_today', (select count(*) from public.edoshmis_admissions where facility_id = p_facility and status = 'active' and expected_discharge_date <= v_today),
      'open_escalations', (select jsonb_build_object(
          'high', count(*) filter (where level = 'high'), 'medium', count(*) filter (where level = 'medium'), 'low', count(*) filter (where level = 'low'))
        from public.edoshmis_escalations where facility_id = p_facility and status <> 'resolved'),
      'wards', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name, 'code', w.code, 'type', w.ward_type,
            'total', b.total, 'occupied', b.occupied, 'available', b.available) order by w.sort_order, w.name)
        from public.edoshmis_wards w
        left join lateral (select count(*) filter (where is_active) as total, count(*) filter (where status = 'occupied') as occupied,
                                  count(*) filter (where is_active and status = 'available') as available
                           from public.edoshmis_beds where ward_id = w.id) b on true
        where w.facility_id = p_facility and w.status <> 'closed'), '[]'::jsonb),
      'alos_30d', (select round(avg(extract(epoch from discharged_at - admitted_at) / 86400.0)::numeric, 1)
        from public.edoshmis_admissions where facility_id = p_facility and discharged_at > now() - interval '30 days'),
      'admissions_14d', coalesce((select jsonb_agg(jsonb_build_object('day', d::date, 'admitted', coalesce(a.n, 0), 'discharged', coalesce(x.n, 0)) order by d)
        from generate_series(v_today - 13, v_today, interval '1 day') d
        left join (select (admitted_at at time zone 'Africa/Nairobi')::date as day, count(*) n from public.edoshmis_admissions
                   where facility_id = p_facility and admitted_at > now() - interval '15 days' group by 1) a on a.day = d::date
        left join (select (discharged_at at time zone 'Africa/Nairobi')::date as day, count(*) n from public.edoshmis_admissions
                   where facility_id = p_facility and discharged_at > now() - interval '15 days' group by 1) x on x.day = d::date), '[]'::jsonb)
    );
  end if;

  if public.edoshmis_has_perm(p_facility, 'meds.verify') or public.edoshmis_has_perm(p_facility, 'meds.administer') then
    out := out || jsonb_build_object(
      'orders_to_verify', (select count(*) from public.edoshmis_medication_orders where facility_id = p_facility and status = 'prescribed'),
      'doses_overdue', (select count(*) from public.edoshmis_medication_administrations ma
                        join public.edoshmis_admissions a on a.id = ma.admission_id and a.status in ('active', 'discharge_in_progress')
                        where ma.facility_id = p_facility and ma.status = 'scheduled' and ma.scheduled_for < now() - interval '1 hour')
    );
  end if;

  if public.edoshmis_has_perm(p_facility, 'billing.read') then
    out := out || jsonb_build_object(
      'billing', (select jsonb_build_object(
          'open_accounts', count(*) filter (where b.status = 'open'),
          'outstanding', coalesce(sum(b.balance) filter (where b.balance > 0), 0),
          'collected_today', (select coalesce(sum(amount) filter (where kind <> 'refund'), 0) - coalesce(sum(amount) filter (where kind = 'refund'), 0)
                              from public.edoshmis_payments where facility_id = p_facility and voided_at is null
                                and (received_at at time zone 'Africa/Nairobi')::date = v_today))
        from public.edoshmis_account_balances b where b.facility_id = p_facility)
    );
  end if;

  if public.edoshmis_has_perm(p_facility, 'patients.read') then
    out := out || jsonb_build_object(
      'patients_total', (select count(*) from public.edoshmis_patients where organization_id = v_org and deleted_at is null),
      'registered_today', (select count(*) from public.edoshmis_patients where organization_id = v_org and (created_at at time zone 'Africa/Nairobi')::date = v_today)
    );
  end if;
  return out;
end $$;
