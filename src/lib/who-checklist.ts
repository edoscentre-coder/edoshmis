/**
 * The WHO Surgical Safety Checklist (2009) — its three phases and items, as
 * published. These are procedural confirmations, not clinical thresholds; a
 * hospital using its own adapted checklist can edit this list.
 */
export const WHO_CHECKLIST = {
  sign_in: {
    title: "Sign in — before induction of anaesthesia",
    items: [
      ["identity_site_procedure_consent", "Patient has confirmed identity, site, procedure and consent"],
      ["site_marked", "Site marked (or not applicable)"],
      ["anaesthesia_check", "Anaesthesia machine and medication check complete"],
      ["pulse_oximeter", "Pulse oximeter on the patient and functioning"],
      ["allergy_assessed", "Known allergy assessed"],
      ["airway_risk_assessed", "Difficult airway / aspiration risk assessed, equipment and assistance available if needed"],
      ["blood_loss_risk_assessed", "Risk of blood loss over 500 ml (7 ml/kg in children) assessed, access and fluids planned"],
    ],
  },
  time_out: {
    title: "Time out — before skin incision",
    items: [
      ["team_introduced", "All team members have introduced themselves by name and role"],
      ["confirm_patient_site_procedure", "Surgeon, anaesthetist and nurse confirm patient, site and procedure"],
      ["antibiotic_prophylaxis", "Antibiotic prophylaxis given within the last 60 minutes (or not applicable)"],
      ["critical_events_reviewed", "Anticipated critical events reviewed by surgeon, anaesthetist and nursing team"],
      ["imaging_displayed", "Essential imaging displayed (or not applicable)"],
    ],
  },
  sign_out: {
    title: "Sign out — before the patient leaves theatre",
    items: [
      ["procedure_recorded", "Name of the procedure recorded"],
      ["counts_correct", "Instrument, sponge and needle counts are correct (or not applicable)"],
      ["specimen_labelled", "Specimen labelled, including the patient's name (or not applicable)"],
      ["equipment_problems", "Any equipment problems to be addressed"],
      ["recovery_concerns_reviewed", "Key concerns for recovery and management reviewed"],
    ],
  },
} as const;

export type ChecklistPhase = keyof typeof WHO_CHECKLIST;
