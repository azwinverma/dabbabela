import type { Metadata } from "next";
import Link from "next/link";
import { requireUser, isStaff, isCompanyAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { logoutAction } from "@/lib/actions/auth";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { AccountNav } from "./AccountNav";

export const metadata: Metadata = { title: "My account", robots: { index: false } };

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("/account");
  const [locale, unread] = await Promise.all([getLocale(), db.notification.count({ where: { userId: user.id, readAt: null } })]);
  const t = accountDict(locale).nav;
  const m = user.membership;
  return (
    <section className="container py-8 md:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-marker text-lg text-sindoor">{t.greeting}</p>
          <h1 className="truncate text-3xl font-extrabold md:text-4xl">{user.name}</h1>
          {m && m.status === "ACTIVE" && <p className="mt-1 text-sm font-semibold text-saag">{m.company.name} team account{m.role === "ADMIN" ? " · admin" : ""}</p>}
          {m && m.status === "PENDING" && <p className="mt-1 text-sm font-semibold text-besar-dark">Waiting for {m.company.name} to approve you</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {isStaff(user.role) && (
            <Link href="/admin" className="rounded-full border-2 border-ink bg-besar px-4 py-1.5 text-sm font-bold">
              {t.controlRoom}
            </Link>
          )}
          {isCompanyAdmin(user) && (
            <Link href="/team" className="rounded-full border-2 border-ink bg-saag px-4 py-1.5 text-sm font-bold text-paper">
              {t.teamPortal}
            </Link>
          )}
          <form action={logoutAction}>
            <button className="rounded-full border-2 border-ink px-4 py-1.5 text-sm font-bold hover:bg-ink hover:text-paper">{t.logout}</button>
          </form>
        </div>
      </div>
      <div className="mt-6">
        <AccountNav labels={t} unread={unread} />
      </div>
      <div className="mt-8">{children}</div>
    </section>
  );
}
