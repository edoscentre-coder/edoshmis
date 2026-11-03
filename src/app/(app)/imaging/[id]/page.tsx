import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ScanLine } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge, Card, CardBody, CardHeader, Disclosure, Fact, Field, Input, PageHeader, Textarea } from "@/components/ui/primitives";
import { ActionButton, ActionForm } from "@/components/ui/action-form";
import { PrintButton } from "@/components/ui/print-button";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ageOf, fmtDateTime, fullName, nairobiLocalInput, titleCase } from "@/lib/format";
import { imagingStep } from "../actions";

export const metadata: Metadata = { title: "Imaging order" };

export default async function ImagingOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireStaff();
  const { id } = await params;
  const supabase = await createClient();
  const { data: o } = await supabase
    .from("edoshmis_imaging_orders")
    .select("*, edoshmis_patients(id, first_name, middle_name, last_name, hospital_number, sex, date_of_birth, dob_estimated), edoshmis_imaging_exams(modality, body_part, preparation, uses_contrast), orderer:edoshmis_staff!edoshmis_imaging_orders_ordered_by_fkey(full_name), performer:edoshmis_staff!edoshmis_imaging_orders_performed_by_fkey(full_name), reporter:edoshmis_staff!edoshmis_imaging_orders_reported_by_fkey(full_name), validator:edoshmis_staff!edoshmis_imaging_orders_validated_by_fkey(full_name), edoshmis_imaging_addenda(id, body, created_at, author:edoshmis_staff!edoshmis_imaging_addenda_author_id_fkey(full_name))")
    .eq("id", id)
    .maybeSingle();
  if (!o) notFound();
  const p = o.edoshmis_patients as { id: string; first_name: string; middle_name: string | null; last_name: string; hospital_number: string; sex: string; date_of_birth: string | null; dob_estimated: boolean };
  const ex = o.edoshmis_imaging_exams as { modality: string; body_part: string | null; preparation: string | null; uses_contrast: boolean };
  const name = (k: string) => (o[k] as { full_name: string } | null)?.full_name;
  const addenda = o.edoshmis_imaging_addenda as { id: string; body: string; created_at: string; author: { full_name: string } | null }[];

  return (
    <>
      <Breadcrumbs trail={[{ label: "Imaging", href: "/imaging" }, { label: o.accession_number }]} />
      <PageHeader
        eyebrow={<span className="tnum">{o.accession_number}</span>}
        title={`${titleCase(ex.modality)} · ${o.exam_name}`}
        description={
          <>
            <Link href={`/patients/${p.id}`} className="hover:text-brand">
              {fullName(p)}
            </Link>{" "}
            · {p.hospital_number} · {ageOf(p.date_of_birth, p.dob_estimated)} · {titleCase(p.sex)}
          </>
        }
        actions={
          <>
            {o.priority !== "routine" && <Badge tone="critical">{o.priority.toUpperCase()}</Badge>}
            {o.pregnancy_status && o.pregnancy_status !== "not_applicable" && <Badge tone={o.pregnancy_status === "pregnant" ? "attention" : "neutral"}>{titleCase(o.pregnancy_status)}</Badge>}
            <Badge tone={o.status === "validated" ? "positive" : "info"}>{titleCase(o.status)}</Badge>
            {o.status === "validated" && <PrintButton label="Print report" />}
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Request" icon={ScanLine} />
            <CardBody>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Fact label="Indication" className="col-span-2 sm:col-span-3">
                  {o.clinical_indication}
                </Fact>
                <Fact label="Ordered">{`${fmtDateTime(o.ordered_at)} · ${name("orderer")}`}</Fact>
                <Fact label="Scheduled">{o.scheduled_for ? fmtDateTime(o.scheduled_for) : null}</Fact>
                <Fact label="Performed">{o.performed_at ? `${fmtDateTime(o.performed_at)} · ${name("performer")}` : null}</Fact>
                {ex.preparation && <Fact label="Preparation">{ex.preparation}</Fact>}
                {o.technique && <Fact label="Technique">{o.technique}</Fact>}
                {o.contrast_given && <Fact label="Contrast">{o.contrast_given}</Fact>}
                {o.pacs_study_uid && <Fact label="PACS study">{o.pacs_study_uid}</Fact>}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Report" description={o.reported_at ? `${name("reporter")} · ${fmtDateTime(o.reported_at)}${o.validated_at ? ` · validated by ${name("validator")} ${fmtDateTime(o.validated_at)}` : " · not yet validated"}` : undefined} />
            <CardBody className="flex flex-col gap-3 text-sm">
              {o.findings ? (
                <>
                  <div>
                    <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">Findings</p>
                    <p className="whitespace-pre-wrap">{o.findings}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">Impression</p>
                    <p className="font-medium whitespace-pre-wrap">{o.impression}</p>
                  </div>
                  {addenda.map((a) => (
                    <p key={a.id} className="rounded-lg bg-attention-soft/50 px-3 py-2">
                      <span className="block text-xs font-medium text-attention-ink">Addendum · {a.author?.full_name} · {fmtDateTime(a.created_at)}</span>
                      {a.body}
                    </p>
                  ))}
                </>
              ) : (
                <p className="text-ink-faint">Not reported yet.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="no-print flex min-w-0 flex-col gap-5 lg:sticky lg:top-20 lg:self-start">
          {["ordered", "scheduled"].includes(o.status) && can(s, "imaging.perform") && (
            <Card>
              <CardHeader title="Radiographer" />
              <CardBody className="flex flex-col gap-3">
                <Disclosure label="Schedule">
                  <ActionForm action={imagingStep.bind(null, id, "schedule")} submitLabel="Save">
                    <Field label="When" required>
                      <Input name="scheduled_for" type="datetime-local" required />
                    </Field>
                  </ActionForm>
                </Disclosure>
                <Disclosure label="Mark performed" variant="primary">
                  <ActionForm action={imagingStep.bind(null, id, "perform")} submitLabel="Performed">
                    <Field label="Time">
                      <Input name="performed_at" type="datetime-local" defaultValue={nairobiLocalInput()} />
                    </Field>
                    <Field label="Technique / views">
                      <Input name="technique" placeholder="e.g. PA erect" />
                    </Field>
                    {ex.uses_contrast && (
                      <Field label="Contrast given">
                        <Input name="contrast_given" placeholder="Agent, volume, route" />
                      </Field>
                    )}
                    <Field label="PACS study UID" hint="When the modality is connected">
                      <Input name="pacs_study_uid" />
                    </Field>
                  </ActionForm>
                </Disclosure>
              </CardBody>
            </Card>
          )}
          {["performed", "reported"].includes(o.status) && can(s, "imaging.report") && (
            <Card>
              <CardHeader title="Report" />
              <CardBody>
                <ActionForm action={imagingStep.bind(null, id, "report")} submitLabel={o.status === "reported" ? "Update report" : "Save report"} resetOnSuccess={false}>
                  <Field label="Findings" required>
                    <Textarea name="findings" required defaultValue={o.findings ?? ""} className="min-h-32" />
                  </Field>
                  <Field label="Impression" required>
                    <Textarea name="impression" required defaultValue={o.impression ?? ""} className="min-h-16" />
                  </Field>
                </ActionForm>
              </CardBody>
            </Card>
          )}
          {o.status === "reported" && can(s, "imaging.validate") && (
            <ActionButton action={imagingStep.bind(null, id, "validate")} variant="primary" confirm="Validate and release this report?">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Validate and release
            </ActionButton>
          )}
          {o.status === "validated" && can(s, "imaging.report") && (
            <Disclosure label="Add addendum">
              <ActionForm action={imagingStep.bind(null, id, "addendum")} submitLabel="Add addendum">
                <Field label="Addendum" required>
                  <Textarea name="body" required />
                </Field>
              </ActionForm>
            </Disclosure>
          )}
          {["ordered", "scheduled"].includes(o.status) && can(s, "imaging.order", "imaging.perform") && (
            <Disclosure label="Cancel" variant="ghost">
              <ActionForm action={imagingStep.bind(null, id, "cancel")} submitLabel="Cancel examination" submitVariant="danger">
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
