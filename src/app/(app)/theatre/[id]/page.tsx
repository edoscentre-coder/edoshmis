import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle, Scissors } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge, Card, CardBody, CardHeader, Disclosure, Fact, Field, Input, PageHeader, Select, Textarea } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { PrintButton } from "@/components/ui/print-button";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ageOf, fmtDateTime, fullName, titleCase } from "@/lib/format";
import { WHO_CHECKLIST, type ChecklistPhase } from "@/lib/who-checklist";
import { cn } from "@/lib/utils";
import { addConsumable, addImplant, surgeryStep } from "../actions";

export const metadata: Metadata = { title: "Surgery" };

/**
 * One operation from request to recovery. Each step is a card; a card the
 * database would refuse yet (sign-in before consent, sign-out before the
 * operation note) says what has to come first instead of offering a form.
 */
export default async function SurgeryPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireStaff();
  const { id } = await params;
  const supabase = await createClient();
  const { data: su } = await supabase
    .from("edoshmis_surgeries")
    .select(
      "*, edoshmis_patients(id, first_name, middle_name, last_name, hospital_number, sex, date_of_birth, dob_estimated), edoshmis_theatres(name, store_id), surgeon_n:edoshmis_staff!edoshmis_surgeries_surgeon_id_fkey(full_name), assistant_n:edoshmis_staff!edoshmis_surgeries_assistant_id_fkey(full_name), anaesthetist_n:edoshmis_staff!edoshmis_surgeries_anaesthetist_id_fkey(full_name), scrub_nurse_n:edoshmis_staff!edoshmis_surgeries_scrub_nurse_id_fkey(full_name), sign_in_n:edoshmis_staff!edoshmis_surgeries_sign_in_by_fkey(full_name), time_out_n:edoshmis_staff!edoshmis_surgeries_time_out_by_fkey(full_name), sign_out_n:edoshmis_staff!edoshmis_surgeries_sign_out_by_fkey(full_name), note_n:edoshmis_staff!edoshmis_surgeries_note_by_fkey(full_name), edoshmis_surgery_implants(id, description, manufacturer, lot_number, serial_number, site), edoshmis_surgery_consumables(id, quantity, batches, edoshmis_stock_items(name, unit))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!su) notFound();
  const p = su.edoshmis_patients as { id: string; first_name: string; middle_name: string | null; last_name: string; hospital_number: string; sex: string; date_of_birth: string | null; dob_estimated: boolean };
  const n = (k: string) => ((su as Record<string, unknown>)[`${k}_n`] as { full_name: string } | null)?.full_name;
  const [{ data: allergies }, { data: items }] = await Promise.all([
    supabase.from("edoshmis_patient_allergies").select("substance, severity").eq("patient_id", p.id).eq("status", "active"),
    supabase.from("edoshmis_stock_items").select("id, name, unit").in("category", ["surgical", "consumable", "drug"]).eq("is_active", true).order("name"),
  ]);
  const perform = can(s, "theatre.perform");
  const anaes = can(s, "theatre.anaesthesia");
  const open = !["completed", "cancelled"].includes(su.status);

  const phase = (k: ChecklistPhase, done: string | null, by: string | undefined, ready: boolean, blocker: string) => {
    const def = WHO_CHECKLIST[k];
    const answers = (su as Record<string, unknown>)[k] as Record<string, boolean> | null;
    return (
      <Card>
        <CardHeader
          title={def.title}
          actions={done ? <Badge tone="positive"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {by} · {fmtDateTime(done)}</Badge> : <Badge tone="attention">To do</Badge>}
        />
        <CardBody>
          {done ? (
            <ul className="flex flex-col gap-1 text-sm">
              {def.items.map(([key, label]) => (
                <li key={key} className="flex items-start gap-2">
                  <CheckCircle2 className={cn("mt-0.5 h-4 w-4 shrink-0", answers?.[key] ? "text-positive" : "text-ink-faint")} aria-hidden="true" /> {label}
                </li>
              ))}
            </ul>
          ) : !ready ? (
            <p className="text-sm text-ink-soft">{blocker}</p>
          ) : perform ? (
            <ActionForm action={surgeryStep.bind(null, id, k)} submitLabel={`Confirm ${k.replace("_", " ")}`}>
              {def.items.map(([key, label]) => (
                <fieldset key={key} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-0">
                  <legend className="sr-only">{label}</legend>
                  <span className="max-w-md text-sm">{label}</span>
                  <span className="flex gap-3 text-sm">
                    {(["yes", "na", "no"] as const).map((v) => (
                      <label key={v} className="flex items-center gap-1">
                        <input type="radio" name={key} value={v} required className="h-4 w-4 accent-brand" /> {v === "na" ? "N/A" : titleCase(v)}
                      </label>
                    ))}
                  </span>
                </fieldset>
              ))}
            </ActionForm>
          ) : (
            <p className="text-sm text-ink-faint">Completed by the theatre team.</p>
          )}
        </CardBody>
      </Card>
    );
  };

  return (
    <>
      <Breadcrumbs trail={[{ label: "Theatre", href: "/theatre" }, { label: su.surgery_number }]} />
      <PageHeader
        eyebrow={<span className="tnum">{su.surgery_number}</span>}
        title={`${su.procedure_name}${su.laterality && su.laterality !== "not_applicable" ? ` (${su.laterality})` : ""}`}
        description={
          <>
            <Link href={`/patients/${p.id}`} className="hover:text-brand">
              {fullName(p)}
            </Link>{" "}
            · {p.hospital_number} · {ageOf(p.date_of_birth, p.dob_estimated)} · {titleCase(p.sex)}
            {su.admission_id && (
              <>
                {" "}
                ·{" "}
                <Link href={`/ipd/admissions/${su.admission_id}`} className="text-brand hover:underline">
                  inpatient record
                </Link>
              </>
            )}
          </>
        }
        actions={
          <>
            {su.urgency !== "elective" && <Badge tone="critical">{titleCase(su.urgency)}</Badge>}
            <Badge tone={su.status === "completed" ? "positive" : "info"}>{titleCase(su.status)}</Badge>
            {su.note_at && <PrintButton label="Print operation note" />}
          </>
        }
      />
      {allergies && allergies.length > 0 && (
        <p className="mb-4 rounded-lg bg-critical-soft px-3 py-2 text-sm font-medium text-critical-ink">Allergies: {allergies.map((a) => `${a.substance} (${a.severity.replace(/_/g, " ")})`).join(" · ")}</p>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Booking and team" icon={Scissors} />
            <CardBody>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Fact label="Theatre">{(su.edoshmis_theatres as { name: string } | null)?.name}</Fact>
                <Fact label="Start">{su.scheduled_start ? `${fmtDateTime(su.scheduled_start)} · ${su.duration_minutes} min` : null}</Fact>
                <Fact label="Indication">{su.indication}</Fact>
                <Fact label="Surgeon">{n("surgeon")}</Fact>
                <Fact label="Assistant">{n("assistant")}</Fact>
                <Fact label="Anaesthetist">{n("anaesthetist")}</Fact>
                <Fact label="Scrub nurse">{n("scrub_nurse")}</Fact>
                <Fact label="Consent">{su.consent_obtained ? `${su.consent_by} · ${fmtDateTime(su.consent_at)}` : <span className="text-attention-ink">Not recorded</span>}</Fact>
                <Fact label="Anaesthesia">{[su.asa_class && `ASA ${su.asa_class}`, su.anaesthesia_type && titleCase(su.anaesthesia_type), su.fasting_confirmed != null && (su.fasting_confirmed ? "fasting confirmed" : "not fasted")].filter(Boolean).join(" · ")}</Fact>
              </dl>
              {su.pre_op_assessment && <p className="mt-3 text-sm whitespace-pre-wrap text-ink-soft">{su.pre_op_assessment}</p>}
            </CardBody>
          </Card>

          {phase("sign_in", su.sign_in_at, n("sign_in"), su.status === "scheduled" && su.consent_obtained, su.status === "requested" ? "Schedule the case on the theatre list first." : "Record consent first.")}
          {phase("time_out", su.time_out_at, n("time_out"), su.status === "in_theatre" && !!su.sign_in_at, "Complete sign-in first.")}

          <Card>
            <CardHeader title="Operation note" actions={su.note_at ? <Badge tone="positive">{n("note")} · {fmtDateTime(su.note_at)}</Badge> : undefined} />
            <CardBody>
              {su.time_out_at && perform && (su.status === "in_theatre" || su.note_at) ? (
                <ActionForm action={surgeryStep.bind(null, id, "note")} submitLabel={su.note_at ? "Update note" : "Save operation note"} resetOnSuccess={false}>
                  <Field label="Findings">
                    <Textarea name="findings" defaultValue={su.findings ?? ""} className="min-h-16" />
                  </Field>
                  <Field label="Procedure" required>
                    <Textarea name="procedure_details" required defaultValue={su.procedure_details ?? ""} className="min-h-28" />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Blood loss (ml)">
                      <Input name="blood_loss_ml" type="number" min={0} defaultValue={su.blood_loss_ml ?? ""} />
                    </Field>
                    <Field label="Specimens" className="sm:col-span-2">
                      <Input name="specimens" defaultValue={su.specimens ?? ""} placeholder="e.g. Hernial sac to histology" />
                    </Field>
                  </div>
                  <Field label="Complications">
                    <Input name="complications" defaultValue={su.complications ?? ""} placeholder="None, or describe" />
                  </Field>
                  <Field label="Post-operative instructions">
                    <Textarea name="post_op_instructions" defaultValue={su.post_op_instructions ?? ""} className="min-h-16" />
                  </Field>
                </ActionForm>
              ) : su.note_at ? (
                <div className="flex flex-col gap-2 text-sm">
                  {su.findings && <p><span className="text-xs text-ink-faint uppercase">Findings</span><br />{su.findings}</p>}
                  <p className="whitespace-pre-wrap"><span className="text-xs text-ink-faint uppercase">Procedure</span><br />{su.procedure_details}</p>
                  <p className="text-ink-soft">Blood loss {su.blood_loss_ml ?? "—"} ml · specimens {su.specimens ?? "none"} · complications {su.complications ?? "none"}</p>
                  {su.post_op_instructions && <p><span className="text-xs text-ink-faint uppercase">Post-op</span><br />{su.post_op_instructions}</p>}
                </div>
              ) : (
                <p className="text-sm text-ink-soft">Written after the time out.</p>
              )}
            </CardBody>
          </Card>

          {phase("sign_out", su.sign_out_at, n("sign_out"), su.status === "in_theatre" && !!su.note_at, su.note_at ? "—" : "Write the operation note first.")}

          <Card>
            <CardHeader title="Recovery" />
            <CardBody>
              {su.status === "recovery" && perform ? (
                <ActionForm action={surgeryStep.bind(null, id, "recovery_out")} submitLabel="Discharge from recovery">
                  <Field label="Recovery notes">
                    <Textarea name="recovery_notes" className="min-h-16" />
                  </Field>
                  <Field label="Going to" required>
                    <Input name="destination" required placeholder="e.g. Ward A, HDU, home (day case)" />
                  </Field>
                </ActionForm>
              ) : su.recovery_out_at ? (
                <p className="text-sm text-ink-soft">
                  In recovery {fmtDateTime(su.recovery_in_at)} → out {fmtDateTime(su.recovery_out_at)}, to {su.destination}.{su.recovery_notes ? ` ${su.recovery_notes}` : ""}
                </p>
              ) : (
                <p className="text-sm text-ink-faint">After sign-out.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Checklist" />
            <ol className="flex flex-col gap-2 px-5 py-4 text-sm">
              {([["Consent", su.consent_obtained], ["Sign in", su.sign_in_at], ["Time out", su.time_out_at], ["Operation note", su.note_at], ["Sign out", su.sign_out_at], ["Out of recovery", su.recovery_out_at]] as const).map(([l, v]) => (
                <li key={l} className="flex items-center gap-2">
                  {v ? <CheckCircle2 className="h-4 w-4 text-positive" aria-hidden="true" /> : <Circle className="h-4 w-4 text-line-strong" aria-hidden="true" />} {l}
                </li>
              ))}
            </ol>
          </Card>
          {open && perform && !su.consent_obtained && (
            <Card>
              <CardHeader title="Consent" />
              <CardBody>
                <ActionForm action={surgeryStep.bind(null, id, "consent")} submitLabel="Record consent">
                  <Field label="Given by" required hint="Patient, or guardian with relationship">
                    <Input name="consent_by" required />
                  </Field>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {open && anaes && (
            <Card>
              <CardHeader title="Anaesthesia" />
              <CardBody className="flex flex-col gap-3">
                <ActionForm action={surgeryStep.bind(null, id, "pre_op")} submitLabel="Save assessment" resetOnSuccess={false}>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="ASA class">
                      <Select name="asa_class" defaultValue={su.asa_class ?? ""}>
                        <option value="">—</option>
                        {["I", "II", "III", "IV", "V", "VI"].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Type">
                      <Select name="anaesthesia_type" defaultValue={su.anaesthesia_type ?? ""}>
                        <option value="">—</option>
                        {["general", "spinal", "epidural", "regional", "local", "sedation", "combined"].map((c) => (
                          <option key={c} value={c}>
                            {titleCase(c)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <Field label="Fasting confirmed">
                    <Select name="fasting_confirmed" defaultValue={su.fasting_confirmed == null ? "" : su.fasting_confirmed ? "yes" : "no"}>
                      <option value="">—</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </Select>
                  </Field>
                  <Field label="Pre-operative assessment">
                    <Textarea name="pre_op_assessment" defaultValue={su.pre_op_assessment ?? ""} className="min-h-20" />
                  </Field>
                </ActionForm>
                {["in_theatre", "recovery"].includes(su.status) && (
                  <Disclosure label="Anaesthetic record" variant="secondary">
                    <ActionForm action={surgeryStep.bind(null, id, "anaesthesia_record")} submitLabel="Save record" resetOnSuccess={false}>
                      <Textarea name="anaesthesia_record" defaultValue={su.anaesthesia_record ?? ""} className="min-h-28" placeholder="Agents, airway, monitoring, fluids, events" />
                    </ActionForm>
                  </Disclosure>
                )}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Consumables and implants" />
            <CardBody className="flex flex-col gap-3 text-sm">
              {(su.edoshmis_surgery_consumables as { id: string; quantity: number; edoshmis_stock_items: { name: string; unit: string } }[]).map((c) => (
                <p key={c.id}>
                  {Number(c.quantity)} {c.edoshmis_stock_items.unit} {c.edoshmis_stock_items.name}
                </p>
              ))}
              {(su.edoshmis_surgery_implants as { id: string; description: string; lot_number: string | null; serial_number: string | null }[]).map((m) => (
                <p key={m.id} className="font-medium">
                  Implant: {m.description} <span className="tnum text-xs font-normal text-ink-faint">lot {m.lot_number ?? "—"} · serial {m.serial_number ?? "—"}</span>
                </p>
              ))}
              {perform && ["in_theatre", "recovery"].includes(su.status) && (
                <>
                  <Disclosure label="Use consumable" variant="secondary">
                    <ActionForm action={addConsumable.bind(null, id)} submitLabel="Record">
                      <Field label="Item" required>
                        <Select name="item_id" required defaultValue="">
                          <option value="" disabled>
                            Choose
                          </option>
                          {items?.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.name} ({it.unit})
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Quantity" required>
                        <Input name="quantity" inputMode="decimal" required />
                      </Field>
                    </ActionForm>
                  </Disclosure>
                  <Disclosure label="Record implant" variant="secondary">
                    <ActionForm action={addImplant.bind(null, id)} submitLabel="Record implant">
                      <Field label="Implant" required>
                        <Input name="description" required />
                      </Field>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Lot no.">
                          <Input name="lot_number" />
                        </Field>
                        <Field label="Serial no.">
                          <Input name="serial_number" />
                        </Field>
                        <Field label="Manufacturer">
                          <Input name="manufacturer" />
                        </Field>
                        <Field label="Site">
                          <Input name="site" />
                        </Field>
                      </div>
                    </ActionForm>
                  </Disclosure>
                </>
              )}
            </CardBody>
          </Card>
          {["requested", "scheduled"].includes(su.status) && can(s, "theatre.schedule") && (
            <Disclosure label="Cancel surgery" variant="ghost">
              <ActionForm action={surgeryStep.bind(null, id, "cancel")} submitLabel="Cancel" submitVariant="danger">
                <Field label="Reason" required>
                  <Input name="reason" required />
                </Field>
              </ActionForm>
            </Disclosure>
          )}
        </div>
      </div>
    </>
  );
}
