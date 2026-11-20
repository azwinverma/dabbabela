import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { assertOwnSubscription } from "@/server/api/customer-dto";
import { cancelSubscription } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

const schema = z.object({ reason: z.string().trim().min(3, "Tell us briefly why — it helps us improve").max(500) });

/**
 * Cancel a plan (money-moving: `Idempotency-Key` required). Meals before their cut-off are cancelled and settled per
 * the plan's cancel policy (`credit` = paisa added to the wallet).
 */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", idempotent: "subscription-cancel", limit: "write" }, async ({ req, user, params }) => {
  const { reason } = await readJson(req, schema);
  await assertOwnSubscription(user.id, params.id);
  const r = await cancelSubscription(params.id, { id: user.id, isStaff: false }, { userId: user.id, reason });
  return {
    cancelled: r.cancelled,
    credit: r.credit,
    settlement: r.settlement,
    message: `Plan cancelled. ${r.cancelled} upcoming meal${r.cancelled === 1 ? "" : "s"} removed${r.credit ? `; ${(r.credit / 100).toFixed(0)} rupees added to your credit` : ""}.`,
  };
});
