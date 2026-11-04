"use server";

import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth";
import { priceCustomBox, type CustomPick } from "@/server/builder";
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
};

function clean(picks: unknown): CustomPick[] {
  if (!Array.isArray(picks)) return [];
  return picks
    .filter((p) => p && typeof p.menuItemId === "string")
    .slice(0, 20)
    .map((p) => ({ menuItemId: String(p.menuItemId), qty: Number(p.qty) || 1 }));
}

/** Live price for the builder. Always computed on the server from current dish data. */
export async function quoteBuildAction(picks: unknown): Promise<BuildQuote> {
  const settings = await getSettings();
  const r = await priceCustomBox(clean(picks), settings);
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
  };
}

/** Save a built dabba to the customer's account so it can be ordered (any service day) or used in plans. */
export async function saveBuildAction(input: { name: string; picks: unknown }): Promise<{ ok: true; id: string; price: number; name: string } | { ok: false; message: string; login?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Log in to save your dabba", login: true };
  const settings = await getSettings();
  const picks = clean(input.picks);
  const r = await priceCustomBox(picks, settings);
  if (r.problem) return { ok: false, message: r.problem };
  const count = await db.customBox.count({ where: { userId: user.id } });
  if (count >= 30) return { ok: false, message: "You have 30 saved dabbas — delete one from your account first" };
  const name = (input.name || "").trim().slice(0, 60) || `My dabba ${count + 1}`;
  const box = await db.customBox.create({ data: { userId: user.id, name, items: r.picks, price: r.price } });
  return { ok: true, id: box.id, price: r.price, name };
}
