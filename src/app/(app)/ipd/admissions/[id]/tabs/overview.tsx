import Link from "next/link";
import { Activity, ArrowRightLeft, ClipboardList, Pill, Plus, Users, Wallet, X } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Disclosure, Fact, Field, Input, Select } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtDateTime, ksh, titleCase } from "@/lib/format";
import { setCareTeam, transferBed, updateAdmission } from "../../../actions";
import type { Ctx } from "../context";

export async function OverviewTab({ ctx }: { ctx: Ctx }) {
  const { s, admission: a, open } = ctx;
  const supabase = await createClient();
  const [team, orders, lastObs, esc, procs, bill, beds, staff, alloc] = await Promise.all([
    supabase.from("edoshmis_care_team").select("id, role, staff_id, started_at, edoshmis_staff!edoshmis_care_team_staff_id_fkey(full_name, designation)").eq("admission_id", a.id).is("ended_at", null),
    supabase.from("edoshmis_medication_orders").select("id, drug_name, dose, dose_unit, route, frequency, status, is_prn").eq("admission_id", a.id).in("status", ["prescribed", "verified", "on_hold"]).order("prescribed_at"),
    supabase.from("edoshmis_observations").select("*").eq("admission_id", a.id).eq("entered_in_error", false).order("observed_at", { ascending: false }).limit(1),
    supabase.from("edoshmis_escalations").select("id, level, reason, status, created_at").eq("admission_id", a.id).neq("status", "resolved"),
    supabase.from("edoshmis_procedures").select("id, name, status, scheduled_for").eq("admission_id", a.id).in("status", ["requested", "authorised", "scheduled"]),
    can(s, "billing.read", "discharge.authorize") ? supabase.from("edoshmis_account_balances").select("charges, paid, balance").eq("admission_id", a.id).maybeSingle() : Promise.resolve({ data: null }),
    open && can(s, "ipd.transfer")
      ? supabase.from("edoshmis_beds").select("id, bed_number, sex_restriction, edoshmis_wards!edoshmis_beds_ward_id_fkey(name, sex_restriction, status)").eq("facility_id", a.facility_id).eq("status", "available").eq("is_active", true).order("bed_number")
      : Promise.resolve({ data: null }),
    open && can(s, "clinical.care_team") ? supabase.from("edoshmis_staff").select("id, full_name, designation").eq("organization_id", s.staff.organizationId).eq("status", "active").order("full_name") : Promise.resolve({ data: null }),
    supabase.from("edoshmis_bed_allocations").select("started_at, ended_at, reason, edoshmis_beds(bed_number), edoshmis_wards(name)").eq("admission_id", a.id).order("started_at"),
  ]);
  const o = lastObs.data?.[0];
  const sex = ctx.patient.sex;
  const transferOptions = ((beds.data ?? []) as unknown as { id: string; bed_number: string; sex_restriction: string; edoshmis_wards: { name: string; sex_restriction: string; status: string } }[]).filter(
    (b) => b.edoshmis_wards.status !== "closed" && [b.sex_restriction, b.edoshmis_wards.sex_restriction].every((x) => x === "any" || x === sex),
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="flex min-w-0 flex-col gap-5">
        {esc.data && esc.data.length > 0 && (
          <Link href="?tab=vitals" className="rounded-xl border border-critical/30 bg-critical-soft px-4 py-3 text-sm text-critical-ink">
            <strong>{esc.data.length} open escalation(s):</strong> {esc.data.map((e) => `${e.reason} (${e.level})`).join(" · ")}
          </Link>
        )}

        <Card>
          <CardHeader
            title="Admission"
            icon={ClipboardList}
            actions={
              open &&
              can(s, "clinical.notes") && (
                <Disclosure label="Update condition">
                  <ActionForm action={updateAdmission.bind(null, a.id)} submitLabel="Save">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Condition">
                        <Select name="condition" defaultValue={a.condition ?? ""}>
                          <option value="">Not stated</option>
                          {["stable", "improving", "fair", "serious", "deteriorating", "critical"].map((c) => (
                            <option key={c} value={c}>
                              {titleCase(c)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Expected discharge">
                        <Input name="expected_discharge_date" type="date" defaultValue={a.expected_discharge_date ?? ""} />
                      </Field>
                    </div>
                  </ActionForm>
                </Disclosure>
              )
            }
          />
          <CardBody>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Fact label="Admitted">{fmtDateTime(a.admitted_at)}</Fact>
              <Fact label="From">{titleCase(a.source)}</Fact>
              <Fact label="Priority">{titleCase(a.priority)}</Fact>
              <Fact label="Payment">{titleCase(a.payment_category)}</Fact>
              <Fact label="Category">{titleCase(a.patient_category)}</Fact>
              <Fact label="Consent">{a.consent_obtained ? `Yes${a.consent_by ? ` — ${a.consent_by}` : ""}` : "Not recorded"}</Fact>
              {a.referring_facility && <Fact label="Referred from">{a.referring_facility}</Fact>}
              {a.accompanying_person && <Fact label="Accompanied by">{a.accompanying_person}</Fact>}
              <Fact label="Indication" className="col-span-2 sm:col-span-3">
                {a.indication}
              </Fact>
              {a.clinical_history && (
                <Fact label="History" className="col-span-2 sm:col-span-3">
                  {a.clinical_history}
                </Fact>
              )}
              {a.initial_assessment && (
                <Fact label="Initial assessment" className="col-span-2 sm:col-span-3">
                  {a.initial_assessment}
                </Fact>
              )}
              {a.notes && (
                <Fact label="Handover" className="col-span-2 sm:col-span-3">
                  {a.notes}
                </Fact>
              )}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Latest observations" icon={Activity} actions={<Link href="?tab=vitals" className="text-xs font-medium text-brand hover:underline">Chart</Link>} />
          <CardBody>
            {o ? (
              <>
                <dl className="tnum grid grid-cols-3 gap-3 sm:grid-cols-6">
                  <Fact label="Temp">{o.temperature != null ? `${o.temperature} °C` : null}</Fact>
                  <Fact label="Pulse">{o.pulse}</Fact>
                  <Fact label="Resp">{o.respiratory_rate}</Fact>
                  <Fact label="BP">{o.systolic_bp != null ? `${o.systolic_bp}/${o.diastolic_bp ?? "–"}` : null}</Fact>
                  <Fact label="SpO₂">{o.spo2 != null ? `${o.spo2}%${o.supplemental_o2 ? " O₂" : ""}` : null}</Fact>
                  <Fact label="EWS">{o.ews_score != null ? `${o.ews_score}${o.ews_level ? ` (${o.ews_level})` : ""}` : "Not configured"}</Fact>
                </dl>
                <p className="mt-2 text-xs text-ink-faint">{fmtDateTime(o.observed_at)}</p>
              </>
            ) : (
              <p className="text-sm text-ink-faint">No observations recorded yet.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`Current medication · ${orders.data?.length ?? 0}`} icon={Pill} actions={<Link href="?tab=meds" className="text-xs font-medium text-brand hover:underline">eMAR</Link>} />
          {orders.data?.length ? (
            <ul className="divide-y divide-line">
              {orders.data.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{m.drug_name}</span>{" "}
                    <span className="text-ink-soft">
                      {Number(m.dose)} {m.dose_unit} {m.route.toUpperCase()} {m.frequency.toUpperCase()}
                    </span>
                  </span>
                  <Badge tone={m.status === "verified" ? "positive" : m.status === "prescribed" ? "attention" : "neutral"}>
                    {m.status === "prescribed" ? "Awaiting pharmacy" : titleCase(m.status)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-sm text-ink-faint">None.</CardBody>
          )}
        </Card>

        {procs.data && procs.data.length > 0 && (
          <Card>
            <CardHeader title="Pending procedures" />
            <ul className="divide-y divide-line">
              {procs.data.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  {p.name}
                  <Badge>{p.scheduled_for ? `Scheduled ${fmtDateTime(p.scheduled_for)}` : titleCase(p.status)}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        {bill.data && (
          <Card>
            <CardHeader title="Bill" icon={Wallet} actions={<Link href="?tab=billing" className="text-xs font-medium text-brand hover:underline">Details</Link>} />
            <CardBody>
              <dl className="tnum grid grid-cols-3 gap-3">
                <Fact label="Charges">{ksh(bill.data.charges)}</Fact>
                <Fact label="Paid">{ksh(bill.data.paid)}</Fact>
                <Fact label="Balance">
                  <span className={Number(bill.data.balance) > 0 ? "font-semibold text-attention-ink" : "text-positive-ink"}>{ksh(bill.data.balance)}</span>
                </Fact>
              </dl>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Bed"
            icon={ArrowRightLeft}
            actions={
              open &&
              can(s, "ipd.transfer") && (
                <Disclosure label="Transfer">
                  {transferOptions.length === 0 ? (
                    <p className="text-sm text-ink-soft">No free bed this patient can move to.</p>
                  ) : (
                    <ActionForm action={transferBed.bind(null, a.id)} submitLabel="Transfer">
                      <Field label="To bed" required>
                        <Select name="bed_id" required defaultValue="">
                          <option value="" disabled>
                            Choose
                          </option>
                          {transferOptions.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.edoshmis_wards.name} · {b.bed_number}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Reason" required>
                        <Input name="reason" required placeholder="e.g. Stepped up to HDU" />
                      </Field>
                    </ActionForm>
                  )}
                </Disclosure>
              )
            }
          />
          <ol className="px-5 py-3 text-sm">
            {((alloc.data ?? []) as unknown as { started_at: string; ended_at: string | null; reason: string | null; edoshmis_beds: { bed_number: string }; edoshmis_wards: { name: string } }[]).map((x, i) => (
              <li key={i} className="relative border-l border-line pb-3 pl-4 last:pb-0">
                <span className={`absolute top-1.5 -left-[5px] h-2.5 w-2.5 rounded-full ${x.ended_at ? "bg-line-strong" : "bg-brand"}`} aria-hidden="true" />
                <span className="font-medium">
                  {x.edoshmis_wards.name} · {x.edoshmis_beds.bed_number}
                </span>
                <span className="block text-xs text-ink-faint">
                  {fmtDateTime(x.started_at)} → {x.ended_at ? fmtDateTime(x.ended_at) : "now"}
                  {x.reason && i > 0 ? ` · ${x.reason}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <CardHeader
            title="Care team"
            icon={Users}
            actions={
              staff.data && (
                <Disclosure label="Add" icon={Plus}>
                  <ActionForm action={setCareTeam.bind(null, a.id, true)} submitLabel="Add to team">
                    <Field label="Staff member" required>
                      <Select name="staff_id" required defaultValue="">
                        <option value="" disabled>
                          Choose
                        </option>
                        {staff.data.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.full_name} — {titleCase(m.designation)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Role">
                      <Select name="role" defaultValue="medical_officer">
                        <option value="consultant">Responsible consultant (replaces current)</option>
                        <option value="medical_officer">Medical officer</option>
                        <option value="clinical_officer">Clinical officer</option>
                        <option value="primary_nurse">Primary nurse</option>
                        <option value="specialist">Specialist (consult)</option>
                        <option value="other">Other</option>
                      </Select>
                    </Field>
                  </ActionForm>
                </Disclosure>
              )
            }
          />
          <ul className="divide-y divide-line">
            {((team.data ?? []) as unknown as { id: string; role: string; staff_id: string; edoshmis_staff: { full_name: string; designation: string } }[]).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{m.edoshmis_staff.full_name}</span>
                  <span className="block text-xs text-ink-faint">{titleCase(m.role)}</span>
                </span>
                {staff.data && m.role !== "consultant" && (
                  <ActionButton action={setCareTeam.bind(null, a.id, false)} hidden={{ staff_id: m.staff_id, role: m.role }} variant="ghost">
                    <X className="h-3.5 w-3.5" aria-label="Remove" />
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        </Card>

        {a.discharged_at && (
          <Card>
            <CardBody className="text-sm text-ink-soft">Discharged {fmtDate(a.discharged_at)}. The record is closed; corrections are made as addenda.</CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
