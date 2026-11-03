import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, Lock, ShieldAlert } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge, EmptyState } from "@/components/ui/primitives";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ageOf, fmtDate, fullName, lengthOfStay, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Ctx } from "./context";
import { OverviewTab } from "./tabs/overview";
import { NotesTab } from "./tabs/notes";
import { NursingTab } from "./tabs/nursing";
import { VitalsTab } from "./tabs/vitals";
import { DiagnosisTab } from "./tabs/diagnosis";
import { MedicationTab } from "./tabs/medication";
import { FluidsTab } from "./tabs/fluids";
import { ProceduresTab } from "./tabs/procedures";
import { BillingTab } from "./tabs/billing";
import { DischargeTab } from "./tabs/discharge";
import { HistoryTab } from "./tabs/history";
import { Investigations } from "@/components/clinical/investigations";

export const metadata: Metadata = { title: "Inpatient" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "notes", label: "Clinical notes" },
  { key: "nursing", label: "Nursing" },
  { key: "vitals", label: "Observations" },
  { key: "diagnosis", label: "Diagnosis" },
  { key: "meds", label: "Medication · eMAR" },
  { key: "fluids", label: "Fluid balance" },
  { key: "investigations", label: "Investigations" },
  { key: "procedures", label: "Procedures" },
  { key: "billing", label: "Billing" },
  { key: "discharge", label: "Discharge" },
  { key: "history", label: "History" },
] as const;
type Tab = (typeof TABS)[number]["key"];

/**
 * One admitted patient's whole stay, for everyone caring for them. The
 * banner — who, where, since when, allergies, alerts, diagnosis — stays on
 * every tab; the tabs a person sees follow their role. A cashier who opens
 * this sees the banner and the bill, and no clinical tab.
 */
export default async function AdmissionWorkspace({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; admitted?: string }> }) {
  const s = await requireStaff();
  const { id } = await params;
  const { tab: tabParam, admitted } = await searchParams;
  const supabase = await createClient();

  const { data: a } = await supabase
    .from("edoshmis_admissions")
    .select(
      "*, condition:clinical_condition, edoshmis_patients(id, hospital_number, first_name, middle_name, last_name, sex, date_of_birth, dob_estimated, phone, allergies_reviewed), edoshmis_beds!edoshmis_admissions_current_bed_id_fkey(bed_number), edoshmis_wards!edoshmis_admissions_current_ward_id_fkey(name), consultant:edoshmis_staff!edoshmis_admissions_responsible_consultant_id_fkey(full_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!a) notFound();
  const { data: seeClinical } = await supabase.rpc("edoshmis_can_see_admission", { p_admission: id });
  await supabase.rpc("edoshmis_log_access", { p_patient: a.patient_id, p_facility: a.facility_id, p_context: "inpatient_record" });

  const p = a.edoshmis_patients as Ctx["patient"] & { allergies_reviewed: string | null };
  const clinicalPatient = can(s, "patients.clinical");
  const [{ data: allergies }, { data: alerts }, { data: dx }] = await Promise.all([
    clinicalPatient ? supabase.from("edoshmis_patient_allergies").select("substance, severity, reaction").eq("patient_id", p.id).eq("status", "active") : Promise.resolve({ data: null }),
    supabase.from("edoshmis_patient_alerts").select("severity, message").eq("patient_id", p.id).eq("is_active", true),
    seeClinical
      ? supabase.from("edoshmis_diagnoses").select("description, icd10_code, rank, kind").eq("admission_id", id).eq("status", "active").order("rank")
      : Promise.resolve({ data: null }),
  ]);

  const open = a.status === "active" || a.status === "discharge_in_progress";
  const visible: Tab[] = TABS.map((t) => t.key).filter((k) => {
    if (k === "billing") return can(s, "billing.read", "discharge.authorize");
    if (k === "discharge") return Boolean(seeClinical) || can(s, "discharge.clear_billing", "discharge.clear_pharmacy", "discharge.clear_nursing");
    if (k === "meds") return Boolean(seeClinical) || can(s, "meds.verify");
    return Boolean(seeClinical);
  });
  const tab: Tab = (visible.includes(tabParam as Tab) ? tabParam : visible[0]) as Tab;
  const ctx: Ctx = { s, open, admission: a as Ctx["admission"], patient: p };
  const primary = dx?.find((d) => d.rank === "primary");
  const consultant = (a.consultant as unknown as { full_name: string } | null)?.full_name;

  return (
    <>
      <Breadcrumbs trail={[{ label: "Inpatients", href: "/ipd" }, { label: (a.edoshmis_wards as unknown as { name: string } | null)?.name ?? "Admission", href: a.current_ward_id ? `/ipd?ward=${a.current_ward_id}` : "/ipd" }, { label: fullName(p) }]} />

      {admitted && (
        <p className="mb-3 flex items-center gap-2 rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive-ink">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Admitted. The ward has the patient; the bill is open.
        </p>
      )}

      {/* Patient banner */}
      <section className="mb-4 rounded-xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
                <Link href={`/patients/${p.id}`} className="hover:text-brand">
                  {fullName(p)}
                </Link>
              </h1>
              <Badge tone={open ? (a.status === "discharge_in_progress" ? "info" : "brand") : "neutral"}>{titleCase(a.status)}</Badge>
              {a.condition && <Badge tone={["critical", "deteriorating"].includes(a.condition) ? "critical" : a.condition === "serious" ? "attention" : "positive"}>{a.condition}</Badge>}
            </div>
            <p className="tnum mt-0.5 text-xs text-ink-soft">
              {p.hospital_number} · {ageOf(p.date_of_birth, p.dob_estimated)} · {titleCase(p.sex)} · {a.admission_number}
            </p>
          </div>
          <dl className="tnum grid grid-cols-3 gap-x-5 gap-y-1 text-xs sm:flex sm:gap-6">
            <BannerFact label="Bed">
              {(a.edoshmis_beds as unknown as { bed_number: string } | null)?.bed_number ?? "—"} · {(a.edoshmis_wards as unknown as { name: string } | null)?.name ?? "—"}
            </BannerFact>
            <BannerFact label="Day">
              {lengthOfStay(a.admitted_at, a.discharged_at)} <span className="text-ink-faint">· {fmtDate(a.admitted_at)}</span>
            </BannerFact>
            <BannerFact label="Consultant">{consultant ?? "Not set"}</BannerFact>
            {a.expected_discharge_date && <BannerFact label="EDD">{fmtDate(a.expected_discharge_date)}</BannerFact>}
          </dl>
        </div>
        {(primary || allergies || alerts?.length) && (
          <div className="flex flex-col gap-1.5 border-t border-line px-4 py-2.5 text-sm sm:px-5">
            {primary && (
              <p className="text-ink-soft">
                <span className="text-xs font-medium text-ink-faint uppercase">Diagnosis</span> <span className="font-medium text-ink">{primary.description}</span>
                {primary.icd10_code && <span className="tnum text-xs text-ink-faint"> {primary.icd10_code}</span>}
                <span className="text-xs text-ink-faint"> ({primary.kind})</span>
              </p>
            )}
            {allergies &&
              (allergies.length ? (
                <p className="flex flex-wrap items-center gap-1.5 font-medium text-critical-ink">
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" /> Allergies:{" "}
                  {allergies.map((x) => `${x.substance} (${x.severity.replace(/_/g, " ")}${x.reaction ? `, ${x.reaction}` : ""})`).join(" · ")}
                </p>
              ) : (
                <p className={cn("text-xs", p.allergies_reviewed === "nkda" ? "text-positive-ink" : "text-attention-ink")}>
                  {p.allergies_reviewed === "nkda" ? "No known allergies (asked)" : "Allergy status not recorded — check before prescribing"}
                </p>
              ))}
            {alerts?.map((x, i) => (
              <p key={i} className={cn("flex items-center gap-1.5 text-xs", x.severity === "critical" ? "text-critical-ink" : "text-attention-ink")}>
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" /> {x.message}
              </p>
            ))}
          </div>
        )}
      </section>

      {!seeClinical && visible.length <= 2 && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-surface-sunk px-3 py-2 text-xs text-ink-soft">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Clinical notes are visible only to this patient&apos;s care team and the staff of their ward.
        </p>
      )}

      {visible.length === 0 ? (
        <EmptyState icon={Lock} title="Nothing here for your role" />
      ) : (
        <>
          <nav className="no-print -mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Sections">
            <ul className="flex min-w-max gap-1 border-b border-line">
              {TABS.filter((t) => visible.includes(t.key)).map((t) => (
                <li key={t.key}>
                  <Link
                    href={`/ipd/admissions/${id}?tab=${t.key}`}
                    aria-current={t.key === tab ? "page" : undefined}
                    className={cn(
                      "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm whitespace-nowrap transition-colors",
                      t.key === tab ? "border-brand font-medium text-brand-darker" : "border-transparent text-ink-soft hover:text-ink",
                    )}
                  >
                    {t.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {tab === "overview" && <OverviewTab ctx={ctx} />}
          {tab === "notes" && <NotesTab ctx={ctx} />}
          {tab === "nursing" && <NursingTab ctx={ctx} />}
          {tab === "vitals" && <VitalsTab ctx={ctx} />}
          {tab === "diagnosis" && <DiagnosisTab ctx={ctx} />}
          {tab === "meds" && <MedicationTab ctx={ctx} />}
          {tab === "fluids" && <FluidsTab ctx={ctx} />}
          {tab === "investigations" && <Investigations s={s} admissionId={a.id} patientSex={p.sex} open={open} />}
          {tab === "procedures" && <ProceduresTab ctx={ctx} />}
          {tab === "billing" && <BillingTab ctx={ctx} />}
          {tab === "discharge" && <DischargeTab ctx={ctx} />}
          {tab === "history" && <HistoryTab ctx={ctx} />}
        </>
      )}
    </>
  );
}

function BannerFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10.5px] font-medium tracking-wide text-ink-faint uppercase">{label}</dt>
      <dd className="truncate text-sm text-ink">{children}</dd>
    </div>
  );
}
