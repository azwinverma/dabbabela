import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, MapPin } from "lucide-react";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getHomeLayout } from "@/lib/cms-store";
import { getSections } from "@/lib/cms";
import { getI18n } from "@/lib/i18n/server";
import { pick, format } from "@/lib/i18n";
import { addDays, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { getPublicWeek, resolveWeek, type PublicDay } from "@/lib/public";
import { LinkButton } from "@/components/ui/Button";
import { SectionHeading, EmptyState } from "@/components/site/Section";
import { BoxImage, DietBadge } from "@/components/site/BoxCard";
import { TiffinHero } from "@/components/art/TiffinHero";
import { Arrow, Chili, Leaf, Momo, Mountains, Splatter, Starburst } from "@/components/art/Graffiti";
import { JsonLd } from "@/components/site/JsonLd";

export const revalidate = 0;

type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function upcomingDays(locale: "en" | "ne") {
  const today = todayKTM();
  const thisWeek = resolveWeek(today);
  const [a, b] = await Promise.all([getPublicWeek(thisWeek, locale), getPublicWeek(addDays(thisWeek, 7), locale)]);
  return [...a.days, ...b.days].filter((d) => d.date >= today && !d.closed && d.items.length).slice(0, 6);
}

export default async function HomePage() {
  const { locale, t } = await getI18n();
  const layout = await getHomeLayout();
  const keys = layout.filter((b) => b.visible).map((b) => b.key);
  const [s, sections, days, plans, zones, faqs, testimonials] = await Promise.all([
    getSettings(),
    getSections(keys, locale),
    keys.includes("home.week") ? upcomingDays(locale) : Promise.resolve([] as PublicDay[]),
    db.mealPlan.findMany({ where: { isActive: true, isCorporate: false }, orderBy: { sortOrder: "asc" }, take: 3 }),
    db.deliveryZone.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, areas: true } }),
    db.faq.findMany({ where: { published: true }, orderBy: { sortOrder: "asc" }, take: 8 }),
    db.testimonial.findMany({ where: { published: true, consentNote: { not: "" } }, orderBy: { sortOrder: "asc" }, take: 3 }),
  ]);

  const blocks: Record<string, (d: Data) => React.ReactNode> = {
    "home.hero": (d) => <Hero d={d} cutoff={s.orderCutoff} />,
    "home.how": (d) => <How d={d} />,
    "home.week": (d) => <Week d={d} days={days} t={t} />,
    "home.build": (d) => <BuildTeaser d={d} />,
    "home.plans": (d) =>
      plans.length ? (
        <section className="container py-20" key="plans">
          <SectionHeading eyebrow={d.eyebrow} title={d.title} intro={d.intro} />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {plans.map((p) => (
              <Link key={p.id} href={`/plans/${p.slug}`} className="card group flex flex-col p-6 shadow-card transition hover:-translate-y-0.5 hover:shadow-sticker">
                {p.isPopular && <span className="mb-3 self-start rounded-full bg-besar px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider">{t.site.popular}</span>}
                <h3 className="font-display text-xl font-extrabold">{pick(p, "name", locale)}</h3>
                {p.tagline && <p className="mt-1 text-sm text-ink-soft">{p.tagline}</p>}
                <p className="mt-5 font-display text-3xl font-extrabold text-sindoor">
                  {rs(p.pricePerMeal)} <span className="text-sm font-semibold text-ink-mute">{t.site.perMeal}</span>
                </p>
                <p className="mt-1 text-xs text-ink-mute">
                  {p.durationWeeks} {p.durationWeeks === 1 ? t.site.week : t.site.weeks} · {format(t.site.minDays, { n: p.minDaysPerWeek })}
                </p>
                <span className="mt-6 inline-flex items-center gap-1 text-sm font-bold text-sindoor">
                  {t.site.choosePlan} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" aria-hidden />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null,
    "home.coverage": (d) => (
      <section className="border-y-2 border-ink bg-paper-deep/60" key="coverage">
        <div className="container grid gap-10 py-16 md:grid-cols-2 md:items-center">
          <div>
            <SectionHeading eyebrow={d.eyebrow} title={d.title} intro={d.text} />
            <LinkButton href="/delivery-areas" variant="dark" className="mt-7">
              <MapPin className="h-4 w-4" aria-hidden /> {d.buttonLabel}
            </LinkButton>
          </div>
          <ul className="flex flex-wrap gap-2" aria-label={t.nav.coverage}>
            {zones.flatMap((z) => z.areas.slice(0, 4)).map((a, i) => (
              <li key={`${a}-${i}`} className="rounded-full border-2 border-ink bg-paper-card px-3 py-1 text-sm font-semibold" style={{ transform: `rotate(${((i * 37) % 7) - 3}deg)` }}>
                {a}
              </li>
            ))}
          </ul>
        </div>
      </section>
    ),
    "home.teams": (d) => (
      <section className="wall relative overflow-hidden text-paper" key="teams">
        <Splatter className="absolute -right-10 -top-10 h-56 w-56 opacity-30" seed={7} />
        <div className="container relative grid gap-10 py-20 md:grid-cols-[1.2fr_1fr] md:items-center">
          <div>
            <SectionHeading eyebrow={d.eyebrow} title={d.title} intro={d.text} light />
            <LinkButton href="/corporate" variant="besar" className="mt-8">
              {d.buttonLabel} <ArrowRight className="h-4 w-4" aria-hidden />
            </LinkButton>
          </div>
          <ul className="space-y-3">
            {(d.points as { text: string }[] | undefined)?.map((p) => (
              <li key={p.text} className="flex items-start gap-3 rounded-xl border border-paper/15 bg-white/5 px-4 py-3">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-besar" aria-hidden />
                <span>{p.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    ),
    "home.faq": (d) =>
      faqs.length ? (
        <section className="container py-20" key="faq">
          <div className="grid gap-10 md:grid-cols-[1fr_1.6fr]">
            <SectionHeading eyebrow={d.eyebrow} title={d.title} />
            <div className="divide-y-2 divide-ink/10 border-y-2 border-ink">
              {faqs.slice(0, Number(d.count) || 5).map((f) => (
                <details key={f.id} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-bold">
                    {pick(f, "question", locale)}
                    <span aria-hidden className="text-2xl text-sindoor transition group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-2 leading-relaxed text-ink-soft">{pick(f, "answer", locale)}</p>
                </details>
              ))}
              <p className="pt-4">
                <Link href="/faq" className="font-semibold text-sindoor underline underline-offset-2">
                  {t.nav.faq} →
                </Link>
              </p>
            </div>
          </div>
        </section>
      ) : null,
    "home.cta": (d) => (
      <section className="container pb-8 pt-12" key="cta">
        <div className="relative overflow-hidden rounded-3xl border-2 border-ink bg-besar px-6 py-14 text-center shadow-sticker-lg md:px-16">
          <Chili className="absolute -left-4 bottom-2 h-16 w-28 -rotate-12 opacity-80" />
          <Leaf className="absolute right-6 top-4 h-12 w-12 rotate-12 opacity-80" />
          <h2 className="mx-auto max-w-2xl text-3xl font-extrabold md:text-5xl">{d.title}</h2>
          <p className="mx-auto mt-3 max-w-lg text-lg text-ink-soft">{d.text}</p>
          <LinkButton href={d.buttonHref || "/menu"} size="lg" className="mt-8">
            {d.buttonLabel}
          </LinkButton>
        </div>
      </section>
    ),
  };

  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FoodEstablishment",
          name: s.brandName,
          alternateName: s.brandNameNe,
          description: s.seoDescription,
          servesCuisine: ["Nepali", "Newari", "Indo-Chinese"],
          areaServed: zones.map((z) => z.name),
          address: { "@type": "PostalAddress", addressLocality: "Kathmandu", addressCountry: "NP", streetAddress: s.address },
          ...(s.phone ? { telephone: s.phone } : {}),
          ...(s.email ? { email: s.email } : {}),
          priceRange: "Rs 150–300",
        }}
      />
      {layout
        .filter((b) => b.visible && blocks[b.key])
        .map((b) => (
          <div key={b.key}>
            {blocks[b.key](sections[b.key] ?? {})}
            {b.key === "home.teams" && testimonials.length > 0 && (
              <section className="container py-16">
                <div className="grid gap-5 md:grid-cols-3">
                  {testimonials.map((q) => (
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
            )}
          </div>
        ))}
    </>
  );
}

function Hero({ d, cutoff }: { d: Data; cutoff: string }) {
  return (
    <section className="relative overflow-hidden border-b-2 border-ink">
      <Mountains className="pointer-events-none absolute inset-x-0 bottom-0 h-24 w-full opacity-[0.07]" />
      <div className="container relative grid gap-10 py-12 md:grid-cols-[1.1fr_1fr] md:items-center md:py-20">
        <div>
          <p className="text-sm font-bold uppercase tracking-[0.14em] text-sindoor">{d.eyebrow}</p>
          <h1 className="mt-4 text-[2.7rem] font-extrabold leading-[0.98] tracking-tight md:text-[4.2rem]">
            {d.headline}{" "}
            <span className="relative inline-block text-sindoor">
              {d.highlight}
              <svg aria-hidden viewBox="0 0 300 18" className="absolute -bottom-2 left-0 h-3 w-full" preserveAspectRatio="none">
                <path d="M3 12c60-8 130-10 294-3" fill="none" stroke="#E3A83B" strokeWidth="6" strokeLinecap="round" />
              </svg>
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">{d.subhead}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <LinkButton href={d.primaryHref || "/menu"} size="lg">
              {d.primaryLabel}
            </LinkButton>
            {d.secondaryLabel && (
              <LinkButton href={d.secondaryHref || "/plans"} variant="outline" size="lg">
                {d.secondaryLabel}
              </LinkButton>
            )}
          </div>
          {d.tertiaryLabel && (
            <Link href={d.tertiaryHref || "/corporate"} className="mt-5 inline-flex items-center gap-1 font-semibold text-ink underline decoration-besar decoration-2 underline-offset-4 hover:text-sindoor">
              {d.tertiaryLabel} <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
          {Array.isArray(d.points) && d.points.length > 0 && (
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-ink-soft">
              {(d.points as { text: string }[]).map((p) => (
                <li key={p.text} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-saag" aria-hidden /> {p.text.replace("9:30 AM", cutoff)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="relative">
          {d.image ? (
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border-2 border-ink shadow-sticker-lg">
              <Image src={d.image} alt={d.imageAlt || ""} fill priority sizes="(min-width: 768px) 45vw, 100vw" className="object-cover" />
            </div>
          ) : (
            <TiffinHero className="mx-auto w-full max-w-lg" />
          )}
          <Starburst className="absolute -right-2 -top-4 h-24 w-24 rotate-12 md:right-0" color="besar">
            <span className="text-center font-marker text-sm leading-tight">
              {cutoff}
              <br />
              cut-off
            </span>
          </Starburst>
        </div>
      </div>
    </section>
  );
}

function How({ d }: { d: Data }) {
  const steps = (d.steps as { title: string; text: string }[] | undefined) ?? [];
  return (
    <section className="container py-20">
      <SectionHeading eyebrow={d.eyebrow} title={d.title} />
      <ol className="mt-10 grid gap-6 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="relative">
            <span className="font-display text-6xl font-extrabold text-besar/70" aria-hidden>
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="-mt-3 font-display text-xl font-bold">{s.title}</h3>
            <p className="mt-2 leading-relaxed text-ink-soft">{s.text}</p>
            {i < steps.length - 1 && <Arrow className="absolute -right-6 top-6 hidden h-8 w-12 md:block" />}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Week({ d, days, t }: { d: Data; days: PublicDay[]; t: Awaited<ReturnType<typeof getI18n>>["t"] }) {
  return (
    <section className="border-y-2 border-ink bg-paper-card/70">
      <div className="container py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading eyebrow={d.eyebrow} title={d.title} intro={d.intro} />
          <Link href="/menu" className="font-semibold text-sindoor underline underline-offset-4">
            {d.linkLabel} →
          </Link>
        </div>
        {days.length === 0 ? (
          <div className="mt-10">
            <EmptyState title={t.site.noMenuTitle} text={t.site.noMenuText}>
              <LinkButton href="/build" variant="outline">
                {t.nav.build}
              </LinkButton>
            </EmptyState>
          </div>
        ) : (
          <ol className="scrollbar-none -mx-4 mt-10 flex snap-x gap-4 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 lg:grid-cols-6">
            {days.map((day) => {
              const main = day.items.find((i) => i.isPrimary) ?? day.items[0];
              const others = day.items.filter((i) => i !== main);
              return (
                <li key={day.date} className="w-[78%] shrink-0 snap-start sm:w-[45%] md:w-auto">
                  <Link href={`/boxes/${main.box.slug}`} className="group block">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-mute">
                      {t.days[day.day]} · {day.label.split(" ").slice(1).join(" ")}
                    </p>
                    <BoxImage box={main.box} className="mt-2 rounded-xl border-2 border-ink" sizes="(min-width: 1024px) 16vw, 70vw" />
                    <h3 className="mt-3 font-display font-bold leading-tight group-hover:text-sindoor">{main.box.name}</h3>
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      <DietBadge diet={main.box.diet} t={t} />
                      <span className="text-sm font-bold text-sindoor">{rs(main.box.price)}</span>
                    </div>
                  </Link>
                  {others.length > 0 && (
                    <p className="mt-2 text-xs text-ink-mute">
                      {t.site.alsoToday}:{" "}
                      {others.map((o, i) => (
                        <span key={o.box.id}>
                          {i > 0 && ", "}
                          <Link href={`/boxes/${o.box.slug}`} className="underline underline-offset-2 hover:text-sindoor">
                            {o.box.name}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

function BuildTeaser({ d }: { d: Data }) {
  return (
    <section className="container py-20">
      <div className="grid items-center gap-10 rounded-3xl border-2 border-ink bg-saag-light/60 p-8 md:grid-cols-[1fr_auto] md:p-12">
        <div>
          <SectionHeading eyebrow={d.eyebrow} title={d.title} intro={d.text} />
          <LinkButton href="/build" variant="dark" className="mt-7">
            {d.buttonLabel}
          </LinkButton>
        </div>
        <div aria-hidden className="relative hidden h-40 w-56 md:block">
          <Momo className="absolute left-0 top-4 h-20 w-20 -rotate-6" />
          <Chili className="absolute bottom-0 right-6 h-14 w-24 rotate-6" />
          <Leaf className="absolute right-0 top-0 h-14 w-14" />
        </div>
      </div>
    </section>
  );
}
