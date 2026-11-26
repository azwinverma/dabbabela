import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { planInput, planQuoteDto } from "@/server/api/customer-dto";
import { quoteSubscription, type PlanInput } from "@/server/subscriptions";
import { withCouponGuard } from "@/lib/coupon-guard";

export const dynamic = "force-dynamic";

/**
 * Price a meal plan (dates from `startDate` for `weeks` on `days`, holidays/menus/cut-offs applied, per-day picks).
 * Wrong coupon codes count toward the per-IP coupon budget shared with cart quotes (then codes aren't checked).
 */
export const POST = apiRoute({ auth: "user" }, async ({ req, user, ip }) => {
  const b = await readJson(req, planInput);
  const q = await withCouponGuard(b.couponCode, (couponCode) => quoteSubscription(user, { ...b, addressId: b.addressId ?? null, couponCode } as PlanInput), ip);
  return planQuoteDto(q);
});
