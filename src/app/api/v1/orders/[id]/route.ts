import { apiRoute } from "@/server/api/route";
import { iso, notFound, ymd } from "@/server/api/http";
import { mealWindows } from "@/server/customer-dashboard";
import { getSettings } from "@/lib/settings";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

type Component = { name: string; qty: number; allergens?: string[]; substitutedFrom?: string };

/**
 * One of the caller's orders (same data as Account → Orders → order): items with what's inside, delivery snapshot,
 * money, payment, refunds, adjustments, feedback, the change window and which customer actions apply now.
 * Another customer's order → 404.
 */
export const GET = apiRoute<"user", { id: string }>({ auth: "user" }, async ({ user, params }) => {
  const order = await db.order.findFirst({
    where: { id: params.id, userId: user.id },
    include: {
      items: { include: { customizations: true } },
      payment: { select: { id: true, method: true, status: true, reference: true, amount: true, purpose: true } },
      feedback: true,
      refunds: { orderBy: { createdAt: "desc" } },
      adjustments: { orderBy: { createdAt: "desc" } },
      subscription: { select: { id: true, reference: true, plan: { select: { name: true } } } },
    },
  });
  if (!order) throw notFound("Order not found");
  const settings = await getSettings();
  const win = (await mealWindows([order], settings)).get(order.id);
  const open = win?.open ?? false;
  const plan = order.source === "SUBSCRIPTION";
  const live = order.status === "SCHEDULED" || order.status === "PENDING_PAYMENT";
  return {
    id: order.id,
    number: order.number,
    code: order.code,
    status: order.status,
    paymentStatus: order.paymentStatus,
    source: order.source,
    deliveryDate: ymd(order.deliveryDate),
    slotLabel: order.slotLabel,
    deliveryOtp: order.status === "OUT_FOR_DELIVERY" ? order.deliveryOtp : null,
    delivery: {
      contactName: order.contactName,
      contactPhone: order.contactPhone,
      addressType: order.addressType,
      placeName: order.placeName,
      addressLine: order.addressLine,
      area: order.area,
      ward: order.ward,
      landmark: order.landmark,
      instructions: order.instructions,
      addressId: order.addressId,
    },
    items: order.items.map((i) => ({
      id: i.id,
      name: i.name,
      details: i.details,
      diet: i.diet,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      boxId: i.boxId,
      customBoxId: i.customBoxId,
      components: (Array.isArray(i.components) ? (i.components as Component[]) : []).map((c) => ({ name: c.name, qty: c.qty, allergens: c.allergens ?? [], substitutedFrom: c.substitutedFrom ?? null })),
      customizations: i.customizations.map((c) => ({ kind: c.kind, label: c.label, priceDelta: c.priceDelta })),
    })),
    money: {
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      discount: order.discount,
      tax: order.tax,
      taxInclusive: order.taxInclusive,
      total: order.total,
      companyShare: order.companyShare,
      customerShare: order.customerShare,
      refundedAmount: order.refundedAmount,
      couponCode: order.couponCode,
    },
    allergenNote: order.allergenNote,
    notes: order.notes,
    payment: order.payment ? { id: order.payment.id, reference: order.payment.reference, method: order.payment.method, status: order.payment.status, amount: order.payment.amount, purpose: order.payment.purpose } : null,
    subscription: order.subscription ? { id: order.subscription.id, reference: order.subscription.reference, planName: order.subscription.plan.name } : null,
    refunds: order.refunds.map((r) => ({ id: r.id, amount: r.amount, method: r.method, status: r.status, reason: r.reason, createdAt: iso(r.createdAt), processedAt: iso(r.processedAt) })),
    adjustments: order.adjustments.map((a) => ({ id: a.id, amount: a.amount, reason: a.reason, createdAt: iso(a.createdAt) })),
    feedback: order.feedback ? { rating: order.feedback.rating, taste: order.feedback.taste, portion: order.feedback.portion, onTime: order.feedback.onTime, comment: order.feedback.comment, publishConsent: order.feedback.publishConsent, createdAt: iso(order.feedback.createdAt) } : null,
    window: { open, cutoff: win?.cutoff ?? settings.orderCutoff },
    /** What the customer may do right now (same rules as the website buttons; the server re-checks on submit). */
    actions: {
      cancel: open && !plan && live,
      skip: open && plan && live,
      unskip: open && plan && order.status === "SKIPPED" && order.paymentStatus !== "REFUNDED",
      swap: open && plan && order.status === "SCHEDULED",
      feedback: settings.flags.feedback && order.status === "DELIVERED",
      pay: order.payment?.status === "PENDING" || order.payment?.status === "FAILED",
    },
    createdAt: iso(order.createdAt),
    deliveredAt: iso(order.deliveredAt),
    cancelledAt: iso(order.cancelledAt),
  };
});
