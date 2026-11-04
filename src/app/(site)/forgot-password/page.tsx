import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/site/AuthFrame";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input } from "@/components/ui/Fields";
import { forgotAction } from "@/lib/actions/auth";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";

export const metadata: Metadata = { title: "Reset password", robots: { index: false } };

export default async function ForgotPage() {
  const t = accountDict(await getLocale()).auth;
  return (
    <AuthFrame title={t.forgotTitle} intro={t.forgotIntro}>
      <ActionForm action={forgotAction} className="space-y-4" resetOnSuccess>
        <Input label={t.email} name="email" type="email" autoComplete="email" required />
        <SubmitButton pendingText="…">{t.sendLink}</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-ink-soft">
        Signed up with your mobile only? Contact us and we'll help you back in. ·{" "}
        <Link href="/login" className="font-semibold text-sindoor underline underline-offset-2">
          {t.login}
        </Link>
      </p>
    </AuthFrame>
  );
}
