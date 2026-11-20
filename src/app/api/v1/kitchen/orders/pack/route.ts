import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { ApiError, readJson } from "@/server/api/http";
import { packCheck, packOne } from "@/server/api/kitchen-pack";

export const dynamic = "force-dynamic";

const schema = z.object({ orders: z.array(packCheck.extend({ orderId: z.string().min(1).max(64) })).min(1).max(100) });

/** Bulk packing checks. Each order is checked independently; out-of-scope / unknown orders come back as not packed. */
export const POST = apiRoute({ auth: { permission: "kitchen.edit" }, limit: "write" }, async ({ req, user }) => {
  const { orders } = await readJson(req, schema);
  const results = [];
  for (const { orderId, ...check } of orders) {
    try {
      results.push(await packOne(user, orderId, check));
    } catch (e) {
      results.push({ orderId, number: null, packed: false, reason: e instanceof ApiError ? e.message : e instanceof Error && e.message.length < 200 ? e.message : "Couldn't pack" });
    }
  }
  return { packed: results.filter((r) => r.packed).length, results };
});
