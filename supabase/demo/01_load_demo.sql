-- EDOSHMIS demo data — 3 sample patients at the Edoscentre facility, all
-- recorded by Val (the administrator), through every section of the system.
--
--   Amina Wekesa      outpatient: check-in, triage, consultation, diagnosis,
--                     lab (FBC), prescription dispensed from stock, paid by
--                     M-Pesa, sent home with a follow-up date.
--   Brian Otieno      inpatient, still admitted: from Emergency, approved,
--                     in bed DEMO-1 — ward round, nursing notes, observations
--                     with an early-warning escalation, eMAR, fluids, lab with
--                     a critical value, chest X-ray reported, a procedure,
--                     bed-days and a deposit.
--   Grace Njeri       inpatient, discharged: admitted, treated, discharge
--                     summary, every clearance, bill paid, bed released.
--
-- Everything is fictional. Every demo patient carries the alert
-- "DEMO RECORD" and an identifier EDOSHMIS-DEMO-n; every demo catalogue item
-- has a DEMO code. Remove it all with 02_remove_demo.sql.
--
-- The demo bands, ranges and prices below are SAMPLE values for showing the
-- screens, NOT clinical guidance — replace them with your own before use.
--
-- Needs migrations 0001–0013 applied. Run the whole file once, in the SQL
-- editor, with nothing selected. It refuses to run twice.

begin;

-- ---------------------------------------------------------------- prerequisites

do $$
begin
  if to_regclass('public.edoshmis_appointments') is null or to_regclass('public.edoshmis_lab_orders') is null
     or to_regclass('public.edoshmis_imaging_orders') is null or to_regclass('public.edoshmis_stock_batches') is null then
    raise exception 'Apply migrations 0010–0013 (and 0099) first: outpatients, laboratory, imaging and stores are not installed yet.';
  end if;
  if not exists (select 1 from public.edoshmis_facilities where code = 'EDO') then
    raise exception 'No facility with code EDO (Edoscentre) was found.';
  end if;
  if exists (select 1 from public.edoshmis_patient_identifiers where id_type = 'other' and value like 'EDOSHMIS-DEMO-%') then
    raise exception 'The demo is already loaded. Run 02_remove_demo.sql first if you want to load it again.';
  end if;
end $$;

-- What the demo adds outside patient records, so removal can take exactly that back.
create table if not exists public.edoshmis_demo_registry (
  kind text not null,
  ref_id uuid not null,
  primary key (kind, ref_id)
);
alter table public.edoshmis_demo_registry enable row level security;
revoke all on public.edoshmis_demo_registry from anon, authenticated;

-- ---------------------------------------------------------------- as the database owner: roles and catalogue

create temp table demo_ctx on commit drop as
select f.id as fac, f.organization_id as org, s.id as val, s.user_id as val_user
from public.edoshmis_facilities f
join public.edoshmis_staff s on s.organization_id = f.organization_id and s.status = 'active'
join auth.users u on u.id = s.user_id
where f.code = 'EDO' and (lower(u.email) = 'edoscentre@gmail.com' or s.full_name = 'Val')
order by (lower(u.email) = 'edoscentre@gmail.com') desc
limit 1;

do $$
declare c record; r record; v_id uuid;
begin
  select * into c from demo_ctx;
  if c.val is null then raise exception 'Could not find Val (the administrator, edoscentre@gmail.com) on the Edoscentre staff.'; end if;

  -- Val gets every working role, so each section can be shown and used.
  for r in select id, code from public.edoshmis_roles where organization_id = c.org
           and code in ('receptionist', 'nurse', 'ward_manager', 'medical_superintendent', 'consultant', 'pharmacist', 'cashier', 'accountant', 'lab_technologist', 'radiologist', 'storekeeper') loop
    insert into public.edoshmis_staff_roles (staff_id, role_id, facility_id, granted_by) values (c.val, r.id, null, c.val)
    on conflict do nothing returning id into v_id;
    if v_id is not null then insert into public.edoshmis_demo_registry values ('staff_role', v_id); end if;
    v_id := null;
  end loop;
end $$;

-- Catalogue (demo-coded). Prices in KSh are samples.
with t as (
  insert into public.edoshmis_tariffs (facility_id, code, name, category, unit, price, sha_price)
  select fac, x.code, x.name, x.cat, x.unit, x.price, x.sha from demo_ctx, (values
    ('DEMO-BED', 'General ward bed-day (demo)', 'bed', 'day', 2500, 2000),
    ('DEMO-CONS', 'Outpatient consultation (demo)', 'consultation', 'each', 1000, null),
    ('DEMO-ROUND', 'Consultant ward round (demo)', 'ward_round', 'each', 1500, null),
    ('DEMO-FBC', 'Full blood count (demo)', 'laboratory', 'each', 800, null),
    ('DEMO-CXR', 'Chest X-ray (demo)', 'radiology', 'each', 2000, null),
    ('DEMO-AMOX', 'Amoxicillin 500 mg capsule (demo)', 'medication', 'capsule', 15, null),
    ('DEMO-PCM', 'Paracetamol 500 mg tablet (demo)', 'medication', 'tablet', 5, null),
    ('DEMO-CEFT', 'Ceftriaxone 1 g vial (demo)', 'medication', 'vial', 350, null),
    ('DEMO-CANN', 'IV cannulation (demo)', 'procedure', 'each', 500, null)
  ) as x (code, name, cat, unit, price, sha)
  returning id
) insert into public.edoshmis_demo_registry select 'tariff', id from t;

with w as (
  insert into public.edoshmis_wards (facility_id, name, code, ward_type, daily_tariff_id)
  select fac, 'General Ward (demo)', 'DEMO', 'general_medical', (select id from public.edoshmis_tariffs where facility_id = fac and code = 'DEMO-BED') from demo_ctx
  returning id
) insert into public.edoshmis_demo_registry select 'ward', id from w;

insert into public.edoshmis_beds (facility_id, ward_id, bed_number)
select c.fac, w.id, 'DEMO-' || n from demo_ctx c, public.edoshmis_wards w, generate_series(1, 4) n where w.facility_id = c.fac and w.code = 'DEMO';

with d as (
  insert into public.edoshmis_drugs (organization_id, generic_name, drug_class, form, strength, default_route, tariff_id)
  select c.org, x.g, x.cls, x.form, x.str, x.route, (select id from public.edoshmis_tariffs where facility_id = c.fac and code = x.tcode)
  from demo_ctx c, (values
    ('Amoxicillin (demo)', 'Penicillin', 'capsule', '500 mg', 'oral', 'DEMO-AMOX'),
    ('Paracetamol (demo)', 'Analgesic', 'tablet', '500 mg', 'oral', 'DEMO-PCM'),
    ('Ceftriaxone (demo)', 'Cephalosporin', 'injection', '1 g', 'iv', 'DEMO-CEFT')
  ) as x (g, cls, form, str, route, tcode)
  returning id
) insert into public.edoshmis_demo_registry select 'drug', id from d;

with s as (
  insert into public.edoshmis_stores (facility_id, name, code, kind, is_dispensing)
  select fac, 'Pharmacy (demo)', 'DEMO-PH', 'pharmacy', not exists (select 1 from public.edoshmis_stores where facility_id = fac and is_dispensing) from demo_ctx
  returning id
) insert into public.edoshmis_demo_registry select 'store', id from s;

with i as (
  insert into public.edoshmis_stock_items (organization_id, code, name, category, unit, drug_id, reorder_level)
  select c.org, 'DEMO-' || x.code, x.name, 'drug', x.unit, (select id from public.edoshmis_drugs where organization_id = c.org and generic_name = x.g), 50
  from demo_ctx c, (values ('AMOX', 'Amoxicillin 500 mg capsule (demo)', 'capsule', 'Amoxicillin (demo)'), ('PCM', 'Paracetamol 500 mg tablet (demo)', 'tablet', 'Paracetamol (demo)'),
                           ('CEFT', 'Ceftriaxone 1 g vial (demo)', 'vial', 'Ceftriaxone (demo)')) as x (code, name, unit, g)
  returning id
) insert into public.edoshmis_demo_registry select 'stock_item', id from i;

with lt as (
  insert into public.edoshmis_lab_tests (facility_id, code, name, discipline, specimen_type, container, turnaround_hours, tariff_id)
  select fac, 'DEMO-FBC', 'Full blood count (demo)', 'haematology', 'Whole blood (EDTA)', 'Purple top', 4, (select id from public.edoshmis_tariffs where facility_id = fac and code = 'DEMO-FBC') from demo_ctx
  returning id
) insert into public.edoshmis_demo_registry select 'lab_test', id from lt;

-- SAMPLE ranges, labelled as such in the test name; not clinical reference values.
insert into public.edoshmis_lab_parameters (test_id, name, unit, ref_low, ref_high, critical_low, critical_high, sort_order)
select t.id, x.n, x.u, x.lo, x.hi, x.clo, x.chi, x.o from public.edoshmis_lab_tests t, demo_ctx c, (values
  ('Haemoglobin', 'g/dL', 12.0, 16.0, 7.0, null, 1),
  ('White cells', '×10⁹/L', 4.0, 11.0, null, 30.0, 2),
  ('Platelets', '×10⁹/L', 150.0, 400.0, 20.0, null, 3)
) as x (n, u, lo, hi, clo, chi, o) where t.facility_id = c.fac and t.code = 'DEMO-FBC';

with ie as (
  insert into public.edoshmis_imaging_exams (facility_id, code, name, modality, body_part, ionising, tariff_id)
  select fac, 'DEMO-CXR', 'Chest X-ray PA (demo)', 'xray', 'Chest', true, (select id from public.edoshmis_tariffs where facility_id = fac and code = 'DEMO-CXR') from demo_ctx
  returning id
) insert into public.edoshmis_demo_registry select 'imaging_exam', id from ie;

-- SAMPLE early-warning bands and one escalation rule, so the observation
-- chart can show scoring. Named as demo; replace with your own approved scheme.
with b as (
  insert into public.edoshmis_observation_bands (facility_id, scheme, parameter, min_value, max_value, match_value, score, approved_by, approved_at)
  select c.fac, 'adult', x.p, x.lo, x.hi, x.m, x.s, 'DEMO DATA — not clinically validated', current_date from demo_ctx c, (values
    ('respiratory_rate', 25::numeric, null::numeric, null::text, 3), ('respiratory_rate', 21, 24, null, 2),
    ('spo2', null, 91, null, 3), ('pulse', 111, 130, null, 2), ('pulse', 131, null, null, 3),
    ('temperature', 39.1, null, null, 2), ('systolic_bp', null, 90, null, 3)
  ) as x (p, lo, hi, m, s)
  returning id
) insert into public.edoshmis_demo_registry select 'band', id from b;
with e as (
  insert into public.edoshmis_escalation_rules (facility_id, scheme, min_total, level, response, approved_by, approved_at)
  select fac, 'adult', 5, 'high', 'Demo: inform the doctor on call now', 'DEMO DATA — not clinically validated', current_date from demo_ctx
  returning id
) insert into public.edoshmis_demo_registry select 'escalation_rule', id from e;

-- ---------------------------------------------------------------- as Val: the patient journeys

-- Hand the ids to the next block through settings (the signed-in role cannot read the temp table).
select set_config('edoshmis.demo_fac', fac::text, true), set_config('edoshmis.demo_org', org::text, true), set_config('edoshmis.demo_val', val::text, true) from demo_ctx;
select set_config('request.jwt.claim.sub', (select val_user::text from demo_ctx), true),
       set_config('request.jwt.claims', json_build_object('sub', (select val_user from demo_ctx), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  c record := null; v_bed1 uuid; v_bed2 uuid; v_amox uuid; v_pcm uuid; v_ceft uuid; v_fbc uuid; v_cxr uuid; v_store uuid;
  a_pat uuid; a_visit uuid; a_rx uuid; a_lab uuid; a_acct uuid;
  b_pat uuid; b_visit uuid; b_req uuid; b_adm uuid; b_lab uuid; b_img uuid; b_proc uuid; b_slot uuid; b_acct uuid; b_ord uuid; b_prn uuid; b_esc uuid; b_crit uuid;
  g_pat uuid; g_req uuid; g_adm uuid; g_dc uuid; g_acct uuid; g_bal numeric; g_ord uuid;
  p record;
begin
  select current_setting('edoshmis.demo_fac')::uuid as fac, current_setting('edoshmis.demo_org')::uuid as org, current_setting('edoshmis.demo_val')::uuid as val into c;
  select id into v_bed1 from public.edoshmis_beds where facility_id = c.fac and bed_number = 'DEMO-1';
  select id into v_bed2 from public.edoshmis_beds where facility_id = c.fac and bed_number = 'DEMO-2';
  select id into v_amox from public.edoshmis_drugs where organization_id = c.org and generic_name = 'Amoxicillin (demo)';
  select id into v_pcm from public.edoshmis_drugs where organization_id = c.org and generic_name = 'Paracetamol (demo)';
  select id into v_ceft from public.edoshmis_drugs where organization_id = c.org and generic_name = 'Ceftriaxone (demo)';
  select id into v_fbc from public.edoshmis_lab_tests where facility_id = c.fac and code = 'DEMO-FBC';
  select id into v_cxr from public.edoshmis_imaging_exams where facility_id = c.fac and code = 'DEMO-CXR';
  select id into v_store from public.edoshmis_stores where facility_id = c.fac and code = 'DEMO-PH';

  -- Opening stock in the demo pharmacy (two batches each, so FEFO shows).
  for p in select i.id, i.code from public.edoshmis_stock_items i where i.organization_id = c.org and i.code like 'DEMO-%' loop
    perform public.edoshmis_opening_stock(v_store, p.id, p.code || '-A', current_date + 90, 200, 4);
    perform public.edoshmis_opening_stock(v_store, p.id, p.code || '-B', current_date + 400, 300, 4);
  end loop;

  -- ===================================================== Amina — outpatient
  a_pat := public.edoshmis_register_patient(c.fac, jsonb_build_object(
    'first_name', 'Amina', 'last_name', 'Wekesa', 'sex', 'female', 'date_of_birth', '1994-03-18', 'phone', '+254700000101',
    'county', 'Nairobi', 'sub_county', 'Westlands', 'occupation', 'Teacher', 'marital_status', 'Married', 'allergies_reviewed', 'nkda',
    'consent_data_processing', true, 'consent_sms', true,
    'identifiers', jsonb_build_array(jsonb_build_object('id_type', 'other', 'value', 'EDOSHMIS-DEMO-1')),
    'contacts', jsonb_build_array(jsonb_build_object('kind', 'next_of_kin', 'full_name', 'Daniel Wekesa', 'relationship', 'Husband', 'phone', '+254700000102', 'is_primary', true))));
  insert into public.edoshmis_patient_alerts (organization_id, patient_id, severity, message) values (c.org, a_pat, 'info', 'DEMO RECORD — sample data, not a real patient.');

  a_visit := public.edoshmis_check_in(c.fac, jsonb_build_object('patient_id', a_pat, 'kind', 'opd', 'chief_complaint', 'Sore throat and fever for 3 days', 'payment_category', 'cash'));
  insert into public.edoshmis_triage_records (facility_id, encounter_id, patient_id, recorded_by, triage_category, chief_complaint, temperature, pulse, respiratory_rate, systolic_bp, diastolic_bp, spo2, weight_kg)
  values (c.fac, a_visit, a_pat, c.val, 'standard', 'Sore throat and fever for 3 days', 38.2, 96, 18, 118, 76, 98, 64);
  insert into public.edoshmis_consultations (facility_id, encounter_id, patient_id, author_id, author_designation, presenting_complaint, history, examination, assessment, plan, status)
  values (c.fac, a_visit, a_pat, c.val, '', 'Sore throat, fever, painful swallowing', 'Three days. No cough. No known allergies.', 'Inflamed tonsils with exudate, tender anterior cervical nodes. Chest clear.',
          'Acute bacterial tonsillitis (demo)', 'FBC. Amoxicillin 500 mg TDS × 7 days, paracetamol PRN. Review in 1 week.', 'signed');
  insert into public.edoshmis_diagnoses (facility_id, patient_id, encounter_id, rank, kind, description, icd10_code, recorded_by)
  values (c.fac, a_pat, a_visit, 'primary', 'working', 'Acute tonsillitis', 'J03.9', c.val);
  perform public.edoshmis_post_charge((select id from public.edoshmis_billing_accounts where encounter_id = a_visit and admission_id is null),
    jsonb_build_object('tariff_id', (select id from public.edoshmis_tariffs where facility_id = c.fac and code = 'DEMO-CONS')));

  a_lab := public.edoshmis_order_lab(c.fac, jsonb_build_object('encounter_id', a_visit, 'test_ids', jsonb_build_array(v_fbc), 'clinical_info', 'Fever, tonsillitis'));
  perform public.edoshmis_lab_step(a_lab, 'collect');
  perform public.edoshmis_lab_step(a_lab, 'receive');
  perform public.edoshmis_enter_lab_results((select id from public.edoshmis_lab_order_items where order_id = a_lab), (
    select jsonb_agg(jsonb_build_object('parameter_id', id, 'value', case name when 'Haemoglobin' then '13.1' when 'White cells' then '12.8' else '265' end))
    from public.edoshmis_lab_parameters where test_id = v_fbc));
  perform public.edoshmis_validate_lab(a_lab);

  a_rx := public.edoshmis_prescribe_outpatient(a_visit, jsonb_build_object('drug_id', v_amox, 'dose', 500, 'dose_unit', 'mg', 'route', 'oral', 'frequency', 'tds', 'duration_days', 7, 'quantity', 21, 'instructions', 'Finish the course'));
  perform public.edoshmis_prescribe_outpatient(a_visit, jsonb_build_object('drug_id', v_pcm, 'dose', 1, 'dose_unit', 'g', 'route', 'oral', 'frequency', 'prn', 'duration_days', 5, 'quantity', 20, 'instructions', 'Up to 4 times a day for fever or pain'));
  for p in select id from public.edoshmis_outpatient_prescriptions where encounter_id = a_visit loop
    perform public.edoshmis_dispense_outpatient(p.id, '{}'::jsonb);
  end loop;

  select id into a_acct from public.edoshmis_billing_accounts where encounter_id = a_visit and admission_id is null;
  perform public.edoshmis_receive_payment(a_acct, jsonb_build_object('method', 'mpesa', 'amount', (select balance from public.edoshmis_account_balances where account_id = a_acct),
    'reference', 'DEMO' || upper(substr(md5(a_pat::text), 1, 6)), 'payer_name', 'Amina Wekesa'));
  perform public.edoshmis_close_visit(a_visit, 'follow_up', 'Review in one week (demo)', current_date + 7);

  -- ===================================================== Brian — inpatient, still admitted
  b_pat := public.edoshmis_register_patient(c.fac, jsonb_build_object(
    'first_name', 'Brian', 'last_name', 'Otieno', 'sex', 'male', 'date_of_birth', '1968-11-02', 'phone', '+254700000201',
    'county', 'Kisumu', 'sub_county', 'Kisumu Central', 'occupation', 'Driver', 'marital_status', 'Married',
    'consent_data_processing', true,
    'identifiers', jsonb_build_array(jsonb_build_object('id_type', 'other', 'value', 'EDOSHMIS-DEMO-2')),
    'contacts', jsonb_build_array(jsonb_build_object('kind', 'next_of_kin', 'full_name', 'Rose Otieno', 'relationship', 'Wife', 'phone', '+254700000202', 'is_primary', true))));
  insert into public.edoshmis_patient_alerts (organization_id, patient_id, severity, message) values (c.org, b_pat, 'info', 'DEMO RECORD — sample data, not a real patient.');
  insert into public.edoshmis_patient_allergies (organization_id, patient_id, substance, category, reaction, severity) values (c.org, b_pat, 'Penicillin', 'drug', 'Rash and lip swelling', 'severe');
  insert into public.edoshmis_patient_history (organization_id, patient_id, kind, description, icd10_code, onset) values
    (c.org, b_pat, 'chronic', 'Type 2 diabetes, on metformin', 'E11.9', '2015'), (c.org, b_pat, 'social', 'Smokes 10 cigarettes a day', null, null);
  insert into public.edoshmis_patient_coverage (organization_id, patient_id, payer_type, payer_name, member_number, verified_at, verified_by, verification_note)
  values (c.org, b_pat, 'sha', 'Social Health Authority', 'DEMO-SHA-0001', now(), c.val, 'Demo — not a real membership');

  b_visit := public.edoshmis_check_in(c.fac, jsonb_build_object('patient_id', b_pat, 'kind', 'emergency', 'triage_category', 'very_urgent', 'arrival_mode', 'private_vehicle',
    'chief_complaint', 'Fever, cough and breathlessness for 4 days', 'payment_category', 'sha'));
  insert into public.edoshmis_triage_records (facility_id, encounter_id, patient_id, recorded_by, triage_category, chief_complaint, temperature, pulse, respiratory_rate, systolic_bp, diastolic_bp, spo2, consciousness, blood_glucose_mmol)
  values (c.fac, b_visit, b_pat, c.val, 'very_urgent', 'Fever, cough, breathless', 39.4, 118, 26, 104, 66, 90, 'alert', 11.2);
  insert into public.edoshmis_consultations (facility_id, encounter_id, patient_id, author_id, author_designation, examination, assessment, plan, status)
  values (c.fac, b_visit, b_pat, c.val, '', 'Bronchial breathing right lower zone, crackles. Alert.', 'Community-acquired pneumonia (demo), hypoxic',
          'Admit. Oxygen. IV ceftriaxone (penicillin allergy noted). FBC, CXR.', 'signed');
  b_req := public.edoshmis_request_admission(c.fac, jsonb_build_object('patient_id', b_pat, 'source', 'emergency', 'source_encounter_id', b_visit, 'priority', 'emergency',
    'provisional_diagnosis', 'Community-acquired pneumonia', 'provisional_icd10', 'J18.9', 'indication', 'Hypoxic (SpO₂ 90% on air), needs oxygen and IV antibiotics',
    'clinical_history', 'Four days of fever and productive cough; diabetic.', 'initial_assessment', 'RR 26, SpO₂ 90%, T 39.4', 'payment_category', 'sha',
    'responsible_consultant_id', c.val, 'accompanying_person', 'Rose Otieno (wife)'));
  perform public.edoshmis_close_visit(b_visit, 'admitted');
  perform public.edoshmis_decide_admission_request(b_req, true, 'Agree — admit to general ward');
  b_adm := public.edoshmis_admit(b_req, v_bed1, jsonb_build_object('consent_obtained', true, 'consent_by', 'Brian Otieno', 'expected_discharge_date', current_date + 4, 'notes', 'On 4 L O₂ via nasal prongs'));
  perform public.edoshmis_update_admission(b_adm, jsonb_build_object('condition', 'serious'));

  insert into public.edoshmis_clinical_notes (facility_id, admission_id, patient_id, note_type, author_id, author_designation, subjective, findings, assessment, plan, status)
  values (c.fac, b_adm, b_pat, 'ward_round', c.val, '', 'Feels a little better, still breathless on walking.',
          'T 38.1, RR 22, SpO₂ 94% on 2 L. Crackles right base persist.', 'CAP, improving. Glucose controlled.',
          'Continue ceftriaxone. Wean O₂ to keep SpO₂ ≥ 94%. Repeat FBC tomorrow. Mobilise.', 'signed');
  insert into public.edoshmis_nursing_notes (facility_id, admission_id, patient_id, category, shift, body, author_id, author_designation)
  values (c.fac, b_adm, b_pat, 'assessment', 'morning', 'Admitted from Emergency. Oriented, on oxygen 4 L. Cannula left forearm. Oriented to ward and call bell.', c.val, ''),
         (c.fac, b_adm, b_pat, 'handover', 'afternoon', 'Settled. O₂ reduced to 2 L. Ate half of lunch. Passed urine. Family visited.', c.val, '');
  insert into public.edoshmis_nursing_notes (facility_id, admission_id, patient_id, category, shift, body, score_tool, score, author_id, author_designation)
  values (c.fac, b_adm, b_pat, 'fall_risk', 'morning', 'Fall risk assessed on admission; bed low, call bell in reach.', 'Morse', 35, c.val, '');
  insert into public.edoshmis_nursing_care_plans (facility_id, admission_id, patient_id, nursing_diagnosis, goal, interventions, author_id)
  values (c.fac, b_adm, b_pat, 'Impaired gas exchange', 'SpO₂ ≥ 94% on minimal oxygen', 'Oxygen as prescribed, sit upright, 4-hourly observations, encourage deep breathing', c.val);

  insert into public.edoshmis_observations (facility_id, admission_id, patient_id, recorded_by, observed_at, temperature, pulse, respiratory_rate, systolic_bp, diastolic_bp, spo2, supplemental_o2, o2_flow_l_min, consciousness)
  values (c.fac, b_adm, b_pat, c.val, now() - interval '8 hours', 39.3, 122, 27, 102, 64, 90, true, 4, 'alert'),
         (c.fac, b_adm, b_pat, c.val, now() - interval '4 hours', 38.4, 108, 22, 112, 70, 93, true, 3, 'alert'),
         (c.fac, b_adm, b_pat, c.val, now() - interval '30 minutes', 37.9, 98, 20, 118, 74, 95, true, 2, 'alert');
  select id into b_esc from public.edoshmis_escalations where admission_id = b_adm order by created_at limit 1;
  if b_esc is not null then
    perform public.edoshmis_update_escalation(b_esc, 'resolve', 'Demo: reviewed by the doctor, oxygen increased, repeat observations hourly');
  end if;

  insert into public.edoshmis_diagnoses (facility_id, patient_id, admission_id, rank, kind, description, icd10_code, recorded_by)
  values (c.fac, b_pat, b_adm, 'secondary', 'working', 'Type 2 diabetes mellitus', 'E11.9', c.val);

  -- Medication: penicillin allergy is recorded, so amoxicillin would be refused; ceftriaxone is given.
  b_ord := public.edoshmis_prescribe(b_adm, jsonb_build_object('drug_id', v_ceft, 'dose', 1, 'dose_unit', 'g', 'route', 'iv', 'frequency', 'od', 'schedule_times', jsonb_build_array('08:00'),
    'start_at', (now() - interval '1 day')::text, 'instructions', 'Over 30 minutes',
    'allergy_override_reason', ''));
  perform public.edoshmis_verify_order(b_ord, true, 'Cephalosporin with penicillin allergy (rash): accepted by prescriber, monitor');
  perform public.edoshmis_dispense(b_ord, jsonb_build_object('quantity', 3, 'unit', 'vial'));
  perform public.edoshmis_generate_mar(b_adm, 24);
  select id into b_slot from public.edoshmis_medication_administrations where order_id = b_ord and scheduled_for < now() order by scheduled_for limit 1;
  if b_slot is not null then perform public.edoshmis_record_administration(b_slot, null, 'administered', jsonb_build_object('dose_given', '1 g IV')); end if;
  b_prn := public.edoshmis_prescribe(b_adm, jsonb_build_object('drug_id', v_pcm, 'dose', 1, 'dose_unit', 'g', 'route', 'oral', 'frequency', 'prn', 'prn_indication', 'Fever above 38 °C or pain', 'prn_max_doses_per_day', 4));
  perform public.edoshmis_verify_order(b_prn, true, null);
  perform public.edoshmis_record_administration(null, b_prn, 'administered', jsonb_build_object('dose_given', '1 g'));

  insert into public.edoshmis_fluid_entries (facility_id, admission_id, patient_id, recorded_by, recorded_at, direction, category, volume_ml, description)
  values (c.fac, b_adm, b_pat, c.val, now() - interval '6 hours', 'in', 'iv', 1000, 'Normal saline 1 L'),
         (c.fac, b_adm, b_pat, c.val, now() - interval '3 hours', 'in', 'oral', 400, 'Water and tea'),
         (c.fac, b_adm, b_pat, c.val, now() - interval '2 hours', 'out', 'urine', 650, null);

  insert into public.edoshmis_procedures (facility_id, admission_id, patient_id, requested_by, name, indication, urgency)
  values (c.fac, b_adm, b_pat, c.val, 'IV cannulation', 'IV antibiotics', 'urgent') returning id into b_proc;
  perform public.edoshmis_update_procedure(b_proc, 'authorise', '{}'::jsonb);
  perform public.edoshmis_update_procedure(b_proc, 'record', jsonb_build_object('consent_obtained', true, 'consent_by', 'Brian Otieno (verbal)',
    'procedure_note', '20G cannula, left forearm, first attempt. Flushed well.', 'outcome', 'Successful', 'complications', 'None'));

  b_lab := public.edoshmis_order_lab(c.fac, jsonb_build_object('admission_id', b_adm, 'test_ids', jsonb_build_array(v_fbc), 'priority', 'urgent', 'clinical_info', 'Pneumonia'));
  perform public.edoshmis_lab_step(b_lab, 'collect');
  perform public.edoshmis_lab_step(b_lab, 'receive');
  perform public.edoshmis_enter_lab_results((select id from public.edoshmis_lab_order_items where order_id = b_lab), (
    select jsonb_agg(jsonb_build_object('parameter_id', id, 'value', case name when 'Haemoglobin' then '14.2' when 'White cells' then '31.5' else '410' end))
    from public.edoshmis_lab_parameters where test_id = v_fbc));
  select id into b_crit from public.edoshmis_lab_results where order_id = b_lab and is_current and flag = 'critical_high' limit 1;
  if b_crit is not null then perform public.edoshmis_record_critical_call(b_crit, 'Val (demo), on the ward', true, 'Demo call'); end if;
  perform public.edoshmis_validate_lab(b_lab);

  b_img := public.edoshmis_order_imaging(c.fac, jsonb_build_object('admission_id', b_adm, 'exam_id', v_cxr, 'priority', 'urgent', 'clinical_indication', 'Suspected right lower lobe pneumonia'));
  perform public.edoshmis_imaging_step(b_img, 'perform', jsonb_build_object('technique', 'PA erect'));
  perform public.edoshmis_imaging_step(b_img, 'report', jsonb_build_object('findings', 'Air-space opacity in the right lower zone with air bronchograms. No effusion. Heart size normal.',
    'impression', 'Right lower lobe consolidation, in keeping with pneumonia (demo report).'));
  perform public.edoshmis_imaging_step(b_img, 'validate', '{}'::jsonb);

  select id into b_acct from public.edoshmis_billing_accounts where admission_id = b_adm;
  perform public.edoshmis_post_bed_charges(b_adm);
  perform public.edoshmis_post_charge(b_acct, jsonb_build_object('tariff_id', (select id from public.edoshmis_tariffs where facility_id = c.fac and code = 'DEMO-ROUND')));
  perform public.edoshmis_post_charge(b_acct, jsonb_build_object('tariff_id', (select id from public.edoshmis_tariffs where facility_id = c.fac and code = 'DEMO-CANN')));
  perform public.edoshmis_receive_payment(b_acct, jsonb_build_object('kind', 'deposit', 'method', 'mpesa', 'amount', 5000, 'reference', 'DEMO' || upper(substr(md5(b_pat::text), 1, 6)), 'payer_name', 'Rose Otieno'));

  -- ===================================================== Grace — inpatient, discharged
  g_pat := public.edoshmis_register_patient(c.fac, jsonb_build_object(
    'first_name', 'Grace', 'last_name', 'Njeri', 'sex', 'female', 'date_of_birth', '1987-06-25', 'phone', '+254700000301',
    'county', 'Kiambu', 'sub_county', 'Thika Town', 'occupation', 'Trader', 'allergies_reviewed', 'nkda', 'consent_data_processing', true,
    'identifiers', jsonb_build_array(jsonb_build_object('id_type', 'other', 'value', 'EDOSHMIS-DEMO-3')),
    'contacts', jsonb_build_array(jsonb_build_object('kind', 'next_of_kin', 'full_name', 'Peter Kamau', 'relationship', 'Brother', 'phone', '+254700000302', 'is_primary', true))));
  insert into public.edoshmis_patient_alerts (organization_id, patient_id, severity, message) values (c.org, g_pat, 'info', 'DEMO RECORD — sample data, not a real patient.');

  g_req := public.edoshmis_request_admission(c.fac, jsonb_build_object('patient_id', g_pat, 'source', 'direct', 'priority', 'urgent',
    'provisional_diagnosis', 'Acute gastroenteritis with dehydration', 'provisional_icd10', 'A09', 'indication', 'Unable to keep fluids down, moderate dehydration',
    'responsible_consultant_id', c.val, 'payment_category', 'cash'));
  perform public.edoshmis_decide_admission_request(g_req, true, null);
  g_adm := public.edoshmis_admit(g_req, v_bed2, jsonb_build_object('consent_obtained', true, 'consent_by', 'Grace Njeri'));
  insert into public.edoshmis_clinical_notes (facility_id, admission_id, patient_id, note_type, author_id, author_designation, findings, assessment, plan, status, discharge_ready)
  values (c.fac, g_adm, g_pat, 'admission', c.val, '', 'Dry mucosa, pulse 104, BP 108/70. Abdomen soft, mildly tender.', 'Gastroenteritis, moderate dehydration',
          'IV fluids, antiemetic, oral rehydration when tolerated.', 'signed', null),
         (c.fac, g_adm, g_pat, 'discharge_readiness', c.val, '', 'Tolerating oral fluids and diet. Pulse 82. No further vomiting.', 'Recovered', 'Discharge home today.', 'signed', true);
  insert into public.edoshmis_observations (facility_id, admission_id, patient_id, recorded_by, observed_at, temperature, pulse, respiratory_rate, systolic_bp, diastolic_bp, spo2)
  values (c.fac, g_adm, g_pat, c.val, now() - interval '3 hours', 37.8, 104, 18, 108, 70, 98), (c.fac, g_adm, g_pat, c.val, now() - interval '20 minutes', 36.9, 82, 16, 118, 76, 99);
  insert into public.edoshmis_fluid_entries (facility_id, admission_id, patient_id, recorded_by, direction, category, volume_ml, description)
  values (c.fac, g_adm, g_pat, c.val, 'in', 'iv', 1000, 'Ringer''s lactate'), (c.fac, g_adm, g_pat, c.val, 'out', 'urine', 500, null);
  insert into public.edoshmis_nursing_notes (facility_id, admission_id, patient_id, category, shift, body, author_id, author_designation)
  values (c.fac, g_adm, g_pat, 'education', 'afternoon', 'Taught oral rehydration at home and danger signs to return for.', c.val, '');
  g_ord := public.edoshmis_prescribe(g_adm, jsonb_build_object('drug_id', v_pcm, 'dose', 1, 'dose_unit', 'g', 'route', 'oral', 'frequency', 'prn', 'prn_indication', 'Pain or fever', 'prn_max_doses_per_day', 4));
  perform public.edoshmis_verify_order(g_ord, true, null);
  perform public.edoshmis_dispense(g_ord, jsonb_build_object('quantity', 8, 'unit', 'tablet'));

  insert into public.edoshmis_diagnoses (facility_id, patient_id, admission_id, rank, kind, description, icd10_code, recorded_by)
  values (c.fac, g_pat, g_adm, 'primary', 'final', 'Acute gastroenteritis with moderate dehydration', 'A09', c.val);
  g_dc := public.edoshmis_initiate_discharge(g_adm, 'routine', jsonb_build_object('destination', 'Home'));
  perform public.edoshmis_save_discharge_summary(g_dc, jsonb_build_object(
    'hospital_course', 'Admitted with vomiting and diarrhoea and moderate dehydration. Rehydrated with IV fluids; symptoms settled within 24 hours. Tolerating diet.',
    'treatment_received', 'IV Ringer''s lactate 1 L, oral rehydration, paracetamol as needed.', 'condition_at_discharge', 'Well, tolerating oral intake.',
    'discharge_medications', 'Paracetamol 1 g up to 4 times a day as needed (8 tablets issued). ORS sachets.', 'patient_instructions', 'Drink plenty of fluids. Return if vomiting returns, blood in stool or unable to drink.',
    'follow_up_date', (current_date + 14)::text, 'follow_up_with', 'Outpatient clinic', 'destination', 'Home'), true);
  perform public.edoshmis_discharge_step(g_dc, 'meds_reconciled', null);
  perform public.edoshmis_discharge_step(g_dc, 'investigations_reviewed', 'None outstanding');
  perform public.edoshmis_clear_discharge(g_dc, 'pharmacy', 'cleared', null);
  perform public.edoshmis_clear_discharge(g_dc, 'nursing', 'cleared', null);
  perform public.edoshmis_post_bed_charges(g_adm);
  select id into g_acct from public.edoshmis_billing_accounts where admission_id = g_adm;
  select balance into g_bal from public.edoshmis_account_balances where account_id = g_acct;
  if g_bal > 0 then
    perform public.edoshmis_receive_payment(g_acct, jsonb_build_object('method', 'cash', 'amount', g_bal, 'payer_name', 'Peter Kamau'));
  end if;
  perform public.edoshmis_clear_discharge(g_dc, 'billing', 'cleared', null);
  perform public.edoshmis_authorise_discharge(g_dc, null);
end $$;

reset role;
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);

-- What was loaded.
select p.hospital_number, p.first_name || ' ' || p.last_name as patient,
       coalesce((select a.status::text from public.edoshmis_admissions a where a.patient_id = p.id order by a.admitted_at desc limit 1),
                (select 'outpatient: ' || e.outcome from public.edoshmis_encounters e where e.patient_id = p.id and e.kind = 'opd' limit 1)) as state
from public.edoshmis_patients p
where p.id in (select patient_id from public.edoshmis_patient_identifiers where id_type = 'other' and value like 'EDOSHMIS-DEMO-%')
order by p.hospital_number;

commit;
