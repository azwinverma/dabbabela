import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Drips, PrayerFlags, Rider } from "@/components/art/Graffiti";
import { getSection } from "@/lib/cms";
import { getSettings } from "@/lib/settings";
import { getI18n } from "@/lib/i18n/server";
import { db } from "@/lib/db";
import { whatsappLink } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { getNav, type NavLink } from "@/lib/cms/nav";
import { COLOR_PRESETS, getBranding } from "@/lib/cms/branding";
import { CookieChoicesButton } from "@/lib/cms/client/CookieChoicesButton";
import { NewsletterForm } from "./NewsletterForm";

function LinkList({ links }: { links: NavLink[] }) {
  return (
    <>
      {links.map((l) => (
        <li key={l.href}>
          <Link className="link-underline" href={l.href}>
            {l.label}
          </Link>
          {l.children.length > 0 && (
            <ul className="mt-2 space-y-1.5 pl-3 text-paper/70">
              {l.children.map((c) => (
                <li key={c.href}>
                  <Link className="link-underline" href={c.href}>
                    {c.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </>
  );
}

export async function Footer() {
  const { locale, t } = await getI18n();
  const [s, f, pages, explore, company, legal, branding] = await Promise.all([
    getSettings(),
    getSection("footer", locale),
    db.page.findMany({ where: { published: true, showInFooter: true }, select: { slug: true, title: true, titleNe: true }, orderBy: { title: "asc" } }).catch(() => []),
    getNav("FOOTER_EXPLORE", locale),
    getNav("FOOTER_COMPANY", locale),
    getNav("FOOTER_LEGAL", locale),
    getBranding(),
  ]);
  const brand = locale === "ne" ? s.brandNameNe : s.brandName;
  // Links come from Admin → Navigation (NavItem); built-in links are only a fallback for an empty database.
  const eat: NavLink[] = explore ?? [
    { href: "/menu", label: t.nav.menu, children: [] },
    { href: "/build", label: t.nav.build, children: [] },
    { href: "/plans", label: t.nav.plans, children: [] },
    { href: "/corporate", label: t.nav.teams, children: [] },
    { href: "/delivery-areas", label: t.nav.coverage, children: [] },
  ];
  const about: NavLink[] = company ?? [
    { href: "/about", label: t.nav.about, children: [] },
    { href: "/journal", label: t.nav.journal, children: [] },
    { href: "/faq", label: t.nav.faq, children: [] },
    { href: "/contact", label: t.nav.contact, children: [] },
  ];
  // Policy pages flagged "link in footer" plus any Legal menu links (no duplicates).
  const legalLinks: NavLink[] = [...(legal ?? [])];
  for (const p of pages) {
    const href = `/info/${p.slug}`;
    if (!legalLinks.some((l) => l.href === href) && !about.some((l) => l.href === href)) legalLinks.push({ href, label: locale === "ne" && p.titleNe ? p.titleNe : p.title, children: [] });
  }
  const footerTone = COLOR_PRESETS[branding.colorPreset].footer;
  return (
    <footer className="relative mt-24">
      <Drips color="paper" className="absolute -top-px left-0 h-8 rotate-180 md:h-10" />
      <div className={cn("wall pt-16 text-paper", footerTone)}>
        <div className="container grid gap-10 pb-12 md:grid-cols-12">
          <div className="md:col-span-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {branding.logoLightUrl ? <img src={branding.logoLightUrl} alt={brand} className="h-12 w-auto" /> : <Logo light />}
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-paper/75">{String(f.blurb)}</p>
            <Rider className="mt-6 h-20 w-32 opacity-90" />
          </div>
          <div className="md:col-span-2">
            <h2 className="stencil text-xs text-besar">{t.site.eat}</h2>
            <ul className="mt-3 space-y-2 text-sm text-paper/85">
              <LinkList links={eat} />
            </ul>
          </div>
          <div className="md:col-span-2">
            <h2 className="stencil text-xs text-besar">{brand}</h2>
            <ul className="mt-3 space-y-2 text-sm text-paper/85">
              <LinkList links={about} />
              <LinkList links={legalLinks} />
              <li>
                <CookieChoicesButton className="link-underline text-left" label={locale === "ne" ? "कुकी छनोट" : "Cookie choices"} />
              </li>
            </ul>
          </div>
          <div className="md:col-span-4">
            <h2 className="stencil text-xs text-besar">{t.site.findUs}</h2>
            <ul className="mt-3 space-y-2 text-sm text-paper/85">
              {s.address && <li>{s.address}</li>}
              {s.hours && <li>{s.hours}</li>}
              {s.phone && (
                <li>
                  <a className="link-underline" href={`tel:${s.phone.replace(/[^\d+]/g, "")}`}>{s.phone}</a>
                  {s.whatsapp && (
                    <>
                      {" · "}
                      <a className="link-underline" href={whatsappLink(s.whatsapp)} target="_blank" rel="noreferrer">WhatsApp</a>
                    </>
                  )}
                </li>
              )}
              {s.email && <li><a className="link-underline" href={`mailto:${s.email}`}>{s.email}</a></li>}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2 text-sm font-semibold">
              {s.facebook && <a href={s.facebook} target="_blank" rel="noreferrer" className="rounded-full border border-paper/30 px-3 py-1 hover:bg-paper hover:text-ink">Facebook</a>}
              {s.instagram && <a href={s.instagram} target="_blank" rel="noreferrer" className="rounded-full border border-paper/30 px-3 py-1 hover:bg-paper hover:text-ink">Instagram</a>}
              {s.tiktok && <a href={s.tiktok} target="_blank" rel="noreferrer" className="rounded-full border border-paper/30 px-3 py-1 hover:bg-paper hover:text-ink">TikTok</a>}
            </div>
            {s.flags.newsletter && (
              <div className="mt-6">
                <h2 className="stencil text-xs text-besar">{t.site.newsletter}</h2>
                <NewsletterForm labels={{ email: t.site.email, subscribe: t.site.subscribe, hint: t.site.newsletterHint }} />
              </div>
            )}
          </div>
        </div>
        <PrayerFlags className="opacity-80" />
        <div className="border-t border-white/10">
          <div className="container flex flex-col gap-2 py-5 text-xs text-paper/60 md:flex-row md:justify-between">
            <span>
              © {new Date().getFullYear()} {s.legalName}
              {s.panVat ? ` · PAN/VAT ${s.panVat}` : ""}
            </span>
            <span className="font-marker text-sm text-besar/90">{String(f.bottomNote)}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
