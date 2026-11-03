import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical, Settings2 } from "lucide-react";
import { Badge, Card, EmptyState, PageHeader, buttonClass } from "@/components/ui/primitives";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, fullName, todayNairobi } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Laboratory" };

const VIEWS = [
  ["collect", "To collect", ["ordered"]],
  ["receive", "To receive", ["collected"]],
  ["bench", "On the bench", ["received", "in_progress"]],
  ["validate", "To validate", ["resulted"]],
  ["done", "Released today", ["validated"]],
] as const;

export default async function LabWorklist({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const s = await requireStaff();
  if (!can(s, "lab.process", "lab.validate", "lab.collect")) return <EmptyState icon={FlaskConical} title="Your role does not include the laboratory." />;
  const { view: v } = await searchParams;
  const view = VIEWS.find(([k]) => k === v) ?? (can(s, "lab.process") ? VIEWS[2] : VIEWS[0]);
  const supabase = await createClient();
  let q = supabase
    .from("edoshmis_lab_orders")
    .select("id, order_number, priority, status, ordered_at, accession, admission_id, encounter_id, edoshmis_patients(first_name, middle_name, last_name, hospital_number), edoshmis_lab_order_items(test_name), edoshmis_admissions(edoshmis_wards!edoshmis_admissions_current_ward_id_fkey(name), edoshmis_beds!edoshmis_admissions_current_bed_id_fkey(bed_number))")
    .eq("facility_id", s.facility.id)
    .in("status", view[2] as unknown as string[]);
  if (view[0] === "done") q = q.gte("validated_at", `${todayNairobi()}T00:00:00+03:00`);
  const { data } = await q.order("ordered_at").limit(200);
  const rows = ((data ?? []) as unknown as {
    id: string; order_number: string; priority: string; status: string; ordered_at: string; accession: string | null; admission_id: string | null;
    edoshmis_patients: { first_name: string; middle_name: string | null; last_name: string; hospital_number: string };
    edoshmis_lab_order_items: { test_name: string }[];
    edoshmis_admissions: { edoshmis_wards: { name: string } | null; edoshmis_beds: { bed_number: string } | null } | null;
  }[]).sort((a, b) => rank(a.priority) - rank(b.priority));

  return (
    <>
      <PageHeader
        title="Laboratory"
        description="Specimens and results, by stage. STAT and urgent work first."
        actions={
          can(s, "lab.configure") && (
            <Link href="/admin/lab" className={buttonClass("secondary")}>
              <Settings2 className="h-4 w-4" aria-hidden="true" /> Test catalogue
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {VIEWS.map(([k, label]) => (
          <Link key={k} href={`/lab?view=${k}`} className={buttonClass(k === view[0] ? "primary" : "secondary", "sm")}>
            {label}
          </Link>
        ))}
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={FlaskConical} title={`Nothing ${view[1].toLowerCase()}`} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((o) => (
              <li key={o.id}>
                <Link href={`/lab/${o.id}`} className={cn("flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-surface-sunk sm:px-5", o.priority === "stat" && "bg-critical-soft/30")}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {fullName(o.edoshmis_patients)} <span className="text-sm font-normal text-ink-soft">— {o.edoshmis_lab_order_items.map((i) => i.test_name).join(", ")}</span>
                    </span>
                    <span className="tnum block text-xs text-ink-faint">
                      {o.order_number} · {o.edoshmis_patients.hospital_number} ·{" "}
                      {o.admission_id ? `${o.edoshmis_admissions?.edoshmis_wards?.name ?? "Ward"} bed ${o.edoshmis_admissions?.edoshmis_beds?.bed_number ?? "—"}` : "Outpatient"} · {fmtDateTime(o.ordered_at)}
                      {o.accession ? ` · ${o.accession}` : ""}
                    </span>
                  </span>
                  {o.priority !== "routine" && <Badge tone="critical">{o.priority.toUpperCase()}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

const rank = (p: string) => (p === "stat" ? 0 : p === "urgent" ? 1 : 2);
