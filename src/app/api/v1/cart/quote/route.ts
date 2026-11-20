import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { cartLine, cartQuoteDto } from "@/server/api/customer-dto";
import { quoteCart } from "@/server/orders";

export const dynamic = "force-dynamic";

const schema = z.object({
  lines: z.array(cartLine).min(1).max(60),
  addressId: z.string().max(64).nullable().optional(),
  couponCode: z.string().max(30).nullable().optional(),
});

/**
 * Price a cart on the server (same quote as the website checkout: menu, cut-offs, capacity, company share, coupon,
 * delivery fee, tax). Client totals are never trusted — POST /orders re-quotes.
 */
export const POST = apiRoute({ auth: "user" }, async ({ req, user }) => {
  const b = await readJson(req, schema);
  return cartQuoteDto(await quoteCart(user, { lines: b.lines, addressId: b.addressId ?? null, couponCode: b.couponCode ?? null }));
});
