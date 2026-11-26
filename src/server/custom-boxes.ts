import "server-only";
import type { CustomBox } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { DIET_LABEL } from "@/lib/labels";
import { priceCustomBox, type BoxDiet, type CustomPick } from "./builder";
import { defaultKitchenId } from "./orders";

/**
 * Build-a-Dabba boxes shared by the website builder (/build, /account/boxes) and the mobile API (/api/v1/builder,
 * /api/v1/saved-boxes). Prices are always recomputed from current dish data with `priceCustomBox` (group min/max,
 * diet and combination rules, portions, kitchen availability, `builderMaxQty` per dish, `builderMinPrice` floor);
 * nothing the client sends about price is used. Ordering a saved box = a cart line `{ kind: "custom", id }`, which
 * checkout re-prices again (and refuses on a company-billed order — quoteCart).
 */

export class CustomBoxError extends Error {}

/** Saved boxes per customer. */
export const MAX_SAVED_BOXES = 30;
const BOX_DIETS: BoxDiet[] = ["VEGAN", "VEG", "EGG_OK"];

/** Keep only the shape we expect (anything else the client sends — prices, totals — is dropped). */
export function cleanPicks(picks: unknown): CustomPick[] {
  if (!Array.isArray(picks)) return [];
  return picks
    .filter((p) => p && typeof p === "object" && typeof (p as CustomPick).menuItemId === "string")
    .slice(0, 20)
    .map((p) => {
      const x = p as CustomPick;
      return { menuItemId: String(x.menuItemId).slice(0, 40), qty: Number(x.qty) || 1, portionId: typeof x.portionId === "string" ? x.portionId.slice(0, 40) : null };
    });
}

export function cleanDiet(d: unknown): BoxDiet | null {
  return BOX_DIETS.includes(d as BoxDiet) ? (d as BoxDiet) : null;
}

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

/** Live price + validation of a build (the builder preview). Kitchen = the default kitchen, like the web builder. */
export async function quoteBuild(picks: unknown, diet?: unknown): Promise<BuildQuote> {
  const [settings, kitchenId] = await Promise.all([getSettings(), defaultKitchenId()]);
  const r = await priceCustomBox(cleanPicks(picks), settings, { kitchenId, diet: cleanDiet(diet), checkStock: true });
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

async function priced(picks: unknown, diet: unknown) {
  const [settings, kitchenId] = await Promise.all([getSettings(), defaultKitchenId()]);
  const r = await priceCustomBox(cleanPicks(picks), settings, { kitchenId, diet: cleanDiet(diet) });
  if (r.problem) throw new CustomBoxError(r.problem);
  return r;
}

/** Save a new built dabba (validated + priced on the server). */
export async function saveBuiltBox(userId: string, input: { name?: unknown; picks: unknown; diet?: unknown }): Promise<CustomBox> {
  const r = await priced(input.picks, input.diet);
  const count = await db.customBox.count({ where: { userId } });
  if (count >= MAX_SAVED_BOXES) throw new CustomBoxError(`You have ${MAX_SAVED_BOXES} saved dabbas — delete one from your account first`);
  const name = (typeof input.name === "string" ? input.name : "").trim().slice(0, 60) || `My dabba ${count + 1}`;
  return db.customBox.create({ data: { userId, name, items: r.picks, price: r.price } });
}

/** Rename and/or rebuild one of the caller's boxes. Another customer's box → not found. */
export async function updateBuiltBox(userId: string, id: string, input: { name?: unknown; picks?: unknown; diet?: unknown }): Promise<CustomBox> {
  const box = await db.customBox.findFirst({ where: { id, userId } });
  if (!box) throw new CustomBoxError("Saved dabba not found");
  const data: { name?: string; items?: CustomPick[]; price?: number } = {};
  if (input.name !== undefined) {
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 60) : "";
    if (name.length < 2) throw new CustomBoxError("Give it a name");
    data.name = name;
  }
  if (input.picks !== undefined) {
    const r = await priced(input.picks, input.diet);
    data.items = r.picks;
    data.price = r.price;
  }
  if (!Object.keys(data).length) return box;
  return db.customBox.update({ where: { id: box.id }, data });
}

/** Delete one of the caller's boxes — refused while an active plan still has it booked on an upcoming day. */
export async function deleteCustomBox(userId: string, id: string) {
  const used = await db.subscription.findFirst({ where: { userId, status: { in: ["ACTIVE", "PAUSED", "PENDING_PAYMENT"] }, orders: { some: { items: { some: { customBoxId: id } }, status: { in: ["SCHEDULED", "PENDING_PAYMENT"] } } } } });
  if (used) throw new CustomBoxError("This dabba is booked in an active plan — it stays until those days pass");
  const r = await db.customBox.deleteMany({ where: { id, userId } });
  return r.count > 0;
}

/** The caller's saved boxes, each re-priced now (`problem` = why it can't be ordered as built). */
export async function listCustomBoxes(userId: string) {
  const [settings, rows] = await Promise.all([getSettings(), db.customBox.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } })]);
  return Promise.all(
    rows.map(async (b) => {
      const p = await priceCustomBox(b.items as unknown as CustomPick[], settings);
      return { box: b, price: p.price, problem: p.problem, details: p.details, diet: p.diet, allergens: p.allergens };
    }),
  );
}
