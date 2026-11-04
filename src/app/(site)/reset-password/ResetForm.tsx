"use client";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input } from "@/components/ui/Fields";
import { resetAction } from "@/lib/actions/auth";

export function ResetForm({ token, labels }: { token: string; labels: { newPassword: string; confirmPassword: string; savePassword: string } }) {
  return (
    <ActionForm action={resetAction} className="space-y-4">
      {(state) => (
        <>
          <input type="hidden" name="token" value={token} />
          <Input label={labels.newPassword} name="password" type="password" autoComplete="new-password" minLength={8} required error={state.errors?.password} />
          <Input label={labels.confirmPassword} name="password2" type="password" autoComplete="new-password" minLength={8} required error={state.errors?.password2} />
          <SubmitButton pendingText="…">{labels.savePassword}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
