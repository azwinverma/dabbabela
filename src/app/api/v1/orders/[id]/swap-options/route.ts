import { apiRoute } from "@/server/api/route";
import { assertOwnOrder } from "@/server/api/customer-dto";
import { swapOptions } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

/** Dabbas a plan meal can be swapped to, with the price difference for each (`delta` > 0 = customer pays more). */
export const GET = apiRoute<"user", { id: string }>({ auth: "user" }, async ({ user, params }) => {
  await assertOwnOrder(user.id, params.id);
  const r = await swapOptions(params.id, user.id);
  return { date: r.date, cutoff: r.cutoff, options: r.options };
});
