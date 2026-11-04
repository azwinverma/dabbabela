import type { Diet, Prisma, Weekday } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dateOnly, weekdayOf, weekStartOf, WEEKDAYS } from "@/lib/dates";

/** Box with everything needed to show dietary facts and snapshot an order. */
export const boxInclude = {
  items: {
    orderBy: { sortOrder: "asc" },
    include: {
      menuItem: {
        include: {
          allergens: { include: { allergen: true } },
          recipe: { select: { currentVersionId: true, currentVersion: { select: { costPerPortion: true } } } },
        },
      },
    },
  },
  substitutions: { where: { isActive: true }, include: { fromItem: true, toItem: { include: { allergens: { include: { allergen: true } } } } } },
} satisfies Prisma.LunchBoxInclude;

export type BoxFull = Prisma.LunchBoxGetPayload<{ include: typeof boxInclude }>;

const DIET_RANK: Diet[] = ["VEGAN", "VEG", "EGG", "FISH", "CHICKEN", "BUFF", "MUTTON", "PORK"];

/** Most restrictive-to-satisfy diet among components (a box with chicken is CHICKEN). */
export function combineDiet(diets: Diet[]): Diet {
  if (!diets.length) return "VEG";
  return diets.reduce((acc, d) => (DIET_RANK.indexOf(d) > DIET_RANK.indexOf(acc) ? d : acc), "VEGAN" as Diet);
}

export function isVegDiet(d: Diet) {
  return d === "VEG" || d === "VEGAN";
}

/** Derived facts for a box (diet, allergens, nutrition, cost). Nutrition only counts items with a source. */
export function boxFacts(box: BoxFull) {
  const items = box.items.map((i) => ({ ...i.menuItem, qty: i.quantity }));
  const diet = combineDiet(items.map((i) => i.diet));
  const allergens = new Map<string, { code: string; name: string; nameNe: string | null; mayContain: boolean }>();
  for (const it of items)
    for (const a of it.allergens) {
      const prev = allergens.get(a.allergen.code);
      allergens.set(a.allergen.code, {
        code: a.allergen.code,
        name: a.allergen.name,
        nameNe: a.allergen.nameNe,
        mayContain: prev ? prev.mayContain && a.mayContain : a.mayContain,
      });
    }
  const withNutrition = items.filter((i) => i.nutritionSource !== "NONE" && i.calories != null);
  const nutritionComplete = withNutrition.length === items.length && items.length > 0;
  const sum = (k: "calories" | "proteinG" | "carbsG" | "fatG") => items.reduce((a, i) => a + (i[k] ?? 0) * i.qty, 0);
  const nutritionSource = !nutritionComplete ? "NONE" : items.every((i) => i.nutritionSource === "VERIFIED") ? "VERIFIED" : "ESTIMATED";
  const cost = items.reduce((a, i) => a + (i.recipe?.currentVersion?.costPerPortion || i.costPrice) * i.qty, 0);
  const spice = items.reduce((m, i) => Math.max(m, i.spiceLevel), 0);
  return {
    diet,
    isVeg: isVegDiet(diet),
    dietVerified: items.every((i) => i.dietVerified),
    hasOnionGarlic: items.some((i) => i.hasOnionGarlic),
    allergens: [...allergens.values()],
    spice,
    cost,
    nutrition: nutritionComplete
      ? { source: nutritionSource as "ESTIMATED" | "VERIFIED", calories: sum("calories"), proteinG: sum("proteinG"), carbsG: sum("carbsG"), fatG: sum("fatG") }
      : null,
  };
}

/** Immutable snapshot stored on OrderItem.components. */
export function boxComponents(box: BoxFull, subs: { fromItemId: string; toItem: BoxFull["substitutions"][number]["toItem"] }[] = []) {
  return box.items.map((i) => {
    const sub = subs.find((s) => s.fromItemId === i.menuItemId);
    const m = sub ? { ...sub.toItem, recipe: null } : i.menuItem;
    return {
      menuItemId: m.id,
      name: m.name,
      qty: i.quantity,
      diet: m.diet,
      station: m.station,
      allergens: m.allergens.map((a) => a.allergen.code),
      recipeVersionId: (m as typeof i.menuItem).recipe?.currentVersionId ?? null,
      substitutedFrom: sub ? i.menuItem.name : undefined,
    };
  });
}

const menuInclude = {
  days: {
    include: { items: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], include: { box: { include: boxInclude } } } },
  },
} satisfies Prisma.WeeklyMenuInclude;

export type WeekMenu = Prisma.WeeklyMenuGetPayload<{ include: typeof menuInclude }>;

/** Published week-specific menu (if any) plus the published standing rotation it falls back to. */
export async function getMenuForWeek(weekStart: string, kitchenId?: string | null) {
  const kitchenFilter = kitchenId ? { OR: [{ kitchenId }, { kitchenId: null }] } : {};
  const order = [{ kitchenId: { sort: "desc" as const, nulls: "last" as const } }, { updatedAt: "desc" as const }];
  const [specific, standing] = await Promise.all([
    db.weeklyMenu.findFirst({ where: { weekStart: dateOnly(weekStart), status: "PUBLISHED", ...kitchenFilter }, include: menuInclude, orderBy: order }),
    db.weeklyMenu.findFirst({ where: { isDefault: true, status: "PUBLISHED", ...kitchenFilter }, include: menuInclude, orderBy: order }),
  ]);
  const menu = specific ?? standing;
  return menu ? { menu, standing, isSpecific: Boolean(specific) } : null;
}

export type DayOffer = {
  date: string;
  day: Weekday;
  closed: boolean;
  note: string | null;
  items: {
    menuDayItemId: string;
    box: BoxFull;
    price: number;
    isPrimary: boolean;
    capacity: number | null;
    soldOut: boolean;
  }[];
};

/** What's on for each date of a week. */
export async function getWeekOffers(weekStart: string, kitchenId?: string | null): Promise<{ offers: DayOffer[]; menu: WeekMenu | null; isSpecific: boolean }> {
  const res = await getMenuForWeek(weekStart, kitchenId);
  const offers = WEEKDAYS.map((day, i) => {
    const date = addDays(weekStart, i);
    // A week menu overrides day by day; days it doesn't define fall back to the standing rotation.
    const md = res?.menu.days.find((d) => d.day === day) ?? res?.standing?.days.find((d) => d.day === day);
    return {
      date,
      day,
      closed: !md || md.isClosed,
      note: md?.note ?? null,
      items: (md?.items ?? [])
        .filter((it) => it.box.isActive)
        .map((it) => ({
          menuDayItemId: it.id,
          box: it.box,
          price: it.priceOverride ?? it.box.price,
          isPrimary: it.isPrimary,
          capacity: it.capacity,
          soldOut: it.soldOut,
        })),
    };
  });
  return { offers, menu: res?.menu ?? null, isSpecific: res?.isSpecific ?? false };
}

/** Offers for arbitrary dates (one query per distinct week). */
export async function getOffersForDates(dates: string[], kitchenId?: string | null) {
  const weeks = [...new Set(dates.map(weekStartOf))];
  const byDate = new Map<string, DayOffer>();
  for (const w of weeks) {
    const { offers } = await getWeekOffers(w, kitchenId);
    for (const o of offers) byDate.set(o.date, o);
  }
  return byDate;
}

/** The box a rotation plan gets on a date: primary pick, or the first veg option for veg-only plans. */
export function rotationPick(offer: DayOffer | undefined, vegOnly: boolean) {
  if (!offer || offer.closed) return null;
  const open = offer.items.filter((i) => !i.soldOut);
  const pool = vegOnly ? open.filter((i) => boxFacts(i.box).isVeg) : open;
  return pool.find((i) => i.isPrimary) ?? pool[0] ?? null;
}

export function weekDates(weekStart: string) {
  return WEEKDAYS.map((_, i) => addDays(weekStart, i));
}

export { weekdayOf };
