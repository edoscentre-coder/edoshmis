import Link from "next/link";
import { History } from "lucide-react";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, lengthOfStay, titleCase } from "@/lib/format";
import type { Ctx } from "../context";

/** Earlier stays, and — for those who may read the audit log — every change made on this admission. */
export async function HistoryTab({ ctx }: { ctx: Ctx }) {
  const { s, admission: a } = ctx;
  const supabase = await createClient();
  const [{ data: stays }, audit] = await Promise.all([
    supabase.from("edoshmis_admissions").select("id, admission_number, admitted_at, discharged_at, status, edoshmis_diagnoses(description, rank, kind, status)").eq("patient_id", a.patient_id).neq("id", a.id).order("admitted_at", { ascending: false }),
    can(s, "audit.read")
      ? supabase.from("edoshmis_audit_logs").select("id, action, entity_type, created_at, reason, actor_staff_id").eq("patient_id", a.patient_id).gte("created_at", a.admitted_at).order("created_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: null }),
  ]);
  // The audit log keeps ids only (no foreign keys — it must outlive anything it records); names are looked up.
  const actorIds = [...new Set((audit.data ?? []).map((e) => e.actor_staff_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length ? await supabase.from("edoshmis_staff").select("id, full_name").in("id", actorIds) : { data: [] };
  const nameOf = new Map((actors ?? []).map((x) => [x.id as string, x.full_name as string]));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Previous admissions" icon={History} />
        {stays?.length ? (
          <ul className="divide-y divide-line">
            {(stays as unknown as { id: string; admission_number: string; admitted_at: string; discharged_at: string | null; status: string; edoshmis_diagnoses: { description: string; rank: string; kind: string; status: string }[] }[]).map((x) => {
              const dx = x.edoshmis_diagnoses.find((d) => d.rank === "primary" && d.kind === "final" && d.status === "active") ?? x.edoshmis_diagnoses.find((d) => d.rank === "primary");
              return (
                <li key={x.id}>
                  <Link href={`/ipd/admissions/${x.id}`} className="block px-5 py-3 text-sm hover:bg-surface-sunk">
                    <div className="flex items-center justify-between gap-2">
                      <span className="tnum font-medium">{x.admission_number}</span>
                      <Badge>{titleCase(x.status)}</Badge>
                    </div>
                    <p className="text-xs text-ink-faint">
                      {fmtDate(x.admitted_at)} → {fmtDate(x.discharged_at)} · {lengthOfStay(x.admitted_at, x.discharged_at)} day(s){dx ? ` · ${dx.description}` : ""}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <CardBody className="text-sm text-ink-faint">This is the patient&apos;s first admission here.</CardBody>
        )}
      </Card>

      {audit.data && (
        <Card>
          <CardHeader title="Audit trail" description="Every change since admission — append-only" />
          <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
            {(audit.data as unknown as { id: number; action: string; entity_type: string; created_at: string; reason: string | null; actor_staff_id: string | null }[]).map((e) => (
              <li key={e.id} className="px-5 py-2 text-sm">
                <span className="font-medium">{titleCase(e.action.replace(/\./g, " · "))}</span>
                <span className="block text-xs text-ink-faint">
                  {fmtDateTime(e.created_at)} · {(e.actor_staff_id && nameOf.get(e.actor_staff_id)) || "System"}
                  {e.reason ? ` · ${e.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
