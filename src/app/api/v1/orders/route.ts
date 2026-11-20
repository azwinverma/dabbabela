import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { created, ok, paginate, readJson, readPage, readQuery, ymd } from "@/server/api/http";
import { cartLine, nextStep, orderSummaryDto, paymentBriefDto, PAYMENT_METHODS } from "@/server/api/customer-dto";
import { placeCartOrder } from "@/server/orders";
import { assertCustomerCanOrder } from "@/server/crm";
import { db } from "@/lib/db";
import { dateOnly, todayKTM } from "@/lib/dates";

export const dynamic = "force-dynamic";

const listQuery = z.object({ scope: z.enum(["upcoming", "past", "all"]).default("all"), limit: z.string().optional(), cursor: z.string().optional() });

/**
 * The caller's orders. `scope=upcoming` (delivery today or later, soonest first), `past` (before today, newest first)
 * or `all` (newest delivery first). Cursor pagination: pass `meta.nextCursor` back as `cursor`.
 */
export const GET = apiRoute({ auth: "user" }, async ({ req, user }) => {
  const { scope } = readQuery(req, listQuery);
  const today = dateOnly(todayKTM());
  const where = { userId: user.id, ...(scope === "upcoming" ? { deliveryDate: { gte: today } } : scope === "past" ? { deliveryDate: { lt: today } } : {}) };
  const dir = scope === "upcoming" ? ("asc" as const) : ("desc" as const);
  const page = await paginate(readPage(req), (args) =>
    db.order.findMany({
      where,
      include: { items: { select: { name: true, quantity: true } }, payment: { select: { id: true, method: true, status: true } } },
      orderBy: [{ deliveryDate: dir }, { id: dir }],
      ...args,
    }),
  );
  return ok(page.items.map(orderSummaryDto), { meta: { nextCursor: page.nextCursor } });
});

const placeSchema = z.object({
  lines: z.array(cartLine).min(1).max(60),
  addressId: z.string().min(1, "Choose a delivery address").max(64),
  slotId: z.string().max(64).nullable().optional(),
  couponCode: z.string().max(30).nullable().optional(),
  method: z.enum(PAYMENT_METHODS),
  notes: z.string().max(500).nullable().optional(),
});

/**
 * Place a cart order (money-moving: `Idempotency-Key` required). Same service as the website checkout — prices are
 * re-quoted on the server. `next: "PAY"` → open the payment (POST /payments/{id}/start or bank proof);
 * `next: "DONE"` → confirmed (cash on delivery, wallet, company invoice, or nothing to pay).
 */
export const POST = apiRoute({ auth: "user", idempotent: "orders", limit: "checkout" }, async ({ req, user, idempotencyKey }) => {
  const b = await readJson(req, placeSchema);
  await assertCustomerCanOrder(user.id);
  const res = await placeCartOrder(user, { ...b, slotId: b.slotId || null, couponCode: b.couponCode || null, notes: b.notes ?? null, idempotencyKey });
  const pay = res.payment;
  const needsPayment = "needsPayment" in res && typeof res.needsPayment === "boolean" ? res.needsPayment : pay.status === "PENDING" && pay.method !== "CASH";
  return created({
    payment: paymentBriefDto(pay),
    orders: res.orders.map((o) => ({ id: o.id, number: o.number, status: o.status, deliveryDate: ymd(o.deliveryDate), total: o.total, customerShare: o.customerShare })),
    needsPayment,
    next: nextStep(needsPayment),
  });
});
