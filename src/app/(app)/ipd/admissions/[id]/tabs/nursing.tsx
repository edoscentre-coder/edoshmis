import { HeartHandshake, ListChecks, PenLine } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Disclosure, EmptyState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, titleCase } from "@/lib/format";
import { addAddendum, addCarePlan, closeCarePlan, writeNursingNote } from "../../../actions";
import type { Ctx } from "../context";

const CATEGORIES = [
  ["general", "General"],
  ["assessment", "Nursing assessment"],
  ["intervention", "Intervention"],
  ["handover", "Shift handover"],
  ["shift_report", "Shift report"],
  ["hygiene", "Hygiene"],
  ["feeding", "Feeding assistance"],
  ["education", "Patient education"],
  ["wound_care", "Wound care"],
  ["fall_risk", "Fall risk assessment"],
  ["pressure_injury", "Pressure injury assessment"],
  ["pain", "Pain assessment"],
  ["incident", "Incident"],
] as const;

/**
 * The nursing record: notes by shift (final when written — corrections are
 * addenda), structured risk assessments with the named tool and score the
 * ward uses, and nursing care plans that stay open until evaluated.
 */
export async function NursingTab({ ctx }: { ctx: Ctx }) {
  const { s, admission: a, open } = ctx;
  const supabase = await createClient();
  const [{ data: notes }, { data: plans }] = await Promise.all([
    supabase
      .from("edoshmis_nursing_notes")
      .select("*, author:edoshmis_staff!edoshmis_nursing_notes_author_id_fkey(full_name), edoshmis_note_addenda(id, body, created_at, author:edoshmis_staff!edoshmis_note_addenda_author_id_fkey(full_name))")
      .eq("admission_id", a.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("edoshmis_nursing_care_plans").select("*").eq("admission_id", a.id).order("status").order("created_at", { ascending: false }),
  ]);
  const write = can(s, "nursing.notes") && open;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="order-2 flex min-w-0 flex-col gap-5 lg:order-1">
        <Card>
          <CardHeader title="Nursing care plans" icon={ListChecks} />
          {plans?.length ? (
            <ul className="divide-y divide-line">
              {plans.map((p) => (
                <li key={p.id} className="px-5 py-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">{p.nursing_diagnosis}</p>
                    <Badge tone={p.status === "active" ? "brand" : p.status === "achieved" ? "positive" : "neutral"}>{titleCase(p.status)}</Badge>
                  </div>
                  <p className="mt-1 text-ink-soft">
                    <span className="text-xs text-ink-faint">Goal:</span> {p.goal}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-ink-soft">
                    <span className="text-xs text-ink-faint">Interventions:</span> {p.interventions}
                  </p>
                  {p.evaluation && (
                    <p className="mt-0.5 text-ink-soft">
                      <span className="text-xs text-ink-faint">Evaluation:</span> {p.evaluation}
                    </p>
                  )}
                  {write && p.status === "active" && (
                    <Disclosure label="Evaluate" variant="ghost" className="mt-2">
                      <ActionForm action={closeCarePlan.bind(null, p.id)} submitLabel="Close plan">
                        <Field label="Outcome">
                          <Select name="status" defaultValue="achieved">
                            <option value="achieved">Goal achieved</option>
                            <option value="discontinued">Discontinued</option>
                          </Select>
                        </Field>
                        <Field label="Evaluation" required>
                          <Textarea name="evaluation" required className="min-h-16" />
                        </Field>
                      </ActionForm>
                    </Disclosure>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-sm text-ink-faint">No care plans.</CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title={`Nursing notes · ${notes?.length ?? 0}`} icon={HeartHandshake} />
          {!notes?.length ? (
            <EmptyState icon={HeartHandshake} title="No nursing notes yet" />
          ) : (
            <ul className="divide-y divide-line">
              {(notes as unknown as { id: string; category: string; shift: string; body: string; score_tool: string | null; score: number | null; created_at: string; author_designation: string; author: { full_name: string } | null; edoshmis_note_addenda: { id: string; body: string; created_at: string; author: { full_name: string } | null }[] }[]).map((n) => (
                <li key={n.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <Badge tone={n.category === "incident" ? "critical" : n.category === "handover" ? "info" : "neutral"}>{titleCase(n.category)}</Badge>
                      <span className="text-xs text-ink-faint">{titleCase(n.shift)} shift</span>
                    </span>
                    <span className="text-xs text-ink-faint">
                      {n.author?.full_name} · {fmtDateTime(n.created_at)}
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap">{n.body}</p>
                  {n.score_tool && (
                    <p className="tnum mt-1 text-xs text-ink-soft">
                      {n.score_tool}: <strong>{n.score ?? "—"}</strong>
                    </p>
                  )}
                  {n.edoshmis_note_addenda.map((ad) => (
                    <p key={ad.id} className="mt-1.5 rounded-lg bg-attention-soft/50 px-3 py-1.5 text-xs">
                      <span className="font-medium text-attention-ink">
                        Addendum · {ad.author?.full_name} · {fmtDateTime(ad.created_at)}:
                      </span>{" "}
                      {ad.body}
                    </p>
                  ))}
                  {can(s, "nursing.notes") && (
                    <Disclosure label="Addendum" icon={PenLine} variant="ghost" className="mt-1.5">
                      <ActionForm action={addAddendum.bind(null, "nursing", n.id)} submitLabel="Add addendum">
                        <Field label="Correction or addition" required>
                          <Textarea name="body" required className="min-h-16" />
                        </Field>
                      </ActionForm>
                    </Disclosure>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {write && (
        <div className="order-1 flex flex-col gap-5 lg:order-2 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader title="Nursing note" description={`As ${s.staff.fullName}`} />
            <CardBody>
              <ActionForm action={writeNursingNote.bind(null, a.id, a.facility_id)} submitLabel="Save note">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Kind">
                    <Select name="category" defaultValue="general">
                      {CATEGORIES.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Shift">
                    <Select name="shift" defaultValue="">
                      <option value="">Current</option>
                      <option value="morning">Morning</option>
                      <option value="afternoon">Afternoon</option>
                      <option value="night">Night</option>
                    </Select>
                  </Field>
                </div>
                <Field label="Note" required>
                  <Textarea name="body" required />
                </Field>
                <div className="grid grid-cols-[1fr_88px] gap-3">
                  <Field label="Assessment tool" hint="If scored — name the tool your ward uses">
                    <Input name="score_tool" placeholder="e.g. Morse, Braden, NRS" />
                  </Field>
                  <Field label="Score">
                    <Input name="score" inputMode="decimal" />
                  </Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Care plan" />
            <CardBody>
              <ActionForm action={addCarePlan.bind(null, a.id, a.facility_id)} submitLabel="Add care plan">
                <Field label="Nursing diagnosis" required>
                  <Input name="nursing_diagnosis" required placeholder="e.g. Risk of pressure injury" />
                </Field>
                <Field label="Goal" required>
                  <Input name="goal" required />
                </Field>
                <Field label="Interventions" required>
                  <Textarea name="interventions" required className="min-h-16" />
                </Field>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
