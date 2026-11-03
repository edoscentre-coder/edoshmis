import type { Metadata } from "next";
import Link from "next/link";
import { ScanLine, Settings2 } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, buttonClass } from "@/components/ui/primitives";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, fullName, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Imaging" };

const VIEWS = [
  ["todo", "To perform", ["ordered", "scheduled"]],
  ["report", "To report", ["performed"]],
  ["validate", "To validate", ["reported"]],
  ["done", "Released", ["validated"]],
] as const;

export default async function ImagingWorklist({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const s = await requireStaff();
  if (!can(s, "imaging.perform", "imaging.report")) return <EmptyState icon={ScanLine} title="Your role does not include imaging." />;
  const { view: v } = await searchParams;
  const view = VIEWS.find(([k]) => k === v) ?? (can(s, "imaging.report") ? VIEWS[1] : VIEWS[0]);
  const supabase = await createClient();
  const { data } = await supabase
    .from("edoshmis_imaging_orders")
    .select("id, exam_name, accession_number, priority, status, ordered_at, scheduled_for, admission_id, pregnancy_status, edoshmis_patients(first_name, middle_name, last_name, hospital_number), edoshmis_imaging_exams(modality)")
    .eq("facility_id", s.facility.id)
    .in("status", view[2] as unknown as string[])
    .order(view[0] === "done" ? "validated_at" : "ordered_at", { ascending: view[0] !== "done" })
    .limit(200);
  const rows = (data ?? []) as unknown as {
    id: string; exam_name: string; accession_number: string; priority: string; status: string; ordered_at: string; scheduled_for: string | null; admission_id: string | null; pregnancy_status: string | null;
    edoshmis_patients: { first_name: string; middle_name: string | null; last_name: string; hospital_number: string }; edoshmis_imaging_exams: { modality: string };
  }[];

  return (
    <>
      <PageHeader
        title="Imaging"
        description="Examinations from order to released report."
        actions={
          can(s, "imaging.configure") && (
            <Link href="/admin/imaging" className={buttonClass("secondary")}>
              <Settings2 className="h-4 w-4" aria-hidden="true" /> Examinations
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map(([k, label]) => (
          <Link key={k} href={`/imaging?view=${k}`} className={buttonClass(k === view[0] ? "primary" : "secondary", "sm")}>
            {label}
          </Link>
        ))}
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={ScanLine} title={`Nothing ${view[1].toLowerCase()}`} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((o) => (
              <li key={o.id}>
                <Link href={`/imaging/${o.id}`} className={cn("flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-sunk sm:px-5", o.priority === "stat" && "bg-critical-soft/30")}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {fullName(o.edoshmis_patients)} <span className="text-sm font-normal text-ink-soft">— {titleCase(o.edoshmis_imaging_exams.modality)} · {o.exam_name}</span>
                    </span>
                    <span className="tnum block text-xs text-ink-faint">
                      {o.accession_number} · {o.edoshmis_patients.hospital_number} · {o.admission_id ? "Inpatient" : "Outpatient"} · {o.scheduled_for ? `scheduled ${fmtDateTime(o.scheduled_for)}` : fmtDateTime(o.ordered_at)}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    {o.pregnancy_status === "pregnant" && <Badge tone="attention">Pregnant</Badge>}
                    {o.priority !== "routine" && <Badge tone="critical">{o.priority.toUpperCase()}</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
