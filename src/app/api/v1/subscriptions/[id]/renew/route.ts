import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson, ymd } from "@/server/api/http";
import { assertOwnSubscription, nextStep, paymentBriefDto, PAYMENT_METHODS } from "@/server/api/customer-dto";
import { renewSubscription } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

const schema = z.object({ method: z.enum(PAYMENT_METHODS), weeks: z.number().int().min(1).max(26).nullable().optional(), slotId: z.string().max(64).nullable().optional() });

/**
 * Renew a plan (money-moving: `Idempotency-Key` required). Never auto-charged: payment goes through the normal flow.
 * Renewing a plan that already has a renewal returns that renewal (`replayed: true`).
 */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", idempotent: "subscription-renew", limit: "checkout" }, async ({ req, user, params, idempotencyKey }) => {
  const b = await readJson(req, schema);
  await assertOwnSubscription(user.id, params.id);
  const r = await renewSubscription(user, params.id, { method: b.method, idempotencyKey, weeks: b.weeks ?? null, slotId: b.slotId ?? undefined });
  return {
    subscription: { id: r.subscription.id, reference: r.subscription.reference, status: r.subscription.status, startDate: ymd(r.subscription.startDate), endDate: ymd(r.subscription.endDate), total: r.subscription.total },
    payment: paymentBriefDto(r.payment),
    replayed: r.replayed,
    needsPayment: r.needsPayment,
    next: nextStep(r.needsPayment),
  };
});
