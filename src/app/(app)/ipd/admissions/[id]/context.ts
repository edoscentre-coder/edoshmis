import type { StaffSession } from "@/lib/session";

/** What every tab of the inpatient workspace receives. */
export interface Ctx {
  s: StaffSession;
  open: boolean;
  admission: {
    id: string;
    facility_id: string;
    patient_id: string;
    admission_number: string;
    admitted_at: string;
    discharged_at: string | null;
    status: string;
    source: string;
    priority: string;
    indication: string;
    clinical_history: string | null;
    initial_assessment: string | null;
    patient_category: string;
    payment_category: string;
    referring_facility: string | null;
    accompanying_person: string | null;
    consent_obtained: boolean;
    consent_by: string | null;
    notes: string | null;
    condition: string | null;
    expected_discharge_date: string | null;
    current_ward_id: string | null;
    current_bed_id: string | null;
    responsible_consultant_id: string | null;
  };
  patient: {
    id: string;
    hospital_number: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    sex: string;
    date_of_birth: string | null;
    dob_estimated: boolean;
    phone: string | null;
  };
}

export const ZERO = "00000000-0000-0000-0000-000000000000";
