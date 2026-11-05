import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { db } from "@/lib/db";
import { getSection } from "@/lib/cms";
import { getI18n } from "@/lib/i18n/server";
import { pick, format } from "@/lib/i18n";
import { rs } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { dateOnly, todayKTM } from "@/lib/dates";
import { PageHero, EmptyState } from "@/components/site/Section";
import { LinkButton } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { syncPlanPriceMirrors, weeksRange } from "@/server/subscriptions";

export const metadata: Metadata = {
  title: "Meal plans",
  description: "Weekly and monthly lunch plans, counted in real delivery days. Choose your days, follow the chef's rotation or pick each day, skip before the cut-off.",
  alternates: { canonical: "/plans" },
};

export default async function PlansPage() {
  const { locale, t } = await getI18n();
  const today = dateOnly(todayKTM());
  await syncPlanPriceMirrors(); // a scheduled price version that became current shows today
  const [intro, plans, s] = await Promise.all([
    getSection("plans.intro", locale),
    db.mealPlan.findMany({
      where: { isActive: true, AND: [{ OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: today } }] }, { OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }] },
      orderBy: { sortOrder: "asc" },
    }),
    getSettings(),
  ]);
  const personal = plans.filter((p) => !p.isCorporate);
  const team = plans.filter((p) => p.isCorporate);
  const maxDays = s.deliveryDays.length;

  const Card = ({ p }: { p: (typeof plans)[number] }) => {
    const save = p.compareAtPrice && p.compareAtPrice > p.pricePerMeal ? p.compareAtPrice - p.pricePerMeal : 0;
    const range = weeksRange(p);
    const minMeals = range.min * p.minDaysPerWeek;
    const maxMeals = range.max * maxDays;
    return (
      <article className={cn("card flex flex-col p-6", p.isPopular ? "shadow-sticker-lg" : "shadow-card")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-extrabold leading-tight">{pick(p, "name", locale)}</h2>
            {p.nameNe && locale === "en" && <p className="lang-ne text-sm text-ink-mute">{p.nameNe}</p>}
          </div>
          {p.isPopular && <span className="shrink-0 rotate-2 rounded-full bg-besar px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider">{t.site.popular}</span>}
          {p.isCorporate && <span className="shrink-0 rounded-full bg-ink px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-paper">{t.site.forTeams}</span>}
        </div>
        {p.tagline && <p className="mt-2 text-ink-soft">{p.tagline}</p>}
        <p className="mt-6 font-display text-4xl font-extrabold text-sindoor">
          {rs(p.pricePerMeal)} <span className="text-base font-semibold text-ink-mute">{t.site.perMeal}</span>
        </p>
        {save > 0 && (
          <p className="mt-1 text-sm text-ink-soft">
            {t.site.regular} {rs(p.compareAtPrice)} · {t.site.youSave} {rs(save)} {t.site.perMeal}
          </p>
        )}
        <dl className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-paper-deep/60 p-3 text-sm">
          <div>
            <dt className="text-ink-mute">Length</dt>
            <dd className="font-semibold">
              {range.min === range.max ? range.min : `${range.min}–${range.max}`} {range.max === 1 ? t.site.week : t.site.weeks}
            </dd>
          </div>
          <div>
            <dt className="text-ink-mute">Lunches</dt>
            <dd className="font-semibold">{minMeals === maxMeals ? minMeals : `${minMeals}–${maxMeals}`} max</dd>
          </div>
          <div className="col-span-2 text-xs text-ink-mute">{format(t.site.minDays, { n: p.minDaysPerWeek })}. {t.site.serviceDays}</div>
        </dl>
        <ul className="mt-5 space-y-2 text-sm">
          {p.includesDelivery && (
            <li className="flex gap-2">
              <Check className="h-4 w-4 shrink-0 text-saag" aria-hidden /> {t.site.deliveryIncluded}
            </li>
          )}
          {p.features.map((f) => (
            <li key={f} className="flex gap-2">
              <Check className="h-4 w-4 shrink-0 text-saag" aria-hidden /> {f}
            </li>
          ))}
        </ul>
        {p.policyNote && <p className="mt-5 border-t border-ink/10 pt-4 text-xs leading-relaxed text-ink-mute">{p.policyNote}</p>}
        <div className="mt-auto pt-6">
          {p.isCorporate ? (
            <LinkButton href="/corporate#enquire" variant="dark" className="w-full">
              Talk to us <ArrowRight className="h-4 w-4" aria-hidden />
            </LinkButton>
          ) : (
            <LinkButton href={`/plans/${p.slug}`} variant={p.isPopular ? "primary" : "outline"} className="w-full">
              {t.site.choosePlan} <ArrowRight className="h-4 w-4" aria-hidden />
            </LinkButton>
          )}
        </div>
      </article>
    );
  };

  return (
    <>
      <PageHero eyebrow={String(intro.eyebrow)} title={String(intro.title)} intro={String(intro.intro)} />
      <div className="container py-12">
        {plans.length === 0 ? (
          <EmptyState title="No plans on sale right now" text="You can still order any day from the weekly menu." />
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {personal.map((p) => (
                <Card key={p.id} p={p} />
              ))}
            </div>
            {team.length > 0 && (
              <section className="mt-16">
                <h2 className="font-display text-2xl font-extrabold">{t.site.forTeams}</h2>
                <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {team.map((p) => (
                    <Card key={p.id} p={p} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
        <section className="mt-16 grid gap-6 rounded-2xl border-2 border-ink bg-paper-card p-6 md:grid-cols-3">
          <div>
            <h3 className="font-display text-lg font-bold">Real service days</h3>
            <p className="mt-1 text-sm text-ink-soft">A plan is a number of delivery days, not calendar days. Holidays and kitchen closures are skipped and never charged.</p>
          </div>
          <div>
            <h3 className="font-display text-lg font-bold">Skip or pause</h3>
            <p className="mt-1 text-sm text-ink-soft">
              Change any day until {s.orderCutoff} that morning. {s.skipPolicy === "CREDIT" ? "A skipped paid lunch goes back to your credit." : "A skipped lunch moves to the end of your plan."}
            </p>
          </div>
          <div>
            <h3 className="font-display text-lg font-bold">No auto-renewal</h3>
            <p className="mt-1 text-sm text-ink-soft">
              We remind you before a plan ends; you renew only if you want to. <Link href="/info/refunds" className="underline underline-offset-2">Cancellation policy</Link>
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
