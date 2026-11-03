import Link from "next/link";
import { Clock, Siren, Stethoscope } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { ActionButton } from "@/components/ui/action-form";
import { can, type StaffSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ageOf, fmtTime, fullName, nowMs, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setStage } from "@/app/(app)/opd/actions";

export const TRIAGE: Record<string, { label: string; tone: string; rank: number }> = {
  immediate: { label: "Immediate", tone: "bg-critical text-white", rank: 0 },
  very_urgent: { label: "Very urgent", tone: "bg-critical-soft text-critical-ink", rank: 1 },
  urgent: { label: "Urgent", tone: "bg-attention-soft text-attention-ink", rank: 2 },
  standard: { label: "Standard", tone: "bg-positive-soft text-positive-ink", rank: 3 },
  non_urgent: { label: "Non-urgent", tone: "bg-info-soft text-info-ink", rank: 4 },
};

const STAGES = [
  ["waiting_triage", "Waiting for triage"],
  ["waiting_doctor", "Waiting for the doctor"],
  ["with_doctor", "With the doctor"],
  ["investigations", "Investigations"],
  ["pharmacy", "Pharmacy"],
  ["billing", "Billing"],
] as const;

interface Visit {
  id: string;
  queue_number: number | null;
  stage: string;
  triage_category: string | null;
  chief_complaint: string | null;
  arrival_mode: string | null;
  started_at: string;
  edoshmis_patients: { first_name: string; middle_name: string | null; last_name: string; sex: string; date_of_birth: string | null; dob_estimated: boolean; hospital_number: string };
  clinician: { full_name: string } | null;
  edoshmis_departments: { name: string } | null;
}

/**
 * The live queue. Outpatients by stage, in arrival order; emergency by
 * triage category first, then waiting time — the sickest at the top.
 * Waiting time is shown on every card so the long waits are seen.
 */
export async function QueueBoard({ s, kind }: { s: StaffSession; kind: "opd" | "emergency" }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("edoshmis_encounters")
    .select("id, queue_number, stage, triage_category, chief_complaint, arrival_mode, started_at, edoshmis_patients(first_name, middle_name, last_name, sex, date_of_birth, dob_estimated, hospital_number), clinician:edoshmis_staff!edoshmis_encounters_assigned_clinician_id_fkey(full_name), edoshmis_departments(name)")
    .eq("facility_id", s.facility.id)
    .eq("kind", kind)
    .eq("status", "open")
    .neq("stage", "done")
    .order("started_at");
  const visits = (data ?? []) as unknown as Visit[];
  const now = nowMs();
  const sorted = kind === "emergency" ? [...visits].sort((a, b) => (TRIAGE[a.triage_category ?? ""]?.rank ?? 9) - (TRIAGE[b.triage_category ?? ""]?.rank ?? 9) || a.started_at.localeCompare(b.started_at)) : visits;
  const consult = can(s, "opd.consult");

  const card = (v: Visit) => {
    const mins = Math.max(0, Math.round((now - new Date(v.started_at).getTime()) / 60000));
    const t = v.triage_category ? TRIAGE[v.triage_category] : null;
    return (
      <li key={v.id} className="rounded-xl border border-line bg-surface p-3 shadow-card">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/visits/${v.id}`} className="min-w-0 hover:text-brand">
            <span className="flex items-center gap-2">
              {v.queue_number != null && <span className="tnum rounded-md bg-shell px-1.5 py-0.5 text-xs font-semibold text-white">{kind === "emergency" ? "E" : ""}{v.queue_number}</span>}
              <span className="truncate font-medium">{fullName(v.edoshmis_patients)}</span>
            </span>
            <span className="tnum mt-0.5 block text-xs text-ink-faint">
              {v.edoshmis_patients.hospital_number} · {ageOf(v.edoshmis_patients.date_of_birth, v.edoshmis_patients.dob_estimated)} · {titleCase(v.edoshmis_patients.sex)}
            </span>
          </Link>
          {t && <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", t.tone)}>{t.label}</span>}
        </div>
        {v.chief_complaint && <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">{v.chief_complaint}</p>}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-faint">
          <span className={cn("flex items-center gap-1", mins > 120 ? "font-semibold text-attention-ink" : "")}>
            <Clock className="h-3 w-3" aria-hidden="true" /> {mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`} · since {fmtTime(v.started_at)}
          </span>
          <span>{v.clinician?.full_name ?? v.edoshmis_departments?.name ?? ""}</span>
        </div>
        {consult && v.stage === "waiting_doctor" && (
          <div className="mt-2">
            <ActionButton action={setStage.bind(null, v.id, "with_doctor", true)} variant="primary">
              <Stethoscope className="h-3.5 w-3.5" aria-hidden="true" /> Call in
            </ActionButton>
          </div>
        )}
      </li>
    );
  };

  if (!visits.length) {
    return (
      <Card>
        <EmptyState icon={kind === "emergency" ? Siren : Stethoscope} title={kind === "emergency" ? "No one in the emergency department" : "The queue is empty"}>
          Check patients in from their record in the patient register.
        </EmptyState>
      </Card>
    );
  }

  if (kind === "emergency") {
    return (
      <Card>
        <CardHeader title={`In the department · ${visits.length}`} description="By triage category, then waiting time" icon={Siren} />
        <ul className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">{sorted.map(card)}</ul>
      </Card>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {STAGES.map(([k, label]) => {
        const here = sorted.filter((v) => v.stage === k);
        if (!here.length && !["waiting_triage", "waiting_doctor", "with_doctor"].includes(k)) return null;
        return (
          <section key={k} className="rounded-xl bg-surface-sunk/70 p-3">
            <h2 className="mb-2 flex items-center justify-between text-sm font-semibold text-ink">
              {label} <Badge>{here.length}</Badge>
            </h2>
            {here.length ? <ul className="flex flex-col gap-2">{here.map(card)}</ul> : <p className="px-1 py-3 text-xs text-ink-faint">None</p>}
          </section>
        );
      })}
    </div>
  );
}
