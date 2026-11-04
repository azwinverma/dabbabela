import type { Metadata } from "next";
import Link from "next/link";
import { requireCompanyAdmin } from "@/lib/auth";
import { Logo } from "@/components/brand/Logo";
import { TeamNav } from "./TeamNav";

export const metadata: Metadata = { title: { default: "Team portal", template: "%s · Team portal" }, robots: { index: false, follow: false } };

export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const { user, company } = await requireCompanyAdmin();
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-ink-line bg-white print:hidden">
        <div className="container flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Logo size="sm" showNepali={false} />
            </Link>
            <span className="hidden h-6 w-px bg-ink-line sm:block" />
            <div>
              <p className="font-display text-sm font-bold leading-tight">{company.name}</p>
              <p className="text-xs text-ink-mute">Team lunch portal · {user.name}</p>
            </div>
          </div>
          <Link href="/account" className="text-sm font-semibold text-ink-soft hover:text-ink">
            My lunches →
          </Link>
        </div>
        <TeamNav />
      </header>
      <main className="container py-6">{children}</main>
    </div>
  );
}
