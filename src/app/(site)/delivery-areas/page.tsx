import type { Metadata } from "next";
import { Search, MapPin, Clock } from "lucide-react";
import { db } from "@/lib/db";
import { getSection } from "@/lib/cms";
import { getI18n } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";
import { rs } from "@/lib/money";
import { searchCoverage } from "@/server/coverage";
import { PageHero } from "@/components/site/Section";
import { AreaRequestForm } from "./AreaRequestForm";

export const metadata: Metadata = {
  title: "Delivery areas",
  description: "Check whether Dabba Bela delivers lunch to your locality in Kathmandu, with delivery fees and lunch windows.",
  alternates: { canonical: "/delivery-areas" },
};

export default async function CoveragePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const query = q.trim().slice(0, 60);
  const { locale, t } = await getI18n();
  const [intro, zones, s, slots, results] = await Promise.all([
    getSection("coverage.intro", locale),
    db.deliveryZone.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, include: { kitchen: { select: { name: true, isActive: true } } } }),
    getSettings(),
    db.deliverySlot.findMany({ where: { isActive: true, kitchen: { isActive: true } }, orderBy: { sortOrder: "asc" }, select: { label: true } }),
    query.length >= 2 ? searchCoverage(query) : Promise.resolve(null),
  ]);
  const windows = [...new Set(slots.map((x) => x.label))];
  const freeAbove = (z: (typeof zones)[number]) => z.freeAbove ?? (s.freeDeliveryAbove || null);

  return (
    <>
      <PageHero eyebrow={String(intro.eyebrow)} title={String(intro.title)} intro={String(intro.intro)}>
        <form method="get" action="/delivery-areas" className="mt-7 flex max-w-xl gap-2" role="search">
          <label htmlFor="q" className="sr-only">{t.site.searchArea}</label>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-mute" aria-hidden />
            <input id="q" name="q" defaultValue={query} placeholder={t.site.searchPlaceholder} className="h-12 w-full rounded-xl border-2 border-ink bg-white pl-10 pr-3 text-base" autoComplete="address-level3" />
          </div>
          <button type="submit" className="h-12 rounded-xl border-2 border-ink bg-ink px-5 font-semibold text-paper">{t.common.search}</button>
        </form>
      </PageHero>

      <div className="container py-12">
        {results && (
          <section aria-live="polite" className="mb-14">
            {results.length ? (
              <div className="rounded-2xl border-2 border-saag bg-saag-light/70 p-6">
                <p className="font-display text-2xl font-extrabold text-saag-dark">
                  ✓ {t.site.covered}: “{query}”
                </p>
                <ul className="mt-4 space-y-3">
                  {results.map(({ zone, matches }) => (
                    <li key={zone.id} className="text-saag-dark">
                      <span className="font-semibold">{zone.name}</span>
                      {matches.length > 0 && <span> — {matches.join(", ")}</span>}
                      <span className="block text-sm">
                        {t.site.fee}: {zone.fee ? rs(zone.fee) : t.common.free}
                        {zone.fee && (zone.freeAbove ?? s.freeDeliveryAbove) ? ` · ${t.site.freeAbove} ${rs(zone.freeAbove ?? s.freeDeliveryAbove)}` : ""}
                        {zone.etaNote ? ` · ${t.site.lunchWindow}: ${zone.etaNote}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="grid gap-8 rounded-2xl border-2 border-ink bg-paper-card p-6 md:grid-cols-2">
                <div>
                  <p className="font-display text-2xl font-extrabold">{t.site.notCovered}: “{query}”</p>
                  <p className="mt-2 text-ink-soft">
                    We only list areas our riders actually cover. Tell us where you are — when enough people ask for an area, it goes on the route. You can still have lunch delivered to an address inside the areas below (an office, a friend's shop, college).
                  </p>
                </div>
                <AreaRequestForm area={query} title={t.site.requestArea} />
              </div>
            )}
          </section>
        )}

        <h2 className="font-display text-2xl font-extrabold">{zones.length} areas on our route</h2>
        {windows.length > 0 && (
          <p className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
            <Clock className="h-4 w-4" aria-hidden /> {t.site.lunchWindow}: {windows.join(" · ")}. Same-day orders close at {s.orderCutoff}.
          </p>
        )}
        <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {zones.map((z) => (
            <section key={z.id} className="card p-5">
              <h3 className="flex items-center gap-2 font-display text-lg font-bold">
                <MapPin className="h-4 w-4 text-sindoor" aria-hidden /> {z.name}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{z.areas.join(" · ")}</p>
              <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-ink/10 pt-3 text-sm">
                <div>
                  <dt className="text-xs text-ink-mute">{t.site.fee}</dt>
                  <dd className="font-semibold">{z.fee ? rs(z.fee) : t.common.free}</dd>
                </div>
                {z.fee > 0 && freeAbove(z) ? (
                  <div>
                    <dt className="text-xs text-ink-mute">{t.common.free}</dt>
                    <dd className="font-semibold">≥ {rs(freeAbove(z))}</dd>
                  </div>
                ) : null}
                {z.minOrder > 0 && (
                  <div>
                    <dt className="text-xs text-ink-mute">Minimum</dt>
                    <dd className="font-semibold">{rs(z.minOrder)}</dd>
                  </div>
                )}
                {z.etaNote && (
                  <div>
                    <dt className="text-xs text-ink-mute">{t.site.lunchWindow}</dt>
                    <dd className="font-semibold">{z.etaNote}</dd>
                  </div>
                )}
              </dl>
            </section>
          ))}
        </div>
        {!results && (
          <section className="mt-14 grid gap-8 rounded-2xl border-2 border-dashed border-ink/30 p-6 md:grid-cols-2">
            <div>
              <h2 className="font-display text-xl font-bold">{t.site.notCovered}?</h2>
              <p className="mt-2 text-ink-soft">Ask us to add your area — we use these requests to plan new routes and future kitchens.</p>
            </div>
            <AreaRequestForm area="" title={t.site.requestArea} />
          </section>
        )}
      </div>
    </>
  );
}
