import type { OrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate, ktmNow, monthRange, todayKTM, weekdayOf, WEEKDAYS } from "@/lib/dates";
import { getOffersForDates } from "@/server/menu";
import { earliestCutoff } from "@/server/subscriptions";
import { walletBalance } from "@/server/ledger";

/**
 * Customer dashboard reads (WP-18). Every function takes the customer's own `userId` (from the session) and only
 * ever reads rows owned by that user. Status comes from the order record — there is no rider GPS tracking.
 */

// ───────── change window (per-day cut-off) ─────────

export type MealWindow = { open: boolean; cutoff: string };
type WindowOrder = { id: string; kitchenId: string; deliveryDate: Date; companyId?: string | null };

/** Pure: is a "YYYY-MM-DD" day still changeable at `now` given its cut-off ("HH:MM")? */
export function windowOpen(date: string, cutoff: string, now: { date: string; time: string } = ktmNow()) {
  if (date < now.date) return false;
  return date > now.date || now.time < cutoff;
}

/**
 * Change window per order: the menu day's own cut-off (`DayOffer.cutoff`) and the order's company override, whichever
 * is earlier (`earliestCutoff`), else the global `orderCutoff`; a locked kitchen day is always closed. Same rule the
 * server applies in `skipMeal` / `unskipMeal` / `swapMeal`.
 */
export async function mealWindows(orders: WindowOrder[], settings: { orderCutoff: string }): Promise<Map<string, MealWindow>> {
  const now = ktmNow();
  const out = new Map<string, MealWindow>();
  const live = orders.filter((o) => isoDate(o.deliveryDate) >= now.date);
  for (const o of orders) if (!live.includes(o)) out.set(o.id, { open: false, cutoff: settings.orderCutoff });
  if (!live.length) return out;

  const keys = [...new Set(live.map((o) => `${o.kitchenId}|${isoDate(o.deliveryDate)}`))];
  const locks = await db.dayLock.findMany({ where: { OR: keys.map((k) => ({ kitchenId: k.split("|")[0], date: dateOnly(k.split("|")[1]) })) }, select: { kitchenId: true, date: true } });
  const locked = new Set(locks.map((l) => `${l.kitchenId}|${isoDate(l.date)}`));

  const offers = new Map<string, Awaited<ReturnType<typeof getOffersForDates>>>();
  for (const k of new Set(live.map((o) => o.kitchenId))) {
    offers.set(k, await getOffersForDates([...new Set(live.filter((o) => o.kitchenId === k).map((o) => isoDate(o.deliveryDate)))], k));
  }
  const companyIds = [...new Set(live.map((o) => o.companyId).filter((c): c is string => Boolean(c)))];
  const companies = companyIds.length ? await db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, cutoffOverride: true } }) : [];
  const companyCutoff = new Map(companies.map((c) => [c.id, c.cutoffOverride]));

  for (const o of live) {
    const d = isoDate(o.deliveryDate);
    const cutoff = earliestCutoff(offers.get(o.kitchenId)?.get(d)?.cutoff, o.companyId ? companyCutoff.get(o.companyId) : null) ?? settings.orderCutoff;
    out.set(o.id, { cutoff, open: windowOpen(d, cutoff, now) && !locked.has(`${o.kitchenId}|${d}`) });
  }
  return out;
}

/**
 * Pure: does this order have a customer action (skip / bring back / cancel) at all? Mirrors `MealActions`:
 * plan meals can be skipped while scheduled and un-skipped unless the skip was credited; single orders can be cancelled.
 */
export function hasCustomerAction(o: { status: OrderStatus; source: string; paymentStatus: string }) {
  if (o.status === "SCHEDULED" || o.status === "PENDING_PAYMENT") return true;
  return o.source === "SUBSCRIPTION" && o.status === "SKIPPED" && o.paymentStatus !== "REFUNDED";
}

// ───────── today / upcoming ─────────

/** The steps a lunch moves through, as recorded by the kitchen and the rider. */
export const STATUS_STEPS: OrderStatus[] = ["SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED"];

/** Pure: position of a status on the step line (-1 when the order left the line: cancelled, skipped, failed). */
export function statusStep(status: OrderStatus) {
  if (status === "PENDING_PAYMENT") return 0;
  return STATUS_STEPS.indexOf(status);
}

const orderInclude = {
  items: { select: { name: true, quantity: true } },
  subscription: { select: { id: true, plan: { select: { name: true } } } },
} as const;

/** Today's lunches (any status except cancelled), with their recorded status events. */
export async function todayLunches(userId: string) {
  return db.order.findMany({
    where: { userId, deliveryDate: dateOnly(todayKTM()), status: { not: "CANCELLED" } },
    include: { ...orderInclude, events: { orderBy: { createdAt: "asc" }, select: { toStatus: true, createdAt: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * The customer's booked lunches from `from` (default tomorrow) for `days` days — single orders and plan meals alike.
 * Cancelled orders are left out; skipped plan meals stay (they can be brought back before the cut-off).
 */
export async function upcomingLunches(userId: string, opts: { from?: string; days?: number } = {}) {
  const from = opts.from ?? addDays(todayKTM(), 1);
  const days = Math.max(1, Math.min(31, opts.days ?? 14));
  return db.order.findMany({
    where: { userId, deliveryDate: { gte: dateOnly(from), lte: dateOnly(addDays(from, days - 1)) }, status: { not: "CANCELLED" } },
    include: orderInclude,
    orderBy: [{ deliveryDate: "asc" }, { createdAt: "asc" }],
  });
}

/** Delivered lunches from the last two weeks the customer hasn't rated yet. */
export async function awaitingFeedback(userId: string, take = 3) {
  return db.order.findMany({
    where: { userId, status: "DELIVERED", feedback: { is: null }, deliveryDate: { gte: dateOnly(addDays(todayKTM(), -14)) } },
    select: { id: true, number: true, deliveryDate: true, items: { select: { name: true }, take: 1 } },
    orderBy: { deliveryDate: "desc" },
    take,
  });
}

// ───────── plans ─────────

/**
 * Live plans plus plans that ended in the last 7 days, each with `renewDue` = the plan is within its reminder window
 * (`MealPlan.renewalReminderDays`) or just ended, nothing already renews it, and the plan is still on sale.
 */
export async function dashboardPlans(userId: string) {
  const today = todayKTM();
  const subs = await db.subscription.findMany({
    where: {
      userId,
      OR: [{ status: { in: ["ACTIVE", "PAUSED", "PENDING_PAYMENT"] } }, { status: "COMPLETED", endDate: { gte: dateOnly(addDays(today, -7)) } }],
    },
    include: {
      plan: { select: { name: true, isActive: true, renewalReminderDays: true } },
      renewals: { where: { status: { not: "CANCELLED" } }, select: { id: true } },
      _count: { select: { orders: { where: { status: "DELIVERED" } } } },
    },
    orderBy: { startDate: "asc" },
  });
  return subs.map((s) => {
    const end = isoDate(s.endDate);
    const window = Math.max(1, s.plan.renewalReminderDays);
    const renewDue = s.status !== "PENDING_PAYMENT" && s.plan.isActive && s.renewals.length === 0 && end <= addDays(today, window);
    return { id: s.id, name: s.plan.name, status: s.status, mealsTotal: s.mealsTotal, delivered: s._count.orders, endDate: end, renewDue };
  });
}

// ───────── calendar ─────────

export type CalendarCell = { date: string; inMonth: boolean; isToday: boolean };

/** Pure: Sunday-first weeks covering a month ("YYYY-MM"). */
export function calendarGrid(ym?: string, today: string = todayKTM()) {
  const m = monthRange(ym);
  let start = m.start;
  while (weekdayOf(start) !== WEEKDAYS[0]) start = addDays(start, -1);
  let end = m.end;
  while (weekdayOf(end) !== WEEKDAYS[6]) end = addDays(end, 1);
  const weeks: CalendarCell[][] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => {
      const date = addDays(d, i);
      return { date, inMonth: date.slice(0, 7) === m.ym, isToday: date === today };
    }));
  }
  const prev = monthRange(addDays(m.start, -1).slice(0, 7)).ym;
  return { ym: m.ym, start, end, weeks, prev, next: m.next.slice(0, 7) };
}

/** The customer's lunches laid out on a month grid (cancelled orders left out). */
export async function mealCalendar(userId: string, ym?: string) {
  const grid = calendarGrid(ym);
  const orders = await db.order.findMany({
    where: { userId, deliveryDate: { gte: dateOnly(grid.start), lte: dateOnly(grid.end) }, status: { not: "CANCELLED" } },
    select: { id: true, number: true, deliveryDate: true, status: true, source: true, items: { select: { name: true, quantity: true } } },
    orderBy: [{ deliveryDate: "asc" }, { createdAt: "asc" }],
  });
  const byDate = new Map<string, typeof orders>();
  for (const o of orders) {
    const d = isoDate(o.deliveryDate);
    byDate.set(d, [...(byDate.get(d) ?? []), o]);
  }
  return { ...grid, byDate, count: orders.length };
}

// ───────── payment history ─────────

const PAID_STATUSES = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

/**
 * Payments, refunds and wallet movements of one customer, newest first, with totals computed over all of their rows
 * (not just the page shown): paid = payments that went through (any method, incl. credit), refunded = money returned
 * on those payments, pending = payments still waiting.
 */
export async function paymentHistory(userId: string, opts: { take?: number } = {}) {
  const take = Math.max(1, Math.min(200, opts.take ?? 50));
  const [payments, refunds, wallet, paidAgg, pendingAgg, walletIn, walletOut, balance] = await Promise.all([
    db.payment.findMany({
      where: { userId },
      select: {
        id: true,
        reference: true,
        method: true,
        status: true,
        amount: true,
        refundedAmount: true,
        paidAt: true,
        createdAt: true,
        subscription: { select: { id: true, plan: { select: { name: true } } } },
        orders: { select: { id: true, number: true }, orderBy: { deliveryDate: "asc" }, take: 1 },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
    }),
    db.refund.findMany({
      where: { payment: { userId } },
      select: { id: true, amount: true, reason: true, method: true, status: true, createdAt: true, processedAt: true, payment: { select: { reference: true } }, order: { select: { id: true, number: true } } },
      orderBy: { createdAt: "desc" },
      take,
    }),
    db.creditLedger.findMany({ where: { userId }, select: { id: true, amount: true, reason: true, note: true, createdAt: true, orderId: true }, orderBy: { createdAt: "desc" }, take }),
    db.payment.aggregate({ where: { userId, status: { in: [...PAID_STATUSES] } }, _sum: { amount: true, refundedAmount: true }, _count: true }),
    db.payment.aggregate({ where: { userId, status: "PENDING" }, _sum: { amount: true }, _count: true }),
    db.creditLedger.aggregate({ where: { userId, amount: { gt: 0 } }, _sum: { amount: true } }),
    db.creditLedger.aggregate({ where: { userId, amount: { lt: 0 } }, _sum: { amount: true } }),
    walletBalance(userId),
  ]);
  return {
    payments,
    refunds,
    wallet,
    totals: {
      paid: paidAgg._sum.amount ?? 0,
      paidCount: paidAgg._count,
      refunded: paidAgg._sum.refundedAmount ?? 0,
      pending: pendingAgg._sum.amount ?? 0,
      pendingCount: pendingAgg._count,
      walletIn: walletIn._sum.amount ?? 0,
      walletOut: -(walletOut._sum.amount ?? 0),
      walletBalance: balance,
    },
  };
}

// ───────── address map pin ─────────

export class PinError extends Error {}

/** Nepal's bounding box, a little generous (same range the address form accepts). */
export const PIN_BOUNDS = { lat: [26, 31], lng: [80, 89] } as const;

/**
 * Pure: parse an optional map pin. Both empty → null (no pin). Otherwise both must be numbers inside Nepal's range;
 * rounded to 6 decimals (~10 cm). Throws `PinError` with a customer-facing message.
 */
export function parsePin(latRaw: unknown, lngRaw: unknown): { lat: number; lng: number } | null {
  const s = (v: unknown) => (v == null ? "" : String(v).trim());
  const la = s(latRaw);
  const ln = s(lngRaw);
  if (!la && !ln) return null;
  if (!la || !ln) throw new PinError("Enter both latitude and longitude, or leave both empty");
  const num = /^-?\d{1,3}(\.\d+)?$/;
  if (!num.test(la) || !num.test(ln)) throw new PinError("Latitude and longitude must be numbers, e.g. 27.7172 and 85.3240");
  const lat = Number(la);
  const lng = Number(ln);
  if (lat < PIN_BOUNDS.lat[0] || lat > PIN_BOUNDS.lat[1] || lng < PIN_BOUNDS.lng[0] || lng > PIN_BOUNDS.lng[1]) {
    throw new PinError("That pin is outside Nepal — check the numbers (latitude 26–31, longitude 80–89)");
  }
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

/** Set (or clear with null) the map pin on one of the customer's own, non-archived addresses. */
export async function saveAddressPin(userId: string, addressId: string, pin: { lat: number; lng: number } | null) {
  if (pin) parsePin(pin.lat, pin.lng); // re-validate typed callers too
  const r = await db.address.updateMany({ where: { id: addressId, userId, archivedAt: null }, data: { lat: pin?.lat ?? null, lng: pin?.lng ?? null } });
  if (!r.count) throw new PinError("Address not found");
  return pin;
}
