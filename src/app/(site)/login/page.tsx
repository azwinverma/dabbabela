import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/site/AuthFrame";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { isStaffRole, staffHome } from "@/lib/permissions";
import { LoginForm, TwoFactorForm } from "./LoginForm";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; step?: string; reset?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "";
  const user = await getCurrentUser();
  if (user && sp.step !== "2fa") redirect(isStaffRole(user.role) ? staffHome(user.role) : next || "/account");
  const [s, locale] = await Promise.all([getSettings(), getLocale()]);
  const t = accountDict(locale).auth;
  if (sp.step === "2fa")
    return (
      <AuthFrame title={t.twoFactorTitle} intro={t.twoFactorIntro}>
        <TwoFactorForm next={next} t={t} />
      </AuthFrame>
    );
  return (
    <AuthFrame title={t.loginTitle} intro={t.loginIntro}>
      {sp.reset && <p role="status" className="mb-4 rounded-lg border border-saag/30 bg-saag-light px-3 py-2 text-sm font-medium text-saag-dark">Password updated. Log in with the new one.</p>}
      <LoginForm next={next} phoneOtp={s.flags.phoneOtp} t={t} />
      <p className="mt-6 text-sm text-ink-soft">
        {t.noAccount}{" "}
        <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-sindoor underline underline-offset-2">
          {t.createAccount}
        </Link>
      </p>
    </AuthFrame>
  );
}
