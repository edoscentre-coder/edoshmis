"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { buttonClass, type ButtonVariant } from "@/components/ui/primitives";
import { initialState, type ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * A form posting to a server action, with the database's own message shown
 * when it refuses — "Bed A2 is occupied", "Allergy warning: Penicillin…" —
 * because those are written for the person at the bedside.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitVariant = "primary",
  className,
  resetOnSuccess = true,
  confirm,
  footer,
  onDone,
}: {
  action: Action;
  children?: React.ReactNode;
  submitLabel: React.ReactNode;
  submitVariant?: ButtonVariant;
  className?: string;
  resetOnSuccess?: boolean;
  /** Asked before submitting — for actions that cannot be taken back. */
  confirm?: string;
  footer?: React.ReactNode;
  onDone?: (state: ActionState) => void;
}) {
  const [state, formAction] = useActionState(action, initialState);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onDone?.(state);
      // Close the disclosure this form sits in, if any.
      const details = ref.current?.closest("details");
      if (details && resetOnSuccess) details.open = false;
    }
  }, [state, resetOnSuccess, onDone]);

  return (
    <form
      ref={ref}
      className={cn("flex flex-col gap-3", className)}
      onSubmit={(e) => {
        // Dispatched by hand rather than through `action=`, so a refused
        // submission keeps what was typed (React resets action forms).
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        // Include the pressed button, so name/value buttons ("Save draft") reach the action.
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(fd));
      }}
    >
      {children}
      {state.error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{state.error}</span>
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-positive-soft px-3 py-2 text-sm text-positive-ink">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{state.message}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Submit variant={submitVariant} pending={pending}>
          {submitLabel}
        </Submit>
        {footer}
      </div>
    </form>
  );
}

function Submit({ children, variant, pending }: { children: React.ReactNode; variant: ButtonVariant; pending: boolean }) {
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, "md")}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** A one-click action (acknowledge, verify, mark cleaned) as a small form. */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  confirm,
  hidden,
}: {
  action: Action;
  children: React.ReactNode;
  variant?: ButtonVariant;
  confirm?: string;
  hidden?: Record<string, string>;
}) {
  const [state, formAction] = useActionState(action, initialState);
  return (
    <form
      action={formAction}
      className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SmallSubmit variant={variant}>{children}</SmallSubmit>
      {state.error && <span className="max-w-xs text-xs text-critical-ink">{state.error}</span>}
    </form>
  );
}

function SmallSubmit({ children, variant }: { children: React.ReactNode; variant: ButtonVariant }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, "sm")}>
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
