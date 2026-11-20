import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readQuery } from "@/server/api/http";
import { assertOwnSubscription, planQuoteDto } from "@/server/api/customer-dto";
import { quoteRenewal } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

const q = z.object({ weeks: z.coerce.number().int().min(1).max(26).optional() });

/** Preview renewing a plan (same plan, days, address and picks; dates from the next service day, today's price). */
export const GET = apiRoute<"user", { id: string }>({ auth: "user" }, async ({ req, user, params }) => {
  const { weeks } = readQuery(req, q);
  await assertOwnSubscription(user.id, params.id);
  const r = await quoteRenewal(user, params.id, weeks ?? null);
  return { existingRenewal: r.existing ? { id: r.existing.id, reference: r.existing.reference } : null, addressId: r.address.id, startDate: r.input.startDate, weeks: r.input.weeks, quote: planQuoteDto(r.quote) };
});
