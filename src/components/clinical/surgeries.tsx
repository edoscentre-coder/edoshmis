import Link from "next/link";
import { Plus, Scissors } from "lucide-react";
import { Badge, Card, CardHeader, Disclosure, EmptyState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can, type StaffSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, titleCase } from "@/lib/format";
import { requestSurgery } from "@/app/(app)/theatre/actions";

/** Surgery for one admission (or day-case visit): what is booked, and a request form. */
export async function Surgeries({ s, admissionId, encounterId, open }: { s: StaffSession; admissionId?: string; encounterId?: string; open: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("edoshmis_surgeries")
    .select("id, surgery_number, procedure_name, laterality, status, scheduled_start, surgeon:edoshmis_staff!edoshmis_surgeries_surgeon_id_fkey(full_name)")
    .eq(admissionId ? "admission_id" : "encounter_id", (admissionId ?? encounterId)!)
    .order("requested_at", { ascending: false });
  const surgeons = can(s, "theatre.schedule") && open
    ? (await supabase.from("edoshmis_staff").select("id, full_name").eq("organization_id", s.staff.organizationId).eq("status", "active").in("designation", ["consultant", "medical_officer"]).order("full_name")).data
    : null;
  const rows = (data ?? []) as unknown as { id: string; surgery_number: string; procedure_name: string; laterality: string | null; status: string; scheduled_start: string | null; surgeon: { full_name: string } | null }[];
  return (
    <Card>
      <CardHeader
        title={`Theatre · ${rows.length}`}
        icon={Scissors}
        actions={
          surgeons && (
            <Disclosure label="Book surgery" icon={Plus} variant="primary">
              <ActionForm action={requestSurgery.bind(null, admissionId ? { admissionId } : { encounterId })} submitLabel="Request">
                <Field label="Procedure" required>
                  <Input name="procedure_name" required />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Side">
                    <Select name="laterality" defaultValue="not_applicable">
                      <option value="not_applicable">Not applicable</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                      <option value="bilateral">Bilateral</option>
                    </Select>
                  </Field>
                  <Field label="Urgency">
                    <Select name="urgency" defaultValue="elective">
                      <option value="elective">Elective</option>
                      <option value="urgent">Urgent</option>
                      <option value="emergency">Emergency</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Surgeon">
                  <Select name="surgeon_id" defaultValue={s.staff.id}>
                    {surgeons.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Indication">
                  <Textarea name="indication" className="min-h-14" />
                </Field>
              </ActionForm>
            </Disclosure>
          )
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={Scissors} title="No surgery booked" />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/theatre/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-surface-sunk">
                <span>
                  <span className="font-medium">{r.procedure_name}</span>
                  {r.laterality && r.laterality !== "not_applicable" ? ` (${r.laterality})` : ""}
                  <span className="block text-xs text-ink-faint">
                    {r.surgery_number} · {r.scheduled_start ? fmtDateTime(r.scheduled_start) : "not yet scheduled"} · {r.surgeon?.full_name ?? "—"}
                  </span>
                </span>
                <Badge tone={r.status === "completed" ? "positive" : r.status === "cancelled" ? "neutral" : "info"}>{titleCase(r.status)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
