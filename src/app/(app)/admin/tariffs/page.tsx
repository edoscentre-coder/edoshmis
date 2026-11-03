import type { Metadata } from "next";
import { Plus, ReceiptText } from "lucide-react";
import { Badge, Card, Disclosure, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui/primitives";
import { ActionForm } from "@/components/ui/action-form";
import { can, requireStaff } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { ksh, titleCase } from "@/lib/format";
import { saveTariff } from "../actions";

export const metadata: Metadata = { title: "Tariffs" };

const CATEGORIES = ["bed", "ward", "icu", "hdu", "consultation", "ward_round", "nursing", "medication", "laboratory", "radiology", "theatre", "procedure", "consumable", "supplies", "oxygen", "deposit", "other"] as const;

interface Tariff {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  price: number;
  sha_price: number | null;
  sha_service_code: string | null;
  is_active: boolean;
}

/** The facility's price list. A changed price applies to new charges only; posted charges keep the price they were posted at. */
export default async function TariffsPage() {
  const s = await requireStaff();
  if (!can(s, "admin.tariffs")) return <EmptyState icon={ReceiptText} title="Your role does not include prices." />;
  const supabase = await createClient();
  const { data } = await supabase.from("edoshmis_tariffs").select("*").eq("facility_id", s.facility.id).order("category").order("name");
  const rows = (data ?? []) as Tariff[];

  return (
    <>
      <PageHeader title="Tariffs" description={`Prices at ${s.facility.name}, in KSh. SHA prices apply to SHA patients where set.`} />
      <Disclosure label="Add a price" icon={Plus} variant="primary" size="md" className="mb-5">
        <TariffForm />
      </Disclosure>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No prices yet">
            Start with the bed-day charge for each ward type, then consultations, ward rounds and procedures.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((t) => (
              <li key={t.id} className="px-4 py-3 sm:px-5">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                    <span className={t.is_active ? "" : "text-ink-faint line-through"}>
                      <span className="font-medium">{t.name}</span>
                      <span className="tnum block text-xs text-ink-faint">
                        {t.code} · {titleCase(t.category)} · per {t.unit}
                        {t.sha_service_code ? ` · SHA ${t.sha_service_code}` : ""}
                      </span>
                    </span>
                    <span className="tnum flex items-center gap-2">
                      <span className="font-semibold">{ksh(t.price)}</span>
                      {t.sha_price != null && <Badge tone="info">SHA {ksh(t.sha_price)}</Badge>}
                    </span>
                  </summary>
                  <div className="mt-3">
                    <TariffForm t={t} />
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

function TariffForm({ t }: { t?: Tariff }) {
  return (
    <ActionForm action={saveTariff.bind(null, t?.id ?? null)} submitLabel={t ? "Save" : "Add price"} resetOnSuccess={!t}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" required>
          <Input name="name" required defaultValue={t?.name ?? ""} placeholder="General ward bed-day" />
        </Field>
        <Field label="Code" required>
          <Input name="code" required defaultValue={t?.code ?? ""} className="uppercase" placeholder="BED-GEN" />
        </Field>
        <Field label="Category">
          <Select name="category" defaultValue={t?.category ?? "bed"}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Price (KSh)" required>
          <Input name="price" inputMode="decimal" required defaultValue={t ? String(t.price) : ""} />
        </Field>
        <Field label="Per">
          <Input name="unit" defaultValue={t?.unit ?? "each"} placeholder="day, each, hour" />
        </Field>
        <Field label="SHA price (KSh)" hint="Blank = same as price">
          <Input name="sha_price" inputMode="decimal" defaultValue={t?.sha_price != null ? String(t.sha_price) : ""} />
        </Field>
        <Field label="SHA service code">
          <Input name="sha_service_code" defaultValue={t?.sha_service_code ?? ""} />
        </Field>
        {t && (
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="inactive" defaultChecked={!t.is_active} className="h-4 w-4 accent-brand" /> No longer offered
          </label>
        )}
      </div>
    </ActionForm>
  );
}
