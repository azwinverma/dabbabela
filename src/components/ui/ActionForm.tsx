"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action";
import { buttonClass } from "./Button";
import { cn } from "@/lib/utils";

type Props = {
  action: (prev: ActionResult, data: FormData) => Promise<ActionResult>;
  children: React.ReactNode | ((state: ActionResult) => React.ReactNode);
  className?: string;
  resetOnSuccess?: boolean;
  showMessage?: boolean;
  id?: string;
};

/** Wraps a server action with pending state, inline messages and optional redirect. */
export function ActionForm({ action, children, className, resetOnSuccess, showMessage = true, id }: Props) {
  const [state, formAction] = useActionState(action, { ok: false } as ActionResult);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
    else if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      router.refresh();
    }
  }, [state, resetOnSuccess, router]);

  return (
    <form ref={ref} action={formAction} className={className} id={id}>
      {typeof children === "function" ? children(state) : children}
      {showMessage && state.message && <FormMessage ok={state.ok} message={state.message} />}
    </form>
  );
}

export function FormMessage({ ok, message }: { ok: boolean; message: string }) {
  return (
    <p
      role={ok ? "status" : "alert"}
      className={cn(
        "mt-3 rounded-lg border px-3 py-2 text-sm font-medium",
        ok ? "border-saag/30 bg-saag-light text-saag-dark" : "border-sindoor/30 bg-sindoor-light text-sindoor-dark",
      )}
    >
      {message}
    </p>
  );
}

export function SubmitButton({
  children,
  pendingText = "Saving…",
  variant = "primary",
  size = "md",
  className,
  name,
  value,
  confirm,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: Parameters<typeof buttonClass>[0];
  size?: Parameters<typeof buttonClass>[1];
  className?: string;
  name?: string;
  value?: string;
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={buttonClass(variant, size, className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingText : children}
    </button>
  );
}
