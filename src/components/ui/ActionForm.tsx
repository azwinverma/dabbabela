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
  // React resets uncontrolled forms after every action — including refused ones. Snapshot the fields on submit
  // and put them back when the action fails, so staff don't retype a whole form after one validation error.
  const snapshot = useRef<Map<string, string[]> | null>(null);

  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
    else if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      router.refresh();
    } else if (state.message && snapshot.current && ref.current) {
      restoreFields(ref.current, snapshot.current);
    }
    snapshot.current = null;
  }, [state, resetOnSuccess, router]);

  return (
    <form ref={ref} action={formAction} onSubmit={(e) => (snapshot.current = captureFields(e.currentTarget))} className={className} id={id}>
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

function captureFields(form: HTMLFormElement) {
  const out = new Map<string, string[]>();
  for (const el of Array.from(form.elements)) {
    const f = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (!f.name || f.type === "file" || f.type === "submit" || f.type === "button" || f.type === "password") continue;
    const key = f.name;
    const list = out.get(key) ?? [];
    if (f instanceof HTMLInputElement && (f.type === "checkbox" || f.type === "radio")) {
      if (f.checked) list.push(f.value);
    } else if (f instanceof HTMLSelectElement && f.multiple) {
      list.push(...Array.from(f.selectedOptions).map((o) => o.value));
    } else list.push(f.value);
    out.set(key, list);
  }
  return out;
}

function restoreFields(form: HTMLFormElement, snap: Map<string, string[]>) {
  const seen = new Map<string, number>();
  for (const el of Array.from(form.elements)) {
    const f = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (!f.name || !snap.has(f.name) || f.type === "file" || f.type === "submit" || f.type === "button" || f.type === "password" || f.type === "hidden") continue;
    const values = snap.get(f.name)!;
    if (f instanceof HTMLInputElement && (f.type === "checkbox" || f.type === "radio")) f.checked = values.includes(f.value);
    else if (f instanceof HTMLSelectElement && f.multiple) for (const o of Array.from(f.options)) o.selected = values.includes(o.value);
    else {
      const i = seen.get(f.name) ?? 0;
      if (i < values.length) f.value = values[i];
      seen.set(f.name, i + 1);
    }
  }
}
