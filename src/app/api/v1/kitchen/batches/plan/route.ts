import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { assertKitchenScope } from "@/server/api/auth";
import { isoDateStr } from "@/server/api/ops-dto";
import { planBatches } from "@/server/kitchen";

export const dynamic = "force-dynamic";

const schema = z.object({ kitchenId: z.string().min(1).max(64), date: isoDateStr, bufferPct: z.number().int().min(0).max(30).default(5) });

/** Plan (or refresh still-PLANNED) batches for a kitchen-day from the demand forecast (`planBatches`). */
export const POST = apiRoute({ auth: { permission: "kitchen.edit" }, limit: "write" }, async ({ req, user }) => {
  const b = await readJson(req, schema);
  assertKitchenScope(user, b.kitchenId);
  const r = await planBatches(b.kitchenId, b.date, b.bufferPct);
  return { ...r, bufferPct: b.bufferPct };
});
