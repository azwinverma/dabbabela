import type { Diet } from "@prisma/client";
import { db } from "@/lib/db";
import type { SiteSettings } from "@/lib/settings";
import { rs } from "@/lib/money";
import { combineDiet } from "./menu";

/** A saved / submitted pick. `portionId` is optional; without it the option's first portion (or none) is used. */
export type CustomPick = { menuItemId: string; qty: number; portionId?: string | null };

// ───────────── diet rules ─────────────

/**
 * Group diet rules (`CustomizationGroup.dietRule`):
 * - `VEG_ONLY` / `VEGAN_ONLY` / `NO_MEAT`: every option *in this group* must satisfy the level.
 * - `VEG_BOX` / `VEGAN_BOX` / `NO_MEAT_BOX`: picking anything from this group makes the *whole dabba*
 *   follow the level (e.g. "Veg thali base" → no chicken anywhere in the box).
 */
export const DIET_RULES = {
  VEG_ONLY: { level: "VEG", scope: "GROUP", label: "Veg dishes only in this step" },
  VEGAN_ONLY: { level: "VEGAN", scope: "GROUP", label: "Vegan dishes only in this step" },
  NO_MEAT: { level: "EGG_OK", scope: "GROUP", label: "No meat or fish in this step (egg OK)" },
  VEG_BOX: { level: "VEG", scope: "BOX", label: "Picking from this step makes the whole dabba veg" },
  VEGAN_BOX: { level: "VEGAN", scope: "BOX", label: "Picking from this step makes the whole dabba vegan" },
  NO_MEAT_BOX: { level: "EGG_OK", scope: "BOX", label: "Picking from this step means no meat/fish in the dabba" },
} as const;
export type DietRule = keyof typeof DIET_RULES;
/** A customer-chosen dabba diet, re-checked on the server. */
export type BoxDiet = "VEGAN" | "VEG" | "EGG_OK";

export const BOX_DIET_LABEL: Record<BoxDiet, string> = { VEGAN: "vegan", VEG: "veg", EGG_OK: "egg-but-no-meat" };

export function isDietRule(v: unknown): v is DietRule {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(DIET_RULES, v);
}

/** Does a dish's diet satisfy a level? */
export function dietSatisfies(diet: Diet, level: BoxDiet) {
  if (level === "VEGAN") return diet === "VEGAN";
  if (level === "VEG") return diet === "VEGAN" || diet === "VEG";
  return diet === "VEGAN" || diet === "VEG" || diet === "EGG";
}

// ───────────── loading ─────────────

const OPTION_INCLUDE = {
  menuItem: { include: { allergens: { include: { allergen: true } } } },
  portions: { orderBy: { sortOrder: "asc" as const } },
  kitchenAvailability: { where: { isAvailable: false }, select: { kitchenId: true } },
};

/**
 * Active builder steps and their pickable options.
 * With `kitchenId`, options the kitchen has switched off (per option or per dish) are left out.
 * Options that break their own group's diet rule are always left out.
 */
export async function builderGroups(opts: { kitchenId?: string | null } = {}) {
  const [groups, offDishes] = await Promise.all([
    db.customizationGroup.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        options: {
          orderBy: { sortOrder: "asc" },
          where: { menuItem: { isActive: true, allowCustom: true } },
          include: OPTION_INCLUDE,
        },
      },
    }),
    opts.kitchenId
      ? db.kitchenAvailability.findMany({ where: { kitchenId: opts.kitchenId, isAvailable: false, boxId: null, optionId: null, menuItemId: { not: null } }, select: { menuItemId: true } })
      : Promise.resolve([] as { menuItemId: string | null }[]),
  ]);
  const off = new Set(offDishes.map((r) => r.menuItemId));
  return groups.map((g) => {
    const rule = isDietRule(g.dietRule) ? DIET_RULES[g.dietRule] : null;
    return {
      ...g,
      options: g.options.filter((o) => {
        if (rule?.scope === "GROUP" && !dietSatisfies(o.menuItem.diet, rule.level)) return false;
        if (!opts.kitchenId) return true;
        if (off.has(o.menuItemId)) return false;
        return !o.kitchenAvailability.some((k) => k.kitchenId === opts.kitchenId);
      }),
    };
  });
}

// ───────────── pricing + validation ─────────────

export type PriceOptions = {
  /** Kitchen that would cook it: options switched off there are refused; ingredient stock is checked there. */
  kitchenId?: string | null;
  /** Customer-chosen dabba diet (e.g. "VEG"). */
  diet?: BoxDiet | null;
  /** Check ingredient stock (soft warning only). Needs `kitchenId`. */
  checkStock?: boolean;
};

/**
 * Price + validate a Build-a-Dabba from current dish data (never from stored or client prices).
 * Enforces group min/max, group and dabba diet rules, combination rules (EXCLUDE / REQUIRE),
 * portions, kitchen availability, per-dish quantity and the minimum dabba price.
 * `problem` is the first blocking problem (kept for existing callers); `problems` lists them all;
 * `warnings` never block (e.g. an ingredient running low).
 */
export async function priceCustomBox(picksRaw: CustomPick[], settings: Pick<SiteSettings, "builderMinPrice" | "builderMaxQty">, opts: PriceOptions = {}) {
  // Merge duplicates (same dish + portion) and clamp quantities. Any price the client sent is ignored.
  const merged = new Map<string, { menuItemId: string; qty: number; portionId: string | null }>();
  for (const p of Array.isArray(picksRaw) ? picksRaw : []) {
    if (!p || typeof p.menuItemId !== "string") continue;
    const portionId = typeof p.portionId === "string" && p.portionId ? p.portionId : null;
    const key = `${p.menuItemId}|${portionId ?? ""}`;
    const qty = Math.max(1, Math.floor(Number(p.qty) || 1));
    const prev = merged.get(key);
    merged.set(key, { menuItemId: p.menuItemId, portionId, qty: Math.min(settings.builderMaxQty, (prev?.qty ?? 0) + qty) });
  }
  const picks: CustomPick[] = [...merged.values()].slice(0, 30);
  const itemIds = [...new Set(picks.map((p) => p.menuItemId))];

  const [groups, rules, recipes] = await Promise.all([
    builderGroups(),
    itemIds.length ? db.comboRule.findMany({ where: { OR: [{ itemAId: { in: itemIds } }, { itemBId: { in: itemIds } }] }, include: { itemA: true, itemB: true } }) : Promise.resolve([]),
    itemIds.length
      ? db.recipe.findMany({
          where: { menuItemId: { in: itemIds } },
          include: { currentVersion: { select: { id: true, costPerPortion: true, yieldPortions: true, ingredients: { select: { ingredientId: true, quantity: true, wastePct: true, ingredient: { select: { name: true } } } } } } },
        })
      : Promise.resolve([]),
  ]);
  type Group = (typeof groups)[number];
  type Option = Group["options"][number];
  const optionByItem = new Map<string, { group: Group; option: Option }>();
  for (const g of groups) for (const o of g.options) if (!optionByItem.has(o.menuItemId)) optionByItem.set(o.menuItemId, { group: g, option: o });
  const recipeBy = new Map(recipes.map((r) => [r.menuItemId, r]));

  // Kitchen switches (dish-level or option-level).
  let offItems = new Set<string>();
  let offOptions = new Set<string>();
  if (opts.kitchenId && itemIds.length) {
    const rows = await db.kitchenAvailability.findMany({ where: { kitchenId: opts.kitchenId, isAvailable: false, boxId: null, OR: [{ menuItemId: { in: itemIds } }, { optionId: { not: null } }] }, select: { menuItemId: true, optionId: true } });
    offItems = new Set(rows.filter((r) => r.menuItemId && !r.optionId).map((r) => r.menuItemId!));
    offOptions = new Set(rows.filter((r) => r.optionId).map((r) => r.optionId!));
  }

  const problems: string[] = [];
  const warnings: string[] = [];
  const add = (m: string) => {
    if (!problems.includes(m)) problems.push(m);
  };

  let price = 0,
    cost = 0;
  const diets: Diet[] = [];
  const allergens = new Set<string>();
  const components: {
    menuItemId: string;
    name: string;
    qty: number;
    diet: Diet;
    station: string | null;
    allergens: string[];
    recipeVersionId: string | null;
    portionId: string | null;
    portion: string | null;
    qtyMultiplier: number;
    unitPrice: number;
  }[] = [];
  const dishes: { id: string; name: string; qty: number; limit: number | null }[] = [];
  const counts = new Map<string, number>();
  const boxLevels: { level: BoxDiet; group: string }[] = [];
  const lines: { name: string; unitPrice: number; qty: number; base: number; portion: string | null; portionDelta: number }[] = [];
  const need = new Map<string, { name: string; qty: number }>();

  for (const p of picks) {
    const hit = optionByItem.get(p.menuItemId);
    if (!hit) {
      add("One of the dishes is no longer available to build with — remove it and pick again");
      continue;
    }
    const { group: g, option: o } = hit;
    const d = o.menuItem;
    if (offItems.has(d.id) || offOptions.has(o.id)) add(`${d.name} isn't available from your kitchen right now`);

    let portion: Option["portions"][number] | null = null;
    if (p.portionId) {
      portion = o.portions.find((x) => x.id === p.portionId) ?? null;
      if (!portion) add(`${d.name}: that portion size is no longer offered — pick another`);
    } else if (o.portions.length) portion = o.portions[0];
    const mult = portion ? Math.max(0, portion.qtyMultiplier) : 1;
    p.portionId = portion?.id ?? null;

    const base = o.priceOverride ?? d.price;
    const unit = Math.max(0, base + (portion?.priceDelta ?? 0));
    counts.set(g.id, (counts.get(g.id) ?? 0) + p.qty);
    price += unit * p.qty;
    const r = recipeBy.get(d.id);
    cost += Math.round((r?.currentVersion?.costPerPortion || d.costPrice) * mult) * p.qty;
    diets.push(d.diet);
    d.allergens.forEach((a) => allergens.add(a.allergen.code));
    const rule = isDietRule(g.dietRule) ? DIET_RULES[g.dietRule] : null;
    if (rule?.scope === "BOX") boxLevels.push({ level: rule.level, group: g.name });
    components.push({
      menuItemId: d.id,
      name: d.name,
      qty: p.qty,
      diet: d.diet,
      station: d.station,
      allergens: d.allergens.map((a) => a.allergen.code),
      recipeVersionId: r?.currentVersion?.id ?? null,
      portionId: portion?.id ?? null,
      portion: portion?.label ?? null,
      qtyMultiplier: mult,
      unitPrice: unit,
    });
    const existing = dishes.find((x) => x.id === d.id);
    if (existing) existing.qty += p.qty;
    else dishes.push({ id: d.id, name: d.name, qty: p.qty, limit: d.dailyLimit });
    lines.push({ name: d.name, unitPrice: unit, qty: p.qty, base, portion: portion?.label ?? null, portionDelta: portion?.priceDelta ?? 0 });

    // Ingredient need for the stock check (whole-yield quantities → per portion × multiplier × qty).
    const v = r?.currentVersion;
    if (v && v.yieldPortions > 0)
      for (const ing of v.ingredients) {
        const q = ((ing.quantity * (1 + ing.wastePct / 100)) / v.yieldPortions) * mult * p.qty;
        const cur = need.get(ing.ingredientId);
        need.set(ing.ingredientId, { name: ing.ingredient.name, qty: (cur?.qty ?? 0) + q });
      }
  }

  // Group min / max.
  for (const g of groups) {
    if (!g.options.length) continue;
    const n = counts.get(g.id) ?? 0;
    if (n < g.minSelect) add(g.minSelect === 1 ? `${g.name}: pick one` : `${g.name}: pick at least ${g.minSelect}`);
    if (n > g.maxSelect) add(g.maxSelect === 1 ? `${g.name}: only one allowed` : `${g.name}: up to ${g.maxSelect} only`);
  }

  // Dabba-wide diet (from a group rule or the customer's choice).
  const levels: { level: BoxDiet; why: string }[] = boxLevels.map((b) => ({ level: b.level, why: `because of your ${b.group.toLowerCase()} pick` }));
  if (opts.diet && opts.diet in BOX_DIET_LABEL) levels.push({ level: opts.diet, why: "as you asked" });
  for (const { level, why } of levels)
    for (const c of components) if (!dietSatisfies(c.diet, level)) add(`${c.name} can't go in a ${BOX_DIET_LABEL[level]} dabba (${why})`);

  // Combination rules.
  const ids = new Set(picks.map((p) => p.menuItemId));
  for (const r of rules) {
    if (r.kind === "EXCLUDE" && ids.has(r.itemAId) && ids.has(r.itemBId)) add(r.message ?? `${r.itemA.name} and ${r.itemB.name} don't go in the same dabba`);
    if ((r.kind === "REQUIRE" || r.kind === "REQUIRES") && ids.has(r.itemAId) && !ids.has(r.itemBId)) add(r.message ?? `${r.itemA.name} needs ${r.itemB.name} — add it or remove ${r.itemA.name}`);
  }

  // Soft stock check.
  if (opts.checkStock && opts.kitchenId && need.size) {
    const { stockOnHand } = await import("./inventory");
    const onHand = await stockOnHand(opts.kitchenId, [...need.keys()]);
    const short = [...need.entries()].filter(([id, n]) => (onHand.get(id) ?? 0) < n.qty).map(([, n]) => n.name);
    if (short.length) warnings.push(`Running low on ${short.slice(0, 3).join(", ")} — the kitchen will restock, but a dish may be swapped for a close match on busy days.`);
  }

  const floor = settings.builderMinPrice;
  const floorApplied = picks.length > 0 && price < floor;
  const finalPrice = floorApplied ? floor : price;
  const details =
    components.map((c) => `${c.name}${c.portion ? ` (${c.portion})` : ""}${c.qty > 1 ? ` ×${c.qty}` : ""}`).join(", ") + (floorApplied ? ` (minimum dabba price ${rs(floor)})` : "");
  if (!picks.length) problems.unshift("Pick your dishes");
  return {
    picks,
    price: finalPrice,
    rawPrice: price,
    floorApplied,
    cost,
    diet: combineDiet(diets),
    allergens: [...allergens],
    components,
    dishes,
    lines,
    details,
    problem: problems[0] ?? null,
    problems,
    warnings,
  };
}

/** The pure part of the client preview: what the builder page shows before the server answers. */
export function previewPrice(lines: { unitPrice: number; qty: number }[], floor: number) {
  const raw = lines.reduce((a, l) => a + Math.max(0, l.unitPrice) * l.qty, 0);
  return { raw, price: lines.length && raw < floor ? floor : raw, floorApplied: lines.length > 0 && raw < floor };
}
