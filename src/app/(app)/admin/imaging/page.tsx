import type { Metadata } from "next";
import { Plus, ScanLine } from "lucide-react";
import { Card, Disclosure, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ksh, titleCase } from "@/lib/format";
import { saveExam } from "../../imaging/actions";

export const metadata: Metadata = { title: "Imaging catalogue" };

const MODALITIES = ["xray", "ultrasound", "ct", "mri", "mammography", "fluoroscopy", "dexa", "other"] as const;

export default async function ImagingCatalogue() {
  const s = await requireStaff();
  if (!can(s, "imaging.configure")) return <EmptyState icon={ScanLine} title="Your role does not include the imaging catalogue." />;
  const supabase = await createClient();
  const [{ data: exams }, { data: tariffs }] = await Promise.all([
    supabase.from("edoshmis_imaging_exams").select("*").eq("facility_id", s.facility.id).order("modality").order("name"),
    supabase.from("edoshmis_tariffs").select("id, name, price").eq("facility_id", s.facility.id).eq("category", "radiology").eq("is_active", true).order("name"),
  ]);
  return (
    <>
      <PageHeader title="Imaging catalogue" description="Examinations clinicians can order." />
      <Disclosure label="Add examination" icon={Plus} variant="primary" size="md" className="mb-5">
        <ExamForm tariffs={tariffs ?? []} />
      </Disclosure>
      <Card>
        {!exams?.length ? (
          <EmptyState icon={ScanLine} title="No examinations yet" />
        ) : (
          <ul className="divide-y divide-line">
            {exams.map((e) => (
              <li key={e.id} className="px-5 py-3 text-sm">
                <details>
                  <summary className={`cursor-pointer ${e.is_active ? "" : "text-ink-faint line-through"}`}>
                    <span className="font-medium">{e.name}</span>{" "}
                    <span className="text-xs text-ink-faint">
                      {e.code} · {titleCase(e.modality)}
                      {e.body_part ? ` · ${e.body_part}` : ""}
                      {e.uses_contrast ? " · contrast" : ""}
                      {e.ionising ? " · ionising" : ""}
                    </span>
                  </summary>
                  <div className="mt-3">
                    <ExamForm e={e} tariffs={tariffs ?? []} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function ExamForm({ e, tariffs }: { e?: Record<string, string | boolean | null>; tariffs: { id: string; name: string; price: number }[] }) {
  return (
    <ActionForm action={saveExam.bind(null, (e?.id as string) ?? null)} submitLabel={e ? "Save" : "Add examination"} resetOnSuccess={!e}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" required>
          <Input name="name" required defaultValue={(e?.name as string) ?? ""} placeholder="Chest X-ray PA" />
        </Field>
        <Field label="Code" required>
          <Input name="code" required defaultValue={(e?.code as string) ?? ""} className="uppercase" />
        </Field>
        <Field label="Modality">
          <Select name="modality" defaultValue={(e?.modality as string) ?? "xray"}>
            {MODALITIES.map((m) => (
              <option key={m} value={m}>
                {titleCase(m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Body part">
          <Input name="body_part" defaultValue={(e?.body_part as string) ?? ""} />
        </Field>
        <Field label="Price">
          <Select name="tariff_id" defaultValue={(e?.tariff_id as string) ?? ""}>
            <option value="">Not charged</option>
            {tariffs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {ksh(t.price)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Preparation">
          <Input name="preparation" defaultValue={(e?.preparation as string) ?? ""} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="ionising" defaultChecked={e ? Boolean(e.ionising) : true} className="h-4 w-4 accent-brand" /> Ionising (asks pregnancy status)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="uses_contrast" defaultChecked={Boolean(e?.uses_contrast)} className="h-4 w-4 accent-brand" /> Uses contrast
        </label>
        {e && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="inactive" defaultChecked={!e.is_active} className="h-4 w-4 accent-brand" /> No longer offered
          </label>
        )}
      </div>
    </ActionForm>
  );
}
