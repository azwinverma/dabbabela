"use client";

import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input } from "@/components/ui/Fields";
import { registerAction } from "@/lib/actions/auth";
import type { AccountDict } from "@/lib/i18n/account";

export function RegisterForm({ next, code, t }: { next: string; code: string; t: AccountDict["auth"] }) {
  return (
    <ActionForm action={registerAction} className="space-y-4">
      {(state) => (
        <>
          <input type="hidden" name="next" value={next} />
          <Input label={t.name} name="name" autoComplete="name" required error={state.errors?.name} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t.email} name="email" type="email" autoComplete="email" required error={state.errors?.email} />
            <Input label={t.mobile} name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98XXXXXXXX" required error={state.errors?.phone} />
          </div>
          <Input label={t.password} name="password" type="password" autoComplete="new-password" minLength={8} required hint="At least 8 characters" error={state.errors?.password} />
          <Input label={`${t.companyCode} (optional)`} name="companyCode" defaultValue={code} hint={t.companyCodeHint} error={state.errors?.companyCode} />
          <p className="text-xs text-ink-mute">
            By creating an account you agree to our{" "}
            <Link href="/info/terms" className="underline">
              terms
            </Link>{" "}
            and{" "}
            <Link href="/info/privacy" className="underline">
              privacy policy
            </Link>
            .
          </p>
          <SubmitButton pendingText="…">{t.register}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
