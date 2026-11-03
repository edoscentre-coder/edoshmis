import { randomUUID } from "node:crypto";
import { Droplets } from "lucide-react";
import { Card, CardBody, CardHeader, Disclosure, EmptyState, Field, Input, Select } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDate, fmtTime, nairobiLocalInput, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { markFluidError, recordFluid } from "../../../actions";
import type { Ctx } from "../context";

interface Entry {
  id: string;
  recorded_at: string;
  direction: "in" | "out";
  category: string;
  volume_ml: number;
  description: string | null;
  entered_in_error: boolean;
  error_reason: string | null;
  recorder: { full_name: string } | null;
}

/** Nairobi shift of a moment: 07–14 morning, 14–21 afternoon, 21–07 night (counted to the day it started). */
function shiftOf(iso: string) {
  const d = new Date(new Date(iso).getTime() + 3 * 3600_000); // Nairobi wall time, UTC+3, no DST
  const h = d.getUTCHours();
  const day = new Date(d);
  if (h < 7) day.setUTCDate(day.getUTCDate() - 1);
  const key = day.toISOString().slice(0, 10);
  return { day: key, shift: h >= 7 && h < 14 ? "morning" : h >= 14 && h < 21 ? "afternoon" : "night" };
}

/**
 * Intake and output with running balances: per shift and per 24 hours
 * (07:00 to 07:00, the ward day). Entries are never edited; a wrong one is
 * struck through as entered in error and drops out of every total.
 */
export async function FluidsTab({ ctx }: { ctx: Ctx }) {
  const { s, admission: a, open } = ctx;
  const supabase = await createClient();
  const { data } = await supabase
    .from("edoshmis_fluid_entries")
    .select("*, recorder:edoshmis_staff!edoshmis_fluid_entries_recorded_by_fkey(full_name)")
    .eq("admission_id", a.id)
    .order("recorded_at", { ascending: false })
    .limit(500);
  const rows = (data ?? []) as unknown as Entry[];
  const valid = rows.filter((r) => !r.entered_in_error);

  const days = new Map<string, Record<string, { in: number; out: number }>>();
  for (const r of valid) {
    const { day, shift } = shiftOf(r.recorded_at);
    const d = days.get(day) ?? { morning: { in: 0, out: 0 }, afternoon: { in: 0, out: 0 }, night: { in: 0, out: 0 } };
    d[shift][r.direction] += r.volume_ml;
    days.set(day, d);
  }
  const summary = [...days.entries()].sort((x, y) => (x[0] < y[0] ? 1 : -1)).slice(0, 7);
  const record = can(s, "fluids.record") && open;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="order-2 flex min-w-0 flex-col gap-5 lg:order-1">
        <Card>
          <CardHeader title="Balance" icon={Droplets} description="Ward day 07:00–07:00 · in, out and net in ml" />
          {summary.length === 0 ? (
            <EmptyState icon={Droplets} title="Nothing recorded yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="tnum w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-faint">
                    <th className="px-5 py-2 font-medium">Day</th>
                    <th className="px-3 py-2 font-medium">Morning</th>
                    <th className="px-3 py-2 font-medium">Afternoon</th>
                    <th className="px-3 py-2 font-medium">Night</th>
                    <th className="px-5 py-2 text-right font-medium">24 h</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map(([day, sh]) => {
                    const tin = sh.morning.in + sh.afternoon.in + sh.night.in;
                    const tout = sh.morning.out + sh.afternoon.out + sh.night.out;
                    return (
                      <tr key={day} className="border-t border-line align-top">
                        <td className="px-5 py-2.5 font-medium">{fmtDate(day)}</td>
                        {(["morning", "afternoon", "night"] as const).map((k) => (
                          <td key={k} className="px-3 py-2.5 text-xs">
                            <Cell i={sh[k].in} o={sh[k].out} />
                          </td>
                        ))}
                        <td className="px-5 py-2.5 text-right text-xs">
                          <Cell i={tin} o={tout} strong />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title={`Entries · ${rows.length}`} />
          {rows.length === 0 ? (
            <CardBody className="text-sm text-ink-faint">None.</CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className={cn("flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm", r.entered_in_error && "text-ink-faint line-through")}>
                  <span className="tnum">
                    <span className="text-xs text-ink-faint">
                      {fmtDate(r.recorded_at)} {fmtTime(r.recorded_at)} ·{" "}
                    </span>
                    <span className={r.direction === "in" ? "text-brand-darker" : "text-attention-ink"}>{r.direction === "in" ? "IN" : "OUT"}</span> {titleCase(r.category)}{" "}
                    <strong>{r.volume_ml} ml</strong>
                    {r.description ? <span className="text-ink-soft"> · {r.description}</span> : null}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-ink-faint">
                    {r.recorder?.full_name}
                    {r.entered_in_error && <span className="text-critical-ink no-underline">{r.error_reason}</span>}
                    {record && !r.entered_in_error && (
                      <Disclosure label="Error" variant="ghost">
                        <ActionForm action={markFluidError.bind(null, r.id)} submitLabel="Mark in error" submitVariant="danger">
                          <Field label="Reason" required>
                            <Input name="reason" required />
                          </Field>
                        </ActionForm>
                      </Disclosure>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {record && (
        <Card className="order-1 lg:order-2 lg:sticky lg:top-20 lg:self-start">
          <CardHeader title="Record intake / output" />
          <CardBody>
            <ActionForm action={recordFluid.bind(null, a.id, a.facility_id)} submitLabel="Save">
              <input type="hidden" name="client_id" value={randomUUID()} />
              <Field label="What">
                <Select name="kind" defaultValue="in:oral">
                  <optgroup label="Intake">
                    <option value="in:oral">Oral</option>
                    <option value="in:iv">IV fluid</option>
                    <option value="in:enteral">Enteral feed</option>
                    <option value="in:blood">Blood / products</option>
                    <option value="in:other">Other intake</option>
                  </optgroup>
                  <optgroup label="Output">
                    <option value="out:urine">Urine</option>
                    <option value="out:drain">Drain</option>
                    <option value="out:vomitus">Vomitus</option>
                    <option value="out:stool">Stool</option>
                    <option value="out:aspirate">NG aspirate</option>
                    <option value="out:other">Other loss</option>
                  </optgroup>
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Volume (ml)" required>
                  <Input name="volume_ml" type="number" inputMode="numeric" min={1} max={10000} required className="tnum h-11 text-base" />
                </Field>
                <Field label="Time">
                  <Input name="recorded_at" type="datetime-local" defaultValue={nairobiLocalInput()} />
                </Field>
              </div>
              <Field label="Detail">
                <Input name="description" placeholder="e.g. Normal saline 1 L bag 2" />
              </Field>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Cell({ i, o, strong }: { i: number; o: number; strong?: boolean }) {
  const net = i - o;
  if (!i && !o) return <span className="text-ink-faint">—</span>;
  return (
    <span className={strong ? "font-semibold" : ""}>
      <span className="block">
        {i} / {o}
      </span>
      <span className={net < 0 ? "text-attention-ink" : "text-ink-soft"}>
        net {net > 0 ? "+" : ""}
        {net}
      </span>
    </span>
  );
}
