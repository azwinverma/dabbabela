import type { Diet } from "@prisma/client";
import { getSettings } from "./settings";
import { addDays, formatDay, ktmNow, todayKTM, weekStartOf, isValidISODate } from "./dates";
import { pick, type Locale } from "./i18n";
import { bookedBoxes, boxFacts, getWeekOffers, type BoxFull, type DayOffer } from "@/server/menu";
import { dateProblem, getClosures, orderableDates, getLockedDates } from "@/server/calendar";

/** Plain, serialisable view of a dabba for public pages and client components. */
export type PublicBox = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  shortDescription: string | null;
  description: string | null;
  healthNote: string | null;
  price: number; // paisa (day price when shown inside a day)
  image: string | null;
  accent: string;
  isSpecial: boolean;
  isFeatured: boolean;
  category: { slug: string; name: string; sortOrder: number } | null;
  tags: string[];
  diet: Diet;
  isVeg: boolean;
  dietVerified: boolean;
  spice: number;
  allergens: { code: string; name: string; mayContain: boolean }[];
  nutrition: { source: "ESTIMATED" | "VERIFIED"; calories: number; proteinG: number; carbsG: number; fatG: number } | null;
  items: { name: string; qty: number; image: string | null }[];
  subs: { id: string; from: string; to: string; priceDelta: number; toDiet: Diet; toAllergens: string[] }[];
};

export function toPublicBox(box: BoxFull, locale: Locale, price?: number): PublicBox {
  const f = boxFacts(box);
  return {
    id: box.id,
    slug: box.slug,
    name: pick(box, "name", locale),
    tagline: pick(box, "tagline", locale) || null,
    shortDescription: pick(box, "shortDescription", locale) || null,
    description: pick(box, "description", locale) || null,
    healthNote: pick(box, "healthNote", locale) || null,
    price: price ?? box.price,
    image: box.image,
    accent: box.accent,
    isSpecial: box.isSpecial,
    isFeatured: box.isFeatured,
    category: box.category && box.category.isActive ? { slug: box.category.slug, name: pick(box.category, "name", locale), sortOrder: box.category.sortOrder } : null,
    tags: box.tags,
    diet: f.diet,
    isVeg: f.isVeg,
    dietVerified: f.dietVerified,
    spice: f.spice,
    allergens: f.allergens.map((a) => ({ code: a.code, name: locale === "ne" && a.nameNe ? a.nameNe : a.name, mayContain: a.mayContain })),
    nutrition: f.nutrition,
    items: box.items.map((i) => ({ name: pick(i.menuItem, "name", locale), qty: i.quantity, image: i.menuItem.image })),
    subs: box.substitutions.map((s) => ({
      id: s.id,
      from: pick(s.fromItem, "name", locale),
      to: pick(s.toItem, "name", locale),
      priceDelta: s.priceDelta,
      toDiet: s.toItem.diet,
      toAllergens: s.toItem.allergens.map((a) => a.allergen.code),
    })),
  };
}

export type PublicDay = {
  date: string;
  day: DayOffer["day"];
  label: string;
  closed: boolean;
  closure: string | null;
  note: string | null;
  problem: string | null; // why it can't be ordered now (past, cut-off, closed…)
  cutoff: string; // same-day order cut-off ("HH:MM"), per-day override or the global setting
  kind: string; // STANDARD | SEASONAL | PROMO
  items: {
    box: PublicBox;
    isPrimary: boolean;
    soldOut: boolean;
    /** Portions left for the day when the dabba has a cap (null = no cap). */
    remaining: number | null;
    /** Offered instead when sold out (only if it's on the same day and orderable). */
    replacement: { slug: string; name: string } | null;
  }[];
};

/** Customers only see dabbas that are visible on the site (staff can still order hidden ones). */
export function isPublicBox(box: Pick<BoxFull, "isActive" | "isVisible">) {
  return box.isActive && box.isVisible;
}

/** Remaining portions for a capped dabba (never negative). */
export function remainingFor(capacity: number | null, booked: number) {
  return capacity == null ? null : Math.max(0, capacity - booked);
}

/** Normalise ?week= into the Sunday that starts that week. */
export function resolveWeek(raw?: string | null) {
  const today = todayKTM();
  if (raw && isValidISODate(raw)) return weekStartOf(raw);
  return weekStartOf(today);
}

/** A whole week of the public menu with orderability per day. `previewMenuId` renders a draft for staff preview. */
export async function getPublicWeek(weekStart: string, locale: Locale, kitchenId?: string | null, opts: { previewMenuId?: string; now?: Date } = {}) {
  const settings = await getSettings();
  const end = addDays(weekStart, 6);
  const [{ offers, menu, isSpecific }, closures, locked, booked] = await Promise.all([
    getWeekOffers(weekStart, kitchenId, { previewMenuId: opts.previewMenuId, now: opts.now }),
    getClosures(weekStart, end, kitchenId),
    getLockedDates(weekStart, end, kitchenId),
    bookedBoxes(weekStart, end, kitchenId),
  ]);
  const now = ktmNow();
  const days: PublicDay[] = offers.map((o) => {
    const closure = closures.get(o.date) ?? null;
    const notServiceDay = !settings.deliveryDays.includes(o.day);
    const closed = o.closed || Boolean(closure) || notServiceDay;
    const visible = o.items.filter((i) => isPublicBox(i.box));
    const onDay = new Map(visible.map((i) => [i.box.id, i]));
    const items = closed
      ? []
      : visible.map((i) => {
          const remaining = remainingFor(i.capacity, booked.get(`${i.box.id}|${o.date}`) ?? 0);
          const soldOut = i.soldOut || remaining === 0;
          const rep = i.replacement ? onDay.get(i.replacement.id) : undefined;
          return {
            box: toPublicBox(i.box, locale, i.price),
            isPrimary: i.isPrimary,
            soldOut,
            remaining,
            replacement: soldOut && rep && !rep.soldOut ? { slug: rep.box.slug, name: pick(rep.box, "name", locale) } : null,
          };
        });
    return {
      date: o.date,
      day: o.day,
      label: formatDay(o.date),
      closed,
      closure,
      note: o.note,
      cutoff: o.cutoff ?? settings.orderCutoff,
      kind: o.kind,
      problem: dateProblem(o.date, settings, closures, { now, cutoff: o.cutoff }) ?? (locked.has(o.date) ? "Orders for this day are closed" : null),
      items,
    };
  });
  return { weekStart, days, hasMenu: Boolean(menu), isSpecific, kind: menu?.kind ?? "STANDARD", settings, isPast: end < now.date };
}

/** Categories present in a week (for the menu filter), in admin order. */
export function weekCategories(days: PublicDay[]) {
  const map = new Map<string, { slug: string; name: string; sortOrder: number }>();
  for (const d of days) for (const i of d.items) if (i.box.category) map.set(i.box.category.slug, i.box.category);
  return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** Dates (within the booking window) when a given box is on the menu and still orderable. */
export async function datesForBox(boxId: string, kitchenId?: string | null) {
  const settings = await getSettings();
  const open = await orderableDates(settings, 40, kitchenId);
  if (!open.length) return [];
  const weeks = [...new Set(open.map(weekStartOf))];
  const out: { value: string; label: string; price: number; soldOut: boolean; remaining: number | null }[] = [];
  for (const w of weeks) {
    const [{ offers }, booked] = await Promise.all([getWeekOffers(w, kitchenId), bookedBoxes(w, addDays(w, 6), kitchenId)]);
    for (const o of offers) {
      if (!open.includes(o.date) || o.closed) continue;
      const it = o.items.find((i) => i.box.id === boxId && isPublicBox(i.box));
      if (!it) continue;
      const remaining = remainingFor(it.capacity, booked.get(`${boxId}|${o.date}`) ?? 0);
      out.push({ value: o.date, label: formatDay(o.date), price: it.price, soldOut: it.soldOut || remaining === 0, remaining });
    }
  }
  return out.sort((a, b) => a.value.localeCompare(b.value));
}

/** Plain list of open order dates (Build-a-Dabba can be ordered on any service day). */
export async function dateOptions(count = 12) {
  const settings = await getSettings();
  const dates = await orderableDates(settings, count);
  return dates.map((d) => ({ value: d, label: formatDay(d) }));
}

export const SPICE_LABEL = ["Not spicy", "Mild", "Medium", "Hot", "Very hot"];
