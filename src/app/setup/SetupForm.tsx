"use client";

import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Checkbox, Input } from "@/components/ui/Fields";
import { setupAction } from "./actions";

export function SetupForm({ allowDemo }: { allowDemo: boolean }) {
  return (
    <ActionForm action={setupAction} className="space-y-4">
      {(s) => (
        <>
          <Input label="Setup key" name="key" type="password" required autoComplete="off" hint="The SETUP_KEY value from your Vercel environment variables" error={s.errors?.key} />
          <Input label="Your name" name="name" required autoComplete="name" />
          <Input label="Owner email" name="email" type="email" required autoComplete="email" error={s.errors?.email} />
          <Input label="Owner password" name="password" type="password" required autoComplete="new-password" hint="At least 12 characters, letters and numbers" error={s.errors?.password} />
          {allowDemo && <Checkbox name="demo" label="Add demo staff, company and customers" hint="Development only — never available in production." />}
          <SubmitButton pendingText="Setting up the kitchen…" size="lg">
            Create owner & load the menu
          </SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
