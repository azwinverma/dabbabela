import type { Diet } from "@prisma/client";
import { db } from "@/lib/db";
import type { SiteSettings } from "@/lib/settings";
import { rs } from "@/lib/money";
import { combineDiet } from "./menu";

export type CustomPick = { menuItemId: string; qty: number };

export async function builderGroups() {
  return db.customizationGroup.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    include: {
      options: {
        orderBy: { sortOrder: "asc" },
        where: { menuItem: { isActive: true, allowCustom: true } },
        include: { menuItem: { include: { allergens: { include: { allergen: true } } } } },
      },
    },
  });
}

/**
 * Price + validate a Build-a-Dabba from current dish data (never from stored or client prices).
 * Enforces group min/max, combination rules, per-dish quantity and the minimum dabba price.
 */
export async function priceCustomBox(picksRaw: CustomPick[], settings: Pick<SiteSettings, "builderMinPrice" | "builderMaxQty">) {
  const picks = (Array.isArray(picksRaw) ? picksRaw : [])
    .filter((p) => p && typeof p.menuItemId === "string")
    .map((p) => ({ menuItemId: p.menuItemId, qty: Math.max(1, Math.min(settings.builderMaxQty, Math.floor(Number(p.qty) || 1))) }));
  const [groups, rules] = await Promise.all([
    builderGroups(),
    db.comboRule.findMany({ where: { OR: [{ itemAId: { in: picks.map((p) => p.menuItemId) } }, { itemBId: { in: picks.map((p) => p.menuItemId) } }] }, include: { itemA: true, itemB: true } }),
  ]);
  const optionByItem = new Map<string, { group: (typeof groups)[number]; option: (typeof groups)[number]["options"][number] }>();
  for (const g of groups) for (const o of g.options) if (!optionByItem.has(o.menuItemId)) optionByItem.set(o.menuItemId, { group: g, option: o });

  let price = 0,
    cost = 0;
  const diets: Diet[] = [];
  const allergens = new Set<string>();
  const components: { menuItemId: string; name: string; qty: number; diet: Diet; station: string | null; allergens: string[]; recipeVersionId: string | null }[] = [];
  const dishes: { id: string; name: string; qty: number; limit: number | null }[] = [];
  const counts = new Map<string, number>();
  let problem: string | null = null;

  const recipes = await db.recipe.findMany({ where: { menuItemId: { in: picks.map((p) => p.menuItemId) } }, include: { currentVersion: { select: { id: true, costPerPortion: true } } } });
  const recipeBy = new Map(recipes.map((r) => [r.menuItemId, r]));

  for (const p of picks) {
    const hit = optionByItem.get(p.menuItemId);
    if (!hit) {
      problem = problem ?? "One of the dishes is no longer available to build with";
      continue;
    }
    const d = hit.option.menuItem;
    counts.set(hit.group.id, (counts.get(hit.group.id) ?? 0) + p.qty);
    price += (hit.option.priceOverride ?? d.price) * p.qty;
    const r = recipeBy.get(d.id);
    cost += (r?.currentVersion?.costPerPortion || d.costPrice) * p.qty;
    diets.push(d.diet);
    d.allergens.forEach((a) => allergens.add(a.allergen.code));
    components.push({ menuItemId: d.id, name: d.name, qty: p.qty, diet: d.diet, station: d.station, allergens: d.allergens.map((a) => a.allergen.code), recipeVersionId: r?.currentVersion?.id ?? null });
    dishes.push({ id: d.id, name: d.name, qty: p.qty, limit: d.dailyLimit });
  }
  for (const g of groups) {
    const n = counts.get(g.id) ?? 0;
    if (n < g.minSelect) problem = problem ?? `${g.name}: pick at least ${g.minSelect}`;
    if (n > g.maxSelect) problem = problem ?? `${g.name}: up to ${g.maxSelect} only`;
  }
  const ids = new Set(picks.map((p) => p.menuItemId));
  for (const r of rules) {
    if (r.kind === "EXCLUDE" && ids.has(r.itemAId) && ids.has(r.itemBId)) problem = problem ?? r.message ?? `${r.itemA.name} and ${r.itemB.name} don't go in the same dabba`;
    if (r.kind === "REQUIRE" && ids.has(r.itemAId) && !ids.has(r.itemBId)) problem = problem ?? r.message ?? `${r.itemA.name} needs ${r.itemB.name}`;
  }
  const floor = settings.builderMinPrice;
  const floorApplied = picks.length > 0 && price < floor;
  const finalPrice = floorApplied ? floor : price;
  const details = components.map((c) => (c.qty > 1 ? `${c.name} ×${c.qty}` : c.name)).join(", ") + (floorApplied ? ` (minimum dabba price ${rs(floor)})` : "");
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
    details,
    problem: picks.length ? problem : "Pick your dishes",
  };
}
