import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/site/AuthFrame";
import { getCurrentUser } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { RegisterForm } from "./RegisterForm";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string; code?: string }> }) {
  const sp = await searchParams;
  if (await getCurrentUser()) redirect("/account");
  const t = accountDict(await getLocale()).auth;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "";
  return (
    <AuthFrame
      title={t.registerTitle}
      intro={t.registerIntro}
      side={
        <>
          <p className="font-marker text-3xl leading-tight text-besar">ghar ko swad, harek diuso.</p>
          <p className="mt-3 max-w-xs text-paper/75">Office, shop, college or home — we bring lunch to wherever you are in our delivery areas.</p>
        </>
      }
    >
      <RegisterForm next={next} code={sp.code?.slice(0, 20) ?? ""} t={t} />
      <p className="mt-6 text-sm text-ink-soft">
        {t.haveAccount}{" "}
        <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-sindoor underline underline-offset-2">
          {t.login}
        </Link>
      </p>
    </AuthFrame>
  );
}
