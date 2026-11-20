import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { created, iso, readJson, ymd } from "@/server/api/http";
import { nextStep, paymentBriefDto, PAYMENT_METHODS, planInput } from "@/server/api/customer-dto";
import { createSubscription } from "@/server/subscriptions";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The caller's meal plans, newest first, with meal counts. */
export const GET = apiRoute({ auth: "user" }, async ({ user }) => {
  const subs = await db.subscription.findMany({
    where: { userId: user.id },
    include: { plan: { select: { id: true, name: true, slug: true } }, _count: { select: { orders: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const done = await db.order.groupBy({ by: ["subscriptionId"], where: { subscriptionId: { in: subs.map((s) => s.id) }, status: "DELIVERED" }, _count: true });
  const delivered = new Map(done.map((d) => [d.subscriptionId, d._count]));
  return subs.map((s) => ({
    id: s.id,
    reference: s.reference,
    status: s.status,
    plan: s.plan,
    startDate: ymd(s.startDate),
    endDate: ymd(s.endDate),
    days: s.days,
    vegOnly: s.vegOnly,
    mealsTotal: s.mealsTotal,
    mealsDelivered: delivered.get(s.id) ?? 0,
    pricePerMeal: s.pricePerMeal,
    total: s.total,
    pausedUntil: ymd(s.pausedUntil),
    createdAt: iso(s.createdAt),
  }));
});

const createSchema = planInput.extend({
  addressId: z.string().min(1, "Choose a delivery address").max(64),
  slotId: z.string().max(64).nullable().optional(),
  method: z.enum(PAYMENT_METHODS),
  notes: z.string().max(500).nullable().optional(),
});

/** Start a meal plan (money-moving: `Idempotency-Key` required). `next: "PAY"` → POST /payments/{payment.id}/start. */
export const POST = apiRoute({ auth: "user", idempotent: "subscriptions", limit: "checkout" }, async ({ req, user, idempotencyKey }) => {
  const b = await readJson(req, createSchema);
  const r = await createSubscription(user, { ...b, slotId: b.slotId || null, notes: b.notes ?? null, couponCode: b.couponCode || null, idempotencyKey } as Parameters<typeof createSubscription>[1]);
  return created({
    subscription: { id: r.subscription.id, reference: r.subscription.reference, status: r.subscription.status, startDate: ymd(r.subscription.startDate), endDate: ymd(r.subscription.endDate), total: r.subscription.total },
    payment: paymentBriefDto(r.payment),
    needsPayment: r.needsPayment,
    next: nextStep(r.needsPayment),
  });
});
