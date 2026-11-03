"use client";

import { useActionState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardBody, CardHeader, Check, Field, Input, Select, Textarea, buttonClass } from "@/components/ui/primitives";
import { initialState } from "@/lib/action-state";
import { KENYA_COUNTIES } from "@/lib/kenya";
import { registerPatient, type Duplicate } from "../actions";

/**
 * Registration, laid out for a phone first: one column, the fields a
 * front desk always has at the top, numeric keyboards for numbers. The form
 * keeps what was typed when the server sends it back — for a duplicate
 * warning, the matches are listed with a link to each, and saving anyway
 * needs a reason, which goes into the audit log.
 */
export function RegisterForm() {
  const [state, action] = useActionState(registerPatient, initialState);
  const [pending, startTransition] = useTransition();
  const dups = (state.data?.duplicates ?? []) as Duplicate[];

  return (
    <form
      className="grid gap-5 lg:grid-cols-[1fr_340px]"
      onSubmit={(e) => {
        // By hand, so a duplicate warning keeps everything typed.
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => action(fd));
      }}
    >
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Identity" />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field label="First name" required>
              <Input name="first_name" required autoComplete="off" autoCapitalize="words" />
            </Field>
            <Field label="Middle name">
              <Input name="middle_name" autoComplete="off" autoCapitalize="words" />
            </Field>
            <Field label="Surname" required>
              <Input name="last_name" required autoComplete="off" autoCapitalize="words" />
            </Field>
            <Field label="Sex" required>
              <Select name="sex" required defaultValue="">
                <option value="" disabled>
                  Choose
                </option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="intersex">Intersex</option>
                <option value="unknown">Unknown</option>
              </Select>
            </Field>
            <Field label="Date of birth" hint="Or give the age if the date is not known">
              <Input name="date_of_birth" type="date" max={new Date().toISOString().slice(0, 10)} />
            </Field>
            <Field label="Age (years)" hint="Recorded as an estimate">
              <Input name="age_years" inputMode="numeric" pattern="[0-9]*" />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Identification" description="At least one where the patient has it — it is the surest duplicate check." />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="National ID">
              <Input name="id_national_id" inputMode="numeric" autoComplete="off" />
            </Field>
            <Field label="SHA member number">
              <Input name="id_sha_member" autoComplete="off" />
            </Field>
            <Field label="Passport">
              <Input name="id_passport" autoComplete="off" className="uppercase" />
            </Field>
            <Field label="Birth certificate (children)">
              <Input name="id_birth_certificate" autoComplete="off" />
            </Field>
            <Field label="Alien / refugee ID">
              <Input name="id_alien_id" autoComplete="off" />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contact and address" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone" hint="0712 345 678">
              <Input name="phone" type="tel" inputMode="tel" autoComplete="off" />
            </Field>
            <Field label="Alternative phone">
              <Input name="phone_alt" type="tel" inputMode="tel" autoComplete="off" />
            </Field>
            <Field label="County">
              <Select name="county" defaultValue="">
                <option value="">—</option>
                {KENYA_COUNTIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Sub-county">
              <Input name="sub_county" />
            </Field>
            <Field label="Physical address / village" className="sm:col-span-2">
              <Input name="address" />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" inputMode="email" />
            </Field>
            <Field label="Occupation">
              <Input name="occupation" />
            </Field>
            <Field label="Marital status">
              <Select name="marital_status" defaultValue="">
                <option value="">—</option>
                <option>Single</option>
                <option>Married</option>
                <option>Divorced</option>
                <option>Widowed</option>
                <option>Separated</option>
              </Select>
            </Field>
            <Field label="Blood group" hint="Only if confirmed">
              <Select name="blood_group" defaultValue="">
                <option value="">Not known</option>
                {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </Select>
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Next of kin and emergency contact" />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <Field label="Next of kin">
              <Input name="nok_name" autoCapitalize="words" />
            </Field>
            <Field label="Relationship">
              <Input name="nok_relationship" placeholder="e.g. Spouse" />
            </Field>
            <Field label="Phone">
              <Input name="nok_phone" type="tel" inputMode="tel" />
            </Field>
            <Field label="Emergency contact / guardian">
              <Input name="em_name" autoCapitalize="words" />
            </Field>
            <Field label="Relationship">
              <Input name="em_relationship" />
            </Field>
            <Field label="Phone">
              <Input name="em_phone" type="tel" inputMode="tel" />
            </Field>
            <Field label="This person is the">
              <Select name="em_kind" defaultValue="emergency">
                <option value="emergency">Emergency contact</option>
                <option value="guardian">Legal guardian (minor / incapacitated)</option>
              </Select>
            </Field>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-5 lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardHeader title="Allergies" />
          <CardBody>
            <Field label="Allergy status" hint="Details can be added on the patient's record">
              <Select name="allergies_reviewed" defaultValue="unknown">
                <option value="unknown">Not yet asked</option>
                <option value="nkda">No known allergies (asked)</option>
                <option value="has_allergies">Has allergies — record them next</option>
              </Select>
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Consent" />
          <CardBody className="flex flex-col gap-3">
            <Check
              name="consent_data_processing"
              required
              label="The patient (or guardian) consents to their personal and health data being recorded and used for their care."
              hint="Data Protection Act, 2019. Required to register."
            />
            <Check name="consent_sms" label="They agree to appointment and result SMS." />
          </CardBody>
        </Card>

        {dups.length > 0 && (
          <Card className="border-attention/50">
            <CardHeader title="Possible duplicates" icon={AlertTriangle} />
            <CardBody className="flex flex-col gap-3">
              <ul className="flex flex-col gap-2">
                {dups.map((d) => (
                  <li key={d.patient_id} className="rounded-lg border border-line bg-surface-sunk/60 px-3 py-2 text-sm">
                    <Link href={`/patients/${d.patient_id}`} className="font-medium text-brand hover:underline">
                      {d.full_name}
                    </Link>
                    <span className="block text-xs text-ink-faint">
                      {d.hospital_number} · {d.date_of_birth ?? "DOB unknown"} {d.phone ? `· ${d.phone}` : ""}
                    </span>
                    <span className="block text-xs text-attention-ink">{d.reasons.join(" · ")}</span>
                  </li>
                ))}
              </ul>
              <Field label="It is a different person because…" hint="Recorded in the audit log">
                <Textarea name="duplicate_override" className="min-h-16" placeholder="e.g. Same name and birthday; different mother, checked ID" />
              </Field>
            </CardBody>
          </Card>
        )}

        {state.error && (
          <p role="alert" className="flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {state.error}
          </p>
        )}
        <Submit again={dups.length > 0} pending={pending} />
      </div>
    </form>
  );
}

function Submit({ again, pending }: { again: boolean; pending: boolean }) {
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary", "lg", "w-full")}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {again ? "Register as a different person" : "Register patient"}
    </button>
  );
}
