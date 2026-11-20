import { apiRoute } from "@/server/api/route";
import { assertOwnOrder } from "@/server/api/customer-dto";
import { unskipMeal } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

/** Bring back a skipped plan meal before the cut-off (not possible once its value was credited). */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", limit: "write" }, async ({ user, params }) => {
  await assertOwnOrder(user.id, params.id);
  await unskipMeal(params.id, { id: user.id, isStaff: false }, user.id);
  return { message: "Back on — we'll cook it" };
});
