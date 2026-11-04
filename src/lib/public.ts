import type { Diet } from "@prisma/client";
import { getSettings } from "./settings";
import { addDays, formatDay, ktmNow, todayKTM, weekStartOf, isValidISODate } from "./dates";
import { pick, type Locale } from "./i18n";
import { boxFacts, getWeekOffers, type BoxFull, type DayOffer } from "@/server/menu";
import { dateProblem, getClosures, orderableDates, getLockedDates } from "@/server/calendar";

/** Plain, serialisable view of a dabba for public pages and client components. */
export type PublicBox = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  healthNote: string | null;
  price: number; // paisa (day price when shown inside a day)
  image: string | null;
  accent: string;
  isSpecial: boolean;
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
    description: pick(box, "description", locale) || null,
    healthNote: pick(box, "healthNote", locale) || null,
    price: price ?? box.price,
    image: box.image,
    accent: box.accent,
    isSpecial: box.isSpecial,
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
  items: { box: PublicBox; isPrimary: boolean; soldOut: boolean }[];
};

/** Normalise ?week= into the Sunday that starts that week. */
export function resolveWeek(raw?: string | null) {
  const today = todayKTM();
  if (raw && isValidISODate(raw)) return weekStartOf(raw);
  return weekStartOf(today);
}

/** A whole week of the public menu with orderability per day. */
export async function getPublicWeek(weekStart: string, locale: Locale, kitchenId?: string | null) {
  const settings = await getSettings();
  const [{ offers, menu, isSpecific }, closures, locked] = await Promise.all([
    getWeekOffers(weekStart, kitchenId),
    getClosures(weekStart, addDays(weekStart, 6), kitchenId),
    getLockedDates(weekStart, addDays(weekStart, 6), kitchenId),
  ]);
  const now = ktmNow();
  const days: PublicDay[] = offers.map((o) => {
    const closure = closures.get(o.date) ?? null;
    const notServiceDay = !settings.deliveryDays.includes(o.day);
    return {
      date: o.date,
      day: o.day,
      label: formatDay(o.date),
      closed: o.closed || Boolean(closure) || notServiceDay,
      closure,
      note: o.note,
      problem: dateProblem(o.date, settings, closures, { now }) ?? (locked.has(o.date) ? "Orders for this day are closed" : null),
      items: o.closed || closure || notServiceDay ? [] : o.items.map((i) => ({ box: toPublicBox(i.box, locale, i.price), isPrimary: i.isPrimary, soldOut: i.soldOut })),
    };
  });
  return { weekStart, days, hasMenu: Boolean(menu), isSpecific, settings, isPast: addDays(weekStart, 6) < now.date };
}

/** Dates (within the booking window) when a given box is on the menu and still orderable. */
export async function datesForBox(boxId: string, kitchenId?: string | null) {
  const settings = await getSettings();
  const open = await orderableDates(settings, 40, kitchenId);
  if (!open.length) return [];
  const weeks = [...new Set(open.map(weekStartOf))];
  const out: { value: string; label: string; price: number; soldOut: boolean }[] = [];
  for (const w of weeks) {
    const { offers } = await getWeekOffers(w, kitchenId);
    for (const o of offers) {
      if (!open.includes(o.date) || o.closed) continue;
      const it = o.items.find((i) => i.box.id === boxId);
      if (it) out.push({ value: o.date, label: formatDay(o.date), price: it.price, soldOut: it.soldOut });
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
