import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getI18n } from "@/lib/i18n/server";
import { getSection } from "@/lib/cms";
import { getCurrentUser } from "@/lib/auth";
import { addDays, formatDay, todayKTM, weekStartOf } from "@/lib/dates";
import { getPublicWeek, resolveWeek, type PublicDay } from "@/lib/public";
import { PageHero, EmptyState } from "@/components/site/Section";
import { BoxCard } from "@/components/site/BoxCard";
import { LinkButton } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "This week's menu",
  description: "The Dabba Bela lunch menu for the week, day by day, with a vegetarian option every day, allergens and prices.",
  alternates: { canonical: "/menu" },
};

type SP = Promise<{ week?: string; diet?: string; mild?: string; avoid?: string }>;

const DIETS = ["veg", "egg", "chicken"] as const;

function keep(item: PublicDay["items"][number], f: { diet?: string; mild: boolean; avoid: string[] }) {
  const b = item.box;
  if (f.diet === "veg" && !b.isVeg) return false;
  if (f.diet === "egg" && !["VEGAN", "VEG", "EGG"].includes(b.diet)) return false;
  if (f.diet === "chicken" && b.diet !== "CHICKEN") return false;
  if (f.mild && b.spice > 1) return false;
  if (f.avoid.length && b.allergens.some((a) => f.avoid.includes(a.code))) return false;
  return true;
}

export default async function MenuPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { locale, t } = await getI18n();
  const [intro, user] = await Promise.all([getSection("menu.intro", locale), getCurrentUser()]);
  const week = resolveWeek(sp.week);
  const current = weekStartOf(todayKTM());
  const data = await getPublicWeek(week, locale);
  const diet = DIETS.includes(sp.diet as (typeof DIETS)[number]) ? sp.diet : undefined;
  const mild = sp.mild === "1";
  const avoidOn = sp.avoid === "1" && Boolean(user?.allergies.length);
  const filters = { diet, mild, avoid: avoidOn ? user!.allergies : [] };
  const anyFilter = Boolean(diet || mild || avoidOn);

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { week: week === current ? undefined : week, diet, mild: mild ? "1" : undefined, avoid: avoidOn ? "1" : undefined, ...patch };
    Object.entries(merged).forEach(([k, v]) => v && p.set(k, v));
    const s = p.toString();
    return `/menu${s ? `?${s}` : ""}`;
  };
  const weekLabel = `${formatDay(week)} – ${formatDay(addDays(week, 6))}`;
  const chip = (active: boolean) =>
    cn("rounded-full border-2 px-3.5 py-1.5 text-sm font-semibold transition", active ? "border-ink bg-ink text-paper" : "border-ink/20 bg-paper-card hover:border-ink");

  return (
    <>
      <PageHero eyebrow={String(intro.eyebrow)} title={String(intro.title)} intro={String(intro.intro)} />

      <div className="sticky top-0 z-20 border-b-2 border-ink bg-paper/95 backdrop-blur">
        <div className="container flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
          <nav className="flex items-center gap-2" aria-label="Week">
            <Link href={qs({ week: addDays(week, -7) })} className="rounded-full p-2 hover:bg-ink/5" aria-label={t.site.previousWeek}>
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <div className="min-w-0 text-center">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-mute">
                {week === current ? t.menu.thisWeek : week === addDays(current, 7) ? t.menu.nextWeek : week < current ? t.site.past : t.menu.weekOf}
              </p>
              <p className="font-display font-bold">{weekLabel}</p>
            </div>
            <Link href={qs({ week: addDays(week, 7) })} className="rounded-full p-2 hover:bg-ink/5" aria-label={t.site.nextWeekShort}>
              <ChevronRight className="h-5 w-5" />
            </Link>
            {week !== current && (
              <Link href={qs({ week: undefined })} className="ml-1 text-sm font-semibold text-sindoor underline underline-offset-2">
                {t.menu.thisWeek}
              </Link>
            )}
          </nav>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.site.filterBy}>
            <Link href={qs({ diet: undefined })} className={chip(!diet)} aria-pressed={!diet}>{t.filters.all}</Link>
            <Link href={qs({ diet: "veg" })} className={chip(diet === "veg")} aria-pressed={diet === "veg"}>{t.filters.veg}</Link>
            <Link href={qs({ diet: "egg" })} className={chip(diet === "egg")} aria-pressed={diet === "egg"}>{t.filters.egg}</Link>
            <Link href={qs({ diet: "chicken" })} className={chip(diet === "chicken")} aria-pressed={diet === "chicken"}>{t.filters.chicken}</Link>
            <Link href={qs({ mild: mild ? undefined : "1" })} className={chip(mild)} aria-pressed={mild}>{t.filters.mild}</Link>
            {user?.allergies.length ? (
              <Link href={qs({ avoid: avoidOn ? undefined : "1" })} className={chip(avoidOn)} aria-pressed={avoidOn}>{t.filters.allergenFree}</Link>
            ) : (
              <Link href={user ? "/account/profile" : "/login?next=/menu"} className="text-xs font-semibold text-ink-mute underline underline-offset-2">
                {t.site.loginForAllergens}
              </Link>
            )}
            {anyFilter && (
              <Link href={qs({ diet: undefined, mild: undefined, avoid: undefined })} className="text-sm font-semibold text-sindoor underline underline-offset-2">
                {t.site.clearFilters}
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="container py-10">
        {!data.hasMenu ? (
          <EmptyState title={t.site.noMenuTitle} text={t.site.noMenuText}>
            <LinkButton href="/build" variant="outline">{t.nav.build}</LinkButton>
          </EmptyState>
        ) : (
          <ol className="space-y-12">
            {data.days.map((day) => {
              const items = day.items.filter((i) => keep(i, filters)).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
              const canOrder = !day.problem && !data.isPast;
              return (
                <li key={day.date} id={day.date} className="scroll-mt-40">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-ink pb-2">
                    <h2 className="font-display text-2xl font-extrabold">
                      {t.days[day.day]} <span className="text-base font-semibold text-ink-mute">{day.label.split(" ").slice(1).join(" ")}</span>
                    </h2>
                    {day.closed ? (
                      <span className="text-sm font-semibold text-ink-mute">{day.closure ? `${t.common.closed} — ${day.closure}` : t.common.closed}</span>
                    ) : day.problem ? (
                      <span className="text-sm font-semibold text-ink-mute">{day.date < todayKTM() ? t.site.past : day.problem}</span>
                    ) : null}
                  </div>
                  {day.note && <p className="mt-2 text-sm text-ink-soft">{day.note}</p>}
                  {day.closed ? null : items.length === 0 ? (
                    <p className="mt-4 text-sm text-ink-mute">{day.items.length ? t.site.nothingMatches : t.site.noMenuTitle}</p>
                  ) : (
                    <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((i) => (
                        <BoxCard
                          key={i.box.id}
                          box={i.box}
                          t={t}
                          eyebrow={i.isPrimary ? t.site.chefPick : i.box.isVeg ? t.site.vegOption : t.site.alsoToday}
                          date={day.date}
                          soldOut={i.soldOut}
                          disabledReason={canOrder ? null : t.site.orderClosed}
                          highlightAllergens={user?.allergies ?? []}
                        />
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-12 max-w-3xl rounded-xl border-2 border-ink/15 bg-paper-card px-4 py-3 text-sm text-ink-soft">
          {t.site.sharedKitchen} {t.menu.nutritionNote}
        </p>
      </div>
    </>
  );
}
