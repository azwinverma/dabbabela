import "server-only";
import type { AddressType, OrderPaymentStatus, OrderSource, OrderStatus, PaymentMethod, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can, type PermissionSubject, type Permission } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { addDays, dateOnly, isoDate, isValidISODate, todayKTM, weekdayOf } from "@/lib/dates";
import { rs } from "@/lib/money";
import { formatNepalPhone, maskEmail, maskPhone, normalizeNepalPhone } from "@/lib/phone";
import { activeCompany, type CurrentUser } from "@/lib/auth";
import { CURRENT_USER_INCLUDE, toCurrentUser } from "@/lib/user-context";
import { csv, money } from "./reports";
import { changeWindowOpen } from "./calendar";
import { combineDiet, getOffersForDates } from "./menu";
import { priceDays, type CompanySpec } from "./pricing";
import { companySpecFor } from "./corporate";
import { assertDayCapacity, CapacityError, lockKitchenDay, slotBooked } from "./capacity";
import { addCredit, spendCredit, walletBalance } from "./ledger";
import { EDITABLE_STATUSES } from "./transitions";
import {
  addressSnapshot,
  dayCutoff,
  OrderError,
  paymentRef,
  placeCartOrder,
  quoteCart,
  staffPaymentMethods,
  taxRuleFor,
  type CartLine,
} from "./orders";

/**
 * Staff order management (WP-03): manual / phone orders, corporate bulk orders, line edits and substitutions
 * before the cut-off, kitchen and delivery reassignment, search and export.
 *
 * Every function takes the acting staff member and re-checks the permission and kitchen scope itself, so the
 * server actions are thin. Order money fields (subtotal … customerShare) and payment records are never rewritten:
 * a price difference is recorded as an `OrderAdjustment` and settled as wallet credit or a new payment.
 */

export type Actor = PermissionSubject & { id: string; role: string; kitchenId?: string | null; kitchenIds?: string[] | null };

export class OrderAdminError extends Error {}
export class OrderForbidden extends OrderAdminError {}
export class VersionConflict extends OrderAdminError {
  constructor(number: string) {
    super(`${number} was changed by someone else — reload and try again`);
  }
}

function need(actor: Actor, perm: Permission) {
  if (!can(actor, perm)) throw new OrderForbidden(`You don't have permission to do that (${perm})`);
}

function scopeIds(actor: Actor): string[] | null {
  if (actor.kitchenIds !== undefined) return actor.kitchenIds ?? null;
  return actor.kitchenId ? [actor.kitchenId] : null;
}

export function inKitchenScope(actor: Actor, kitchenId: string) {
  const ids = scopeIds(actor);
  return !ids || ids.includes(kitchenId);
}

function assertScope(actor: Actor, kitchenId: string) {
  if (!inKitchenScope(actor, kitchenId)) throw new OrderForbidden("That kitchen isn't in your scope");
}

function cleanReason(reason: string | null | undefined) {
  const r = (reason ?? "").trim();
  if (r.length < 3) throw new OrderAdminError("Give a reason (at least a few words) — it goes in the audit log");
  return r.slice(0, 500);
}

/** Load a customer the same way getCurrentUser does, so checkout code sees the same shape. */
export async function loadCustomer(userId: string): Promise<CurrentUser> {
  const u = await db.user.findUnique({ where: { id: userId }, include: CURRENT_USER_INCLUDE });
  if (!u || !u.isActive || u.deletedAt) throw new OrderAdminError("Customer not found");
  return toCurrentUser(u, "staff-order") as CurrentUser;
}

// ───────────── modification window ─────────────

/** Setting row holding the staff modification window: `{ "cutoff": "HH:MM" }`. Absent = the order cut-off. */
export const MODIFICATION_WINDOW_KEY = "orders.modificationWindow";

async function modificationCutoff(): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key: MODIFICATION_WINDOW_KEY } });
  const v = row?.value as { cutoff?: unknown } | null;
  return typeof v?.cutoff === "string" && /^\d{2}:\d{2}$/.test(v.cutoff) ? v.cutoff : null;
}

/**
 * Can staff still change this order's contents? Only editable statuses, and before the cut-off for that day:
 * the modification-window setting when set, else the menu day's cut-off / company override / global cut-off;
 * never after the kitchen locked the day.
 */
export async function staffEditWindow(order: { status: OrderStatus; deliveryDate: Date; kitchenId: string; companyId: string | null }) {
  const settings = await getSettings();
  const date = isoDate(order.deliveryDate);
  if (!EDITABLE_STATUSES.includes(order.status)) return { open: false, cutoff: settings.orderCutoff, reason: "The kitchen has already confirmed this order" };
  const [offers, company, window] = await Promise.all([
    getOffersForDates([date], order.kitchenId),
    order.companyId ? db.company.findUnique({ where: { id: order.companyId }, select: { cutoffOverride: true } }) : null,
    modificationCutoff(),
  ]);
  const cutoff = window ?? dayCutoff(offers.get(date)?.cutoff, company?.cutoffOverride) ?? settings.orderCutoff;
  const open = await changeWindowOpen(date, order.kitchenId, settings, cutoff);
  return { open, cutoff, reason: open ? null : `Changes for ${date} closed at ${cutoff} (or the kitchen locked the day)` };
}

// ───────────── manual / phone orders ─────────────

export type NewCustomerInput = { name: string; phone: string; email?: string | null };
export type NewAddressInput = {
  label?: string | null;
  type?: AddressType | null;
  recipientName?: string | null;
  phone?: string | null;
  placeName?: string | null;
  line1: string;
  area: string;
  ward?: number | null;
  landmark?: string | null;
  instructions?: string | null;
  zoneId: string;
};

export type ManualOrderInput = {
  customerId?: string | null;
  newCustomer?: NewCustomerInput | null;
  addressId?: string | null;
  newAddress?: NewAddressInput | null;
  lines: CartLine[];
  method: PaymentMethod;
  slotId?: string | null;
  couponCode?: string | null;
  notes?: string | null;
  /** One per form render: a retried submit returns the first result instead of a second order. */
  idempotencyKey: string;
  reason?: string | null;
};

const ADDRESS_TYPES: AddressType[] = ["OFFICE", "SHOP", "COLLEGE", "HOME", "SITE", "OTHER"];

async function findOrCreateCustomer(actor: Actor, input: NewCustomerInput) {
  const name = input.name?.trim().slice(0, 120);
  const phone = normalizeNepalPhone(input.phone ?? "");
  if (!name) throw new OrderAdminError("Enter the customer's name");
  if (!phone) throw new OrderAdminError("Enter a valid Nepal phone number");
  const email = input.email?.trim().toLowerCase().slice(0, 200) || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OrderAdminError("That email doesn't look right");
  const existing = await db.user.findFirst({ where: { OR: [{ phoneNumber: phone }, ...(email ? [{ email }] : [])], deletedAt: null } });
  if (existing) return { id: existing.id, created: false };
  const u = await db.user.create({
    data: { name, phoneNumber: phone, email: email ?? `${phone.replace(/\D/g, "")}@phone.dabbabela.local`, role: "CUSTOMER", acquisitionSource: "staff" },
  });
  await audit({ actorId: actor.id, action: "customer.create", entity: "User", entityId: u.id, summary: `Customer created by staff for a phone order`, after: { name, phone: maskPhone(phone), email: email ? maskEmail(email) : null } });
  return { id: u.id, created: true };
}

async function createAddress(actor: Actor, userId: string, a: NewAddressInput, fallback: { name: string; phone: string }) {
  const zone = await db.deliveryZone.findFirst({ where: { id: a.zoneId, isActive: true } });
  if (!zone) throw new OrderAdminError("Pick a delivery zone we serve");
  if (!a.line1?.trim() || !a.area?.trim()) throw new OrderAdminError("Enter the street/building and area");
  const phone = normalizeNepalPhone(a.phone ?? "") ?? fallback.phone;
  const addr = await db.address.create({
    data: {
      userId,
      label: a.label?.trim().slice(0, 60) || "Phone order",
      type: a.type && ADDRESS_TYPES.includes(a.type) ? a.type : "OFFICE",
      recipientName: a.recipientName?.trim().slice(0, 120) || fallback.name,
      phone,
      placeName: a.placeName?.trim().slice(0, 120) || null,
      line1: a.line1.trim().slice(0, 200),
      area: a.area.trim().slice(0, 120),
      ward: a.ward ?? null,
      landmark: a.landmark?.trim().slice(0, 200) || null,
      instructions: a.instructions?.trim().slice(0, 300) || null,
      zoneId: zone.id,
    },
  });
  await audit({ actorId: actor.id, action: "address.create", entity: "Address", entityId: addr.id, summary: `Address added by staff (${addr.area})`, after: { userId, area: addr.area, zoneId: zone.id } });
  return addr;
}

/**
 * Place an order for a customer on their behalf (phone / walk-in). Goes through `quoteCart` + `placeCartOrder`
 * exactly like a customer checkout, so prices, capacity, coupons and tax are the server's own.
 */
export async function createManualOrder(actor: Actor, input: ManualOrderInput) {
  need(actor, "orders.create");
  const key = (input.idempotencyKey ?? "").trim();
  if (key.length < 8 || key.length > 100) throw new OrderAdminError("Reload the page and try again (missing submit key)");
  const idempotencyKey = `staff:${key}`;
  const replay = await db.payment.findUnique({ where: { idempotencyKey }, include: { orders: true } });
  if (replay) return { payment: replay, orders: replay.orders, replayed: true, customerId: replay.userId };

  let customerId = input.customerId ?? null;
  if (!customerId) {
    if (!input.newCustomer) throw new OrderAdminError("Pick a customer or enter a new one");
    customerId = (await findOrCreateCustomer(actor, input.newCustomer)).id;
  }
  let customer = await loadCustomer(customerId);

  let addressId = input.addressId ?? null;
  if (addressId && !customer.addresses.some((a) => a.id === addressId)) throw new OrderAdminError("That address isn't one of the customer's");
  if (!addressId) {
    if (!input.newAddress) throw new OrderAdminError("Pick a delivery address or enter a new one");
    addressId = (await createAddress(actor, customer.id, input.newAddress, { name: customer.name, phone: customer.phoneNumber ?? "" })).id;
    customer = await loadCustomer(customer.id);
  }
  const address = customer.addresses.find((a) => a.id === addressId)!;
  if (address.zone?.kitchenId) assertScope(actor, address.zone.kitchenId);
  if (input.method === "COMPANY_INVOICE") throw new OrderAdminError("Company billing is applied automatically from the customer's company");

  try {
    const res = await placeCartOrder(customer, {
      lines: input.lines,
      addressId,
      slotId: input.slotId ?? null,
      couponCode: input.couponCode ?? null,
      method: input.method,
      notes: input.notes ?? null,
      idempotencyKey,
      source: "ADMIN",
      placedById: actor.id,
      staffMethods: true,
    });
    if (!res.replayed) {
      for (const o of res.orders) {
        await audit({
          actorId: actor.id,
          action: "order.create_manual",
          entity: "Order",
          entityId: o.id,
          summary: `${o.number}: staff order for ${customer.name} — ${rs(o.total)} (${res.payment.method})`,
          reason: input.reason?.trim().slice(0, 500) || "Phone / walk-in order",
          after: { customerId: customer.id, deliveryDate: isoDate(o.deliveryDate), total: o.total, customerShare: o.customerShare, companyShare: o.companyShare, method: res.payment.method, status: o.status },
        });
      }
    }
    return { payment: res.payment, orders: res.orders, replayed: res.replayed, customerId: customer.id };
  } catch (e) {
    if (e instanceof OrderError) throw new OrderAdminError(e.message);
    throw e;
  }
}

/** Price preview for the manual order form (same quote the order will be placed with). */
export async function quoteManualOrder(actor: Actor, input: { customerId?: string | null; addressId?: string | null; zoneId?: string | null; lines: CartLine[]; couponCode?: string | null }) {
  need(actor, "orders.create");
  const customer = input.customerId ? await loadCustomer(input.customerId) : null;
  if (input.addressId && customer && !customer.addresses.some((a) => a.id === input.addressId)) throw new OrderAdminError("That address isn't one of the customer's");
  return quoteCart(customer, { lines: input.lines, addressId: customer ? (input.addressId ?? null) : null, zoneId: input.addressId ? null : (input.zoneId ?? null), couponCode: customer ? input.couponCode : null });
}

/** Customers matching a search (for the manual order picker). Phone/email search and display need customers.pii. */
export async function findCustomers(actor: Actor, q: string) {
  need(actor, "orders.create");
  const s = q.trim().slice(0, 100);
  if (s.length < 2) return [];
  const pii = can(actor, "customers.pii");
  const digits = s.replace(/\D/g, "");
  const rows = await db.user.findMany({
    where: {
      role: "CUSTOMER",
      deletedAt: null,
      isActive: true,
      OR: [{ name: { contains: s, mode: "insensitive" } }, ...(pii && digits.length >= 6 ? [{ phoneNumber: { contains: digits.slice(-8) } }] : []), ...(pii && s.includes("@") ? [{ email: { contains: s.toLowerCase() } }] : [])],
    },
    select: { id: true, name: true, email: true, phoneNumber: true, membership: { select: { status: true, company: { select: { name: true } } } } },
    orderBy: { name: "asc" },
    take: 20,
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: pii ? formatNepalPhone(r.phoneNumber) || r.phoneNumber || "" : maskPhone(r.phoneNumber),
    email: pii ? r.email : maskEmail(r.email),
    company: r.membership?.status === "ACTIVE" ? r.membership.company.name : null,
  }));
}

// ───────────── corporate bulk orders ─────────────

export type BulkOrderInput = {
  companyId: string;
  date: string;
  slotId?: string | null;
  /** One row per dabba; a member may appear more than once. */
  lines: { memberId: string; boxId: string; qty?: number }[];
  /** How the employee's share (if any) is paid. The company's share is invoiced. */
  memberMethod?: "CASH" | "WALLET";
  idempotencyKey: string;
  notes?: string | null;
};

export type BulkResult = { memberId: string; name: string; ok: boolean; message: string; orderIds: string[]; companyShare: number; customerShare: number; replayed: boolean };

async function memberAddressId(user: CurrentUser) {
  const loc = user.membership?.officeLocation;
  if (loc && loc.isActive) {
    const found = user.addresses.find((a) => a.type === "OFFICE" && a.line1 === loc.line1 && a.area === loc.area);
    if (found) return found.id;
    const a = await db.address.create({
      data: { userId: user.id, label: loc.name, type: "OFFICE", recipientName: user.name, phone: loc.receiverPhone || user.phoneNumber || "", placeName: loc.name, line1: loc.line1, area: loc.area, ward: loc.ward, landmark: loc.landmark, zoneId: loc.zoneId, instructions: loc.receiverName ? `Hand to ${loc.receiverName}` : null },
    });
    return a.id;
  }
  return user.addresses[0]?.id ?? null;
}

/**
 * Staff corporate bulk order: one order per employee for one day. Each employee's order carries the company split
 * (subsidy, allowance, negotiated prices) exactly as if they had ordered; the company's part is invoiced.
 */
export async function createCorporateBulkOrder(actor: Actor, input: BulkOrderInput) {
  need(actor, "orders.create");
  const key = (input.idempotencyKey ?? "").trim();
  if (key.length < 8 || key.length > 100) throw new OrderAdminError("Reload the page and try again (missing submit key)");
  if (!isValidISODate(input.date)) throw new OrderAdminError("Pick a delivery date");
  const company = await db.company.findUnique({ where: { id: input.companyId } });
  if (!company || !company.isActive) throw new OrderAdminError("Company not found or inactive");
  const byMember = new Map<string, Map<string, number>>();
  for (const l of input.lines ?? []) {
    if (!l?.memberId || !l.boxId) continue;
    const m = byMember.get(l.memberId) ?? new Map<string, number>();
    m.set(l.boxId, Math.min(25, (m.get(l.boxId) ?? 0) + Math.max(1, Math.floor(l.qty ?? 1))));
    byMember.set(l.memberId, m);
  }
  if (!byMember.size) throw new OrderAdminError("Pick at least one employee and dabba");
  if (byMember.size > 300) throw new OrderAdminError("At most 300 employees per bulk order");
  const members = await db.companyMember.findMany({ where: { id: { in: [...byMember.keys()] }, companyId: company.id }, include: { user: { select: { name: true } } } });
  const day = weekdayOf(input.date);

  const results: BulkResult[] = [];
  for (const [memberId, boxes] of byMember) {
    const m = members.find((x) => x.id === memberId);
    const base = { memberId, name: m?.user.name ?? "Unknown", orderIds: [] as string[], companyShare: 0, customerShare: 0, replayed: false };
    if (!m || m.status !== "ACTIVE") {
      results.push({ ...base, ok: false, message: "Not an active member of this company" });
      continue;
    }
    if (!m.mealEligible || (m.eligibleDays.length && !m.eligibleDays.includes(day))) {
      results.push({ ...base, ok: false, message: `Not eligible for company meals on ${input.date}` });
      continue;
    }
    try {
      const user = await loadCustomer(m.userId);
      const addressId = await memberAddressId(user);
      if (!addressId) throw new OrderAdminError("No office location or address on file");
      const fresh = await loadCustomer(m.userId);
      const zoneKitchen = fresh.addresses.find((a) => a.id === addressId)?.zone?.kitchenId;
      if (zoneKitchen) assertScope(actor, zoneKitchen);
      const r = await placeCartOrder(fresh, {
        lines: [...boxes].map(([boxId, qty]) => ({ kind: "box", id: boxId, date: input.date, qty })),
        addressId,
        slotId: input.slotId ?? null,
        method: input.memberMethod === "WALLET" ? "WALLET" : "CASH",
        notes: input.notes ?? null,
        source: "CORPORATE",
        placedById: actor.id,
        staffMethods: true,
        // Same employee + same dabbas under the same key = the same order, even across page reloads.
        idempotencyKey: `staff-bulk:${key}:${m.id}:${[...boxes].sort(([x], [y]) => x.localeCompare(y)).map(([b, q]) => `${b}x${q}`).join(",")}`.slice(0, 190),
      });
      results.push({
        ...base,
        ok: true,
        replayed: r.replayed,
        message: r.replayed ? "Already ordered" : `Order ${r.orders.map((o) => o.number).join(", ")}`,
        orderIds: r.orders.map((o) => o.id),
        companyShare: r.orders.reduce((a, o) => a + o.companyShare, 0),
        customerShare: r.orders.reduce((a, o) => a + o.customerShare, 0),
      });
    } catch (e) {
      results.push({ ...base, ok: false, message: e instanceof Error ? e.message : "Failed" });
    }
  }
  const ok = results.filter((r) => r.ok && !r.replayed);
  if (ok.length) {
    await audit({
      actorId: actor.id,
      action: "order.bulk_corporate",
      entity: "Company",
      entityId: company.id,
      summary: `${company.name}: ${ok.length} order(s) for ${input.date} — company ${rs(ok.reduce((a, r) => a + r.companyShare, 0))}, employees ${rs(ok.reduce((a, r) => a + r.customerShare, 0))}`,
      after: { date: input.date, results: results.map((r) => ({ memberId: r.memberId, ok: r.ok, message: r.message, orderIds: r.orderIds, companyShare: r.companyShare, customerShare: r.customerShare })) },
    });
  }
  return {
    results,
    totals: {
      orders: results.reduce((a, r) => a + r.orderIds.length, 0),
      companyShare: results.filter((r) => r.ok).reduce((a, r) => a + r.companyShare, 0),
      customerShare: results.filter((r) => r.ok).reduce((a, r) => a + r.customerShare, 0),
      failed: results.filter((r) => !r.ok).length,
    },
  };
}

// ───────────── content changes (line edits, substitutions) ─────────────

const orderEditInclude = {
  items: { include: { customizations: true } },
  payment: true,
  company: true,
  zone: true,
} satisfies Prisma.OrderInclude;
type EditableOrder = Prisma.OrderGetPayload<{ include: typeof orderEditInclude }>;

async function loadForEdit(actor: Actor, orderId: string, version: number) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: orderEditInclude });
  if (!order) throw new OrderAdminError("Order not found");
  assertScope(actor, order.kitchenId);
  if (!Number.isInteger(version) || order.version !== version) throw new VersionConflict(order.number);
  return order;
}

async function assertEditable(order: EditableOrder) {
  const w = await staffEditWindow(order);
  if (!w.open) throw new OrderAdminError(w.reason ?? "This order can't be changed any more");
}

type ItemState = {
  id?: string;
  boxId: string | null;
  customBoxId: string | null;
  name: string;
  details: string | null;
  components: Prisma.InputJsonValue;
  diet: EditableOrder["items"][number]["diet"];
  quantity: number;
  unitPrice: number;
  unitCost: number;
  packagingCost: number;
  newCustomizations: { kind: string; label: string; priceDelta: number }[];
  changed: boolean;
};

/** Company spec for re-pricing an existing order: this order's own company share is added back to the allowance. */
async function companySpecForOrder(order: EditableOrder): Promise<CompanySpec> {
  if (!order.company) return null;
  const spec = await companySpecFor(order.userId, order.company, [isoDate(order.deliveryDate)]);
  if (spec && spec.allowanceRemaining != null) spec.allowanceRemaining += order.companyShare;
  return spec;
}

/**
 * Price difference of a content change. Both the current and the new contents are priced the same way (zone fee,
 * company split, tax rule of the day; coupon left as originally applied), so only the change itself moves money.
 */
export async function priceDelta(order: EditableOrder, before: Pick<ItemState, "quantity" | "unitPrice" | "unitCost" | "boxId">[], after: Pick<ItemState, "quantity" | "unitPrice" | "unitCost" | "boxId">[]) {
  const date = isoDate(order.deliveryDate);
  const settings = await getSettings();
  const [tax, company] = await Promise.all([taxRuleFor(date), companySpecForOrder(order)]);
  const zone = order.zone ? { fee: order.zone.fee, freeAbove: order.zone.freeAbove, minOrder: order.zone.minOrder } : null;
  const price = (items: typeof before) =>
    priceDays({ lines: items.filter((i) => i.quantity > 0).map((i) => ({ date, qty: i.quantity, unitPrice: i.unitPrice, unitCost: i.unitCost, boxId: i.boxId })), zone, company, tax, globalFreeAbove: settings.freeDeliveryAbove });
  const a = price(before);
  const b = price(after);
  return {
    subtotal: b.subtotal - a.subtotal,
    total: b.total - a.total,
    customer: b.customerShare - a.customerShare,
    company: b.companyShare - a.companyShare,
    cost: b.cost - a.cost,
  };
}

async function packagingByBox(boxIds: string[]) {
  const rows = boxIds.length ? await db.lunchBox.findMany({ where: { id: { in: boxIds } }, select: { id: true, packagingCost: true } }) : [];
  return new Map(rows.map((r) => [r.id, r.packagingCost]));
}

function isPaid(order: EditableOrder) {
  return order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_REFUNDED" || order.payment?.status === "PAID";
}

type Delta = Awaited<ReturnType<typeof priceDelta>>;

/**
 * Write a content change: replace the order's items (version-checked, capacity re-checked when it grows) and record
 * the money difference. Customer part: credit → wallet when already paid; charge → a new pending payment (or a wallet
 * spend). Company part: its own adjustment row (picked up by invoicing).
 */
async function commitContentChange(
  actor: Actor,
  order: EditableOrder,
  next: ItemState[],
  delta: Delta,
  opts: { reason: string; summary: string; chargeMethod?: PaymentMethod | null },
) {
  const date = isoDate(order.deliveryDate);
  const mealsBefore = order.items.reduce((a, i) => a + i.quantity, 0);
  const mealsAfter = next.reduce((a, i) => a + i.quantity, 0);
  const boxGrowth = new Map<string, number>();
  for (const i of next) if (i.boxId) boxGrowth.set(i.boxId, (boxGrowth.get(i.boxId) ?? 0) + i.quantity);
  for (const i of order.items) if (i.boxId) boxGrowth.set(i.boxId, (boxGrowth.get(i.boxId) ?? 0) - i.quantity);
  const grows = mealsAfter > mealsBefore || [...boxGrowth.values()].some((n) => n > 0);
  const offer = grows ? (await getOffersForDates([date], order.kitchenId)).get(date) : null;

  const chargeMethod: PaymentMethod = opts.chargeMethod && ["CASH", "BANK_TRANSFER", "WALLET", "ESEWA", "KHALTI"].includes(opts.chargeMethod) ? opts.chargeMethod : "CASH";
  if (delta.customer > 0 && chargeMethod === "WALLET" && (await walletBalance(order.userId)) < delta.customer) throw new OrderAdminError("Not enough wallet credit for the extra charge — pick another method");
  const packaging = next.reduce((a, i) => a + i.packagingCost * i.quantity, 0);
  const costTotal = next.reduce((a, i) => a + i.unitCost * i.quantity, 0);

  try {
    return await db.$transaction(
      async (tx) => {
        await lockKitchenDay(tx, order.kitchenId, date);
        const u = await tx.order.updateMany({
          where: { id: order.id, version: order.version, status: order.status },
          data: { version: { increment: 1 }, costTotal, packagingCost: packaging },
        });
        if (!u.count) throw new VersionConflict(order.number);

        const keep = new Set(next.filter((i) => i.id).map((i) => i.id!));
        const removed = order.items.filter((i) => !keep.has(i.id)).map((i) => i.id);
        if (removed.length) await tx.orderItem.deleteMany({ where: { id: { in: removed }, orderId: order.id } });
        for (const i of next) {
          if (i.id && !i.changed) continue;
          if (i.id) {
            await tx.orderItem.update({
              where: { id: i.id },
              data: { quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.unitPrice * i.quantity, components: i.components, diet: i.diet, customizations: i.newCustomizations.length ? { create: i.newCustomizations } : undefined },
            });
          } else {
            await tx.orderItem.create({
              data: {
                orderId: order.id,
                boxId: i.boxId,
                customBoxId: i.customBoxId,
                name: i.name,
                details: i.details,
                components: i.components,
                diet: i.diet,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                unitCost: i.unitCost,
                lineTotal: i.unitPrice * i.quantity,
                customizations: { create: i.newCustomizations },
              },
            });
          }
        }

        if (grows) {
          // Items are already written: check the resulting day fits (zero increments = "as it now stands").
          const boxes = new Map<string, { qty: number; capacity: number | null; name: string }>();
          for (const [boxId, n] of boxGrowth) {
            if (n <= 0) continue;
            const it = offer?.items.find((x) => x.box.id === boxId);
            boxes.set(boxId, { qty: 0, capacity: it?.capacity ?? null, name: it?.box.name ?? "That dabba" });
          }
          await assertDayCapacity(tx, { kitchenId: order.kitchenId, date, meals: 0, boxes });
        }

        const adjustments = [];
        let chargePayment: { id: string; reference: string; status: string } | null = null;
        if (delta.customer !== 0) {
          let note = "";
          if (delta.customer > 0) {
            const p = await tx.payment.create({
              data: {
                reference: paymentRef(),
                userId: order.userId,
                method: chargeMethod,
                status: chargeMethod === "WALLET" ? "PAID" : "PENDING",
                amount: delta.customer,
                paidAt: chargeMethod === "WALLET" ? new Date() : null,
                note: `Extra charge for order ${order.number}: ${opts.reason}`.slice(0, 500),
              },
            });
            if (chargeMethod === "WALLET") await spendCredit(tx, { userId: order.userId, amount: delta.customer, paymentId: p.id, orderId: order.id, actorId: actor.id, note: `Extra charge ${order.number}` });
            chargePayment = { id: p.id, reference: p.reference, status: p.status };
            note = ` — charge ${p.reference}`;
          } else if (isPaid(order)) {
            await addCredit(tx, { userId: order.userId, amount: -delta.customer, reason: "ADJUSTMENT", orderId: order.id, paymentId: order.paymentId, actorId: actor.id, note: `${opts.summary}: ${opts.reason}` });
            note = " — credited to wallet";
          } else {
            note = " — deduct from the amount due";
          }
          adjustments.push(await tx.orderAdjustment.create({ data: { orderId: order.id, amount: delta.customer, reason: `${opts.summary}: ${opts.reason}${note}`.slice(0, 500), actorId: actor.id } }));
        }
        if (delta.company !== 0) {
          adjustments.push(await tx.orderAdjustment.create({ data: { orderId: order.id, amount: delta.company, reason: `Company share — ${opts.summary}: ${opts.reason}`.slice(0, 500), actorId: actor.id } }));
        }
        return { adjustments, chargePayment, version: order.version + 1 };
      },
      { timeout: 20_000 },
    );
  } catch (e) {
    if (e instanceof CapacityError) throw new OrderAdminError(e.message);
    throw e;
  }
}

function itemsSnapshot(items: { name: string; quantity: number; unitPrice: number; boxId: string | null; customBoxId: string | null; components?: unknown }[]) {
  return items.map((i) => ({ name: i.name, qty: i.quantity, unitPrice: i.unitPrice, boxId: i.boxId, customBoxId: i.customBoxId, components: i.components }));
}

export type LineEditInput = {
  version: number;
  /** New quantity per existing item (0 removes it). Items not listed stay as they are. */
  items?: { itemId: string; qty: number }[];
  /** New dabbas for the same day (priced by the server). */
  add?: { kind: "box" | "custom"; id: string; qty: number; subs?: string[] }[];
  reason: string;
  /** How a positive difference is collected (default cash at hand-off). */
  chargeMethod?: PaymentMethod | null;
};

/** Edit an order's dabbas before the cut-off: re-quote, record the difference, never rewrite order totals. */
export async function editOrderLines(actor: Actor, orderId: string, input: LineEditInput) {
  need(actor, "orders.edit");
  const reason = cleanReason(input.reason);
  const order = await loadForEdit(actor, orderId, input.version);
  await assertEditable(order);
  const date = isoDate(order.deliveryDate);

  const changes = new Map<string, number>();
  for (const c of input.items ?? []) {
    if (!order.items.some((i) => i.id === c.itemId)) throw new OrderAdminError("That dabba isn't on this order");
    const q = Math.floor(Number(c.qty));
    if (!Number.isFinite(q) || q < 0 || q > 25) throw new OrderAdminError("Quantities must be between 0 and 25");
    changes.set(c.itemId, q);
  }
  const pack = await packagingByBox(order.items.map((i) => i.boxId).filter((x): x is string => Boolean(x)));
  const next: ItemState[] = [];
  for (const i of order.items) {
    const qty = changes.get(i.id) ?? i.quantity;
    if (qty === 0) continue;
    next.push({ ...i, components: i.components as Prisma.InputJsonValue, packagingCost: i.boxId ? (pack.get(i.boxId) ?? 0) : 0, quantity: qty, newCustomizations: [], changed: qty !== i.quantity });
  }

  const add = (input.add ?? []).filter((l) => l && (l.kind === "box" || l.kind === "custom") && typeof l.id === "string").slice(0, 20);
  if (add.length) {
    const customer = await loadCustomer(order.userId);
    const q = await quoteCart(customer, { lines: add.map((l) => ({ ...l, date })), zoneId: order.zoneId, kitchenId: order.kitchenId });
    if (q.lines.length !== add.length) throw new OrderAdminError(q.error ?? "Some dabbas couldn't be priced");
    const bad = q.lines.find((l) => l.problem);
    if (bad) throw new OrderAdminError(`${bad.name}: ${bad.problem}`);
    for (const l of q.lines) {
      next.push({
        boxId: l.boxId ?? null,
        customBoxId: l.customBoxId ?? null,
        name: l.name,
        details: l.details,
        components: l.components,
        diet: l.diet,
        quantity: l.qty,
        unitPrice: l.unitPrice,
        unitCost: l.unitCost,
        packagingCost: l.packagingCost,
        newCustomizations: l.customizations,
        changed: true,
      });
    }
  }
  if (!next.length) throw new OrderAdminError("An order needs at least one dabba — cancel the order instead");
  if (!next.some((i) => i.changed) && next.length === order.items.length) throw new OrderAdminError("Nothing changed");

  const delta = await priceDelta(order, order.items, next);
  const res = await commitContentChange(actor, order, next, delta, {
    reason,
    summary: "Dabbas changed",
    chargeMethod: input.chargeMethod,
  });
  await audit({
    actorId: actor.id,
    action: "order.edit_lines",
    entity: "Order",
    entityId: order.id,
    summary: `${order.number}: dabbas changed — difference ${rs(delta.total)} (customer ${rs(delta.customer)}, company ${rs(delta.company)})`,
    reason,
    before: { version: order.version, items: itemsSnapshot(order.items) },
    after: { version: res.version, items: itemsSnapshot(next), delta, chargePayment: res.chargePayment?.reference ?? null },
  });
  return { ...res, delta };
}

export type SubstitutionInput = { version: number; itemId: string; substitutionId: string; reason: string; chargeMethod?: PaymentMethod | null };

type Comp = { menuItemId: string; name: string; qty: number; diet?: string; station?: string | null; allergens?: string[]; recipeVersionId?: string | null; substitutedFrom?: string };

/** Apply a chef-approved substitution (`BoxSubstitution`) to one dabba on the order: new components snapshot + customization row. */
export async function substituteOrderItem(actor: Actor, orderId: string, input: SubstitutionInput) {
  need(actor, "orders.edit");
  const reason = cleanReason(input.reason);
  const order = await loadForEdit(actor, orderId, input.version);
  await assertEditable(order);
  const item = order.items.find((i) => i.id === input.itemId);
  if (!item) throw new OrderAdminError("That dabba isn't on this order");
  if (!item.boxId) throw new OrderAdminError("Substitutions apply to set dabbas only");
  const sub = await db.boxSubstitution.findFirst({
    where: { id: input.substitutionId, boxId: item.boxId, isActive: true },
    include: { fromItem: true, toItem: { include: { allergens: { include: { allergen: true } }, recipe: { select: { currentVersionId: true } } } } },
  });
  if (!sub) throw new OrderAdminError("That substitution isn't approved for this dabba");
  const comps = (Array.isArray(item.components) ? (item.components as unknown as Comp[]) : []).map((c) => ({ ...c }));
  const idx = comps.findIndex((c) => c.menuItemId === sub.fromItemId);
  if (idx < 0) throw new OrderAdminError(`${sub.fromItem.name} isn't in this dabba (already swapped?)`);
  const unavailable = await db.kitchenAvailability.findFirst({ where: { kitchenId: order.kitchenId, menuItemId: sub.toItemId, isAvailable: false } });
  if (unavailable) throw new OrderAdminError(`${sub.toItem.name} isn't available at this kitchen`);
  const customer = await db.user.findUnique({ where: { id: order.userId }, select: { allergies: true } });
  const toAllergens = sub.toItem.allergens.map((a) => a.allergen.code);
  const clash = toAllergens.filter((a) => customer?.allergies.includes(a));
  if (clash.length) throw new OrderAdminError(`${sub.toItem.name} contains ${clash.join(", ").toLowerCase()} — on the customer's avoid list`);

  comps[idx] = {
    menuItemId: sub.toItem.id,
    name: sub.toItem.name,
    qty: comps[idx].qty,
    diet: sub.toItem.diet,
    station: sub.toItem.station,
    allergens: toAllergens,
    recipeVersionId: sub.toItem.recipe?.currentVersionId ?? null,
    substitutedFrom: sub.fromItem.name,
  };
  const pack = await packagingByBox(order.items.map((i) => i.boxId).filter((x): x is string => Boolean(x)));
  const unitPrice = Math.max(0, item.unitPrice + sub.priceDelta);
  const next: ItemState[] = order.items.map((i) => ({
    ...i,
    components: i.components as Prisma.InputJsonValue,
    packagingCost: i.boxId ? (pack.get(i.boxId) ?? 0) : 0,
    newCustomizations: [],
    changed: false,
  }));
  const target = next.find((i) => i.id === item.id)!;
  target.components = comps as unknown as Prisma.InputJsonValue;
  target.diet = combineDiet(comps.map((c) => (c.diet ?? "VEG") as typeof item.diet));
  target.unitPrice = unitPrice;
  target.newCustomizations = [{ kind: "SUBSTITUTE", label: `${sub.fromItem.name} → ${sub.toItem.name} (staff)`, priceDelta: sub.priceDelta }];
  target.changed = true;

  const delta = await priceDelta(order, order.items, next);
  const res = await commitContentChange(actor, order, next, delta, { reason, summary: `Substitution ${sub.fromItem.name} → ${sub.toItem.name}`, chargeMethod: input.chargeMethod });
  await audit({
    actorId: actor.id,
    action: "order.substitute",
    entity: "Order",
    entityId: order.id,
    summary: `${order.number}: ${item.name} — ${sub.fromItem.name} → ${sub.toItem.name}${sub.priceDelta ? ` (${rs(sub.priceDelta)})` : ""}`,
    reason,
    before: { version: order.version, itemId: item.id, components: item.components, unitPrice: item.unitPrice },
    after: { version: res.version, itemId: item.id, components: comps, unitPrice, delta },
  });
  return { ...res, delta };
}

// ───────────── reassignment ─────────────

/** Move an order to another kitchen before the day is locked (capacity and menu availability checked there). */
export async function reassignKitchen(actor: Actor, orderId: string, input: { version: number; kitchenId: string; slotId?: string | null; reason: string }) {
  need(actor, "orders.edit");
  const reason = cleanReason(input.reason);
  const order = await loadForEdit(actor, orderId, input.version);
  assertScope(actor, input.kitchenId);
  if (order.kitchenId === input.kitchenId) throw new OrderAdminError("The order is already at that kitchen");
  await assertEditable(order);
  const date = isoDate(order.deliveryDate);
  const [target, from, assignment] = await Promise.all([
    db.kitchen.findUnique({ where: { id: input.kitchenId } }),
    db.kitchen.findUnique({ where: { id: order.kitchenId }, select: { name: true } }),
    db.deliveryAssignment.findUnique({ where: { orderId: order.id } }),
  ]);
  if (!target || !target.isActive || target.status !== "OPEN") throw new OrderAdminError("That kitchen isn't taking orders");
  if (assignment) throw new OrderAdminError("Take the order off its delivery route first");
  const slot = input.slotId ? await db.deliverySlot.findFirst({ where: { id: input.slotId, kitchenId: target.id, isActive: true } }) : null;
  if (input.slotId && !slot) throw new OrderAdminError("That delivery window doesn't belong to the new kitchen");

  const offer = (await getOffersForDates([date], target.id)).get(date);
  const boxes = new Map<string, { qty: number; capacity: number | null; name: string }>();
  for (const i of order.items) {
    if (!i.boxId) continue;
    const it = offer?.items.find((x) => x.box.id === i.boxId);
    if (!offer || offer.closed || !it) throw new OrderAdminError(`${i.name} isn't on ${target.name}'s menu that day`);
    if (it.soldOut) throw new OrderAdminError(`${i.name} is sold out at ${target.name}`);
    boxes.set(i.boxId, { qty: (boxes.get(i.boxId)?.qty ?? 0) + i.quantity, capacity: it.capacity, name: i.name });
  }
  const meals = order.items.reduce((a, i) => a + i.quantity, 0);
  try {
    await db.$transaction(async (tx) => {
      await lockKitchenDay(tx, target.id, date);
      await assertDayCapacity(tx, { kitchenId: target.id, date, meals, slotId: slot?.id ?? null, boxes });
      const u = await tx.order.updateMany({
        where: { id: order.id, version: order.version, status: order.status, kitchenId: order.kitchenId },
        data: { kitchenId: target.id, slotId: slot?.id ?? null, slotLabel: slot?.label ?? null, version: { increment: 1 } },
      });
      if (!u.count) throw new VersionConflict(order.number);
    });
  } catch (e) {
    if (e instanceof CapacityError) throw new OrderAdminError(e.message);
    throw e;
  }
  await audit({
    actorId: actor.id,
    action: "order.reassign_kitchen",
    entity: "Order",
    entityId: order.id,
    summary: `${order.number}: ${from?.name ?? "?"} → ${target.name}`,
    reason,
    before: { version: order.version, kitchenId: order.kitchenId, slotId: order.slotId, slotLabel: order.slotLabel },
    after: { version: order.version + 1, kitchenId: target.id, slotId: slot?.id ?? null, slotLabel: slot?.label ?? null },
  });
  return { version: order.version + 1 };
}

const DELIVERY_EDITABLE: OrderStatus[] = ["PENDING_PAYMENT", "SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "FAILED_DELIVERY"];

/**
 * Change where/when an order is delivered: another delivery window of the same kitchen (slot capacity checked) and/or
 * another saved address of the customer in a zone served by the same kitchen. The delivery fee is not re-priced.
 * Rider/route assignment stays in dispatch.
 */
export async function reassignDelivery(actor: Actor, orderId: string, input: { version: number; slotId?: string | null; addressId?: string | null; reason: string }) {
  need(actor, "orders.edit");
  const reason = cleanReason(input.reason);
  const order = await loadForEdit(actor, orderId, input.version);
  if (!DELIVERY_EDITABLE.includes(order.status)) throw new OrderAdminError("The delivery can't be changed at this stage");
  const date = isoDate(order.deliveryDate);
  const data: Prisma.OrderUpdateManyMutationInput & { slotId?: string | null; addressId?: string | null; zoneId?: string | null } = {};
  const before: Record<string, unknown> = { version: order.version };
  const after: Record<string, unknown> = {};

  if (input.slotId !== undefined && input.slotId !== order.slotId) {
    if (input.slotId) {
      const slot = await db.deliverySlot.findFirst({ where: { id: input.slotId, kitchenId: order.kitchenId, isActive: true } });
      if (!slot) throw new OrderAdminError("That delivery window isn't available at this order's kitchen");
      const n = await slotBooked(slot.id, date);
      if (n + 1 > slot.capacity) throw new OrderAdminError(`The ${slot.label} window is full on ${date}`);
      Object.assign(data, { slotId: slot.id, slotLabel: slot.label });
      after.slot = slot.label;
    } else {
      Object.assign(data, { slotId: null, slotLabel: null });
      after.slot = null;
    }
    before.slot = order.slotLabel;
  }
  if (input.addressId && input.addressId !== order.addressId) {
    const customer = await loadCustomer(order.userId);
    const a = customer.addresses.find((x) => x.id === input.addressId);
    if (!a) throw new OrderAdminError("That address isn't one of the customer's");
    if (!a.zone || !a.zone.isActive) throw new OrderAdminError(`We don't deliver to ${a.area}`);
    if (a.zone.kitchenId && a.zone.kitchenId !== order.kitchenId) throw new OrderAdminError("That address is served by another kitchen — reassign the kitchen first");
    const snap = addressSnapshot(a);
    Object.assign(data, snap);
    before.address = { addressId: order.addressId, area: order.area, addressLine: order.addressLine, zoneId: order.zoneId };
    after.address = { addressId: a.id, area: a.area, addressLine: a.line1, zoneId: a.zoneId };
  }
  if (!Object.keys(after).length) throw new OrderAdminError("Nothing changed");
  const u = await db.order.updateMany({ where: { id: order.id, version: order.version, status: order.status }, data: { ...data, version: { increment: 1 } } });
  if (!u.count) throw new VersionConflict(order.number);
  await audit({ actorId: actor.id, action: "order.reassign_delivery", entity: "Order", entityId: order.id, summary: `${order.number}: delivery changed`, reason, before, after: { ...after, version: order.version + 1 } });
  return { version: order.version + 1 };
}

// ───────────── search & export ─────────────

export const ORDER_SORTS = ["deliveryDate", "createdAt", "total", "number"] as const;
export type OrderSort = (typeof ORDER_SORTS)[number];

export type OrderFilters = {
  from: string;
  to: string;
  q?: string;
  status?: OrderStatus;
  pay?: OrderPaymentStatus;
  kitchen?: string;
  zone?: string;
  slot?: string;
  source?: OrderSource;
  company?: string;
  method?: PaymentMethod;
};

const STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED_DELIVERY", "CANCELLED", "SKIPPED"];
const PAYS: OrderPaymentStatus[] = ["UNPAID", "PENDING", "PAID", "INVOICED", "PARTIALLY_REFUNDED", "REFUNDED"];
const SOURCES: OrderSource[] = ["SINGLE", "SUBSCRIPTION", "CORPORATE", "ADMIN"];
const METHODS: PaymentMethod[] = ["ESEWA", "KHALTI", "BANK_TRANSFER", "CASH", "COMPANY_INVOICE", "WALLET"];

export function parseOrderFilters(sp: Record<string, string | string[] | undefined>, today = todayKTM()): OrderFilters {
  const one = (k: string) => {
    const v = sp[k];
    const s = (Array.isArray(v) ? v[0] : v)?.trim();
    return s ? s.slice(0, 200) : undefined;
  };
  const pick = <T extends string>(k: string, list: readonly T[]) => {
    const v = one(k);
    return v && (list as readonly string[]).includes(v) ? (v as T) : undefined;
  };
  let from = one("from");
  let to = one("to");
  if (!from || !isValidISODate(from)) from = today;
  if (!to || !isValidISODate(to)) to = addDays(from, 6);
  if (from > to) [from, to] = [to, from];
  if (addDays(from, 366) < to) to = addDays(from, 366);
  return {
    from,
    to,
    q: one("q"),
    status: pick("status", STATUSES),
    pay: pick("pay", PAYS),
    kitchen: one("kitchen"),
    zone: one("zone"),
    slot: one("slot"),
    source: pick("source", SOURCES),
    company: one("company"),
    method: pick("method", METHODS),
  };
}

/** Prisma where for the order list/export, limited to the actor's kitchens. Contact search needs customers.pii. */
export function orderWhere(actor: Actor, f: OrderFilters): Prisma.OrderWhereInput {
  const ids = scopeIds(actor);
  const kitchen = f.kitchen && inKitchenScope(actor, f.kitchen) ? { kitchenId: f.kitchen } : ids ? { kitchenId: { in: ids } } : {};
  const q = f.q?.trim();
  const pii = can(actor, "customers.pii");
  const digits = q?.replace(/\D/g, "") ?? "";
  return {
    deliveryDate: { gte: dateOnly(f.from), lte: dateOnly(f.to) },
    ...kitchen,
    ...(f.status ? { status: f.status } : {}),
    ...(f.pay ? { paymentStatus: f.pay } : {}),
    ...(f.zone ? { zoneId: f.zone } : {}),
    ...(f.slot ? { slotId: f.slot } : {}),
    ...(f.source ? { source: f.source } : {}),
    ...(f.company ? { companyId: f.company } : {}),
    ...(f.method ? { payment: { method: f.method } } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" as const } },
            { code: { equals: q.replace(/^#/, "").toUpperCase() } },
            { contactName: { contains: q, mode: "insensitive" as const } },
            { user: { name: { contains: q, mode: "insensitive" as const } } },
            { placeName: { contains: q, mode: "insensitive" as const } },
            { company: { name: { contains: q, mode: "insensitive" as const } } },
            ...(pii && digits.length >= 6 ? [{ contactPhone: { contains: digits.slice(-8) } }, { user: { phoneNumber: { contains: digits.slice(-8) } } }] : []),
            ...(pii && q.includes("@") ? [{ user: { email: { contains: q.toLowerCase() } } }] : []),
          ],
        }
      : {}),
  };
}

export function orderOrderBy(sort: OrderSort, dir: "asc" | "desc"): Prisma.OrderOrderByWithRelationInput[] {
  if (sort === "createdAt") return [{ createdAt: dir }];
  if (sort === "total") return [{ total: dir }, { createdAt: "desc" }];
  if (sort === "number") return [{ number: dir }];
  return [{ deliveryDate: dir }, { slotLabel: "asc" }, { createdAt: "desc" }];
}

export const orderListInclude = {
  items: { select: { name: true, quantity: true } },
  payment: { select: { method: true } },
  zone: { select: { name: true } },
  company: { select: { name: true } },
  kitchen: { select: { name: true } },
  user: { select: { name: true } },
} satisfies Prisma.OrderInclude;

export async function searchOrders(actor: Actor, f: OrderFilters, list: { sort: OrderSort; dir: "asc" | "desc"; skip: number; take: number }) {
  need(actor, "orders.view");
  const where = orderWhere(actor, f);
  const [rows, total, byStatus] = await Promise.all([
    db.order.findMany({ where, include: orderListInclude, orderBy: orderOrderBy(list.sort, list.dir), skip: list.skip, take: list.take }),
    db.order.count({ where }),
    db.order.groupBy({ by: ["status"], where: { ...where, status: undefined }, _count: true }),
  ]);
  return { rows, total, byStatus };
}

export const EXPORT_CAP = 5000;

/** CSV of the filtered orders. Needs orders.view + orders.export; contact details masked without customers.pii; audited. */
export async function exportOrdersCsv(actor: Actor, sp: Record<string, string | undefined>) {
  need(actor, "orders.view");
  need(actor, "orders.export");
  const f = parseOrderFilters(sp);
  const where = orderWhere(actor, f);
  const full = can(actor, "customers.pii");
  const [rows, matched] = await Promise.all([
    db.order.findMany({ where, include: { ...orderListInclude, user: { select: { name: true, email: true } } }, orderBy: orderOrderBy("deliveryDate", "asc"), take: EXPORT_CAP }),
    db.order.count({ where }),
  ]);
  const phone = (p: string | null | undefined) => (full ? formatNepalPhone(p) || p || "" : maskPhone(p));
  const email = (e: string | null | undefined) => (full ? (e ?? "") : maskEmail(e));
  const out: (string | number | null)[][] = [
    ["Order", "Code", "Delivery date", "Slot", "Kitchen", "Status", "Payment status", "Method", "Source", "Customer", "Email", "Receiver", "Phone", "Area", "Zone", "Company", "Dabbas", "Meals", "Subtotal", "Delivery", "Discount", "Tax", "Total", "Company share", "Customer share", "Refunded", "Created"],
  ];
  for (const o of rows) {
    out.push([
      o.number,
      o.code,
      isoDate(o.deliveryDate),
      o.slotLabel,
      o.kitchen.name,
      o.status,
      o.paymentStatus,
      o.payment?.method ?? "",
      o.source,
      o.user.name,
      email(o.user.email),
      o.contactName,
      phone(o.contactPhone),
      o.area,
      o.zone?.name ?? "",
      o.company?.name ?? "",
      o.items.map((i) => `${i.quantity}x ${i.name}`).join("; "),
      o.items.reduce((a, i) => a + i.quantity, 0),
      money(o.subtotal),
      money(o.deliveryFee),
      money(o.discount),
      money(o.tax),
      money(o.total),
      money(o.companyShare),
      money(o.customerShare),
      money(o.refundedAmount),
      o.createdAt.toISOString(),
    ]);
  }
  await audit({
    actorId: actor.id,
    action: "orders.export",
    entity: "Order",
    summary: `Orders ${f.from} → ${f.to}: ${rows.length} rows${rows.length < matched ? ` (capped, ${matched} matched)` : ""}${full ? "" : " · PII masked"}`,
    after: { filters: f, rows: rows.length, matched, piiMasked: !full },
  });
  return { filename: `dabbabela-orders-${f.from}-to-${f.to}.csv`, body: csv(out), rows: rows.length, matched };
}

// ───────────── order page extras ─────────────

/** Audit entries about this order (and its payment), newest first, for the order timeline. */
export async function orderAuditTrail(order: { id: string; paymentId: string | null }) {
  return db.auditLog.findMany({
    where: { OR: [{ entity: "Order", entityId: order.id }, ...(order.paymentId ? [{ entity: "Payment", entityId: order.paymentId }] : [])] },
    include: { actor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

/** What the order page needs to offer edits: whether the window is open, the day's menu and approved substitutions. */
export async function orderEditOptions(order: { id: string; status: OrderStatus; deliveryDate: Date; kitchenId: string; companyId: string | null; userId: string; items: { boxId: string | null }[] }) {
  const date = isoDate(order.deliveryDate);
  const [window, offers, subs, customer] = await Promise.all([
    staffEditWindow(order),
    getOffersForDates([date], order.kitchenId),
    db.boxSubstitution.findMany({
      where: { boxId: { in: order.items.map((i) => i.boxId).filter((x): x is string => Boolean(x)) }, isActive: true },
      include: { fromItem: { select: { name: true } }, toItem: { select: { name: true } } },
    }),
    db.user.findUnique({ where: { id: order.userId }, include: { addresses: { where: { archivedAt: null }, include: { zone: { select: { name: true, kitchenId: true } } } }, membership: { include: { company: true } } } }),
  ]);
  const offer = offers.get(date);
  return {
    window,
    menu: offer && !offer.closed ? offer.items.filter((i) => !i.soldOut).map((i) => ({ id: i.box.id, name: i.box.name, price: i.price })) : [],
    substitutions: subs.map((s) => ({ id: s.id, boxId: s.boxId, label: `${s.fromItem.name} → ${s.toItem.name}`, priceDelta: s.priceDelta })),
    addresses: (customer?.addresses ?? []).map((a) => ({ id: a.id, label: `${a.label} — ${a.line1}, ${a.area}${a.zone ? ` (${a.zone.name})` : " (not served)"}`, sameKitchen: !a.zone?.kitchenId || a.zone.kitchenId === order.kitchenId })),
    company: activeCompany(customer as Parameters<typeof activeCompany>[0])?.name ?? null,
  };
}

export { staffPaymentMethods };
