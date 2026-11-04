import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Drips, PrayerFlags, Rider } from "@/components/art/Graffiti";
import { getSection } from "@/lib/cms";
import { getSettings } from "@/lib/settings";
import { getI18n } from "@/lib/i18n/server";
import { db } from "@/lib/db";
import { whatsappLink } from "@/lib/phone";
import { NewsletterForm } from "./NewsletterForm";

export async function Footer() {
  const { locale, t } = await getI18n();
  const [s, f, pages] = await Promise.all([
    getSettings(),
    getSection("footer", locale),
    db.page.findMany({ where: { published: true, showInFooter: true }, select: { slug: true, title: true, titleNe: true }, orderBy: { title: "asc" } }).catch(() => []),
  ]);
  const brand = locale === "ne" ? s.brandNameNe : s.brandName;
  return (
    <footer className="relative mt-24">
      <Drips color="paper" className="absolute -top-px left-0 h-8 rotate-180 md:h-10" />
      <div className="wall pt-16 text-paper">
        <div className="container grid gap-10 pb-12 md:grid-cols-12">
          <div className="md:col-span-4">
            <Logo light />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-paper/75">{String(f.blurb)}</p>
            <Rider className="mt-6 h-20 w-32 opacity-90" />
          </div>
          <div className="md:col-span-2">
            <h2 className="stencil text-xs text-besar">{t.site.eat}</h2>
            <ul className="mt-3 space-y-2 text-sm text-paper/85">
              <li><Link className="link-underline" href="/menu">{t.nav.menu}</Link></li>
              <li><Link className="link-underline" href="/build">{t.nav.build}</Link></li>
              <li><Link className="link-underline" href="/plans">{t.nav.plans}</Link></li>
              <li><Link className="link-underline" href="/corporate">{t.nav.teams}</Link></li>
              <li><Link className="link-underline" href="/delivery-areas">{t.nav.coverage}</Link></li>
            </ul>
          </div>
          <div className="md:col-span-2">
            <h2 className="stencil text-xs text-besar">{brand}</h2>
            <ul className="mt-3 space-y-2 text-sm text-paper/85">
              <li><Link className="link-underline" href="/about">{t.nav.about}</Link></li>
              <li><Link className="link-underline" href="/journal">{t.nav.journal}</Link></li>
              <li><Link className="link-underline" href="/faq">{t.nav.faq}</Link></li>
              <li><Link className="link-underline" href="/contact">{t.nav.contact}</Link></li>
              {pages.map((p) => (
                <li key={p.slug}>
                  <Link className="link-underline" href={`/info/${p.slug}`}>
                    {locale === "ne" && p.titleNe ? p.titleNe : p.title}
                  </Link>
                </li>
              ))}
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
