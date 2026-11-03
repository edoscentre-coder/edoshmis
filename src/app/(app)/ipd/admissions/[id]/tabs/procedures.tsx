import { Scissors } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Disclosure, EmptyState, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, nairobiLocalInput, titleCase } from "@/lib/format";
import { procedureAction, requestProcedure } from "../../../actions";
import type { Ctx } from "../context";

/** requested → authorised → scheduled → done (consent required) or cancelled with a reason. */
export async function ProceduresTab({ ctx }: { ctx: Ctx }) {
  const { s, admission: a, open } = ctx;
  const supabase = await createClient();
  const { data } = await supabase
    .from("edoshmis_procedures")
    .select("*, req:edoshmis_staff!edoshmis_procedures_requested_by_fkey(full_name), auth:edoshmis_staff!edoshmis_procedures_authorised_by_fkey(full_name), perf:edoshmis_staff!edoshmis_procedures_performed_by_fkey(full_name)")
    .eq("admission_id", a.id)
    .order("requested_at", { ascending: false });
  const rows = (data ?? []) as unknown as P[];
  const order = can(s, "procedures.order") && open;
  const perform = can(s, "procedures.perform") && open;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <Card className="order-2 lg:order-1">
        <CardHeader title="Procedures" icon={Scissors} />
        {!rows.length ? (
          <EmptyState icon={Scissors} title="No procedures" />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((p) => (
              <li key={p.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span>
                    <span className="font-medium">{p.name}</span>
                    {p.code && <span className="tnum ml-1.5 text-xs text-ink-faint">{p.code}</span>}
                    <span className="block text-xs text-ink-faint">
                      Requested by {p.req?.full_name} {fmtDateTime(p.requested_at)}
                      {p.auth ? ` · authorised by ${p.auth.full_name}` : ""}
                      {p.scheduled_for ? ` · scheduled ${fmtDateTime(p.scheduled_for)}` : ""}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <Badge tone={p.urgency === "emergency" ? "critical" : p.urgency === "urgent" ? "attention" : "neutral"}>{titleCase(p.urgency)}</Badge>
                    <Badge tone={p.status === "done" ? "positive" : p.status === "cancelled" ? "neutral" : "brand"}>{titleCase(p.status)}</Badge>
                  </span>
                </div>
                {p.indication && <p className="mt-1 text-ink-soft">{p.indication}</p>}
                {p.status === "done" && (
                  <div className="mt-2 rounded-lg bg-surface-sunk/70 px-3 py-2 text-sm">
                    <p className="text-xs text-ink-faint">
                      Done by {p.perf?.full_name} {fmtDateTime(p.performed_at)} · consent: {p.consent_by ?? "yes"}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{p.procedure_note}</p>
                    {p.outcome && <p className="mt-1"><span className="text-xs text-ink-faint">Outcome:</span> {p.outcome}</p>}
                    {p.complications && <p className="text-attention-ink"><span className="text-xs">Complications:</span> {p.complications}</p>}
                    {p.post_procedure_monitoring && <p><span className="text-xs text-ink-faint">Monitoring:</span> {p.post_procedure_monitoring}</p>}
                    {p.follow_up && <p><span className="text-xs text-ink-faint">Follow-up:</span> {p.follow_up}</p>}
                  </div>
                )}
                {p.status === "cancelled" && <p className="mt-1 text-xs text-ink-faint">Cancelled: {p.cancel_reason}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  {order && p.status === "requested" && (
                    <Disclosure label="Authorise" variant="primary">
                      <ActionForm action={procedureAction.bind(null, p.id, "authorise")} submitLabel="Authorise" />
                    </Disclosure>
                  )}
                  {order && ["authorised", "scheduled"].includes(p.status) && (
                    <Disclosure label="Schedule">
                      <ActionForm action={procedureAction.bind(null, p.id, "schedule")} submitLabel="Save">
                        <Field label="When">
                          <Input name="scheduled_for" type="datetime-local" required />
                        </Field>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" name="consent_obtained" className="h-4 w-4 accent-brand" /> Consent obtained
                        </label>
                        <Field label="Consent given by">
                          <Input name="consent_by" />
                        </Field>
                      </ActionForm>
                    </Disclosure>
                  )}
                  {perform && ["authorised", "scheduled"].includes(p.status) && (
                    <Disclosure label="Record as done" variant="primary">
                      <ActionForm action={procedureAction.bind(null, p.id, "record")} submitLabel="Save procedure note">
                        <Field label="Performed at">
                          <Input name="performed_at" type="datetime-local" defaultValue={nairobiLocalInput()} />
                        </Field>
                        {!p.consent_obtained && (
                          <>
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" name="consent_obtained" className="h-4 w-4 accent-brand" /> Consent obtained
                            </label>
                            <Field label="Consent given by">
                              <Input name="consent_by" />
                            </Field>
                          </>
                        )}
                        <Field label="Procedure note" required>
                          <Textarea name="procedure_note" required />
                        </Field>
                        <Field label="Outcome">
                          <Input name="outcome" />
                        </Field>
                        <Field label="Complications">
                          <Input name="complications" placeholder="None, or describe" />
                        </Field>
                        <Field label="Post-procedure monitoring">
                          <Input name="post_procedure_monitoring" />
                        </Field>
                        <Field label="Follow-up">
                          <Input name="follow_up" />
                        </Field>
                      </ActionForm>
                    </Disclosure>
                  )}
                  {order && !["done", "cancelled"].includes(p.status) && (
                    <Disclosure label="Cancel" variant="ghost">
                      <ActionForm action={procedureAction.bind(null, p.id, "cancel")} submitLabel="Cancel procedure" submitVariant="danger">
                        <Field label="Reason" required>
                          <Input name="reason" required />
                        </Field>
                      </ActionForm>
                    </Disclosure>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {order && (
        <Card className="order-1 lg:order-2 lg:sticky lg:top-20 lg:self-start">
          <CardHeader title="Request a procedure" />
          <CardBody>
            <ActionForm action={requestProcedure.bind(null, a.id, a.facility_id)} submitLabel="Request">
              <Field label="Procedure" required>
                <Input name="name" required placeholder="e.g. Lumbar puncture" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Code">
                  <Input name="code" />
                </Field>
                <Field label="Urgency">
                  <Select name="urgency" defaultValue="elective">
                    <option value="elective">Elective</option>
                    <option value="urgent">Urgent</option>
                    <option value="emergency">Emergency</option>
                  </Select>
                </Field>
              </div>
              <Field label="Indication">
                <Textarea name="indication" className="min-h-16" />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

interface P {
  id: string;
  name: string;
  code: string | null;
  indication: string | null;
  urgency: string;
  status: string;
  requested_at: string;
  scheduled_for: string | null;
  consent_obtained: boolean;
  consent_by: string | null;
  performed_at: string | null;
  procedure_note: string | null;
  outcome: string | null;
  complications: string | null;
  post_procedure_monitoring: string | null;
  follow_up: string | null;
  cancel_reason: string | null;
  req: { full_name: string } | null;
  auth: { full_name: string } | null;
  perf: { full_name: string } | null;
}
