import { FileSignature, Lock, NotebookPen, PenLine, Sparkles } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Disclosure, EmptyState, Field, Select, Textarea } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { can } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmtDateTime, titleCase } from "@/lib/format";
import { addAddendum, signNote, writeClinicalNote } from "../../../actions";
import type { Ctx } from "../context";

interface Note {
  id: string;
  note_type: string;
  author_id: string;
  author_designation: string;
  subjective: string | null;
  findings: string;
  assessment: string | null;
  plan: string | null;
  discharge_ready: boolean | null;
  specialist_requested: string | null;
  status: string;
  signed_at: string | null;
  ai_assisted: boolean;
  created_at: string;
  author: { full_name: string } | null;
  edoshmis_note_addenda: { id: string; body: string; created_at: string; author_designation: string; author: { full_name: string } | null }[];
}

/**
 * Doctors' notes and ward rounds. A note is signed when written (or saved
 * as a draft only its author can finish); once signed the database refuses
 * any change, and corrections are dated, signed addenda underneath it.
 */
export async function NotesTab({ ctx }: { ctx: Ctx }) {
  const { s, admission: a, open } = ctx;
  const supabase = await createClient();
  const { data } = await supabase
    .from("edoshmis_clinical_notes")
    .select(
      "*, author:edoshmis_staff!edoshmis_clinical_notes_author_id_fkey(full_name), edoshmis_note_addenda(id, body, created_at, author_designation, author:edoshmis_staff!edoshmis_note_addenda_author_id_fkey(full_name))",
    )
    .eq("admission_id", a.id)
    .order("created_at", { ascending: false });
  const notes = (data ?? []) as unknown as Note[];
  const write = can(s, "clinical.notes");

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
      <div className="order-2 flex min-w-0 flex-col gap-4 lg:order-1">
        {notes.length === 0 ? (
          <Card>
            <EmptyState icon={NotebookPen} title="No clinical notes yet" />
          </Card>
        ) : (
          notes.map((n) => (
            <Card key={n.id}>
              <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
                <div>
                  <p className="text-sm font-semibold">{titleCase(n.note_type)}</p>
                  <p className="text-xs text-ink-faint">
                    {n.author?.full_name} · {titleCase(n.author_designation)} · {fmtDateTime(n.created_at)}
                  </p>
                </div>
                <span className="flex items-center gap-1.5">
                  {n.ai_assisted && (
                    <Badge tone="info">
                      <Sparkles className="h-3 w-3" aria-hidden="true" /> AI-assisted draft, clinician-approved
                    </Badge>
                  )}
                  {n.status === "signed" ? (
                    <Badge tone="positive">
                      <Lock className="h-3 w-3" aria-hidden="true" /> Signed {fmtDateTime(n.signed_at)}
                    </Badge>
                  ) : (
                    <Badge tone="attention">Draft</Badge>
                  )}
                </span>
              </header>
              <CardBody className="flex flex-col gap-2.5 text-sm">
                {n.subjective && <Section label="Subjective">{n.subjective}</Section>}
                <Section label="Findings">{n.findings}</Section>
                {n.assessment && <Section label="Assessment">{n.assessment}</Section>}
                {n.plan && <Section label="Plan">{n.plan}</Section>}
                {(n.discharge_ready !== null || n.specialist_requested) && (
                  <div className="flex flex-wrap gap-1.5">
                    {n.discharge_ready !== null && <Badge tone={n.discharge_ready ? "positive" : "neutral"}>{n.discharge_ready ? "Fit for discharge" : "Not yet fit for discharge"}</Badge>}
                    {n.specialist_requested && <Badge tone="info">Specialist review: {n.specialist_requested}</Badge>}
                  </div>
                )}
                {n.edoshmis_note_addenda.length > 0 && (
                  <div className="mt-1 flex flex-col gap-2 border-t border-line pt-2.5">
                    {n.edoshmis_note_addenda.map((ad) => (
                      <div key={ad.id} className="rounded-lg bg-attention-soft/50 px-3 py-2">
                        <p className="text-xs font-medium text-attention-ink">
                          Addendum · {ad.author?.full_name} · {titleCase(ad.author_designation)} · {fmtDateTime(ad.created_at)}
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap">{ad.body}</p>
                      </div>
                    ))}
                  </div>
                )}
                {write && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {n.status === "draft" && n.author_id === s.staff.id && (
                      <ActionButton action={signNote.bind(null, n.id)} variant="primary" confirm="Sign this note? It cannot be edited afterwards.">
                        <FileSignature className="h-3.5 w-3.5" aria-hidden="true" /> Sign
                      </ActionButton>
                    )}
                    {n.status === "signed" && (
                      <Disclosure label="Add addendum" icon={PenLine} variant="ghost">
                        <ActionForm action={addAddendum.bind(null, "clinical", n.id)} submitLabel="Sign addendum">
                          <Field label="Addendum" required hint="The original stays as written; this is added below it, signed by you.">
                            <Textarea name="body" required />
                          </Field>
                        </ActionForm>
                      </Disclosure>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          ))
        )}
      </div>

      {write && open && (
        <div className="order-1 lg:order-2 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <CardHeader title="New note" icon={NotebookPen} description={`Signed as ${s.staff.fullName}, ${titleCase(s.staff.designation)}`} />
            <CardBody>
              <ActionForm
                action={writeClinicalNote.bind(null, a.id, a.facility_id)}
                submitLabel="Sign note"
                footer={
                  <button type="submit" name="intent" value="draft" className="text-sm text-ink-soft hover:text-ink">
                    Save draft
                  </button>
                }
              >
                <Field label="Type">
                  <Select name="note_type" defaultValue="ward_round">
                    <option value="ward_round">Ward round</option>
                    <option value="progress">Progress note</option>
                    <option value="admission">Admission clerking</option>
                    <option value="consult">Consultation</option>
                    <option value="specialist_review">Specialist review</option>
                    <option value="discharge_readiness">Discharge readiness</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Subjective">
                  <Textarea name="subjective" className="min-h-16" placeholder="How the patient says they are" />
                </Field>
                <Field label="Findings" required>
                  <Textarea name="findings" required placeholder="Examination, results reviewed" />
                </Field>
                <Field label="Assessment">
                  <Textarea name="assessment" className="min-h-16" />
                </Field>
                <Field label="Plan">
                  <Textarea name="plan" className="min-h-20" placeholder="Investigations, treatment changes, decisions" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Fit for discharge?">
                    <Select name="discharge_ready" defaultValue="">
                      <option value="">Not assessed</option>
                      <option value="true">Yes</option>
                      <option value="false">Not yet</option>
                    </Select>
                  </Field>
                  <Field label="Specialist review">
                    <input name="specialist_requested" placeholder="e.g. Cardiology" className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm" />
                  </Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-ink">{children}</p>
    </div>
  );
}
