"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/session";
import { bool, dbError, opt, rpc, str } from "@/lib/actions";
import { normalisePhone } from "@/lib/format";
import type { ActionState } from "@/lib/action-state";

const ID_TYPES = ["national_id", "passport", "birth_certificate", "alien_id", "sha_member"] as const;

const Registration = z.object({
  first_name: z.string().min(1, "Enter the first name.").max(80),
  middle_name: z.string().max(80).nullable(),
  last_name: z.string().min(1, "Enter the surname.").max(80),
  sex: z.enum(["male", "female", "intersex", "unknown"], { message: "Choose the sex." }),
  date_of_birth: z.string().nullable(),
  dob_estimated: z.boolean(),
});

export interface Duplicate {
  patient_id: string;
  hospital_number: string;
  full_name: string;
  date_of_birth: string | null;
  phone: string | null;
  reasons: string[];
}

/** Turn an estimated age ("about 45") into a date of birth, flagged as estimated. */
function dobFrom(fd: FormData): { dob: string | null; estimated: boolean } {
  const dob = str(fd, "date_of_birth");
  if (dob) return { dob, estimated: false };
  const years = Number(str(fd, "age_years"));
  if (Number.isFinite(years) && years > 0 && years < 130) {
    const d = new Date();
    d.setFullYear(d.getFullYear() - Math.floor(years));
    return { dob: d.toISOString().slice(0, 10), estimated: true };
  }
  return { dob: null, estimated: false };
}

export async function registerPatient(_: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireStaff();
  const { dob, estimated } = dobFrom(fd);
  const parsed = Registration.safeParse({
    first_name: str(fd, "first_name"),
    middle_name: opt(fd, "middle_name"),
    last_name: str(fd, "last_name"),
    sex: str(fd, "sex"),
    date_of_birth: dob,
    dob_estimated: estimated,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (dob && new Date(dob) > new Date()) return { ok: false, error: "The date of birth is in the future." };

  const phone = normalisePhone(str(fd, "phone"));
  const phoneAlt = normalisePhone(str(fd, "phone_alt"));
  const nokPhone = normalisePhone(str(fd, "nok_phone"));
  const emPhone = normalisePhone(str(fd, "em_phone"));
  if ([phone, phoneAlt, nokPhone, emPhone].includes(undefined)) {
    return { ok: false, error: "A phone number is not a Kenyan mobile number. Use the form 0712 345 678 or +254 712 345 678." };
  }

  const identifiers = ID_TYPES.map((t) => ({ id_type: t, value: str(fd, `id_${t}`) })).filter((i) => i.value);
  const contacts = [
    { kind: "next_of_kin", full_name: str(fd, "nok_name"), relationship: str(fd, "nok_relationship"), phone: nokPhone, is_primary: true },
    { kind: str(fd, "em_kind") === "guardian" ? "guardian" : "emergency", full_name: str(fd, "em_name"), relationship: str(fd, "em_relationship"), phone: emPhone, is_primary: false },
  ].filter((c) => c.full_name);

  const payload = {
    ...parsed.data,
    phone,
    phone_alt: phoneAlt,
    email: opt(fd, "email"),
    county: opt(fd, "county"),
    sub_county: opt(fd, "sub_county"),
    address: opt(fd, "address"),
    occupation: opt(fd, "occupation"),
    marital_status: opt(fd, "marital_status"),
    blood_group: opt(fd, "blood_group"),
    allergies_reviewed: opt(fd, "allergies_reviewed"),
    consent_data_processing: bool(fd, "consent_data_processing"),
    consent_sms: bool(fd, "consent_sms"),
    identifiers,
    contacts,
  };

  const supabase = await createClient();
  const override = str(fd, "duplicate_override");
  if (!override) {
    const { data: dups, error } = await supabase.rpc("edoshmis_find_duplicates", {
      p_org: s.staff.organizationId,
      p_first: payload.first_name,
      p_last: payload.last_name,
      p_dob: payload.date_of_birth,
      p_phone: payload.phone,
      p_identifiers: identifiers,
    });
    if (error) return { ok: false, error: dbError(error) };
    if (dups?.length) {
      return {
        ok: false,
        error: "This may be someone already registered. Open their record, or confirm this is a different person.",
        data: { duplicates: dups as Duplicate[] },
      };
    }
  }

  const { data: id, error } = await supabase.rpc("edoshmis_register_patient", {
    p_facility: s.facility.id,
    p: payload,
    p_duplicate_override: override || null,
  });
  if (error) return { ok: false, error: dbError(error) };
  redirect(`/patients/${id}?registered=1`);
}

/* ---------------------------------------------------------------- clinical history */

async function orgOf() {
  const s = await requireStaff();
  return { s, org: s.staff.organizationId };
}

export async function addAllergy(patientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { org } = await orgOf();
  const substance = str(fd, "substance");
  if (substance.length < 2) return { ok: false, error: "Name the substance." };
  const supabase = await createClient();
  const { error } = await supabase.from("edoshmis_patient_allergies").insert({
    organization_id: org,
    patient_id: patientId,
    substance,
    category: str(fd, "category") || "drug",
    reaction: opt(fd, "reaction"),
    severity: str(fd, "severity") || "unknown",
  });
  if (error) return { ok: false, error: dbError(error) };
  await supabase.from("edoshmis_patients").update({ allergies_reviewed: "has_allergies" }).eq("id", patientId);
  refresh();
  return { ok: true, message: "Allergy recorded." };
}

export async function setAllergyStatus(allergyId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const status = str(fd, "status");
  if (!["inactive", "entered_in_error"].includes(status)) return { ok: false, error: "Unknown status." };
  const supabase = await createClient();
  const { error } = await supabase.from("edoshmis_patient_allergies").update({ status }).eq("id", allergyId);
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true };
}

export async function markNoKnownAllergies(patientId: string): Promise<ActionState> {
  await requireStaff();
  const supabase = await createClient();
  const { error } = await supabase.from("edoshmis_patients").update({ allergies_reviewed: "nkda" }).eq("id", patientId);
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true };
}

export async function addHistory(patientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { org } = await orgOf();
  const description = str(fd, "description");
  if (description.length < 2) return { ok: false, error: "Describe it." };
  const supabase = await createClient();
  const { error } = await supabase.from("edoshmis_patient_history").insert({
    organization_id: org,
    patient_id: patientId,
    kind: str(fd, "kind") || "medical",
    description,
    icd10_code: opt(fd, "icd10_code")?.toUpperCase() ?? null,
    onset: opt(fd, "onset"),
  });
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true, message: "Added to history." };
}

export async function addAlert(patientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { org } = await orgOf();
  const message = str(fd, "message");
  if (message.length < 2) return { ok: false, error: "Write the alert." };
  const supabase = await createClient();
  const { error } = await supabase.from("edoshmis_patient_alerts").insert({
    organization_id: org,
    patient_id: patientId,
    severity: str(fd, "severity") || "warning",
    message,
  });
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true, message: "Alert added." };
}

export async function resolveAlert(alertId: string): Promise<ActionState> {
  const { s } = await orgOf();
  const supabase = await createClient();
  const { error } = await supabase
    .from("edoshmis_patient_alerts")
    .update({ is_active: false, resolved_at: new Date().toISOString(), resolved_by: s.staff.id })
    .eq("id", alertId);
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true };
}

export async function addCoverage(patientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const { s, org } = await orgOf();
  const member = str(fd, "member_number");
  if (!member) return { ok: false, error: "Enter the member number." };
  const verified = bool(fd, "verified");
  const supabase = await createClient();
  const { error } = await supabase.from("edoshmis_patient_coverage").insert({
    organization_id: org,
    patient_id: patientId,
    payer_type: str(fd, "payer_type") || "sha",
    payer_name: str(fd, "payer_name") || (str(fd, "payer_type") === "sha" ? "Social Health Authority" : ""),
    member_number: member,
    principal_name: opt(fd, "principal_name"),
    valid_to: opt(fd, "valid_to"),
    verified_at: verified ? new Date().toISOString() : null,
    verified_by: verified ? s.staff.id : null,
    verification_note: opt(fd, "verification_note"),
  });
  if (error) return { ok: false, error: dbError(error) };
  refresh();
  return { ok: true, message: "Cover recorded." };
}

export async function requestAdmission(patientId: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const s = await requireStaff();
  const r = await rpc(
    "edoshmis_request_admission",
    {
      p_facility: s.facility.id,
      r: {
        patient_id: patientId,
        source: str(fd, "source") || "opd",
        priority: str(fd, "priority") || "urgent",
        preferred_ward_id: opt(fd, "preferred_ward_id"),
        responsible_consultant_id: opt(fd, "responsible_consultant_id"),
        provisional_diagnosis: str(fd, "provisional_diagnosis"),
        provisional_icd10: opt(fd, "provisional_icd10"),
        indication: str(fd, "indication"),
        clinical_history: opt(fd, "clinical_history"),
        initial_assessment: opt(fd, "initial_assessment"),
        payment_category: str(fd, "payment_category") || "cash",
        referring_facility: opt(fd, "referring_facility"),
        accompanying_person: opt(fd, "accompanying_person"),
        notes: opt(fd, "notes"),
      },
    },
    "Admission requested. It is waiting for approval under Inpatients → Admissions.",
  );
  return r;
}
