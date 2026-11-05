import Link from "next/link";
import type { Dictionary, Locale } from "@/lib/i18n";
import { todayKTM } from "@/lib/dates";
import type { PublicDay } from "@/lib/public";
import { BoxCard } from "@/components/site/BoxCard";

/** Labels this package adds (kept local so the shared dictionaries stay untouched). */
const L = {
  en: {
    featured: "Featured",
    left: (n: number) => `Only ${n} left`,
    tryInstead: "Sold out — try",
    orderBy: (t: string) => `Order by ${t} on the day`,
    category: "Category",
    allCategories: "All dabbas",
    kind: { SEASONAL: "Seasonal menu", PROMO: "Special offer week" } as Record<string, string>,
  },
  ne: {
    featured: "विशेष",
    left: (n: number) => `${n} वटा मात्र बाँकी`,
    tryInstead: "सकियो — यो लिनुहोस्",
    orderBy: (t: string) => `सोही दिन ${t} सम्म अर्डर गर्नुहोस्`,
    category: "प्रकार",
    allCategories: "सबै डब्बा",
    kind: { SEASONAL: "मौसमी मेनु", PROMO: "विशेष अफर हप्ता" } as Record<string, string>,
  },
};
export const menuLabels = (locale: Locale) => L[locale] ?? L.en;

/** Featured first after the chef's pick, then the menu order. */
export function sortDayItems(items: PublicDay["items"]) {
  return [...items].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || Number(b.box.isFeatured) - Number(a.box.isFeatured));
}

export function MenuDays({
  days,
  t,
  locale,
  keep,
  isPast,
  allergies,
  preview,
}: {
  days: PublicDay[];
  t: Dictionary;
  locale: Locale;
  keep: (item: PublicDay["items"][number]) => boolean;
  isPast: boolean;
  allergies: string[];
  preview?: boolean;
}) {
  const l = menuLabels(locale);
  return (
    <ol className="space-y-12">
      {days.map((day) => {
        const items = sortDayItems(day.items.filter(keep));
        const canOrder = !preview && !day.problem && !isPast;
        return (
          <li key={day.date} id={day.date} className="scroll-mt-40">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-ink pb-2">
              <h2 className="font-display text-2xl font-extrabold">
                {t.days[day.day]} <span className="text-base font-semibold text-ink-mute">{day.label.split(" ").slice(1).join(" ")}</span>
                {l.kind[day.kind] && <span className="ml-2 align-middle text-xs font-bold uppercase tracking-wider text-sindoor">{l.kind[day.kind]}</span>}
              </h2>
              {day.closed ? (
                <span className="text-sm font-semibold text-ink-mute">{day.closure ? `${t.common.closed} — ${day.closure}` : t.common.closed}</span>
              ) : day.problem ? (
                <span className="text-sm font-semibold text-ink-mute">{day.date < todayKTM() ? t.site.past : day.problem}</span>
              ) : (
                <span className="text-sm text-ink-mute">{l.orderBy(day.cutoff)}</span>
              )}
            </div>
            {day.note && <p className="mt-2 text-sm text-ink-soft">{day.note}</p>}
            {day.closed ? null : items.length === 0 ? (
              <p className="mt-4 text-sm text-ink-mute">{day.items.length ? t.site.nothingMatches : t.site.noMenuTitle}</p>
            ) : (
              <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((i) => (
                  <div key={i.box.id} className="flex flex-col gap-1.5">
                    <BoxCard
                      box={i.box}
                      t={t}
                      eyebrow={i.isPrimary ? t.site.chefPick : i.box.isFeatured ? l.featured : i.box.isVeg ? t.site.vegOption : t.site.alsoToday}
                      date={day.date}
                      soldOut={i.soldOut}
                      disabledReason={canOrder ? null : preview ? "Preview" : t.site.orderClosed}
                      highlightAllergens={allergies}
                    />
                    {i.box.shortDescription && <p className="px-1 text-sm text-ink-soft">{i.box.shortDescription}</p>}
                    {i.soldOut && i.replacement ? (
                      <p className="px-1 text-sm font-semibold">
                        {l.tryInstead}{" "}
                        <Link href={`/boxes/${i.replacement.slug}`} className="text-sindoor underline underline-offset-2">
                          {i.replacement.name}
                        </Link>
                      </p>
                    ) : !i.soldOut && i.remaining != null && i.remaining <= 10 ? (
                      <p className="px-1 text-sm font-semibold text-besar-dark">{l.left(i.remaining)}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
