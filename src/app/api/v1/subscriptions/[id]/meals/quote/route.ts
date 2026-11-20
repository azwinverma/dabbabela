import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { assertOwnSubscription, ISO_DATE } from "@/server/api/customer-dto";
import { quoteAddMeal } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

const schema = z.object({ date: z.string().regex(ISO_DATE, "Pick a day"), boxId: z.string().min(1, "Pick a dabba").max(64) });

/** Price one extra meal for a plan (the plan's per-meal price; delivery free when a plan meal already goes out that day). */
export const POST = apiRoute<"user", { id: string }>({ auth: "user" }, async ({ req, user, params }) => {
  const b = await readJson(req, schema);
  await assertOwnSubscription(user.id, params.id);
  const q = await quoteAddMeal(user, params.id, b);
  return { name: q.pick.box.name, unitPrice: q.unitPrice, deliveryFee: q.priced.deliveryFee, tax: q.priced.tax, total: q.priced.total, taxInclusive: q.tax?.inclusive ?? true };
});
