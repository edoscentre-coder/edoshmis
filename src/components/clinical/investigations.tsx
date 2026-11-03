import Link from "next/link";
import { FlaskConical, Plus, ScanLine } from "lucide-react";
import { Badge, Card, CardHeader, Disclosure, EmptyState, Field, Select, Textarea } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can, type StaffSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { orderLab } from "@/app/(app)/lab/actions";
import { orderImaging } from "@/app/(app)/imaging/actions";

export const FLAG_TONE: Record<string, string> = {
  normal: "text-ink",
  low: "text-attention-ink font-semibold",
  high: "text-attention-ink font-semibold",
  abnormal: "text-attention-ink font-semibold",
  critical_low: "text-critical-ink font-bold",
  critical_high: "text-critical-ink font-bold",
};
export const FLAG_MARK: Record<string, string> = { low: "L", high: "H", critical_low: "LL", critical_high: "HH", abnormal: "A" };

interface LabOrder {
  id: string;
  order_number: string;
  priority: string;
  status: string;
  ordered_at: string;
  accession: string | null;
  validated_at: string | null;
  cancel_reason: string | null;
  edoshmis_lab_order_items: { id: string; test_name: string; status: string }[];
  edoshmis_lab_results: { id: string; item_id: string; value_text: string; unit: string | null; flag: string | null; ref_display: string | null; is_current: boolean; edoshmis_lab_parameters: { name: string; sort_order: number } | null }[];
}
interface ImagingOrder {
  id: string;
  exam_name: string;
  accession_number: string;
  priority: string;
  status: string;
  ordered_at: string;
  findings: string | null;
  impression: string | null;
  validated_at: string | null;
}

/**
 * Lab and imaging for one admission or one outpatient visit: order, follow
 * the status, read the results. Shared by the inpatient workspace and the
 * outpatient visit, so a doctor reads results the same way everywhere.
 */
export async function Investigations({ s, admissionId, encounterId, patientSex, open }: { s: StaffSession; admissionId?: string; encounterId?: string; patientSex: string; open: boolean }) {
  const supabase = await createClient();
  const col = admissionId ? "admission_id" : "encounter_id";
  const id = (admissionId ?? encounterId)!;
  const [{ data: labs }, { data: imgs }, tests, exams] = await Promise.all([
    supabase
      .from("edoshmis_lab_orders")
      .select("id, order_number, priority, status, ordered_at, accession, validated_at, cancel_reason, edoshmis_lab_order_items(id, test_name, status), edoshmis_lab_results(id, item_id, value_text, unit, flag, ref_display, is_current, edoshmis_lab_parameters(name, sort_order))")
      .eq(col, id)
      .order("ordered_at", { ascending: false }),
    supabase.from("edoshmis_imaging_orders").select("id, exam_name, accession_number, priority, status, ordered_at, findings, impression, validated_at").eq(col, id).order("ordered_at", { ascending: false }),
    can(s, "lab.order") && open ? supabase.from("edoshmis_lab_tests").select("id, name, discipline").eq("facility_id", s.facility.id).eq("is_active", true).order("discipline").order("name") : Promise.resolve({ data: null }),
    can(s, "imaging.order") && open ? supabase.from("edoshmis_imaging_exams").select("id, name, modality, ionising").eq("facility_id", s.facility.id).eq("is_active", true).order("modality").order("name") : Promise.resolve({ data: null }),
  ]);
  const target = admissionId ? { admissionId } : { encounterId };
  const labList = (labs ?? []) as unknown as LabOrder[];
  const imgList = (imgs ?? []) as unknown as ImagingOrder[];

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader
          title={`Laboratory · ${labList.length}`}
          icon={FlaskConical}
          actions={
            tests.data && (
              <Disclosure label="Order tests" icon={Plus} variant="primary">
                {tests.data.length === 0 ? (
                  <p className="text-sm text-ink-soft">The lab has not set up its test catalogue yet.</p>
                ) : (
                  <ActionForm action={orderLab.bind(null, target)} submitLabel="Order">
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-line bg-surface p-2">
                      {Object.entries(group(tests.data, (t) => t.discipline)).map(([disc, ts]) => (
                        <fieldset key={disc} className="mb-2">
                          <legend className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">{titleCase(disc)}</legend>
                          {ts.map((t) => (
                            <label key={t.id} className="flex items-center gap-2 py-0.5 text-sm">
                              <input type="checkbox" name="test_ids" value={t.id} className="h-4 w-4 accent-brand" /> {t.name}
                            </label>
                          ))}
                        </fieldset>
                      ))}
                    </div>
                    <Field label="Priority">
                      <Select name="priority" defaultValue="routine">
                        <option value="routine">Routine</option>
                        <option value="urgent">Urgent</option>
                        <option value="stat">STAT</option>
                      </Select>
                    </Field>
                    <Field label="Clinical information">
                      <Textarea name="clinical_info" className="min-h-14" />
                    </Field>
                  </ActionForm>
                )}
              </Disclosure>
            )
          }
        />
        {labList.length === 0 ? (
          <EmptyState icon={FlaskConical} title="No lab orders" />
        ) : (
          <ul className="divide-y divide-line">
            {labList.map((o) => (
              <li key={o.id} className="px-4 py-3 text-sm sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/lab/${o.id}`} className="font-medium hover:text-brand">
                    {o.edoshmis_lab_order_items.map((i) => i.test_name).join(", ")}
                  </Link>
                  <span className="flex gap-1">
                    {o.priority !== "routine" && <Badge tone="critical">{o.priority.toUpperCase()}</Badge>}
                    <Badge tone={o.status === "validated" ? "positive" : o.status === "cancelled" ? "neutral" : "info"}>{titleCase(o.status)}</Badge>
                  </span>
                </div>
                <p className="tnum text-xs text-ink-faint">
                  {o.order_number} · {fmtDateTime(o.ordered_at)}
                  {o.accession ? ` · ${o.accession}` : ""}
                  {o.cancel_reason ? ` · ${o.cancel_reason}` : ""}
                </p>
                <ResultTable order={o} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title={`Imaging · ${imgList.length}`}
          icon={ScanLine}
          actions={
            exams.data && (
              <Disclosure label="Order imaging" icon={Plus} variant="primary">
                {exams.data.length === 0 ? (
                  <p className="text-sm text-ink-soft">Radiology has not set up its examination catalogue yet.</p>
                ) : (
                  <ActionForm action={orderImaging.bind(null, target)} submitLabel="Order">
                    <Field label="Examination" required>
                      <Select name="exam_id" required defaultValue="">
                        <option value="" disabled>
                          Choose
                        </option>
                        {exams.data.map((e) => (
                          <option key={e.id} value={e.id}>
                            {titleCase(e.modality)} · {e.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Clinical indication" required>
                      <Textarea name="clinical_indication" required className="min-h-14" />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Priority">
                        <Select name="priority" defaultValue="routine">
                          <option value="routine">Routine</option>
                          <option value="urgent">Urgent</option>
                          <option value="stat">STAT</option>
                        </Select>
                      </Field>
                      {patientSex === "female" && (
                        <Field label="Pregnancy status" required>
                          <Select name="pregnancy_status" defaultValue="">
                            <option value="">Choose</option>
                            <option value="not_pregnant">Not pregnant</option>
                            <option value="pregnant">Pregnant</option>
                            <option value="unknown">Unknown</option>
                            <option value="not_applicable">Not applicable</option>
                          </Select>
                        </Field>
                      )}
                    </div>
                  </ActionForm>
                )}
              </Disclosure>
            )
          }
        />
        {imgList.length === 0 ? (
          <EmptyState icon={ScanLine} title="No imaging" />
        ) : (
          <ul className="divide-y divide-line">
            {imgList.map((o) => (
              <li key={o.id} className="px-4 py-3 text-sm sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={`/imaging/${o.id}`} className="font-medium hover:text-brand">
                    {o.exam_name}
                  </Link>
                  <Badge tone={o.status === "validated" ? "positive" : o.status === "cancelled" ? "neutral" : "info"}>{titleCase(o.status)}</Badge>
                </div>
                <p className="tnum text-xs text-ink-faint">
                  {o.accession_number} · {fmtDateTime(o.ordered_at)}
                </p>
                {o.impression && (
                  <p className={cn("mt-1.5 rounded-lg px-3 py-2", o.validated_at ? "bg-surface-sunk/70" : "bg-attention-soft/60")}>
                    {!o.validated_at && <span className="block text-xs font-medium text-attention-ink">Preliminary — not yet validated</span>}
                    <span className="font-medium">Impression:</span> {o.impression}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ResultTable({ order }: { order: LabOrder }) {
  const current = order.edoshmis_lab_results.filter((r) => r.is_current);
  if (!current.length) return null;
  return (
    <div className={cn("mt-2 rounded-lg px-3 py-2", order.validated_at ? "bg-surface-sunk/70" : "bg-attention-soft/50")}>
      {!order.validated_at && <p className="mb-1 text-xs font-medium text-attention-ink">Not yet validated by the lab</p>}
      <table className="tnum w-full text-xs">
        <tbody>
          {current
            .sort((a, b) => (a.edoshmis_lab_parameters?.sort_order ?? 0) - (b.edoshmis_lab_parameters?.sort_order ?? 0))
            .map((r) => (
              <tr key={r.id}>
                <td className="py-0.5 pr-3 text-ink-soft">{r.edoshmis_lab_parameters?.name}</td>
                <td className={cn("py-0.5 pr-3", FLAG_TONE[r.flag ?? "normal"])}>
                  {r.value_text} {r.unit}
                  {r.flag && FLAG_MARK[r.flag] ? ` ${FLAG_MARK[r.flag]}` : ""}
                </td>
                <td className="py-0.5 text-ink-faint">{r.ref_display}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function group<T>(xs: T[], key: (x: T) => string) {
  return xs.reduce<Record<string, T[]>>((acc, x) => ((acc[key(x)] ??= []).push(x), acc), {});
}
