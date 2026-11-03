"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Field, Input, buttonClass } from "@/components/ui/primitives";
import { initialState } from "@/lib/action-state";
import { signIn } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, initialState);
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" inputMode="email" required autoFocus />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state.error && (
        <p role="alert" className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical-ink">
          {state.error}
        </p>
      )}
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary", "lg", "w-full")}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      Sign in
    </button>
  );
}
