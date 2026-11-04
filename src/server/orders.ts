import type { DeliveryZone, Diet, OrderSource, OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings, type SiteSettings } from "@/lib/settings";
import { addDays, dateOnly, isoDate, ktmNow, todayKTM, weekdayOf } from "@/lib/dates";
import { randomCode } from "@/lib/utils";
import { rs } from "@/lib/money";
import { log } from "@/lib/logger";
import { activeCompany, type CurrentUser } from "@/lib/auth";
import { changeWindowOpen, dateProblem, getClosures, getLockedDates } from "./calendar";
import { boxComponents, boxFacts, combineDiet, getOffersForDates, type BoxFull } from "./menu";
import { priceDays, type CompanySpec, type TaxSpec } from "./pricing";
import { checkCoupon, redeemCoupon } from "./coupons";
import { assertDayCapacity, CapacityError, lockKitchenDay } from "./capacity";
import { addCredit, spendCredit, walletBalance } from "./ledger";
import { assertTransition, canTransition, EDITABLE_STATUSES, LIVE_STATUSES } from "./transitions";
import { availableMethods, isGatewayMethod } from "./payments/methods";
import { companySpecFor, companyOutstanding } from "./corporate";
import { notify } from "./notify";
import { priceCustomBox, type CustomPick } from "./builder";

type Tx = Prisma.TransactionClient;

// ───────────── identifiers ─────────────

export function orderNumber() {
  return `DB${todayKTM().slice(2).replace(/-/g, "")}${randomCode(4)}`;
}
export function paymentRef() {
  return `PAY-${Date.now().toString(36).toUpperCase()}-${randomCode(5)}`;
}
export function handoffOtp() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 10000;
  return String(n).padStart(4, "0");
}

// ───────────── tax ─────────────

export async function taxRuleFor(date: string, client: Tx | typeof db = db): Promise<TaxSpec> {
  const d = dateOnly(date);
  const rule = await client.taxRule.findFirst({
    where: { isActive: true, effectiveFrom: { lte: d }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: d } }] },
    orderBy: { effectiveFrom: "desc" },
  });
  return rule ? { rateBps: rule.rateBps, inclusive: rule.inclusive } : null;
}

// ───────────── kitchen resolution ─────────────

export async function defaultKitchenId() {
  const k = await db.kitchen.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return k?.id ?? null;
}

// ───────────── cart quote ─────────────

export type CartLine = { kind: "box" | "custom"; id: string; date: string; qty: number; subs?: string[] };

export type QuotedLine = CartLine & {
  name: string;
  details: string | null;
  unitPrice: number;
  unitCost: number;
  diet: Diet;
  allergens: string[];
  components: Prisma.InputJsonValue;
  customizations: { kind: string; label: string; priceDelta: number }[];
  boxId?: string;
  customBoxId?: string;
  capacity: number | null;
  dishes: { id: string; name: string; qty: number; limit: number | null }[];
  problem: string | null;
  warning: string | null;
};

export type CartQuote = Awaited<ReturnType<typeof quoteCart>>;

function sanitizeLines(lines: unknown): CartLine[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((l): l is CartLine => Boolean(l) && (l.kind === "box" || l.kind === "custom") && typeof l.id === "string" && typeof l.date === "string")
    .slice(0, 60)
    .map((l) => ({
      kind: l.kind,
      id: l.id,
      date: l.date,
      qty: Math.max(1, Math.min(25, Math.floor(Number(l.qty) || 1))),
      subs: Array.isArray(l.subs) ? l.subs.filter((s) => typeof s === "string").slice(0, 4) : [],
    }));
}

export async function quoteCart(
  user: CurrentUser | null,
  input: { lines: unknown; addressId?: string | null; zoneId?: string | null; couponCode?: string | null },
) {
  const settings = await getSettings();
  const lines = sanitizeLines(input.lines);
  const address = user && input.addressId ? user.addresses.find((a) => a.id === input.addressId) ?? null : null;
  let zone: (DeliveryZone & { kitchen?: unknown }) | null = null;
  if (address?.zoneId) zone = await db.deliveryZone.findFirst({ where: { id: address.zoneId, isActive: true } });
  else if (!address && input.zoneId) zone = await db.deliveryZone.findFirst({ where: { id: input.zoneId, isActive: true } });
  const kitchenId = zone?.kitchenId ?? (await defaultKitchenId());
  const company = activeCompany(user);

  const base = {
    ok: false,
    error: null as string | null,
    lines: [] as QuotedLine[],
    days: [] as ReturnType<typeof priceDays>["days"],
    subtotal: 0,
    deliveryFee: 0,
    companyDiscount: 0,
    couponDiscount: 0,
    discount: 0,
    tax: 0,
    taxInclusive: true,
    total: 0,
    companyShare: 0,
    customerShare: 0,
    cost: 0,
    couponCode: null as string | null,
    couponId: null as string | null,
    couponError: null as string | null,
    kitchenId,
    zone,
    addressProblem: null as string | null,
    company: company ? { id: company.id, name: company.name, billingMode: company.billingMode } : null,
  };
  if (!lines.length) return { ...base, error: "Your dabba list is empty" };
  if (!kitchenId) return { ...base, error: "No kitchen is open yet" };
  if (address && !address.zoneId) base.addressProblem = `We don't deliver to ${address.area} yet. Pick another address, or ask us to add your area.`;

  const dates = [...new Set(lines.map((l) => l.date))].sort();
  const [offers, closures, locked] = await Promise.all([
    getOffersForDates(dates, kitchenId),
    getClosures(dates[0], dates[dates.length - 1], kitchenId),
    getLockedDates(dates[0], dates[dates.length - 1], kitchenId),
  ]);
  const customIds = lines.filter((l) => l.kind === "custom").map((l) => l.id);
  const customs = user && customIds.length ? await db.customBox.findMany({ where: { id: { in: customIds }, userId: user.id } }) : [];
  const customMap = new Map(customs.map((c) => [c.id, c]));
  const avoid = new Set(user?.allergies ?? []);
  const cutoff = company?.cutoffOverride ?? null;

  const out: QuotedLine[] = [];
  for (const l of lines) {
    const problem = dateProblem(l.date, settings, closures, { cutoff }) ?? (locked.has(l.date) ? "Orders for this day are closed — the kitchen has locked it" : null);
    if (l.kind === "box") {
      const offer = offers.get(l.date);
      const item = offer?.items.find((i) => i.box.id === l.id);
      if (!offer || offer.closed || !item) {
        const any = await db.lunchBox.findUnique({ where: { id: l.id }, select: { name: true } });
        if (!any) continue;
        out.push(emptyLine(l, any.name, offer?.closed ? "Kitchen closed that day" : `${any.name} isn't on the menu that day`));
        continue;
      }
      const box = item.box as BoxFull;
      const subs = box.substitutions.filter((s) => l.subs?.includes(s.id));
      const facts = boxFacts(box);
      const subDiet = combineDiet([facts.diet, ...subs.map((s) => s.toItem.diet)]);
      const allergens = [...new Set([...facts.allergens.map((a) => a.code), ...subs.flatMap((s) => s.toItem.allergens.map((a) => a.allergen.code))])];
      const hit = allergens.filter((a) => avoid.has(a));
      out.push({
        ...l,
        subs: subs.map((s) => s.id),
        name: box.name,
        details: box.tagline,
        unitPrice: item.price + subs.reduce((a, s) => a + s.priceDelta, 0),
        unitCost: facts.cost,
        diet: subDiet,
        allergens,
        components: boxComponents(box, subs) as unknown as Prisma.InputJsonValue,
        customizations: subs.map((s) => ({ kind: "SUBSTITUTE", label: `${s.fromItem.name} → ${s.toItem.name}`, priceDelta: s.priceDelta })),
        boxId: box.id,
        capacity: item.capacity,
        dishes: [],
        problem: problem ?? (item.soldOut ? `${box.name} is sold out that day` : null),
        warning: hit.length ? `Contains ${hit.join(", ").toLowerCase()} — on your avoid list` : null,
      });
    } else {
      const c = customMap.get(l.id);
      if (!c) continue;
      const priced = await priceCustomBox(c.items as unknown as CustomPick[], settings);
      const hit = priced.allergens.filter((a) => avoid.has(a));
      out.push({
        ...l,
        name: c.name,
        details: priced.details,
        unitPrice: priced.price,
        unitCost: priced.cost,
        diet: priced.diet,
        allergens: priced.allergens,
        components: priced.components as unknown as Prisma.InputJsonValue,
        customizations: [],
        customBoxId: c.id,
        capacity: null,
        dishes: priced.dishes,
        problem: problem ?? priced.problem,
        warning: hit.length ? `Contains ${hit.join(", ").toLowerCase()} — on your avoid list` : null,
      });
    }
  }
  if (!out.length) return { ...base, error: "Those dabbas are no longer available" };

  const priceable = out.filter((l) => l.unitPrice > 0);
  const firstDate = dates[0];
  const tax = await taxRuleFor(firstDate);
  const spec: CompanySpec = user && company ? await companySpecFor(user.id, company, dates) : null;

  // Coupon base = subtotal after company discount.
  const pre = priceDays({ lines: priceable, zone: zone && { fee: zone.fee, freeAbove: zone.freeAbove, minOrder: zone.minOrder }, company: spec, tax, globalFreeAbove: settings.freeDeliveryAbove });
  let coupon: { type: "PERCENT" | "FLAT"; value: number; maxDiscount: number | null; minSubtotal: number } | null = null;
  let couponCode: string | null = null;
  let couponId: string | null = null;
  let couponError: string | null = null;
  if (input.couponCode?.trim()) {
    if (!user) couponError = "Log in to use a coupon";
    else {
      const r = await checkCoupon(input.couponCode, { userId: user.id, base: pre.subtotal - pre.companyDiscount, scope: "ORDERS" });
      if (r.ok) {
        coupon = r.coupon;
        couponCode = r.coupon.code;
        couponId = r.coupon.id;
      } else couponError = r.error;
    }
  }
  const priced = coupon ? priceDays({ lines: priceable, zone: zone && { fee: zone.fee, freeAbove: zone.freeAbove, minOrder: zone.minOrder }, company: spec, tax, globalFreeAbove: settings.freeDeliveryAbove, coupon }) : pre;

  const lineProblem = out.find((l) => l.problem);
  let error: string | null = lineProblem ? `${lineProblem.name} (${lineProblem.date}): ${lineProblem.problem}` : null;
  const minOrder = zone?.minOrder || settings.minOrderAmount;
  const smallDay = minOrder ? priced.days.find((d) => d.subtotal < minOrder) : null;
  if (!error && smallDay) error = `Minimum order is ${rs(minOrder)} per delivery day (${smallDay.date})`;

  return {
    ...base,
    ok: !error,
    error,
    lines: out,
    days: priced.days,
    subtotal: priced.subtotal,
    deliveryFee: priced.deliveryFee,
    companyDiscount: priced.companyDiscount,
    couponDiscount: priced.couponDiscount,
    discount: priced.discount,
    tax: priced.tax,
    taxInclusive: tax?.inclusive ?? true,
    total: priced.total,
    companyShare: priced.companyShare,
    customerShare: priced.customerShare,
    cost: priced.cost,
    couponCode,
    couponId,
    couponError,
  };
}

function emptyLine(l: CartLine, name: string, problem: string): QuotedLine {
  return { ...l, name, details: null, unitPrice: 0, unitCost: 0, diet: "VEG", allergens: [], components: [], customizations: [], capacity: null, dishes: [], problem, warning: null };
}

// ───────────── placing orders ─────────────

export class OrderError extends Error {}

function addressSnapshot(a: CurrentUser["addresses"][number]) {
  return {
    addressId: a.id,
    contactName: a.recipientName,
    contactPhone: a.phone,
    addressType: a.type,
    placeName: a.placeName,
    addressLine: a.line1,
    area: a.area,
    ward: a.ward,
    landmark: a.landmark,
    lat: a.lat,
    lng: a.lng,
    instructions: a.instructions,
    zoneId: a.zoneId,
  };
}

/** Initial fulfilment + payment state for a new order. */
export function initialState(method: PaymentMethod, customerShare: number, companyShare: number) {
  if (customerShare <= 0) return { status: "SCHEDULED" as OrderStatus, payment: "PAID" as const, orderPayment: companyShare > 0 ? ("INVOICED" as const) : ("PAID" as const) };
  if (method === "WALLET") return { status: "SCHEDULED" as OrderStatus, payment: "PAID" as const, orderPayment: "PAID" as const };
  if (method === "CASH") return { status: "SCHEDULED" as OrderStatus, payment: "PENDING" as const, orderPayment: "UNPAID" as const };
  return { status: "PENDING_PAYMENT" as OrderStatus, payment: "PENDING" as const, orderPayment: "PENDING" as const };
}

export async function placeCartOrder(
  user: CurrentUser,
  input: {
    lines: unknown;
    addressId: string;
    slotId?: string | null;
    couponCode?: string | null;
    method: PaymentMethod;
    notes?: string | null;
    idempotencyKey?: string | null;
    source?: OrderSource;
    placedById?: string | null;
  },
) {
  if (input.idempotencyKey) {
    const existing = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { orders: true } });
    if (existing) {
      if (existing.userId !== user.id) throw new OrderError("Please refresh the page and try again");
      return { payment: existing, orders: existing.orders, replayed: true };
    }
  }
  const settings = await getSettings();
  if (settings.maintenanceMode) throw new OrderError(settings.maintenanceMessage);
  const address = user.addresses.find((a) => a.id === input.addressId);
  if (!address) throw new OrderError("Choose a delivery address");
  if (!address.zoneId || !address.zone?.isActive) throw new OrderError(`We don't deliver to ${address.area} yet. Choose another address or ask us to add your area.`);

  const q = await quoteCart(user, { lines: input.lines, addressId: address.id, couponCode: input.couponCode });
  if (!q.ok) throw new OrderError(q.error ?? "We couldn't price your order");
  if (input.couponCode && q.couponError) throw new OrderError(q.couponError);
  const kitchenId = q.kitchenId!;

  const slot = input.slotId ? await db.deliverySlot.findFirst({ where: { id: input.slotId, kitchenId, isActive: true } }) : null;
  if (input.slotId && !slot) throw new OrderError("That delivery window isn't available for your area");

  const company = activeCompany(user);
  const methods = await availableMethods(settings, { hasCompany: Boolean(company), customerShare: q.customerShare });
  const method: PaymentMethod = q.customerShare <= 0 ? "COMPANY_INVOICE" : input.method;
  if (q.customerShare > 0 && !methods.includes(method)) throw new OrderError("That payment method isn't available right now");
  if (method === "WALLET" && (await walletBalance(user.id)) < q.customerShare) throw new OrderError("Not enough credit — choose another payment method");
  if (company && q.companyShare > 0 && company.creditLimit != null) {
    const outstanding = await companyOutstanding(company.id);
    if (outstanding + q.companyShare > company.creditLimit) throw new OrderError(`${company.name}'s lunch account has reached its credit limit. Ask your admin, or pay yourself.`);
  }

  const state = initialState(method, q.customerShare, q.companyShare);
  const source: OrderSource = input.source ?? (company ? "CORPORATE" : "SINGLE");

  try {
    const result = await db.$transaction(
      async (tx) => {
        for (const day of q.days) {
          const ls = q.lines.filter((l) => l.date === day.date);
          await lockKitchenDay(tx, kitchenId, day.date);
          const boxes = new Map<string, { qty: number; capacity: number | null; name: string }>();
          const dishes = new Map<string, { qty: number; limit: number | null; name: string }>();
          for (const l of ls) {
            if (l.boxId) boxes.set(l.boxId, { qty: (boxes.get(l.boxId)?.qty ?? 0) + l.qty, capacity: l.capacity, name: l.name });
            for (const d of l.dishes) dishes.set(d.id, { qty: (dishes.get(d.id)?.qty ?? 0) + d.qty * l.qty, limit: d.limit, name: d.name });
          }
          await assertDayCapacity(tx, { kitchenId, date: day.date, meals: day.meals, slotId: slot?.id, boxes, dishes });
        }
        const payment = await tx.payment.create({
          data: {
            reference: paymentRef(),
            userId: user.id,
            method,
            status: state.payment,
            amount: q.customerShare,
            companyId: company?.id ?? null,
            idempotencyKey: input.idempotencyKey || null,
            paidAt: state.payment === "PAID" ? new Date() : null,
          },
        });
        if (q.couponId) await redeemCoupon(tx, { couponId: q.couponId, userId: user.id, amount: q.couponDiscount, paymentId: payment.id });
        if (method === "WALLET") await spendCredit(tx, { userId: user.id, amount: q.customerShare, paymentId: payment.id, note: `Order payment ${payment.reference}` });

        const orders = [];
        for (const day of q.days) {
          const ls = q.lines.filter((l) => l.date === day.date);
          const order = await tx.order.create({
            data: {
              number: orderNumber(),
              code: randomCode(4),
              userId: user.id,
              placedById: input.placedById ?? null,
              source,
              status: state.status,
              paymentStatus: state.orderPayment,
              deliveryDate: dateOnly(day.date),
              kitchenId,
              slotId: slot?.id ?? null,
              slotLabel: slot?.label ?? null,
              ...addressSnapshot(address),
              companyId: company?.id ?? null,
              officeLocationId: user.membership?.officeLocationId ?? null,
              subtotal: day.subtotal,
              deliveryFee: day.deliveryFee,
              discount: day.discount,
              tax: day.tax,
              taxInclusive: q.taxInclusive,
              total: day.total,
              companyShare: day.companyShare,
              customerShare: day.customerShare,
              costTotal: day.cost,
              couponCode: q.couponCode,
              allergenNote: user.allergies.length ? `Avoid: ${user.allergies.join(", ")}` : null,
              notes: input.notes?.slice(0, 500) || null,
              deliveryOtp: handoffOtp(),
              paymentId: payment.id,
              items: {
                create: ls.map((l) => ({
                  boxId: l.boxId ?? null,
                  customBoxId: l.customBoxId ?? null,
                  name: l.name,
                  details: l.details,
                  components: l.components,
                  diet: l.diet,
                  quantity: l.qty,
                  unitPrice: l.unitPrice,
                  unitCost: l.unitCost,
                  lineTotal: l.unitPrice * l.qty,
                  customizations: { create: l.customizations },
                })),
              },
              events: { create: { toStatus: state.status, note: "Order placed", actorId: input.placedById ?? user.id } },
            },
          });
          orders.push(order);
        }
        return { payment, orders };
      },
      { timeout: 20_000 },
    );
    void notify(
      "order.placed",
      { userId: user.id },
      { name: user.name, number: result.orders.map((o) => o.number).join(", "), summary: `${q.lines.length} dabba(s) for ${q.days.map((d) => d.date).join(", ")} — ${rs(q.total)}` },
      { link: `/account/orders`, dedupeKey: `order.placed:${result.payment.id}` },
    );
    return { ...result, quote: q, replayed: false, needsPayment: state.status === "PENDING_PAYMENT" };
  } catch (e) {
    if (e instanceof CapacityError) throw new OrderError(e.message);
    if (e instanceof Error && e.message.includes("idempotencyKey")) {
      const existing = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey! }, include: { orders: true } });
      if (existing) return { payment: existing, orders: existing.orders, replayed: true };
    }
    throw e;
  }
}

// ───────────── status changes ─────────────

export type StatusResult = { changed: string[]; rejected: { id: string; reason: string }[] };

/**
 * Move orders through the state machine. Each order is updated only if it is still in the state we
 * read (optimistic check), so two staff members can't double-apply a change.
 */
export async function setOrderStatus(ids: string[], to: OrderStatus, actorId: string | null, note?: string | null): Promise<StatusResult> {
  const res: StatusResult = { changed: [], rejected: [] };
  if (!ids.length) return res;
  const orders = await db.order.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, userId: true, number: true, deliveryOtp: true } });
  for (const o of orders) {
    if (o.status === to) continue;
    if (!canTransition(o.status, to)) {
      res.rejected.push({ id: o.id, reason: `${o.number}: can't go from ${o.status} to ${to}` });
      continue;
    }
    const now = new Date();
    const updated = await db.$transaction(async (tx) => {
      const u = await tx.order.updateMany({
        where: { id: o.id, status: o.status },
        data: {
          status: to,
          version: { increment: 1 },
          deliveredAt: to === "DELIVERED" ? now : undefined,
          cancelledAt: to === "CANCELLED" ? now : undefined,
          lockedAt: to === "CONFIRMED" ? now : undefined,
        },
      });
      if (!u.count) return false;
      await tx.orderStatusEvent.create({ data: { orderId: o.id, fromStatus: o.status, toStatus: to, note: note ?? null, actorId } });
      return true;
    });
    if (!updated) {
      res.rejected.push({ id: o.id, reason: `${o.number} changed while you were editing — reload` });
      continue;
    }
    res.changed.push(o.id);
    if (to === "OUT_FOR_DELIVERY") void notify("order.out_for_delivery", { userId: o.userId }, { number: o.number, otp: o.deliveryOtp ?? "" }, { dedupeKey: `ofd:${o.id}` });
    if (to === "DELIVERED") void notify("order.delivered", { userId: o.userId }, { number: o.number }, { link: `/account/orders/${o.id}`, dedupeKey: `del:${o.id}` });
    if (to === "FAILED_DELIVERY") void notify("order.failed_delivery", { userId: o.userId }, { number: o.number, reason: note || "We couldn't reach you" }, { dedupeKey: `fail:${o.id}:${Date.now()}` });
  }
  return res;
}

// ───────────── cancellation & money back ─────────────

export type Settlement = "CREDIT" | "REFUND" | "NONE";

/**
 * Cancel an order. Customers may cancel editable orders before the cut-off; staff may cancel any
 * non-final order with a reason. Paid money goes back as wallet credit or a refund request —
 * the order's own totals are never rewritten (refundedAmount records what went back).
 */
export async function cancelOrder(
  orderId: string,
  actor: { id: string | null; isStaff: boolean },
  opts: { reason: string; settlement?: Settlement; userId?: string },
) {
  const settings = await getSettings();
  const order = await db.order.findUnique({ where: { id: orderId }, include: { payment: true } });
  if (!order || (opts.userId && order.userId !== opts.userId)) throw new OrderError("Order not found");
  if (!actor.isStaff) {
    if (!EDITABLE_STATUSES.includes(order.status)) throw new OrderError("This order is already being prepared");
    if (!(await changeWindowOpen(isoDate(order.deliveryDate), order.kitchenId, settings))) throw new OrderError(`Changes for that day closed at ${settings.orderCutoff}`);
  }
  assertTransition(order.status, "CANCELLED");
  if (actor.isStaff && !opts.reason.trim()) throw new OrderError("Give a reason");

  const paid = order.payment?.status === "PAID" || order.payment?.status === "PARTIALLY_REFUNDED";
  const refundable = paid && order.paymentStatus === "PAID" ? order.customerShare - order.refundedAmount : 0;
  const settlement: Settlement =
    refundable <= 0 ? "NONE" : actor.isStaff ? (opts.settlement ?? "CREDIT") : settings.cancelBeforeCutoff === "FULL_REFUND" ? "REFUND" : "CREDIT";

  await db.$transaction(async (tx) => {
    const u = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: "CANCELLED", cancelledAt: new Date(), version: { increment: 1 }, refundedAmount: settlement === "CREDIT" ? { increment: refundable } : undefined, paymentStatus: settlement === "CREDIT" ? "REFUNDED" : undefined },
    });
    if (!u.count) throw new OrderError("The order changed — reload and try again");
    await tx.orderStatusEvent.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: "CANCELLED", note: opts.reason, actorId: actor.id } });
    if (settlement === "CREDIT" && order.paymentId) {
      await addCredit(tx, { userId: order.userId, amount: refundable, reason: "CANCEL_CREDIT", orderId: order.id, paymentId: order.paymentId, actorId: actor.id, note: opts.reason });
      await bumpPaymentRefund(tx, order.paymentId, refundable);
    }
    if (settlement === "REFUND" && order.paymentId) {
      await tx.refund.create({ data: { paymentId: order.paymentId, orderId: order.id, amount: refundable, reason: opts.reason, method: "ORIGINAL", requestedById: actor.id } });
    }
    // Unpaid payment: shrink what's owed, cancel it when nothing is left.
    if (order.payment && order.payment.status === "PENDING") {
      const left = await tx.order.count({ where: { paymentId: order.paymentId, status: { notIn: ["CANCELLED", "SKIPPED"] } } });
      await tx.payment.update({
        where: { id: order.payment.id },
        data: left ? { amount: { decrement: Math.min(order.customerShare, order.payment.amount) } } : { status: "CANCELLED" },
      });
    }
  });
  void notify("order.cancelled", { userId: order.userId }, { number: order.number, reason: settlement === "CREDIT" ? `${rs(refundable)} added to your credit.` : settlement === "REFUND" ? `A refund of ${rs(refundable)} is being processed.` : opts.reason }, { dedupeKey: `cancel:${order.id}` });
  return { settlement, amount: refundable };
}

export async function bumpPaymentRefund(tx: Tx, paymentId: string, amount: number) {
  const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const refunded = p.refundedAmount + amount;
  await tx.payment.update({
    where: { id: paymentId },
    data: { refundedAmount: refunded, status: refunded >= p.amount ? "REFUNDED" : "PARTIALLY_REFUNDED", version: { increment: 1 } },
  });
}

/** Staff money adjustment on an order (compensating record, never a silent edit). */
export async function adjustOrder(orderId: string, actorId: string, amount: number, reason: string) {
  if (!reason.trim()) throw new OrderError("Give a reason");
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  return db.$transaction(async (tx) => {
    const adj = await tx.orderAdjustment.create({ data: { orderId, amount, reason, actorId } });
    if (amount < 0) await addCredit(tx, { userId: order.userId, amount: -amount, reason: "ADJUSTMENT", orderId, actorId, note: reason });
    return adj;
  });
}

// ───────────── daily lock ─────────────

/** After the cut-off: SCHEDULED → CONFIRMED for a kitchen-day and record the lock. Idempotent. */
export async function lockDay(kitchenId: string, date: string, actorId: string | null) {
  const existing = await db.dayLock.findUnique({ where: { kitchenId_date: { kitchenId, date: dateOnly(date) } } });
  const orders = await db.order.findMany({ where: { kitchenId, deliveryDate: dateOnly(date), status: "SCHEDULED" }, select: { id: true } });
  const r = await setOrderStatus(orders.map((o) => o.id), "CONFIRMED", actorId, "Day locked after cut-off");
  if (!existing) {
    const count = await db.order.count({ where: { kitchenId, deliveryDate: dateOnly(date), status: { in: ["CONFIRMED", "PREPARING", "PACKED"] } } });
    await db.dayLock.upsert({ where: { kitchenId_date: { kitchenId, date: dateOnly(date) } }, create: { kitchenId, date: dateOnly(date), lockedById: actorId, orderCount: count }, update: {} });
  }
  return { confirmed: r.changed.length, alreadyLocked: Boolean(existing) };
}

/** Unpaid online orders whose delivery window has closed get cancelled (cron). */
export async function expireUnpaidOrders(now = ktmNow()) {
  const settings = await getSettings();
  const stale = await db.order.findMany({
    where: {
      status: "PENDING_PAYMENT",
      OR: [{ deliveryDate: { lt: dateOnly(now.date) } }, ...(now.time >= settings.orderCutoff ? [{ deliveryDate: dateOnly(now.date) }] : [])],
    },
    select: { id: true },
  });
  let n = 0;
  for (const o of stale) {
    try {
      await cancelOrder(o.id, { id: null, isStaff: true }, { reason: "Payment not received before the cut-off", settlement: "NONE" });
      n++;
    } catch (e) {
      log.warn("expire.cancel_failed", { orderId: o.id, error: e });
    }
  }
  return n;
}

export { LIVE_STATUSES, weekdayOf, addDays };
export type { SiteSettings };
