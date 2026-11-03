-- Remove the EDOSHMIS demo data loaded by 01_load_demo.sql — and nothing else.
--
-- Demo patients are those carrying an identifier EDOSHMIS-DEMO-n; demo
-- catalogue items, stock and Val's extra demo roles are listed in
-- edoshmis_demo_registry. Clinical records are append-only by design, so
-- this script switches the guard triggers off for its own transaction only,
-- deletes the demo rows in dependency order, and switches them back on.
-- Real patients, real catalogue items and Val's administrator role are
-- untouched. Run the whole file in the SQL editor, with nothing selected.

begin;

do $$
begin
  if to_regclass('public.edoshmis_demo_registry') is null and not exists (
      select 1 from public.edoshmis_patient_identifiers where id_type = 'other' and value like 'EDOSHMIS-DEMO-%') then
    raise exception 'No demo data found — nothing to remove.';
  end if;
end $$;

create temp table demo_p on commit drop as
  select distinct patient_id as id from public.edoshmis_patient_identifiers where id_type = 'other' and value like 'EDOSHMIS-DEMO-%';
create temp table demo_reg (kind text, ref_id uuid) on commit drop;
do $$ begin
  if to_regclass('public.edoshmis_demo_registry') is not null then
    insert into demo_reg select kind, ref_id from public.edoshmis_demo_registry;
  end if;
end $$;
create temp table demo_adm on commit drop as select id from public.edoshmis_admissions where patient_id in (select id from demo_p);
create temp table demo_enc on commit drop as select id from public.edoshmis_encounters where patient_id in (select id from demo_p);
create temp table demo_acct on commit drop as select id from public.edoshmis_billing_accounts where patient_id in (select id from demo_p);

-- Guards off (this transaction only).
do $$ declare t text; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'edoshmis\_%' loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;
end $$;

-- Laboratory and imaging
delete from public.edoshmis_lab_critical_calls where order_id in (select id from public.edoshmis_lab_orders where patient_id in (select id from demo_p));
delete from public.edoshmis_lab_results where patient_id in (select id from demo_p);
delete from public.edoshmis_lab_order_items where order_id in (select id from public.edoshmis_lab_orders where patient_id in (select id from demo_p));
delete from public.edoshmis_lab_orders where patient_id in (select id from demo_p);
delete from public.edoshmis_imaging_addenda where order_id in (select id from public.edoshmis_imaging_orders where patient_id in (select id from demo_p));
delete from public.edoshmis_imaging_orders where patient_id in (select id from demo_p);

-- Medication
delete from public.edoshmis_medication_administrations where admission_id in (select id from demo_adm);
delete from public.edoshmis_medication_dispenses where admission_id in (select id from demo_adm);
delete from public.edoshmis_medication_orders where admission_id in (select id from demo_adm);
delete from public.edoshmis_outpatient_prescriptions where patient_id in (select id from demo_p);

-- Stock: movements of demo patients, and everything in demo stores / of demo items
delete from public.edoshmis_stock_movements where patient_id in (select id from demo_p)
  or store_id in (select ref_id from demo_reg where kind = 'store') or item_id in (select ref_id from demo_reg where kind = 'stock_item');
delete from public.edoshmis_requisition_lines where item_id in (select ref_id from demo_reg where kind = 'stock_item');
delete from public.edoshmis_stock_batches where store_id in (select ref_id from demo_reg where kind = 'store') or item_id in (select ref_id from demo_reg where kind = 'stock_item');

-- Discharge, ward documentation
delete from public.edoshmis_discharge_clearances where discharge_id in (select id from public.edoshmis_discharges where admission_id in (select id from demo_adm));
delete from public.edoshmis_discharges where admission_id in (select id from demo_adm);
delete from public.edoshmis_escalations where admission_id in (select id from demo_adm);
delete from public.edoshmis_observations where admission_id in (select id from demo_adm);
delete from public.edoshmis_fluid_entries where admission_id in (select id from demo_adm);
delete from public.edoshmis_procedures where admission_id in (select id from demo_adm);
delete from public.edoshmis_note_addenda where admission_id in (select id from demo_adm);
delete from public.edoshmis_clinical_notes where admission_id in (select id from demo_adm);
delete from public.edoshmis_nursing_notes where admission_id in (select id from demo_adm);
delete from public.edoshmis_nursing_care_plans where admission_id in (select id from demo_adm);
delete from public.edoshmis_care_team where admission_id in (select id from demo_adm);
delete from public.edoshmis_diagnoses where patient_id in (select id from demo_p);

-- Billing
delete from public.edoshmis_payments where account_id in (select id from demo_acct);
delete from public.edoshmis_charges where account_id in (select id from demo_acct);
delete from public.edoshmis_billing_accounts where id in (select id from demo_acct);

-- Beds and admissions
update public.edoshmis_beds set current_admission_id = null where current_admission_id in (select id from demo_adm);
delete from public.edoshmis_bed_reservations where request_id in (select id from public.edoshmis_admission_requests where patient_id in (select id from demo_p));
delete from public.edoshmis_bed_events where admission_id in (select id from demo_adm)
  or bed_id in (select b.id from public.edoshmis_beds b where b.ward_id in (select ref_id from demo_reg where kind = 'ward'));
delete from public.edoshmis_bed_allocations where admission_id in (select id from demo_adm);
update public.edoshmis_admission_requests set admission_id = null where patient_id in (select id from demo_p);
delete from public.edoshmis_admissions where id in (select id from demo_adm);
delete from public.edoshmis_admission_requests where patient_id in (select id from demo_p);

-- Outpatient visits
delete from public.edoshmis_consultation_addenda where consultation_id in (select id from public.edoshmis_consultations where patient_id in (select id from demo_p));
delete from public.edoshmis_consultations where patient_id in (select id from demo_p);
delete from public.edoshmis_triage_records where patient_id in (select id from demo_p);
update public.edoshmis_encounters set appointment_id = null where id in (select id from demo_enc);
delete from public.edoshmis_appointments where patient_id in (select id from demo_p);
delete from public.edoshmis_encounters where id in (select id from demo_enc);

-- The patients
delete from public.edoshmis_patient_alerts where patient_id in (select id from demo_p);
delete from public.edoshmis_patient_allergies where patient_id in (select id from demo_p);
delete from public.edoshmis_patient_history where patient_id in (select id from demo_p);
delete from public.edoshmis_patient_coverage where patient_id in (select id from demo_p);
delete from public.edoshmis_patient_contacts where patient_id in (select id from demo_p);
delete from public.edoshmis_patient_identifiers where patient_id in (select id from demo_p);
delete from public.edoshmis_access_logs where patient_id in (select id from demo_p);
delete from public.edoshmis_audit_logs where patient_id in (select id from demo_p)
  or entity_id in (select ref_id::text from demo_reg)
  or entity_id in (select id::text from demo_adm) or entity_id in (select id::text from demo_enc) or entity_id in (select id::text from demo_acct);
delete from public.edoshmis_patients where id in (select id from demo_p);

-- Demo catalogue, configuration and Val's demo roles
delete from public.edoshmis_stock_items where id in (select ref_id from demo_reg where kind = 'stock_item');
delete from public.edoshmis_stores where id in (select ref_id from demo_reg where kind = 'store');
delete from public.edoshmis_drug_interactions where drug_a in (select ref_id from demo_reg where kind = 'drug') or drug_b in (select ref_id from demo_reg where kind = 'drug');
delete from public.edoshmis_drugs where id in (select ref_id from demo_reg where kind = 'drug');
delete from public.edoshmis_lab_tests where id in (select ref_id from demo_reg where kind = 'lab_test');
delete from public.edoshmis_imaging_exams where id in (select ref_id from demo_reg where kind = 'imaging_exam');
delete from public.edoshmis_observation_bands where id in (select ref_id from demo_reg where kind = 'band');
delete from public.edoshmis_escalation_rules where id in (select ref_id from demo_reg where kind = 'escalation_rule');
delete from public.edoshmis_staff_wards where ward_id in (select ref_id from demo_reg where kind = 'ward');
delete from public.edoshmis_beds where ward_id in (select ref_id from demo_reg where kind = 'ward');
delete from public.edoshmis_wards where id in (select ref_id from demo_reg where kind = 'ward');
delete from public.edoshmis_tariffs where id in (select ref_id from demo_reg where kind = 'tariff');
delete from public.edoshmis_staff_roles where id in (select ref_id from demo_reg where kind = 'staff_role');
delete from public.edoshmis_audit_logs where entity_type in ('edoshmis_staff_roles', 'edoshmis_beds', 'edoshmis_lab_parameters')
  and (after ->> 'id' in (select ref_id::text from demo_reg) or after ->> 'ward_id' in (select ref_id::text from demo_reg where kind = 'ward')
       or after ->> 'test_id' in (select ref_id::text from demo_reg where kind = 'lab_test'));

-- Guards back on.
do $$ declare t text; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'edoshmis\_%' loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;
end $$;

drop table if exists public.edoshmis_demo_registry;

select 'Demo removed' as result,
       (select count(*) from public.edoshmis_patient_identifiers where value like 'EDOSHMIS-DEMO-%') as demo_patients_left,
       (select count(*) from public.edoshmis_tariffs where code like 'DEMO-%') as demo_tariffs_left;

commit;
