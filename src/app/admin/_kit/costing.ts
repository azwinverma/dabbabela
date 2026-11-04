import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { boxFacts, boxInclude } from "@/server/menu";

type Tx = Prisma.TransactionClient | typeof db;

/** Cost per portion (paisa) of a recipe: Σ unitCost × qty ÷ (1 − waste) ÷ yield. */
export function recipeCost(lines: { quantity: number; wastePct: number; costPerUnit: number }[], yieldPortions: number) {
  const total = lines.reduce((a, l) => a + (l.costPerUnit * l.quantity) / Math.max(0.05, 1 - Math.min(90, Math.max(0, l.wastePct)) / 100), 0);
  return Math.round(total / Math.max(1, yieldPortions));
}

/** Packaging cost added to every box (the disposable dabba ingredient, if stocked). */
async function packagingCost(client: Tx) {
  const box = await client.ingredient.findFirst({ where: { name: { contains: "dabba", mode: "insensitive" }, unit: "PC", isActive: true }, select: { costPerUnit: true } });
  return box?.costPerUnit ?? 0;
}

/** Refresh the denormalised LunchBox.costPrice for boxes (all, or those containing a dish). */
export async function refreshBoxCosts(opts: { menuItemId?: string; boxId?: string } = {}, client: Tx = db) {
  const boxes = await client.lunchBox.findMany({
    where: opts.boxId ? { id: opts.boxId } : opts.menuItemId ? { items: { some: { menuItemId: opts.menuItemId } } } : {},
    include: boxInclude,
  });
  const pack = await packagingCost(client);
  for (const b of boxes) await client.lunchBox.update({ where: { id: b.id }, data: { costPrice: boxFacts(b).cost + pack } });
  return boxes.length;
}
