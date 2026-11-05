import { Prisma, type Diet, type Weekday } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { addDays, dateOnly, isoDate, todayKTM, weekdayOf, weekStartOf, WEEKDAYS } from "@/lib/dates";
import { LIVE_STATUSES } from "./transitions";

type Tx = Prisma.TransactionClient | typeof db;

/** Box with everything needed to show dietary facts and snapshot an order. */
export const boxInclude = {
  category: { select: { id: true, slug: true, name: true, nameNe: true, sortOrder: true, isActive: true } },
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
    include: {
      items: {
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
        include: { box: { include: boxInclude }, replacementBox: { select: { id: true, slug: true, name: true, nameNe: true, isActive: true, isVisible: true } } },
      },
    },
  },
} satisfies Prisma.WeeklyMenuInclude;

export type WeekMenu = Prisma.WeeklyMenuGetPayload<{ include: typeof menuInclude }>;

/** Menu kinds. SEASONAL / PROMO behave like STANDARD for ordering; they're labelled on the site. */
export const MENU_KINDS = ["STANDARD", "SEASONAL", "PROMO"] as const;
export type MenuKind = (typeof MENU_KINDS)[number];

/**
 * A menu is live when it's PUBLISHED, or when it's a DRAFT scheduled with `publishAt` that has passed.
 * The second case makes scheduled publishing visible at read time without waiting for a cron run;
 * `publishDueMenus()` later finalises it (status, revision, rotation re-sync).
 */
export function liveMenuWhere(now: Date = new Date()): Prisma.WeeklyMenuWhereInput {
  return { OR: [{ status: "PUBLISHED" }, { status: "DRAFT", publishAt: { not: null, lte: now } }] };
}

type MenuOpts = {
  now?: Date;
  /** Staff preview: use this menu (any status) in place of the live one it would replace. */
  previewMenuId?: string;
  /** Pretend this menu isn't live (used to check what an unpublish would orphan). */
  excludeMenuId?: string;
};

/** Pick the live menu that wins: kitchen-specific first, then the most recently (scheduled-)published. */
async function pickLive(where: Prisma.WeeklyMenuWhereInput, kitchenId: string | null | undefined, opts: MenuOpts) {
  const now = opts.now ?? new Date();
  const kitchenFilter = kitchenId ? { OR: [{ kitchenId }, { kitchenId: null }] } : {};
  const rows = await db.weeklyMenu.findMany({
    where: { AND: [where, liveMenuWhere(now), kitchenFilter, opts.excludeMenuId ? { id: { not: opts.excludeMenuId } } : {}] },
    select: { id: true, kitchenId: true, status: true, publishAt: true, publishedAt: true, updatedAt: true },
    take: 20,
  });
  const eff = (r: (typeof rows)[number]) => (r.status === "DRAFT" ? r.publishAt! : (r.publishedAt ?? r.updatedAt)).getTime();
  rows.sort((a, b) => Number(Boolean(b.kitchenId)) - Number(Boolean(a.kitchenId)) || eff(b) - eff(a));
  return rows[0]?.id ?? null;
}

/** Live week-specific menu (if any) plus the live standing rotation it falls back to. */
export async function getMenuForWeek(weekStart: string, kitchenId?: string | null, opts: MenuOpts = {}) {
  const preview = opts.previewMenuId ? await db.weeklyMenu.findUnique({ where: { id: opts.previewMenuId }, include: menuInclude }) : null;
  const [specificId, standingId] = await Promise.all([
    preview && !preview.isDefault ? preview.id : pickLive({ weekStart: dateOnly(weekStart) }, kitchenId, opts),
    preview?.isDefault ? preview.id : pickLive({ isDefault: true }, kitchenId, opts),
  ]);
  const load = (id: string | null) => (!id ? null : preview?.id === id ? preview : db.weeklyMenu.findUnique({ where: { id }, include: menuInclude }));
  const [specific, standing] = await Promise.all([load(specificId), load(standingId)]);
  const menu = specific ?? standing;
  return menu ? { menu, standing, isSpecific: Boolean(specific) } : null;
}

export type DayOffer = {
  date: string;
  day: Weekday;
  closed: boolean;
  note: string | null;
  /** Per-day cut-off ("HH:MM") overriding the global one, if set on the menu day. */
  cutoff: string | null;
  menuId: string | null;
  kind: string;
  items: {
    menuDayItemId: string;
    box: BoxFull;
    price: number;
    isPrimary: boolean;
    /** Effective cap for the kitchen-day: the lower of the menu-day capacity and the dabba's max daily quantity. */
    capacity: number | null;
    soldOut: boolean;
    replacement: { id: string; slug: string; name: string; nameNe: string | null } | null;
  }[];
};

/** Effective daily cap: the stricter of the menu-day capacity and LunchBox.maxDailyQty (null = no cap). */
export function effectiveCapacity(dayCapacity: number | null, maxDailyQty: number | null) {
  const caps = [dayCapacity, maxDailyQty].filter((n): n is number => n != null);
  return caps.length ? Math.min(...caps) : null;
}

/**
 * Boxes not available for a kitchen (KitchenAvailability rows with isAvailable=false on the box or one of its dishes).
 * Without a kitchen: boxes unavailable in every active kitchen.
 */
export async function unavailableBoxIds(boxes: { id: string; items: { menuItemId: string }[] }[], kitchenId?: string | null) {
  if (!boxes.length) return new Set<string>();
  const dishIds = [...new Set(boxes.flatMap((b) => b.items.map((i) => i.menuItemId)))];
  const rows = await db.kitchenAvailability.findMany({
    where: { isAvailable: false, ...(kitchenId ? { kitchenId } : {}), OR: [{ boxId: { in: boxes.map((b) => b.id) } }, { menuItemId: { in: dishIds } }] },
    select: { kitchenId: true, boxId: true, menuItemId: true },
  });
  if (!rows.length) return new Set<string>();
  const kitchens = kitchenId ? [kitchenId] : (await db.kitchen.findMany({ where: { isActive: true }, select: { id: true } })).map((k) => k.id);
  const out = new Set<string>();
  for (const b of boxes) {
    const dishes = new Set(b.items.map((i) => i.menuItemId));
    const blocked = new Set(rows.filter((r) => r.boxId === b.id || (r.menuItemId && dishes.has(r.menuItemId))).map((r) => r.kitchenId));
    if (kitchens.length && kitchens.every((k) => blocked.has(k))) out.add(b.id);
  }
  return out;
}

/** What's on for each date of a week (only active dabbas available at the kitchen). */
export async function getWeekOffers(weekStart: string, kitchenId?: string | null, opts: MenuOpts = {}): Promise<{ offers: DayOffer[]; menu: WeekMenu | null; isSpecific: boolean }> {
  const res = await getMenuForWeek(weekStart, kitchenId, opts);
  const picked = WEEKDAYS.map((day) => {
    // A week menu overrides day by day; days it doesn't define fall back to the standing rotation.
    const own = res?.menu.days.find((d) => d.day === day);
    const fallback = res?.standing?.days.find((d) => d.day === day);
    return { md: own ?? fallback, menu: own ? res!.menu : fallback ? res!.standing! : null };
  });
  const allBoxes = new Map<string, BoxFull>();
  for (const p of picked) for (const it of p.md?.items ?? []) allBoxes.set(it.box.id, it.box);
  const blocked = await unavailableBoxIds([...allBoxes.values()], kitchenId);
  const offers = WEEKDAYS.map((day, i): DayOffer => {
    const { md, menu } = picked[i];
    return {
      date: addDays(weekStart, i),
      day,
      closed: !md || md.isClosed,
      note: md?.note ?? null,
      cutoff: md?.cutoffOverride ?? null,
      menuId: menu?.id ?? null,
      kind: menu?.kind ?? "STANDARD",
      items: (md?.items ?? [])
        .filter((it) => it.box.isActive && !blocked.has(it.box.id))
        .map((it) => ({
          menuDayItemId: it.id,
          box: it.box,
          price: it.priceOverride ?? it.box.price,
          isPrimary: it.isPrimary,
          capacity: effectiveCapacity(it.capacity, it.box.maxDailyQty),
          soldOut: it.soldOut,
          replacement:
            it.replacementBox && it.replacementBox.isActive && !blocked.has(it.replacementBox.id)
              ? { id: it.replacementBox.id, slug: it.replacementBox.slug, name: it.replacementBox.name, nameNe: it.replacementBox.nameNe }
              : null,
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

/** Dabbas already booked per "boxId|date" between two dates (live orders; one kitchen or all). */
export async function bookedBoxes(from: string, to: string, kitchenId?: string | null) {
  const rows = await db.$queryRaw<{ boxId: string; d: string; n: bigint | null }[]>`
    SELECT oi."boxId" AS "boxId", to_char(o."deliveryDate", 'YYYY-MM-DD') AS d, SUM(oi.quantity) AS n
    FROM "OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    WHERE oi."boxId" IS NOT NULL
      AND o."deliveryDate" BETWEEN ${from}::date AND ${to}::date
      AND o.status::text = ANY(${LIVE_STATUSES as string[]})
      ${kitchenId ? Prisma.sql`AND o."kitchenId" = ${kitchenId}` : Prisma.empty}
    GROUP BY 1, 2`;
  return new Map(rows.map((r) => [`${r.boxId}|${r.d}`, Number(r.n ?? 0)]));
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

// ───────────────────────────── Publishing, revisions, guards ─────────────────────────────

export type MenuSnapshot = {
  title: string;
  kind: string;
  kitchenId: string | null;
  weekStart: string | null;
  isDefault: boolean;
  days: {
    day: Weekday;
    isClosed: boolean;
    note: string | null;
    cutoffOverride: string | null;
    items: { boxId: string; boxName: string; isPrimary: boolean; capacity: number | null; soldOut: boolean; priceOverride: number | null; price: number; replacementBoxId: string | null }[];
  }[];
};

const snapInclude = { days: { include: { items: { orderBy: { sortOrder: "asc" }, include: { box: { select: { name: true, price: true } } } } } } } satisfies Prisma.WeeklyMenuInclude;

export async function menuSnapshot(menuId: string, client: Tx = db): Promise<MenuSnapshot> {
  const m = await client.weeklyMenu.findUniqueOrThrow({ where: { id: menuId }, include: snapInclude });
  return {
    title: m.title,
    kind: m.kind,
    kitchenId: m.kitchenId,
    weekStart: m.weekStart ? isoDate(m.weekStart) : null,
    isDefault: m.isDefault,
    days: WEEKDAYS.map((day) => m.days.find((d) => d.day === day))
      .filter((d): d is NonNullable<typeof d> => Boolean(d))
      .map((d) => ({
        day: d.day,
        isClosed: d.isClosed,
        note: d.note,
        cutoffOverride: d.cutoffOverride,
        items: d.items.map((i) => ({
          boxId: i.boxId,
          boxName: i.box.name,
          isPrimary: i.isPrimary,
          capacity: i.capacity,
          soldOut: i.soldOut,
          priceOverride: i.priceOverride,
          price: i.priceOverride ?? i.box.price,
          replacementBoxId: i.replacementBoxId,
        })),
      })),
  };
}

export type SnapshotDiff = { scope: string; change: string }[];

/** Human-readable differences between two menu snapshots (older → newer). */
export function diffSnapshots(prev: MenuSnapshot | null, next: MenuSnapshot): SnapshotDiff {
  if (!prev) return [{ scope: "Menu", change: "First revision" }];
  const out: SnapshotDiff = [];
  if (prev.title !== next.title) out.push({ scope: "Menu", change: `Title "${prev.title}" → "${next.title}"` });
  if (prev.kind !== next.kind) out.push({ scope: "Menu", change: `Kind ${prev.kind} → ${next.kind}` });
  if (prev.kitchenId !== next.kitchenId) out.push({ scope: "Menu", change: "Kitchen changed" });
  for (const day of WEEKDAYS) {
    const a = prev.days.find((d) => d.day === day);
    const b = next.days.find((d) => d.day === day);
    if (!a && !b) continue;
    if (!a || !b) {
      out.push({ scope: day, change: a ? "Day removed" : "Day added" });
      continue;
    }
    if (a.isClosed !== b.isClosed) out.push({ scope: day, change: b.isClosed ? "Now closed" : "Now open" });
    if ((a.cutoffOverride ?? "") !== (b.cutoffOverride ?? "")) out.push({ scope: day, change: `Cut-off ${a.cutoffOverride ?? "default"} → ${b.cutoffOverride ?? "default"}` });
    if ((a.note ?? "") !== (b.note ?? "")) out.push({ scope: day, change: "Note changed" });
    for (const it of b.items) {
      const was = a.items.find((x) => x.boxId === it.boxId);
      if (!was) {
        out.push({ scope: day, change: `Added ${it.boxName}${it.isPrimary ? " (chef's pick)" : ""}` });
        continue;
      }
      if (was.isPrimary !== it.isPrimary && it.isPrimary) out.push({ scope: day, change: `Chef's pick → ${it.boxName}` });
      if (was.price !== it.price) out.push({ scope: day, change: `${it.boxName} price ${was.price / 100} → ${it.price / 100} Rs` });
      if (was.capacity !== it.capacity) out.push({ scope: day, change: `${it.boxName} quantity ${was.capacity ?? "∞"} → ${it.capacity ?? "∞"}` });
      if (was.soldOut !== it.soldOut) out.push({ scope: day, change: `${it.boxName} ${it.soldOut ? "marked sold out" : "back on sale"}` });
      if (was.replacementBoxId !== it.replacementBoxId) out.push({ scope: day, change: `${it.boxName} replacement changed` });
    }
    for (const it of a.items) if (!b.items.some((x) => x.boxId === it.boxId)) out.push({ scope: day, change: `Removed ${it.boxName}` });
  }
  return out;
}

/** Validation shared by save and publish. Returns an error message or null. */
export function validateMenuDays(
  days: { day: Weekday; isClosed: boolean; cutoffOverride?: string | null; items: { boxId: string; isPrimary: boolean; replacementBoxId?: string | null }[] }[],
) {
  for (const d of days) {
    if (!WEEKDAYS.includes(d.day)) return "Unknown day";
    if (d.cutoffOverride && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.cutoffOverride)) return `${d.day}: cut-off must look like 09:30`;
    if (d.isClosed) continue;
    if (!d.items.length) return `${d.day}: add at least one dabba or mark the day closed`;
    if (d.items.filter((i) => i.isPrimary).length !== 1) return `${d.day}: choose exactly one chef's pick`;
    if (new Set(d.items.map((i) => i.boxId)).size !== d.items.length) return `${d.day}: a dabba appears twice`;
    for (const i of d.items) if (i.replacementBoxId && i.replacementBoxId === i.boxId) return `${d.day}: a dabba can't replace itself`;
  }
  return null;
}

/** Revalidate every public page that shows menu data. Called on publish, unpublish and live edits. */
export function revalidatePublicMenu() {
  revalidateTag("menu");
  for (const p of ["/menu", "/", "/corporate/sample-menu", "/build"]) revalidatePath(p);
  revalidatePath("/boxes/[slug]", "page");
  revalidatePath("/plans/[slug]", "page");
}

async function writeRevision(tx: Tx, menuId: string, action: "PUBLISH" | "UNPUBLISH" | "SCHEDULE" | "EDIT", actorId: string | null) {
  const m = await tx.weeklyMenu.update({ where: { id: menuId }, data: { version: { increment: 1 } }, select: { version: true } });
  const snapshot = await menuSnapshot(menuId, tx);
  await tx.weeklyMenuRevision.create({ data: { menuId, version: m.version, action, actorId, snapshot: snapshot as unknown as Prisma.InputJsonValue } });
  return m.version;
}

/** Record a revision for an edit to a live menu (the edit itself is already saved). */
export async function recordLiveEdit(menuId: string, actorId: string) {
  return db.$transaction((tx) => writeRevision(tx, menuId, "EDIT", actorId));
}

/** Weeks whose booked rotation meals should be re-assigned after this menu changes. */
async function resync(menu: { isDefault: boolean; weekStart: Date | null }, actorId: string | null) {
  const { syncRotationOrders } = await import("./subscriptions");
  const weeks = menu.isDefault ? [0, 1, 2, 3].map((i) => addDays(weekStartOf(todayKTM()), i * 7)) : menu.weekStart ? [isoDate(menu.weekStart)] : [];
  let changed = 0;
  for (const w of weeks) changed += await syncRotationOrders(w, actorId);
  return changed;
}

function publishProblem(menu: { isDefault: boolean; days: { day: Weekday; isClosed: boolean; cutoffOverride: string | null; items: { boxId: string; isPrimary: boolean; replacementBoxId: string | null }[] }[] }) {
  const open = menu.days.filter((d) => !d.isClosed);
  if (menu.isDefault && open.length === 0) return "The standing rotation needs at least one open day";
  return validateMenuDays(menu.days);
}

export type MenuResult = { ok: boolean; message: string; reassigned?: number; orders?: number };

/**
 * Booked customer-picked orders that would lose their dabba from the menu if `menuId` stopped being live.
 * Rotation orders are excluded: they're re-assigned by syncRotationOrders. Orders keep their snapshot either way.
 */
export async function orphanedOrders(menuId: string) {
  const menu = await db.weeklyMenu.findUnique({ where: { id: menuId }, include: { days: { include: { items: { select: { boxId: true } } } } } });
  if (!menu) return [];
  const boxIds = [...new Set(menu.days.flatMap((d) => d.items.map((i) => i.boxId)))];
  if (!boxIds.length) return [];
  const today = todayKTM();
  const from = menu.weekStart ? (isoDate(menu.weekStart) > today ? isoDate(menu.weekStart) : today) : today;
  const to = menu.weekStart ? addDays(isoDate(menu.weekStart), 6) : addDays(today, 56);
  if (to < from) return [];
  const orders = await db.order.findMany({
    where: {
      deliveryDate: { gte: dateOnly(from), lte: dateOnly(to) },
      status: { in: ["PENDING_PAYMENT", "SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY"] },
      followsRotation: false,
      ...(menu.kitchenId ? { kitchenId: menu.kitchenId } : {}),
      items: { some: { boxId: { in: boxIds } } },
    },
    select: { id: true, number: true, kitchenId: true, deliveryDate: true, items: { select: { boxId: true } } },
  });
  const orphaned: typeof orders = [];
  const cache = new Map<string, Map<string, DayOffer>>();
  for (const o of orders) {
    const date = isoDate(o.deliveryDate);
    const key = `${weekStartOf(date)}|${o.kitchenId}`;
    if (!cache.has(key)) {
      const { offers } = await getWeekOffers(weekStartOf(date), o.kitchenId, { excludeMenuId: menuId });
      cache.set(key, new Map(offers.map((x) => [x.date, x])));
    }
    const offer = cache.get(key)!.get(date);
    const still = new Set(offer && !offer.closed ? offer.items.map((i) => i.box.id) : []);
    if (o.items.some((i) => i.boxId && boxIds.includes(i.boxId) && !still.has(i.boxId))) orphaned.push(o);
  }
  return orphaned;
}

/** Publish now: archive the other live menu for the same week/kitchen, write a revision, re-sync rotation, revalidate. */
export async function publishMenu(menuId: string, actorId: string | null, opts: { scheduled?: boolean } = {}): Promise<MenuResult> {
  const menu = await db.weeklyMenu.findUnique({ where: { id: menuId }, include: { days: { include: { items: true } } } });
  if (!menu) return { ok: false, message: "Menu not found" };
  const err = publishProblem(menu);
  if (err) return { ok: false, message: err };
  const claimed = await db.$transaction(async (tx) => {
    // Claim: only a draft (or archived) menu moves to PUBLISHED, so concurrent cron/staff publishes are idempotent.
    const res = await tx.weeklyMenu.updateMany({
      where: { id: menuId, status: { not: "PUBLISHED" }, ...(opts.scheduled ? { publishAt: { not: null, lte: new Date() } } : {}) },
      data: { status: "PUBLISHED", publishedAt: opts.scheduled && menu.publishAt ? menu.publishAt : new Date(), publishedById: actorId, publishAt: null },
    });
    if (!res.count) return false;
    await tx.weeklyMenu.updateMany({
      where: { id: { not: menuId }, status: "PUBLISHED", kitchenId: menu.kitchenId, ...(menu.isDefault ? { isDefault: true } : { weekStart: menu.weekStart }) },
      data: { status: "ARCHIVED" },
    });
    await writeRevision(tx, menuId, "PUBLISH", actorId);
    return true;
  });
  if (!claimed) return { ok: true, message: "Already published", reassigned: 0 };
  const reassigned = await resync(menu, actorId);
  await audit({ actorId, action: "menu.published", entity: "WeeklyMenu", entityId: menuId, summary: `${menu.title} → PUBLISHED${opts.scheduled ? " (scheduled)" : ""}`, before: { status: menu.status, publishAt: menu.publishAt }, after: { status: "PUBLISHED", reassigned } });
  revalidatePublicMenu();
  return { ok: true, message: `Published. ${reassigned} booked rotation meal(s) re-assigned to the new chef's picks.`, reassigned };
}

/** Schedule a draft for `publishAt`. It becomes visible at that time (read-time check) and is finalised by publishDueMenus(). */
export async function scheduleMenu(menuId: string, publishAt: Date, actorId: string): Promise<MenuResult> {
  const menu = await db.weeklyMenu.findUnique({ where: { id: menuId }, include: { days: { include: { items: true } } } });
  if (!menu) return { ok: false, message: "Menu not found" };
  if (menu.status === "PUBLISHED") return { ok: false, message: "This menu is already live" };
  if (Number.isNaN(publishAt.getTime()) || publishAt.getTime() <= Date.now()) return { ok: false, message: "Pick a time in the future" };
  const err = publishProblem(menu);
  if (err) return { ok: false, message: err };
  await db.$transaction(async (tx) => {
    await tx.weeklyMenu.update({ where: { id: menuId }, data: { status: "DRAFT", publishAt } });
    await writeRevision(tx, menuId, "SCHEDULE", actorId);
  });
  await audit({ actorId, action: "menu.scheduled", entity: "WeeklyMenu", entityId: menuId, summary: menu.title, before: { status: menu.status, publishAt: menu.publishAt }, after: { status: "DRAFT", publishAt } });
  revalidatePublicMenu();
  return { ok: true, message: `Scheduled. Customers see it from ${publishAt.toLocaleString("en-GB", { timeZone: "Asia/Kathmandu" })} (Kathmandu).` };
}

/** Cancel a pending schedule (refused once it's due, because customers may already see it — unpublish instead). */
export async function cancelSchedule(menuId: string, actorId: string): Promise<MenuResult> {
  const menu = await db.weeklyMenu.findUnique({ where: { id: menuId } });
  if (!menu || !menu.publishAt) return { ok: false, message: "Nothing scheduled" };
  if (menu.publishAt.getTime() <= Date.now()) return { ok: false, message: "It's already live. Publish it, then unpublish if needed." };
  await db.weeklyMenu.update({ where: { id: menuId }, data: { publishAt: null } });
  await audit({ actorId, action: "menu.schedule_cancelled", entity: "WeeklyMenu", entityId: menuId, summary: menu.title, before: { publishAt: menu.publishAt }, after: { publishAt: null } });
  revalidatePublicMenu();
  return { ok: true, message: "Schedule cancelled" };
}

/**
 * Take a live menu offline (to DRAFT or ARCHIVED). Refused while booked customer orders would lose their dabba
 * from the menu. Rotation meals are re-assigned to whatever menu takes over.
 */
export async function unpublishMenu(menuId: string, to: "DRAFT" | "ARCHIVED", actorId: string): Promise<MenuResult> {
  const menu = await db.weeklyMenu.findUnique({ where: { id: menuId } });
  if (!menu) return { ok: false, message: "Menu not found" };
  const live = menu.status === "PUBLISHED" || (menu.status === "DRAFT" && menu.publishAt != null && menu.publishAt <= new Date());
  if (live) {
    const orphans = await orphanedOrders(menuId);
    if (orphans.length)
      return {
        ok: false,
        orders: orphans.length,
        message: `${orphans.length} booked order(s) (${orphans.slice(0, 5).map((o) => o.number).join(", ")}${orphans.length > 5 ? "…" : ""}) use dabbas that would disappear from the menu. Cancel or move them first, or publish a replacement menu that still includes those dabbas.`,
      };
  }
  await db.$transaction(async (tx) => {
    await tx.weeklyMenu.update({ where: { id: menuId }, data: { status: to, publishAt: null } });
    if (live) await writeRevision(tx, menuId, "UNPUBLISH", actorId);
  });
  const reassigned = live ? await resync(menu, actorId) : 0;
  await audit({ actorId, action: to === "ARCHIVED" ? "menu.archived" : "menu.unpublished", entity: "WeeklyMenu", entityId: menuId, summary: `${menu.title} → ${to}`, before: { status: menu.status, publishAt: menu.publishAt }, after: { status: to, reassigned } });
  if (live) revalidatePublicMenu();
  return { ok: true, reassigned, message: to === "ARCHIVED" ? `Archived. ${reassigned} meal(s) re-assigned.` : `Back to draft. ${reassigned} meal(s) re-assigned.` };
}

/** Finalise scheduled menus whose publishAt has passed. Idempotent; for the cron hook (WP-16). */
export async function publishDueMenus(now: Date = new Date()) {
  const due = await db.weeklyMenu.findMany({ where: { status: "DRAFT", publishAt: { not: null, lte: now } }, orderBy: { publishAt: "asc" }, select: { id: true } });
  const results: { id: string; ok: boolean; message: string }[] = [];
  for (const m of due) {
    const r = await publishMenu(m.id, null, { scheduled: true });
    results.push({ id: m.id, ok: r.ok, message: r.message });
  }
  return results;
}
