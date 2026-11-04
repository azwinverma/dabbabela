"use client";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea } from "@/components/ui/Fields";
import { requestDeletionAction } from "@/lib/actions/account";

export function DeleteForm() {
  return (
    <ActionForm action={requestDeletionAction} className="space-y-3">
      {(state) => (
        <>
          <Textarea label="Anything we should know? (optional)" name="note" rows={2} maxLength={500} />
          <Input label='Type DELETE to confirm' name="confirm" required error={state.errors?.confirm} autoComplete="off" />
          <SubmitButton variant="danger" size="sm">Request account deletion</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
