"use server";

import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth";
import { priceCustomBox, type BoxDiet, type CustomPick } from "@/server/builder";
import { defaultKitchenId } from "@/server/orders";
import { DIET_LABEL } from "@/lib/labels";

export type BuildQuote = {
  price: number;
  rawPrice: number;
  floorApplied: boolean;
  floor: number;
  diet: keyof typeof DIET_LABEL;
  isVeg: boolean;
  allergens: { code: string; name: string }[];
  details: string;
  problem: string | null;
  problems: string[];
  warnings: string[];
  lines: { name: string; unitPrice: number; qty: number; portion: string | null }[];
};

const BOX_DIETS: BoxDiet[] = ["VEGAN", "VEG", "EGG_OK"];

/** Keep only the shape we expect. Anything else the client sends (prices, totals) is dropped. */
function clean(picks: unknown): CustomPick[] {
  if (!Array.isArray(picks)) return [];
  return picks
    .filter((p) => p && typeof p === "object" && typeof p.menuItemId === "string")
    .slice(0, 20)
    .map((p) => ({ menuItemId: String(p.menuItemId).slice(0, 40), qty: Number(p.qty) || 1, portionId: typeof p.portionId === "string" ? p.portionId.slice(0, 40) : null }));
}

function cleanDiet(d: unknown): BoxDiet | null {
  return BOX_DIETS.includes(d as BoxDiet) ? (d as BoxDiet) : null;
}

/** Live price for the builder. Always computed on the server from current dish data. */
export async function quoteBuildAction(picks: unknown, diet?: unknown): Promise<BuildQuote> {
  const [settings, kitchenId] = await Promise.all([getSettings(), defaultKitchenId()]);
  const r = await priceCustomBox(clean(picks), settings, { kitchenId, diet: cleanDiet(diet), checkStock: true });
  const names = new Map((await db.allergen.findMany({ where: { code: { in: r.allergens } } })).map((a) => [a.code, a.name]));
  return {
    price: r.price,
    rawPrice: r.rawPrice,
    floorApplied: r.floorApplied,
    floor: settings.builderMinPrice,
    diet: r.diet,
    isVeg: DIET_LABEL[r.diet].veg,
    allergens: r.allergens.map((c) => ({ code: c, name: names.get(c) ?? c })),
    details: r.details,
    problem: r.problem,
    problems: r.problems,
    warnings: r.warnings,
    lines: r.lines.map((l) => ({ name: l.name, unitPrice: l.unitPrice, qty: l.qty, portion: l.portion })),
  };
}

/** Save a built dabba to the customer's account so it can be ordered (any service day) or used in plans. */
export async function saveBuildAction(input: { name: string; picks: unknown; diet?: unknown }): Promise<{ ok: true; id: string; price: number; name: string } | { ok: false; message: string; login?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Log in to save your dabba", login: true };
  const [settings, kitchenId] = await Promise.all([getSettings(), defaultKitchenId()]);
  const r = await priceCustomBox(clean(input?.picks), settings, { kitchenId, diet: cleanDiet(input?.diet) });
  if (r.problem) return { ok: false, message: r.problem };
  const count = await db.customBox.count({ where: { userId: user.id } });
  if (count >= 30) return { ok: false, message: "You have 30 saved dabbas — delete one from your account first" };
  const name = (typeof input?.name === "string" ? input.name : "").trim().slice(0, 60) || `My dabba ${count + 1}`;
  const box = await db.customBox.create({ data: { userId: user.id, name, items: r.picks, price: r.price } });
  return { ok: true, id: box.id, price: r.price, name };
}
