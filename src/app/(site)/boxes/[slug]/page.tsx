import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getI18n } from "@/lib/i18n/server";
import { getCurrentUser } from "@/lib/auth";
import { rs } from "@/lib/money";
import { boxInclude } from "@/server/menu";
import { datesForBox, toPublicBox } from "@/lib/public";
import { AllergenChips, BoxImage, DietBadge, NutritionLine, SpiceMeter } from "@/components/site/BoxCard";
import { AddToBox } from "@/components/site/AddToBox";
import { JsonLd } from "@/components/site/JsonLd";
import { Splatter } from "@/components/art/Graffiti";

type Params = Promise<{ slug: string }>;

async function load(slug: string) {
  // Hidden dabbas stay orderable by staff but have no public page.
  return db.lunchBox.findFirst({ where: { slug, isActive: true, isVisible: true }, include: boxInclude });
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const box = await load((await params).slug);
  if (!box) return { title: "Dabba not found" };
  return {
    title: box.name,
    description: box.shortDescription ?? box.description ?? box.tagline ?? undefined,
    alternates: { canonical: `/boxes/${box.slug}` },
    openGraph: box.image ? { images: [box.image] } : undefined,
  };
}

export default async function BoxPage({ params }: { params: Params }) {
  const raw = await load((await params).slug);
  if (!raw) notFound();
  const { locale, t } = await getI18n();
  const [box, dates, user] = await Promise.all([Promise.resolve(toPublicBox(raw, locale)), datesForBox(raw.id), getCurrentUser()]);
  const hit = box.allergens.filter((a) => user?.allergies.includes(a.code));

  return (
    <article>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "MenuItem",
          name: box.name,
          description: box.description ?? box.tagline,
          ...(box.image ? { image: box.image } : {}),
          suitableForDiet: box.diet === "VEGAN" ? "https://schema.org/VeganDiet" : box.isVeg ? "https://schema.org/VegetarianDiet" : undefined,
          offers: { "@type": "Offer", price: (box.price / 100).toFixed(2), priceCurrency: "NPR" },
        }}
      />
      <div className="container grid gap-10 py-10 md:grid-cols-[1.1fr_1fr] md:py-14">
        <div className="relative">
          <Splatter className="absolute -left-8 -top-8 h-40 w-40 opacity-30" seed={4} />
          <BoxImage box={box} className="relative rounded-3xl border-2 border-ink shadow-sticker-lg" priority sizes="(min-width: 768px) 55vw, 100vw" />
          {!box.image && <p className="mt-2 text-xs text-ink-mute">Illustration — real photos are added as the kitchen shoots each dabba.</p>}
        </div>
        <div>
          <nav aria-label="Breadcrumb" className="text-sm text-ink-mute">
            <Link href="/menu" className="underline underline-offset-2 hover:text-sindoor">{t.nav.menu}</Link> / {box.name}
          </nav>
          <h1 className="mt-3 text-4xl font-extrabold leading-[1.03] md:text-5xl">{box.name}</h1>
          {box.tagline && <p className="mt-3 text-lg text-ink-soft">{box.tagline}</p>}
          {(box.category || box.isFeatured) && (
            <p className="mt-2 flex flex-wrap gap-2 text-xs font-bold uppercase tracking-wider">
              {box.isFeatured && <span className="rounded-full border-2 border-ink bg-besar px-2 py-0.5">{locale === "ne" ? "विशेष" : "Featured"}</span>}
              {box.category && (
                <Link href={`/menu?cat=${box.category.slug}`} className="rounded-full border-2 border-ink/30 px-2 py-0.5 hover:border-ink">
                  {box.category.name}
                </Link>
              )}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="font-display text-3xl font-extrabold text-sindoor">{rs(box.price)}</span>
            <DietBadge diet={box.diet} t={t} verified={box.dietVerified} />
            <SpiceMeter level={box.spice} />
          </div>
          {box.description ? <p className="mt-5 leading-relaxed text-ink-soft">{box.description}</p> : box.shortDescription && <p className="mt-5 leading-relaxed text-ink-soft">{box.shortDescription}</p>}

          {hit.length > 0 && (
            <p role="alert" className="mt-5 rounded-xl border-2 border-sindoor bg-sindoor-light px-4 py-3 text-sm font-semibold text-sindoor-dark">
              Contains {hit.map((a) => a.name.toLowerCase()).join(", ")} — on your avoid list.
            </p>
          )}

          <div className="mt-6 rounded-2xl border-2 border-ink bg-paper-card p-5">
            <AddToBox
              box={{ id: box.id, name: box.name, price: box.price, accent: box.accent, image: box.image }}
              dates={dates}
              subs={box.subs}
              labels={{ add: t.site.addToList, added: t.site.added, checkout: t.site.checkout, day: t.site.pickDay, none: t.site.noDays, swaps: t.site.swaps, swapNone: t.site.swapNone }}
            />
            {(() => {
              const low = dates.filter((d) => !d.soldOut && d.remaining != null && d.remaining <= 10);
              return low.length > 0 ? (
                <p className="mt-3 text-sm font-semibold text-besar-dark">
                  {low.map((d) => `${d.label}: ${locale === "ne" ? `${d.remaining} वटा मात्र बाँकी` : `only ${d.remaining} left`}`).join(" · ")}
                </p>
              ) : null;
            })()}
            {dates.length === 0 && (
              <p className="mt-3 text-sm">
                <Link href="/build" className="font-semibold text-sindoor underline underline-offset-2">{t.nav.build}</Link>
              </p>
            )}
          </div>

          <section className="mt-8">
            <h2 className="font-display text-xl font-bold">{t.menu.contents}</h2>
            <ul className="mt-3 divide-y divide-ink/10 border-y border-ink/10">
              {box.items.map((i) => (
                <li key={i.name} className="flex items-center justify-between py-2.5">
                  <span>{i.name}</span>
                  {i.qty > 1 && <span className="text-sm text-ink-mute">×{i.qty}</span>}
                </li>
              ))}
            </ul>
            {box.subs.length > 0 && (
              <p className="mt-3 text-sm text-ink-soft">
                {t.site.swaps}: {box.subs.map((s) => `${s.from} → ${s.to}${s.priceDelta ? ` (${s.priceDelta > 0 ? "+" : ""}${rs(s.priceDelta)})` : ""}`).join("; ")}
              </p>
            )}
          </section>

          {box.healthNote && (
            <section className="mt-8 rounded-2xl bg-saag-light/70 p-5">
              <h2 className="font-display text-lg font-bold text-saag-dark">{t.menu.whyItWorks}</h2>
              <p className="mt-1 leading-relaxed text-saag-dark">{box.healthNote}</p>
            </section>
          )}

          <section className="mt-8">
            <h2 className="font-display text-xl font-bold">{t.menu.allergens}</h2>
            <div className="mt-3">
              <AllergenChips allergens={box.allergens} t={t} highlight={user?.allergies ?? []} />
            </div>
            <div className="mt-3">
              <NutritionLine n={box.nutrition} t={t} />
            </div>
            <p className="mt-3 text-sm text-ink-mute">
              {t.site.sharedKitchen}{" "}
              <Link href="/info/allergens" className="underline underline-offset-2">{t.menu.allergens}</Link>
            </p>
            {box.nutrition && <p className="mt-1 text-xs text-ink-mute">{t.menu.nutritionNote}</p>}
          </section>
        </div>
      </div>
    </article>
  );
}
