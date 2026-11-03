/** The permission keys, mirroring edoshmis_permission_catalog (migrations 0001, 0010–0012). */
export const PERMS = [
  "admin.facility", "admin.staff", "admin.roles", "admin.wards", "admin.tariffs", "admin.clinical_config", "audit.read", "reports.read",
  "patients.read", "patients.register", "patients.edit", "patients.clinical",
  "ipd.read", "ipd.all_patients", "ipd.request_admission", "ipd.approve_admission", "ipd.allocate_bed", "ipd.transfer", "ipd.manage_beds",
  "clinical.notes", "clinical.diagnose", "clinical.care_team",
  "nursing.notes", "vitals.record", "vitals.escalate", "fluids.record",
  "meds.prescribe", "meds.verify", "meds.administer",
  "procedures.order", "procedures.perform",
  "billing.read", "billing.charge", "billing.payment", "billing.adjust",
  "discharge.initiate", "discharge.clear_billing", "discharge.clear_pharmacy", "discharge.clear_nursing", "discharge.authorize",
  // 0010 outpatients & emergency
  "opd.read", "opd.register", "opd.triage", "opd.consult",
  // 0011 laboratory
  "lab.read", "lab.order", "lab.collect", "lab.process", "lab.validate", "lab.configure",
  // 0012 imaging
  "imaging.read", "imaging.order", "imaging.perform", "imaging.report", "imaging.validate", "imaging.configure",
] as const;

export type Perm = (typeof PERMS)[number];
