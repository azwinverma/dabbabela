import { apiRoute } from "@/server/api/route";
import { assertOwnOrder } from "@/server/api/customer-dto";
import { skipMeal } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

/**
 * Skip one plan meal before the cut-off (money-moving under the CREDIT policy: `Idempotency-Key` required).
 * `policy: EXTEND` → the meal moves to the end of the plan (`moved` dates); `CREDIT` → its value goes to the wallet.
 */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", idempotent: "order-skip", limit: "write" }, async ({ user, params }) => {
  await assertOwnOrder(user.id, params.id);
  const r = await skipMeal(params.id, { id: user.id, isStaff: false }, user.id);
  const message = r.policy === "CREDIT" ? "Skipped — the meal's value is in your credit" : `Skipped — moved to ${r.moved.join(", ") || "the end of your plan"}`;
  return { policy: r.policy, moved: r.moved, credited: r.credited, message };
});
