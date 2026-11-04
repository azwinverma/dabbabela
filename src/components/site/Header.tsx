import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { getSection } from "@/lib/cms";
import { getCurrentUser, isStaff, activeCompany } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { db } from "@/lib/db";
import { HeaderClient } from "./HeaderClient";

async function topBanner(locale: string) {
  const now = new Date();
  const b = await db.banner
    .findFirst({
      where: { isActive: true, placement: "TOP", AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }] },
      orderBy: { sortOrder: "asc" },
    })
    .catch(() => null);
  if (!b) return null;
  return { text: locale === "ne" && b.textNe ? b.textNe : b.text, link: b.link, linkLabel: b.linkLabel, tone: b.tone };
}

export async function Header() {
  const { locale, t } = await getI18n();
  const [bar, user, banner] = await Promise.all([getSection("announcement", locale), getCurrentUser(), topBanner(locale)]);
  const strip = banner ?? (bar.enabled && bar.text ? { text: String(bar.text), link: String(bar.linkHref || ""), linkLabel: String(bar.linkLabel || ""), tone: "charcoal" } : null);
  const links = [
    { href: "/menu", label: t.nav.menu },
    { href: "/build", label: t.nav.build },
    { href: "/plans", label: t.nav.plans },
    { href: "/corporate", label: t.nav.teams },
    { href: "/delivery-areas", label: t.nav.coverage },
  ];
  return (
    <header className="relative z-30">
      <a href="#main" className="sr-only-focusable absolute left-3 top-3 z-50 rounded-lg bg-ink px-3 py-2 text-sm font-semibold text-paper">
        {t.nav.skip}
      </a>
      {strip && (
        <div className={strip.tone === "turmeric" ? "bg-besar text-ink" : strip.tone === "achar" ? "bg-sindoor text-paper" : "bg-ink text-paper"}>
          <div className="container flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2 text-center text-[0.84rem]">
            <span>{strip.text}</span>
            {strip.link && strip.linkLabel && (
              <Link href={strip.link} className="font-semibold underline decoration-2 underline-offset-2">
                {strip.linkLabel}
              </Link>
            )}
          </div>
        </div>
      )}
      <div className="relative border-b-2 border-ink bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
        <HeaderClient
          logo={<Logo size="md" />}
          links={links}
          locale={locale}
          labels={{ login: t.nav.login, account: t.nav.account, admin: t.nav.admin, team: t.nav.team, cart: t.nav.cart, open: t.nav.openMenu, close: t.nav.closeMenu, language: t.common.language, home: t.nav.home }}
          user={user ? { name: user.name, staff: isStaff(user.role), teamAdmin: Boolean(activeCompany(user) && user.membership?.role === "ADMIN") } : null}
        />
      </div>
    </header>
  );
}
