import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { assertOwnSubscription } from "@/server/api/customer-dto";
import { changePlanAddress } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

const schema = z.object({ addressId: z.string().min(1).max(64) });

/** Move a plan's upcoming (still changeable) meals to another of the caller's addresses (delivery window checked on the new zone). */
export const PUT = apiRoute<"user", { id: string }>({ auth: "user", limit: "write" }, async ({ req, user, params }) => {
  const { addressId } = await readJson(req, schema);
  await assertOwnSubscription(user.id, params.id);
  const n = await changePlanAddress(params.id, user, addressId);
  return { moved: n, message: `${n} upcoming meal${n === 1 ? "" : "s"} will go to the new address` };
});
