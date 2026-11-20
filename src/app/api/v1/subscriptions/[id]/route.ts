import { apiRoute } from "@/server/api/route";
import { iso, notFound, ymd } from "@/server/api/http";
import { addressDto } from "@/server/api/customer-dto";
import { mealWindows } from "@/server/customer-dashboard";
import { cancelPolicyFor, extraMeals, pendingSwapPayments, POLICY_TEXT, skipPolicyFor, weeksRange } from "@/server/subscriptions";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * One of the caller's meal plans: plan, schedule, address, every meal with its status and change window, pending
 * pay-the-difference swaps, extra meals bought for the plan, policies and recent changes. Another customer's → 404.
 */
export const GET = apiRoute<"user", { id: string }>({ auth: "user" }, async ({ user, params }) => {
  const sub = await db.subscription.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      plan: true,
      address: { include: { zone: true } },
      renewedFrom: { select: { id: true, reference: true } },
      renewals: { select: { id: true, reference: true, status: true }, orderBy: { createdAt: "desc" } },
      orders: { include: { items: { select: { name: true, quantity: true, boxId: true } } }, orderBy: { deliveryDate: "asc" } },
      changes: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!sub) throw notFound("Plan not found");
  const [settings, extras, swaps] = await Promise.all([getSettings(), extraMeals(sub.id), pendingSwapPayments(sub.id)]);
  const windows = await mealWindows(sub.orders, settings);
  const range = weeksRange(sub.plan);
  const skipPolicy = skipPolicyFor(sub.plan, settings);
  const cancelPolicy = cancelPolicyFor(sub.plan);
  return {
    id: sub.id,
    reference: sub.reference,
    status: sub.status,
    plan: { id: sub.plan.id, name: sub.plan.name, slug: sub.plan.slug, weeks: range },
    startDate: ymd(sub.startDate),
    endDate: ymd(sub.endDate),
    days: sub.days,
    boxChoice: sub.boxChoice,
    vegOnly: sub.vegOnly,
    slotId: sub.slotId,
    pausedUntil: ymd(sub.pausedUntil),
    cancelReason: sub.cancelReason,
    money: { mealsTotal: sub.mealsTotal, pricePerMeal: sub.pricePerMeal, subtotal: sub.subtotal, deliveryFee: sub.deliveryFee, discount: sub.discount, tax: sub.tax, total: sub.total, couponCode: sub.couponCode },
    address: sub.address ? addressDto(sub.address) : null,
    policies: { skip: skipPolicy, skipText: POLICY_TEXT.skip[skipPolicy], cancel: cancelPolicy, cancelText: POLICY_TEXT.cancel[cancelPolicy] },
    renewedFrom: sub.renewedFrom,
    renewals: sub.renewals,
    meals: sub.orders.map((o) => {
      const w = windows.get(o.id);
      return {
        id: o.id,
        number: o.number,
        deliveryDate: ymd(o.deliveryDate),
        status: o.status,
        paymentStatus: o.paymentStatus,
        followsRotation: o.followsRotation,
        items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, boxId: i.boxId })),
        window: { open: w?.open ?? false, cutoff: w?.cutoff ?? settings.orderCutoff },
        deliveryOtp: o.status === "OUT_FOR_DELIVERY" ? o.deliveryOtp : null,
      };
    }),
    pendingSwapPayments: swaps,
    extraMeals: extras.map((o) => ({ id: o.id, number: o.number, deliveryDate: ymd(o.deliveryDate), status: o.status, total: o.total, items: o.items })),
    changes: sub.changes.map((c) => ({ id: c.id, type: c.type, date: ymd(c.date), detail: c.detail, amount: c.amount, createdAt: iso(c.createdAt) })),
    createdAt: iso(sub.createdAt),
  };
});
