import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { planInput, planQuoteDto } from "@/server/api/customer-dto";
import { quoteSubscription, type PlanInput } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

/** Price a meal plan (dates from `startDate` for `weeks` on `days`, holidays/menus/cut-offs applied, per-day picks). */
export const POST = apiRoute({ auth: "user" }, async ({ req, user }) => {
  const b = await readJson(req, planInput);
  const q = await quoteSubscription(user, { ...b, addressId: b.addressId ?? null, couponCode: b.couponCode ?? null } as PlanInput);
  return planQuoteDto(q);
});
