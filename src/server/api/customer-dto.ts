import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import type { CartQuote } from "@/server/orders";
import type { quoteSubscription } from "@/server/subscriptions";
import { ledgerReasonLabel } from "@/lib/ledger-labels";
import { db } from "@/lib/db";
import { ApiError, iso, notFound, ymd } from "./http";

/**
 * Customer DTOs for /api/v1 (explicit fields only — no internal notes, kitchen notes, actor ids, cost or attribution).
 * Money: integer paisa. Service dates: YYYY-MM-DD. Timestamps: ISO-8601.
 */

/** Turn a web-style `{ ok, message, errors }` result into the API error envelope (404 for "… not found"). */
export function throwIfFailed(r: { ok: boolean; message?: string; errors?: Record<string, string> }) {
  if (r.ok) return;
  const message = r.message ?? "Request rejected";
  if (/not found/i.test(message)) throw notFound(message);
  throw new ApiError(422, r.errors ? "VALIDATION_FAILED" : "REQUEST_REJECTED", message, r.errors);
}

/** 404 unless the order belongs to the caller (checked before any service call, so IDOR never reaches business logic). */
export async function assertOwnOrder(userId: string, orderId: string) {
  const o = await db.order.findFirst({ where: { id: orderId, userId }, select: { id: true, source: true, status: true } });
  if (!o) throw notFound("Order not found");
  return o;
}

export async function assertOwnSubscription(userId: string, subId: string) {
  const s = await db.subscription.findFirst({ where: { id: subId, userId }, select: { id: true, status: true } });
  if (!s) throw notFound("Plan not found");
  return s;
}

export async function assertOwnPayment(userId: string, paymentId: string) {
  const p = await db.payment.findFirst({ where: { id: paymentId, userId }, select: { id: true, purpose: true, status: true, method: true } });
  if (!p) throw notFound("Payment not found");
  return p;
}

type AddressRow =Prisma.AddressGetPayload<{ include: { zone: true } }>;

export function addressDto(a: AddressRow) {
  return {
    id: a.id,
    label: a.label,
    type: a.type,
    recipientName: a.recipientName,
    phone: a.phone,
    placeName: a.placeName,
    line1: a.line1,
    area: a.area,
    ward: a.ward,
    municipality: a.municipality,
    city: a.city,
    landmark: a.landmark,
    instructions: a.instructions,
    lat: a.lat,
    lng: a.lng,
    isDefault: a.isDefault,
    covered: Boolean(a.zone && a.zone.isActive),
    zone: a.zone ? { id: a.zone.id, name: a.zone.name } : null,
    createdAt: iso(a.createdAt),
  };
}

type OrderListRow = Prisma.OrderGetPayload<{ include: { items: { select: { name: true; quantity: true } }; payment: { select: { id: true; method: true; status: true } } } }>;

export function orderSummaryDto(o: OrderListRow) {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    paymentStatus: o.paymentStatus,
    source: o.source,
    deliveryDate: ymd(o.deliveryDate),
    slotLabel: o.slotLabel,
    placeName: o.placeName,
    area: o.area,
    total: o.total,
    customerShare: o.customerShare,
    companyShare: o.companyShare,
    subscriptionId: o.subscriptionId,
    items: o.items.map((i) => ({ name: i.name, quantity: i.quantity })),
    payment: o.payment ? { id: o.payment.id, method: o.payment.method, status: o.payment.status } : null,
    /** Hand-off code the rider asks for — shown only while the order is out for delivery (same as the website). */
    deliveryOtp: o.status === "OUT_FOR_DELIVERY" ? o.deliveryOtp : null,
    createdAt: iso(o.createdAt),
  };
}

export function paymentBriefDto(p: { id: string; reference: string; method: string; status: string; amount: number; purpose?: string }) {
  return { id: p.id, reference: p.reference, method: p.method, status: p.status, amount: p.amount, purpose: p.purpose ?? "ORDER" };
}

export function ledgerDto(r: { id: string; amount: number; reason: string; note: string | null; orderId: string | null; paymentId?: string | null; createdAt: Date }) {
  return { id: r.id, amount: r.amount, reason: r.reason, reasonLabel: ledgerReasonLabel(r.reason), note: r.note, orderId: r.orderId, paymentId: r.paymentId ?? null, createdAt: iso(r.createdAt) };
}

export function cartQuoteDto(q: CartQuote) {
  return {
    ok: q.ok && !q.addressProblem,
    error: q.error,
    addressProblem: q.addressProblem,
    lines: q.lines.map((l) => ({
      key: `${l.kind}:${l.id}:${l.date}:${[...(l.subs ?? [])].sort().join("+")}`,
      kind: l.kind,
      id: l.id,
      date: l.date,
      qty: l.qty,
      subs: l.subs ?? [],
      name: l.name,
      details: l.details,
      unitPrice: l.unitPrice,
      diet: l.diet,
      allergens: l.allergens,
      customizations: l.customizations.map((c) => c.label),
      problem: l.problem,
      warning: l.warning,
    })),
    days: q.days.map((d) => ({ date: d.date, subtotal: d.subtotal, deliveryFee: d.deliveryFee, discount: d.discount, tax: d.tax, total: d.total, companyShare: d.companyShare, customerShare: d.customerShare })),
    subtotal: q.subtotal,
    deliveryFee: q.deliveryFee,
    companyDiscount: q.companyDiscount,
    couponDiscount: q.couponDiscount,
    tax: q.tax,
    taxInclusive: q.taxInclusive,
    total: q.total,
    companyShare: q.companyShare,
    customerShare: q.customerShare,
    couponCode: q.couponCode,
    couponError: q.couponError,
    company: q.company ? { name: q.company.name, billingMode: q.company.billingMode } : null,
    kitchenId: q.kitchenId,
  };
}

export function planQuoteDto(q: Awaited<ReturnType<typeof quoteSubscription>>) {
  return {
    ok: !q.error && !q.addressProblem,
    error: q.error,
    addressProblem: q.addressProblem,
    meals: q.meals.map((m) => ({ date: m.date, name: m.name, price: m.price, surcharge: m.surcharge, followsRotation: m.followsRotation, problem: m.problem, boxId: m.boxId ?? null, customBoxId: m.customBoxId ?? null })),
    skippedDates: q.skippedDates,
    closures: q.closures,
    mealsTotal: q.mealsTotal,
    perMealEffective: q.perMealEffective,
    subtotal: q.subtotal,
    deliveryFee: q.deliveryFee,
    discount: q.discount,
    couponDiscount: q.couponDiscount,
    companyDiscount: q.companyDiscount,
    tax: q.tax,
    taxInclusive: q.taxInclusive,
    total: q.total,
    companyShare: q.companyShare,
    customerShare: q.customerShare,
    savings: q.savings,
    endDate: q.endDate ?? null,
    couponCode: q.couponCode,
    couponError: q.couponError,
  };
}

/** What the app does next after a purchase: open the payment (gateway / bank proof) or show the confirmation. */
export function nextStep(needsPayment: boolean) {
  return needsPayment ? ("PAY" as const) : ("DONE" as const);
}

export const PAYMENT_METHODS = ["ESEWA", "KHALTI", "BANK_TRANSFER", "CASH", "COMPANY_INVOICE", "WALLET"] as const;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Address input (validated by the shared rules in src/server/addresses.ts; messages match the website). */
export const addressInput = z.object({
  label: z.string().max(40).optional(),
  type: z.enum(["HOME", "OFFICE", "SHOP", "COLLEGE", "SITE", "OTHER"]).optional(),
  recipientName: z.string().max(80).optional(),
  phone: z.string().max(20).optional(),
  placeName: z.string().max(120).nullable().optional(),
  line1: z.string().max(200).optional(),
  area: z.string().max(80).optional(),
  ward: z.number().int().nullable().optional(),
  municipality: z.string().max(80).nullable().optional(),
  city: z.string().max(60).optional(),
  landmark: z.string().max(160).nullable().optional(),
  instructions: z.string().max(300).nullable().optional(),
  /** Optional map pin: both or neither, inside Nepal. */
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  isDefault: z.boolean().optional(),
});

/** One cart line: a menu box (`kind: "box"`, id = LunchBox id) or a saved Build-a-Dabba (`custom`, id = CustomBox id). */
export const cartLine = z.object({ kind: z.enum(["box", "custom"]), id: z.string().min(1).max(64), date: z.string().max(10), qty: z.number().int().min(1).max(25), subs: z.array(z.string().max(64)).max(4).optional() });

/** Plan input (POST /subscriptions/quote and POST /subscriptions). */
export const planInput = z.object({
  planId: z.string().min(1).max(64),
  startDate: z.string().regex(ISO_DATE, "Use YYYY-MM-DD"),
  days: z.array(z.enum(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"])).min(1).max(7),
  weeks: z.number().int().min(1).max(26).nullable().optional(),
  picks: z.record(z.string(), z.object({ boxId: z.string().max(64).optional(), customBoxId: z.string().max(64).optional() })).optional(),
  vegOnly: z.boolean().optional(),
  addressId: z.string().max(64).nullable().optional(),
  couponCode: z.string().max(30).nullable().optional(),
});

