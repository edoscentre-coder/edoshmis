import type { Metadata } from "next";
import { UserPlus } from "lucide-react";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { can, requireStaff } from "@/lib/session";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Register patient" };

export default async function NewPatientPage() {
  const s = await requireStaff();
  if (!can(s, "patients.register")) return <EmptyState icon={UserPlus} title="Your role does not include registering patients." />;
  return (
    <>
      <Breadcrumbs trail={[{ label: "Patients", href: "/patients" }, { label: "Register" }]} />
      <PageHeader title="Register a patient" description="Look the person up first — the form checks for duplicates before it saves." />
      <RegisterForm />
    </>
  );
}
