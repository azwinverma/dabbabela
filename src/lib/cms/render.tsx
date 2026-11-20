import Link from "next/link";
import { ArrowRight, CalendarDays, Check, Clock, Heart, Leaf as LeafIcon, MapPin, ShieldCheck, Truck, Users, Utensils } from "lucide-react";
import { db } from "@/lib/db";
import { md } from "@/lib/markdown";
import { rs } from "@/lib/money";
import { cn } from "@/lib/utils";
import { pick, type Dictionary, type Locale } from "@/lib/i18n";
import { addDays, todayKTM } from "@/lib/dates";
import { boxInclude } from "@/server/menu";
import { getPublicWeek, isPublicBox, resolveWeek, toPublicBox, type PublicBox } from "@/lib/public";
import { LinkButton } from "@/components/ui/Button";
import { SectionHeading } from "@/components/site/Section";
import { BoxImage, DietBadge } from "@/components/site/BoxCard";
import { TiffinHero } from "@/components/art/TiffinHero";
import { Chili, Leaf, Momo, Mountains, PrayerFlags, Rider, Splatter } from "@/components/art/Graffiti";
import type { Block, MetricKey } from "./blocks";

/**
 * Server renderer for page-builder blocks. Text is rendered by React (escaped); markdown goes through `md()` (raw HTML
 * escaped, URLs allow-listed); links/images were allow-listed when the blocks were validated. Live blocks read the
 * database here, so prices, dabbas, testimonials, FAQs and stats are always current.
 */

type D = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Ctx = { locale: Locale; t: Dictionary; first: boolean };

const TONE_CLASS: Record<string, string> = {
  turmeric: "bg-besar text-ink",
  achar: "bg-sindoor text-paper",
  charcoal: "bg-ink text-paper",
  saag: "bg-saag text-paper",
};
const ICONS = { check: Check, clock: Clock, leaf: LeafIcon, truck: Truck, users: Users, heart: Heart, utensils: Utensils, calendar: CalendarDays, map: MapPin, shield: ShieldCheck };

export function Art({ art, className }: { art: string; className?: string }) {
  switch (art) {
    case "rider":
      return <Rider className={className} />;
    case "momo":
      return <Momo className={className} />;
    case "chili":
      return <Chili className={className} />;
    case "leaf":
      return <Leaf className={className} />;
    case "mountains":
      return <Mountains className={className} />;
    case "prayerFlags":
      return <PrayerFlags className={className} />;
    case "splatter":
      return <Splatter className={className} />;
    default:
      return <TiffinHero className={className} />;
  }
}

function Img({ src, alt, className }: { src: string; alt: string; className?: string }) {
  // Plain <img>: sources are allow-listed media-library URLs or bundled paths.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" className={className} />;
}

function Hero({ d, first }: { d: D; first: boolean }) {
  const H = first ? "h1" : "h2";
  return (
    <section className="relative overflow-hidden border-b-2 border-ink">
      <div className="container relative grid gap-8 py-12 md:grid-cols-[1.1fr_1fr] md:items-center md:py-16">
        <div>
          {d.eyebrow && <p className="text-sm font-bold uppercase tracking-[0.14em] text-sindoor">{d.eyebrow}</p>}
          <H className="mt-3 max-w-3xl text-4xl font-extrabold leading-[1.03] md:text-[3.4rem]">{d.title}</H>
          {d.subtitle && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">{d.subtitle}</p>}
          {(d.primaryLabel || d.secondaryLabel) && (
            <div className="mt-7 flex flex-wrap gap-3">
              {d.primaryLabel && d.primaryHref && <LinkButton href={d.primaryHref}>{d.primaryLabel}</LinkButton>}
              {d.secondaryLabel && d.secondaryHref && (
                <LinkButton href={d.secondaryHref} variant="outline">
                  {d.secondaryLabel}
                </LinkButton>
              )}
            </div>
          )}
        </div>
        <div className="relative">
          {d.image ? (
            <Img src={d.image} alt={d.imageAlt || ""} className="aspect-[4/3] w-full rounded-3xl border-2 border-ink object-cover shadow-sticker-lg" />
          ) : (
            <Art art={d.illustration} className="mx-auto h-auto w-full max-w-md" />
          )}
        </div>
      </div>
    </section>
  );
}

function TextBlock({ d }: { d: D }) {
  return (
    <section className={cn("container py-10", d.width === "wide" ? "max-w-5xl" : "max-w-3xl")}>
      {d.heading && <h2 className="mb-4 text-3xl font-extrabold">{d.heading}</h2>}
      <div className="prose-poko" dangerouslySetInnerHTML={{ __html: md(String(d.body ?? "")) }} />
    </section>
  );
}

function ImageBlock({ d }: { d: D }) {
  return (
    <figure className="container max-w-4xl py-10">
      <Img src={d.src} alt={d.alt} className="w-full rounded-2xl border-2 border-ink object-cover" />
      {d.caption && <figcaption className="mt-2 text-sm text-ink-mute">{d.caption}</figcaption>}
    </figure>
  );
}

function Cta({ d }: { d: D }) {
  const dark = d.tone === "achar" || d.tone === "charcoal" || d.tone === "saag";
  return (
    <section className="container py-12">
      <div className={cn("rounded-3xl border-2 border-ink px-6 py-12 text-center shadow-sticker-lg md:px-16", TONE_CLASS[d.tone] ?? TONE_CLASS.turmeric)}>
        <h2 className="mx-auto max-w-2xl text-3xl font-extrabold md:text-5xl">{d.title}</h2>
        {d.text && <p className={cn("mx-auto mt-3 max-w-lg text-lg", dark ? "text-paper/85" : "text-ink-soft")}>{d.text}</p>}
        <LinkButton href={d.buttonHref} size="lg" variant={dark ? "besar" : "primary"} className="mt-8">
          {d.buttonLabel}
        </LinkButton>
      </div>
    </section>
  );
}

function FeatureGrid({ d }: { d: D }) {
  const cols = d.columns === "2" ? "md:grid-cols-2" : d.columns === "4" ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3";
  return (
    <section className="container py-14">
      {(d.heading || d.intro) && <SectionHeading title={d.heading || ""} intro={d.intro || undefined} />}
      <ul className={cn("mt-8 grid gap-5", cols)}>
        {(d.items as D[]).map((it, i) => {
          const Icon = ICONS[it.icon as keyof typeof ICONS] ?? Check;
          return (
            <li key={i} className="card p-6">
              <Icon className="h-6 w-6 text-sindoor" aria-hidden />
              <h3 className="mt-3 font-display text-lg font-bold">{it.title}</h3>
              {it.text && <p className="mt-1.5 leading-relaxed text-ink-soft">{it.text}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function showcaseBoxes(d: D, locale: Locale): Promise<PublicBox[]> {
  const limit = Number(d.limit) || 6;
  if (d.source === "thisWeek") {
    const today = todayKTM();
    const week = resolveWeek(today);
    const [a, b] = await Promise.all([getPublicWeek(week, locale), getPublicWeek(addDays(week, 7), locale)]);
    const seen = new Set<string>();
    const out: PublicBox[] = [];
    for (const day of [...a.days, ...b.days].filter((x) => x.date >= today && !x.closed))
      for (const it of day.items)
        if (!seen.has(it.box.id) && out.length < limit) {
          seen.add(it.box.id);
          out.push(it.box);
        }
    return out;
  }
  const where = d.source === "category" && d.category ? { category: { slug: String(d.category), isActive: true } } : { isFeatured: true };
  const rows = await db.lunchBox.findMany({ where: { isActive: true, isVisible: true, ...where }, include: boxInclude, orderBy: { sortOrder: "asc" }, take: limit });
  const list = rows.length || d.source === "category" ? rows : await db.lunchBox.findMany({ where: { isActive: true, isVisible: true }, include: boxInclude, orderBy: { sortOrder: "asc" }, take: limit });
  return list.filter(isPublicBox).map((bx) => toPublicBox(bx, locale));
}

async function MealShowcase({ d, ctx }: { d: D; ctx: Ctx }) {
  const boxes = await showcaseBoxes(d, ctx.locale).catch(() => []);
  if (!boxes.length) return null;
  return (
    <section className="container py-14">
      {(d.heading || d.intro) && <SectionHeading title={d.heading || ""} intro={d.intro || undefined} />}
      <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {boxes.map((bx) => (
          <li key={bx.id}>
            <Link href={`/boxes/${bx.slug}`} className="card group block overflow-hidden">
              <BoxImage box={bx} className="border-b-2 border-ink" />
              <div className="p-4">
                <h3 className="font-display text-lg font-bold group-hover:text-sindoor">{bx.name}</h3>
                {bx.tagline && <p className="mt-1 text-sm text-ink-soft">{bx.tagline}</p>}
                <div className="mt-3 flex items-center justify-between gap-2">
                  <DietBadge diet={bx.diet} t={ctx.t} verified={bx.dietVerified} />
                  <span className="font-bold text-sindoor">{rs(bx.price)}</span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function PricingTable({ d, ctx }: { d: D; ctx: Ctx }) {
  const slugs = String(d.plans ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const plans = await db.mealPlan
    .findMany({ where: { isActive: true, ...(slugs.length ? { slug: { in: slugs } } : { isCorporate: false }) }, orderBy: { sortOrder: "asc" }, take: Number(d.limit) || 3 })
    .catch(() => []);
  if (!plans.length) return null;
  const { t, locale } = ctx;
  return (
    <section className="container py-14">
      {(d.heading || d.intro) && <SectionHeading title={d.heading || ""} intro={d.intro || undefined} />}
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {plans.map((p) => (
          <Link key={p.id} href={`/plans/${p.slug}`} className="card group flex flex-col p-6 shadow-card transition hover:-translate-y-0.5 hover:shadow-sticker">
            {p.isPopular && <span className="mb-3 self-start rounded-full bg-besar px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider">{t.site.popular}</span>}
            <h3 className="font-display text-xl font-extrabold">{pick(p, "name", locale)}</h3>
            {p.tagline && <p className="mt-1 text-sm text-ink-soft">{p.tagline}</p>}
            <p className="mt-5 font-display text-3xl font-extrabold text-sindoor">
              {rs(p.pricePerMeal)} <span className="text-sm font-semibold text-ink-mute">{t.site.perMeal}</span>
            </p>
            {p.features.length > 0 && (
              <ul className="mt-4 space-y-1.5 text-sm">
                {p.features.slice(0, 5).map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-saag" aria-hidden /> {f}
                  </li>
                ))}
              </ul>
            )}
            <span className="mt-auto inline-flex items-center gap-1 pt-6 text-sm font-bold text-sindoor">
              {t.site.choosePlan} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" aria-hidden />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

async function Testimonials({ d }: { d: D }) {
  const rows = await db.testimonial.findMany({ where: { published: true, consentNote: { not: "" } }, orderBy: { sortOrder: "asc" }, take: Number(d.limit) || 3 }).catch(() => []);
  if (!rows.length) return null;
  return (
    <section className="container py-14">
      {d.heading && <SectionHeading title={d.heading} />}
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {rows.map((q) => (
          <figure key={q.id} className="card p-6">
            <blockquote className="text-lg leading-relaxed">“{q.quote}”</blockquote>
            <figcaption className="mt-4 text-sm font-semibold text-ink-soft">
              {q.name}
              {q.role ? `, ${q.role}` : ""}
              {q.company ? ` · ${q.company}` : ""}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

export async function faqRows(d: D) {
  return db.faq
    .findMany({ where: { published: true, ...(d.category ? { category: String(d.category) } : {}) }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take: Number(d.limit) || 6 })
    .catch(() => []);
}

async function FaqBlock({ d, ctx }: { d: D; ctx: Ctx }) {
  const rows = await faqRows(d);
  if (!rows.length) return null;
  return (
    <section className="container py-14">
      <div className="grid gap-10 md:grid-cols-[1fr_1.6fr]">
        {d.heading ? <SectionHeading title={d.heading} /> : <div />}
        <div className="divide-y-2 divide-ink/10 border-y-2 border-ink">
          {rows.map((f) => (
            <details key={f.id} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-bold">
                {pick(f, "question", ctx.locale)}
                <span aria-hidden className="text-2xl text-sindoor transition group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-2 leading-relaxed text-ink-soft">{pick(f, "answer", ctx.locale)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Partners({ d }: { d: D }) {
  const items = d.items as D[];
  if (!items?.length) return null;
  return (
    <section className="container py-12">
      {d.heading && <h2 className="text-center text-2xl font-extrabold">{d.heading}</h2>}
      <ul className="mt-6 flex flex-wrap items-center justify-center gap-6">
        {items.map((p, i) => {
          const inner = p.logo ? <Img src={p.logo} alt={p.name} className="h-12 w-auto object-contain" /> : <span className="font-display text-lg font-bold">{p.name}</span>;
          return (
            <li key={i} className="rounded-xl border-2 border-ink/15 bg-paper-card px-5 py-3">
              {p.href ? (
                <a href={p.href} {...(/^https:/.test(p.href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                  {inner}
                </a>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Banner({ d }: { d: D }) {
  return (
    <div className={cn("border-y-2 border-ink", TONE_CLASS[d.tone] ?? TONE_CLASS.turmeric)}>
      <div className="container flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-3 text-center font-semibold">
        <span>{d.text}</span>
        {d.linkLabel && d.linkHref && (
          <Link href={d.linkHref} className="underline decoration-2 underline-offset-2">
            {d.linkLabel}
          </Link>
        )}
      </div>
    </div>
  );
}

function Gallery({ d }: { d: D }) {
  const images = d.images as D[];
  if (!images?.length) return null;
  return (
    <section className="container py-12">
      {d.heading && <h2 className="mb-6 text-3xl font-extrabold">{d.heading}</h2>}
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {images.map((im, i) => (
          <li key={i}>
            <figure>
              <Img src={im.src} alt={im.alt} className="aspect-square w-full rounded-xl border-2 border-ink object-cover" />
              {im.caption && <figcaption className="mt-1.5 text-xs text-ink-mute">{im.caption}</figcaption>}
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Illustration({ d }: { d: D }) {
  return (
    <figure className={cn("container flex flex-col py-10", d.align === "left" ? "items-start" : d.align === "right" ? "items-end" : "items-center")}>
      <Art art={d.art} className={d.art === "prayerFlags" || d.art === "mountains" ? "h-16 w-full" : "h-40 w-56"} />
      {d.caption && <figcaption className="mt-3 font-marker text-lg text-ink-soft">{d.caption}</figcaption>}
    </figure>
  );
}

/** Live metric values (counts from the database — never typed in). */
export async function metricValue(m: MetricKey): Promise<number> {
  switch (m) {
    case "dabbasOnMenu":
      return db.lunchBox.count({ where: { isActive: true, isVisible: true } });
    case "deliveryAreas": {
      const zones = await db.deliveryZone.findMany({ where: { isActive: true }, select: { areas: true } });
      return zones.reduce((n, z) => n + z.areas.length, 0);
    }
    case "deliveryZones":
      return db.deliveryZone.count({ where: { isActive: true } });
    case "mealPlans":
      return db.mealPlan.count({ where: { isActive: true, isCorporate: false } });
    case "mealsDelivered":
      return db.order.count({ where: { status: "DELIVERED" } });
    case "teamsServed":
      return db.company.count({ where: { isActive: true } });
  }
}

async function Stats({ d }: { d: D }) {
  const items = d.items as { metric: MetricKey; label: string }[];
  const values = await Promise.all(items.map((i) => metricValue(i.metric).catch(() => 0)));
  const shown = items.map((it, i) => ({ ...it, value: values[i]! })).filter((x) => x.value > 0); // never show a zero as a boast
  if (!shown.length) return null;
  return (
    <section className="container py-12">
      {d.heading && <h2 className="mb-6 text-center text-3xl font-extrabold">{d.heading}</h2>}
      <dl className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
        {shown.map((s) => (
          <div key={s.metric} className="card flex flex-col p-6 text-center">
            <dt className="text-sm font-semibold text-ink-soft">{s.label}</dt>
            <dd className="order-first font-display text-4xl font-extrabold text-sindoor">{s.value.toLocaleString("en-IN")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function one(b: Block, ctx: Ctx): React.ReactNode {
  const d = b.data as D;
  switch (b.type) {
    case "hero":
      return <Hero d={d} first={ctx.first} />;
    case "text":
      return <TextBlock d={d} />;
    case "image":
      return <ImageBlock d={d} />;
    case "cta":
      return <Cta d={d} />;
    case "featureGrid":
      return <FeatureGrid d={d} />;
    case "mealShowcase":
      return <MealShowcase d={d} ctx={ctx} />;
    case "pricingTable":
      return <PricingTable d={d} ctx={ctx} />;
    case "testimonials":
      return <Testimonials d={d} />;
    case "faq":
      return <FaqBlock d={d} ctx={ctx} />;
    case "partners":
      return <Partners d={d} />;
    case "banner":
      return <Banner d={d} />;
    case "gallery":
      return <Gallery d={d} />;
    case "illustration":
      return <Illustration d={d} />;
    case "stats":
      return <Stats d={d} />;
    default:
      return null;
  }
}

/** Render a validated block list. `firstIsTitle`: the first hero becomes the page's h1. */
export function Blocks({ blocks, locale, t, firstIsTitle = true }: { blocks: Block[]; locale: Locale; t: Dictionary; firstIsTitle?: boolean }) {
  return (
    <>
      {blocks.map((b, i) => (
        <div key={b.id} data-block={b.type}>
          {one(b, { locale, t, first: firstIsTitle && i === 0 })}
        </div>
      ))}
    </>
  );
}
