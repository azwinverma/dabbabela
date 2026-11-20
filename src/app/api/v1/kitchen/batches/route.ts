import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { iso, readQuery, ymd } from "@/server/api/http";
import { pickApiKitchen } from "@/server/api/auth";
import { isoDateStr } from "@/server/api/ops-dto";
import { batchShortages } from "@/server/kitchen";
import { dateOnly, todayKTM } from "@/lib/dates";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const q = z.object({ kitchenId: z.string().max(64).optional(), date: isoDateStr.optional() });

/** Production batches of a kitchen-day (plan them with POST /kitchen/batches/plan), with recorded stock shortages. */
export const GET = apiRoute({ auth: { permission: "kitchen.view" } }, async ({ req, user }) => {
  const p = readQuery(req, q);
  const kitchen = await pickApiKitchen(user, p.kitchenId);
  const date = p.date ?? todayKTM();
  const [batches, shortages] = await Promise.all([
    db.productionBatch.findMany({ where: { kitchenId: kitchen.id, date: dateOnly(date) }, include: { menuItem: { select: { name: true } } }, orderBy: [{ station: "asc" }, { createdAt: "asc" }] }),
    batchShortages(kitchen.id, date),
  ]);
  return {
    kitchen,
    date,
    batches: batches.map((b) => ({
      id: b.id,
      date: ymd(b.date),
      menuItemId: b.menuItemId,
      dish: b.menuItem.name,
      station: b.station,
      status: b.status,
      plannedPortions: b.plannedPortions,
      bufferPortions: b.bufferPortions,
      actualPortions: b.actualPortions,
      wastePortions: b.wastePortions,
      assignedTo: b.assignedTo,
      stockPosted: b.stockPosted,
      notes: b.notes,
      startedAt: iso(b.startedAt),
      completedAt: iso(b.completedAt),
    })),
    shortages: shortages.map((s) => ({ batchId: s.batchId, dish: s.dish, ingredientId: s.ingredientId, name: s.name, unit: s.unit, type: s.type, shortage: s.shortage, at: iso(s.at) })),
  };
});
