import { Prisma, type Diet, type OrderPaymentStatus, type OrderStatus, type PaymentMethod } from "@prisma/client";
import { addDays, isValidISODate, todayKTM } from "@/lib/dates";

/**
 * Global analytics filters (WP-02). One parser, one Prisma builder and one SQL builder, so every metric,
 * breakdown, drill-down list and CSV export applies exactly the same conditions.
 *
 * Kitchen scope: `kitchenIds` is ALWAYS the intersection of what was asked for and the staff member's scope
 * (User.kitchenId ∪ StaffScope). null = all kitchens (unscoped user, nothing picked).
 */

export const ORDER_STATUSES = ["PENDING_PAYMENT", "SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY", "CANCELLED", "SKIPPED"] as const satisfies readonly OrderStatus[];
export const ORDER_PAYMENT_STATUSES = ["UNPAID", "PENDING", "PAID", "INVOICED", "PARTIALLY_REFUNDED", "REFUNDED"] as const satisfies readonly OrderPaymentStatus[];
export const DIETS = ["VEGAN", "VEG", "EGG", "CHICKEN", "MUTTON", "BUFF", "PORK", "FISH"] as const satisfies readonly Diet[];
export const METHODS = ["ESEWA", "KHALTI", "BANK_TRANSFER", "CASH", "COMPANY_INVOICE", "WALLET"] as const satisfies readonly PaymentMethod[];

/** Sentinel for "no value" drill-downs (individual customer, single order, uncategorised, channel not captured). */
export const NONE = "none";

export type CustomerType = "INDIVIDUAL" | "CORPORATE";

export type AnalyticsFilters = {
  from: string;
  to: string;
  /** Resolved kitchen scope; null = all kitchens. An empty array matches nothing. */
  kitchenIds: string[] | null;
  zoneId?: string; // zone id or NONE
  companyId?: string; // company id or NONE (= individual customers)
  customerType?: CustomerType;
  diet?: Diet; // "meal type": any item on the order has this diet
  planId?: string; // plan id, or NONE = orders not from a meal plan
  paymentStatus?: OrderPaymentStatus;
  orderStatus?: OrderStatus;
  // drill-down only dimensions
  categoryId?: string; // box category id or NONE
  channel?: string; // User.acquisitionSource or NONE
  method?: PaymentMethod; // cash basis only
};

export type Scoped = { kitchenId?: string | null; kitchenIds?: string[] | null };
type SP = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const ID = /^[a-z0-9_-]{1,40}$/i;
const pick = <T extends string>(v: string | undefined, allowed: readonly T[]) => (v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined);
const id = (v: string | undefined) => (v && ID.test(v) ? v : undefined);

export function userScope(user: Scoped): string[] | null {
  if (user.kitchenIds !== undefined) return user.kitchenIds;
  return user.kitchenId ? [user.kitchenId] : null;
}

/** Parse ?from&to&kitchen&zone&company&ctype&diet&plan&pay&status&category&channel&method against the user's scope. */
export function parseFilters(sp: SP, user: Scoped, defaultDays = 30): AnalyticsFilters {
  const today = todayKTM();
  const toRaw = one(sp.to);
  const to = toRaw && isValidISODate(toRaw) ? toRaw : today;
  const fromRaw = one(sp.from);
  const from = fromRaw && isValidISODate(fromRaw) && fromRaw <= to ? fromRaw : addDays(to, -(defaultDays - 1));
  const scope = userScope(user);
  const kitchen = id(one(sp.kitchen));
  let kitchenIds: string[] | null = scope;
  if (kitchen) kitchenIds = !scope || scope.includes(kitchen) ? [kitchen] : scope;
  const channel = one(sp.channel);
  return {
    from,
    to,
    kitchenIds,
    zoneId: id(one(sp.zone)),
    companyId: id(one(sp.company)),
    customerType: pick(one(sp.ctype), ["INDIVIDUAL", "CORPORATE"] as const),
    diet: pick(one(sp.diet), DIETS),
    planId: id(one(sp.plan)),
    paymentStatus: pick(one(sp.pay), ORDER_PAYMENT_STATUSES),
    orderStatus: pick(one(sp.status), ORDER_STATUSES),
    categoryId: id(one(sp.category)),
    channel: channel && channel.length <= 60 ? channel : undefined,
    method: pick(one(sp.method), METHODS),
  };
}

/** Back to query params (for drill-down links, pagination and export URLs). */
export function filterParams(f: AnalyticsFilters, extra: Record<string, string | undefined> = {}): Record<string, string> {
  const out: Record<string, string | undefined> = {
    from: f.from,
    to: f.to,
    kitchen: f.kitchenIds?.length === 1 ? f.kitchenIds[0] : undefined,
    zone: f.zoneId,
    company: f.companyId,
    ctype: f.customerType,
    diet: f.diet,
    plan: f.planId,
    pay: f.paymentStatus,
    status: f.orderStatus,
    category: f.categoryId,
    channel: f.channel,
    method: f.method,
    ...extra,
  };
  return Object.fromEntries(Object.entries(out).filter((e): e is [string, string] => Boolean(e[1])));
}

export function qs(f: AnalyticsFilters, extra: Record<string, string | undefined> = {}) {
  return new URLSearchParams(filterParams(f, extra)).toString();
}

/** True when anything narrows the data beyond the date range (used where a dimension can't be filtered). */
export function isFiltered(f: AnalyticsFilters, opts: { ignoreKitchen?: boolean } = {}) {
  return Boolean(
    (!opts.ignoreKitchen && f.kitchenIds) || f.zoneId || f.companyId || f.customerType || f.diet || f.planId || f.paymentStatus || f.orderStatus || f.categoryId || f.channel,
  );
}

// ───────────── date boundaries ─────────────

/** Kathmandu midnight of an ISO date as a UTC instant (timestamps are stored in UTC). */
export function ktmStart(date: string) {
  return new Date(`${date}T00:00:00+05:45`);
}
/** [from 00:00 KTM, to+1 00:00 KTM) for timestamp columns. */
export function stampRange(from: string, to: string) {
  return { gte: ktmStart(from), lt: ktmStart(addDays(to, 1)) };
}
/** Inclusive range for @db.Date columns. */
export function dayRange(from: string, to: string) {
  return { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) };
}

// ───────────── Prisma builder ─────────────

/** Non-date order conditions (kitchen scope + every global filter). */
export function orderDims(f: AnalyticsFilters): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  if (f.kitchenIds) and.push({ kitchenId: { in: f.kitchenIds } });
  if (f.zoneId) and.push({ zoneId: f.zoneId === NONE ? null : f.zoneId });
  if (f.companyId) and.push({ companyId: f.companyId === NONE ? null : f.companyId });
  if (f.customerType) and.push({ companyId: f.customerType === "CORPORATE" ? { not: null } : null });
  if (f.diet) and.push({ items: { some: { diet: f.diet } } });
  if (f.planId) and.push(f.planId === NONE ? { subscriptionId: null } : { subscription: { planId: f.planId } });
  if (f.paymentStatus) and.push({ paymentStatus: f.paymentStatus });
  if (f.orderStatus) and.push({ status: f.orderStatus });
  if (f.categoryId) and.push({ items: { some: f.categoryId === NONE ? { OR: [{ boxId: null }, { box: { categoryId: null } }] } : { box: { categoryId: f.categoryId } } } });
  if (f.channel) and.push({ user: { acquisitionSource: f.channel === NONE ? null : f.channel } });
  return and.length ? { AND: and } : {};
}

/** Order conditions ANDed with a basis-specific condition. */
export function orderWhere(f: AnalyticsFilters, basis: Prisma.OrderWhereInput): Prisma.OrderWhereInput {
  const dims = orderDims(f);
  return Object.keys(dims).length ? { AND: [basis, dims] } : basis;
}

/** A plan matches the filters when any of its meal orders does. */
export function subscriptionDims(f: AnalyticsFilters): Prisma.SubscriptionWhereInput {
  if (f.planId === NONE) return { id: "__never__" };
  const dims = orderDims({ ...f, planId: undefined });
  const base: Prisma.SubscriptionWhereInput = f.planId ? { planId: f.planId } : {};
  return Object.keys(dims).length ? { ...base, orders: { some: dims } } : base;
}

/** A payment matches when any order it paid for matches (plan payments link to every meal order). */
export function paymentDims(f: AnalyticsFilters): Prisma.PaymentWhereInput {
  const dims = orderDims(f);
  const and: Prisma.PaymentWhereInput[] = [];
  if (Object.keys(dims).length) and.push({ orders: { some: dims } });
  if (f.method) and.push({ method: f.method });
  return and.length ? { AND: and } : {};
}

// ───────────── SQL builder (mirrors orderDims) ─────────────

/** `AND …` fragment over an "Order" alias, identical in meaning to orderDims(). */
export function orderDimsSql(f: AnalyticsFilters, o = "o"): Prisma.Sql {
  const a = Prisma.raw(`"${o.replace(/[^a-z_]/gi, "")}"`);
  const parts: Prisma.Sql[] = [];
  if (f.kitchenIds) parts.push(f.kitchenIds.length ? Prisma.sql`${a}."kitchenId" = ANY(${f.kitchenIds})` : Prisma.sql`FALSE`);
  if (f.zoneId) parts.push(f.zoneId === NONE ? Prisma.sql`${a}."zoneId" IS NULL` : Prisma.sql`${a}."zoneId" = ${f.zoneId}`);
  if (f.companyId) parts.push(f.companyId === NONE ? Prisma.sql`${a}."companyId" IS NULL` : Prisma.sql`${a}."companyId" = ${f.companyId}`);
  if (f.customerType) parts.push(f.customerType === "CORPORATE" ? Prisma.sql`${a}."companyId" IS NOT NULL` : Prisma.sql`${a}."companyId" IS NULL`);
  if (f.diet) parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "OrderItem" fi WHERE fi."orderId" = ${a}.id AND fi.diet::text = ${f.diet})`);
  if (f.planId)
    parts.push(
      f.planId === NONE ? Prisma.sql`${a}."subscriptionId" IS NULL` : Prisma.sql`EXISTS (SELECT 1 FROM "Subscription" fs WHERE fs.id = ${a}."subscriptionId" AND fs."planId" = ${f.planId})`,
    );
  if (f.paymentStatus) parts.push(Prisma.sql`${a}."paymentStatus"::text = ${f.paymentStatus}`);
  if (f.orderStatus) parts.push(Prisma.sql`${a}.status::text = ${f.orderStatus}`);
  if (f.categoryId)
    parts.push(
      f.categoryId === NONE
        ? Prisma.sql`EXISTS (SELECT 1 FROM "OrderItem" fi LEFT JOIN "LunchBox" fb ON fb.id = fi."boxId" WHERE fi."orderId" = ${a}.id AND fb."categoryId" IS NULL)`
        : Prisma.sql`EXISTS (SELECT 1 FROM "OrderItem" fi JOIN "LunchBox" fb ON fb.id = fi."boxId" WHERE fi."orderId" = ${a}.id AND fb."categoryId" = ${f.categoryId})`,
    );
  if (f.channel)
    parts.push(
      f.channel === NONE
        ? Prisma.sql`EXISTS (SELECT 1 FROM "User" fu WHERE fu.id = ${a}."userId" AND fu."acquisitionSource" IS NULL)`
        : Prisma.sql`EXISTS (SELECT 1 FROM "User" fu WHERE fu.id = ${a}."userId" AND fu."acquisitionSource" = ${f.channel})`,
    );
  return parts.length ? Prisma.sql`AND ${Prisma.join(parts, " AND ")}` : Prisma.empty;
}
