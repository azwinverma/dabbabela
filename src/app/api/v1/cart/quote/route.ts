import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { cartLine, cartQuoteDto } from "@/server/api/customer-dto";
import { quoteCart } from "@/server/orders";
import { withCouponGuard } from "@/lib/coupon-guard";

export const dynamic = "force-dynamic";

const schema = z.object({
  lines: z.array(cartLine).min(1).max(60),
  addressId: z.string().max(64).nullable().optional(),
  couponCode: z.string().max(30).nullable().optional(),
});

/**
 * Price a cart on the server (same quote as the website checkout: menu, cut-offs, capacity, company share, coupon,
 * delivery fee, tax). Client totals are never trusted — POST /orders re-quotes. Wrong coupon codes count toward the
 * per-IP coupon budget shared with the website (after 10 in 10 min codes aren't checked).
 */
export const POST = apiRoute({ auth: "user" }, async ({ req, user, ip }) => {
  const b = await readJson(req, schema);
  return cartQuoteDto(await withCouponGuard(b.couponCode, (couponCode) => quoteCart(user, { lines: b.lines, addressId: b.addressId ?? null, couponCode }), ip));
});
