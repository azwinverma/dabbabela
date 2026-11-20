import { apiRoute } from "@/server/api/route";
import { iso, notFound } from "@/server/api/http";
import { STATUS_STEPS, statusStep } from "@/server/customer-dashboard";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const DELIVERY_TYPES = ["PICKED_UP", "DELIVERED", "FAILED", "RETRY"];

/**
 * Status history of one of the caller's orders: status changes (with the note the website shows) and delivery
 * milestones (picked up / delivered / failed with reason / retried). No staff ids, photos or internal notes.
 */
export const GET = apiRoute<"user", { id: string }>({ auth: "user" }, async ({ user, params }) => {
  const order = await db.order.findFirst({
    where: { id: params.id, userId: user.id },
    select: {
      id: true,
      status: true,
      events: { orderBy: { createdAt: "asc" }, select: { id: true, fromStatus: true, toStatus: true, note: true, createdAt: true } },
      deliveryEvents: { where: { type: { in: DELIVERY_TYPES } }, orderBy: { createdAt: "asc" }, select: { id: true, type: true, note: true, createdAt: true } },
    },
  });
  if (!order) throw notFound("Order not found");
  const items = [
    ...order.events.map((e) => ({ id: e.id, kind: "STATUS" as const, at: iso(e.createdAt), fromStatus: e.fromStatus, toStatus: e.toStatus, type: null, note: e.note })),
    ...order.deliveryEvents.map((e) => ({ id: e.id, kind: "DELIVERY" as const, at: iso(e.createdAt), fromStatus: null, toStatus: null, type: e.type, note: e.type === "FAILED" || e.type === "RETRY" ? e.note : null })),
  ].sort((a, b) => (a.at! < b.at! ? -1 : a.at! > b.at! ? 1 : 0));
  return { orderId: order.id, status: order.status, steps: STATUS_STEPS, currentStep: statusStep(order.status), events: items };
});
