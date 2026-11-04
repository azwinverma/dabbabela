import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/site/AuthFrame";
import { ResetForm } from "./ResetForm";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

/** Better Auth sends people here as /reset-password?token=… (or ?error=INVALID_TOKEN). */
export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const sp = await searchParams;
  const t = accountDict(await getLocale()).auth;
  if (!sp.token || sp.error)
    return (
      <AuthFrame title="This link has expired" intro="Reset links work once and only for an hour.">
        <Link href="/forgot-password" className="font-semibold text-sindoor underline underline-offset-2">
          Send me a new link
        </Link>
      </AuthFrame>
    );
  return (
    <AuthFrame title={t.resetTitle}>
      <ResetForm token={sp.token} labels={t} />
    </AuthFrame>
  );
}
