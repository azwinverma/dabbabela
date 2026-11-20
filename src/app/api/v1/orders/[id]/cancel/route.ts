import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { assertOwnOrder } from "@/server/api/customer-dto";
import { cancelOrder } from "@/server/orders";

export const dynamic = "force-dynamic";

const schema = z.object({ reason: z.string().max(300).optional() });

/**
 * Cancel a single (non-plan) order before the day's cut-off (money-moving: `Idempotency-Key` required). Paid money
 * goes back as wallet credit or a refund request per settings → `settlement: CREDIT | REFUND | NONE`.
 */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", idempotent: "order-cancel", limit: "write" }, async ({ req, user, params }) => {
  const { reason } = await readJson(req, schema);
  await assertOwnOrder(user.id, params.id);
  const r = await cancelOrder(params.id, { id: user.id, isStaff: false }, { reason: reason?.trim() || "Cancelled by customer", userId: user.id });
  const message = r.settlement === "CREDIT" ? "Cancelled — the amount is back in your credit" : r.settlement === "REFUND" ? "Cancelled — your refund is being processed" : "Cancelled";
  return { settlement: r.settlement, amount: r.amount, message };
});
