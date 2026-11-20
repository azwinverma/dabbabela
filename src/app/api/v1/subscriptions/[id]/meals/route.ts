import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { created, readJson, ymd } from "@/server/api/http";
import { assertOwnSubscription, ISO_DATE, nextStep, paymentBriefDto, PAYMENT_METHODS } from "@/server/api/customer-dto";
import { addMealToPlan } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

const schema = z.object({ date: z.string().regex(ISO_DATE, "Pick a day"), boxId: z.string().min(1, "Pick a dabba").max(64), method: z.enum(PAYMENT_METHODS) });

/** Buy one extra meal for a plan (money-moving: `Idempotency-Key` required). */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", idempotent: "subscription-meal", limit: "checkout" }, async ({ req, user, params, idempotencyKey }) => {
  const b = await readJson(req, schema);
  await assertOwnSubscription(user.id, params.id);
  const r = await addMealToPlan(user, params.id, { ...b, idempotencyKey: idempotencyKey! });
  return created({
    order: r.order ? { id: r.order.id, number: r.order.number, status: r.order.status, deliveryDate: ymd(r.order.deliveryDate), total: r.order.total } : null,
    payment: paymentBriefDto(r.payment),
    needsPayment: r.needsPayment,
    next: nextStep(r.needsPayment),
  });
});
