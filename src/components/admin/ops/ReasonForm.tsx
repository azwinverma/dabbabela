"use client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import type { ActionResult } from "@/lib/action";

/** Small inline form for an action that needs a written reason (audited). */
export function ReasonForm({ action, label, placeholder = "Reason (goes in the audit log)", children, variant = "outline", confirm }: { action: (p: ActionResult, fd: FormData) => Promise<ActionResult>; label: string; placeholder?: string; children?: React.ReactNode; variant?: "outline" | "danger" | "dark" | "primary"; confirm?: string }) {
  return (
    <ActionForm action={action} className="space-y-2" resetOnSuccess>
      {children}
      <input name="reason" required minLength={3} placeholder={placeholder} className="field" />
      <SubmitButton variant={variant} size="sm" confirm={confirm}>
        {label}
      </SubmitButton>
    </ActionForm>
  );
}
