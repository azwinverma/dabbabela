import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { notFound, readJson } from "@/server/api/http";
import { assertKitchenScope } from "@/server/api/auth";
import { advanceBatch } from "@/server/kitchen";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const schema = z.object({
  to: z.enum(["COOKING", "DONE", "CANCELLED"]),
  actualPortions: z.number().int().min(0).max(100_000).optional(),
  wastePortions: z.number().int().min(0).max(100_000).optional(),
  assignedTo: z.string().trim().max(80).optional(),
  /** Required to cancel. */
  notes: z.string().trim().max(300).optional(),
});

/**
 * Move a batch PLANNED → COOKING → DONE (or CANCELLED with a note) via `advanceBatch`. DONE posts ingredient usage to
 * stock exactly once; ingredients that weren't in stock come back in `shortages` (recorded, not hidden).
 */
export const POST = apiRoute<{ permission: "kitchen.edit" }, { id: string }>({ auth: { permission: "kitchen.edit" }, limit: "write" }, async ({ req, user, params }) => {
  const body = await readJson(req, schema);
  const b = await db.productionBatch.findUnique({ where: { id: params.id }, select: { kitchenId: true } });
  if (!b) throw notFound("Batch not found");
  assertKitchenScope(user, b.kitchenId);
  const { to, ...data } = body;
  const r = await advanceBatch(params.id, to, user.id, data);
  const now = await db.productionBatch.findUniqueOrThrow({ where: { id: params.id }, select: { id: true, status: true, actualPortions: true, wastePortions: true, stockPosted: true } });
  return { ...now, shortages: r.shortages };
});
