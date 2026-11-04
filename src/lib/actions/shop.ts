"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PaymentMethod, Weekday } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";
import { storeUpload } from "@/lib/upload";
import { log } from "@/lib/logger";
import { done, fail, type ActionResult } from "@/lib/action";
import { str } from "@/lib/utils";
import { quoteCart, placeCartOrder, OrderError, type CartLine } from "@/server/orders";
import { quoteSubscription, createSubscription, type PlanInput } from "@/server/subscriptions";
import { startPayment, switchPaymentMethod, submitTransferProof, PaymentError, type StartResult } from "@/server/payments";
import { priceCustomBox, type CustomPick } from "@/server/builder";
import { CapacityError } from "@/server/capacity";

type Result<T = unknown> = { ok: boolean; error?: string; fieldErrors?: Record<string, string>; redirectTo?: string; data?: T };

const METHODS: PaymentMethod[] = ["ESEWA", "KHALTI", "BANK_TRANSFER", "CASH", "COMPANY_INVOICE", "WALLET"];
const WEEKDAYS: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function errText(e: unknown, fallback = "Something went wrong — please try again") {
  if (e instanceof OrderError || e instanceof PaymentError || e instanceof CapacityError) return e.message;
  if (e instanceof Error && e.message && e.message.length < 200 && !/prisma|invocation/i.test(e.message)) return e.message;
  log.error("shop.action_failed", { error: e });
  return fallback;
}

// ───────── cart quote ─────────

export type CartQuoteDTO = {
  ok: boolean;
  error: string | null;
  addressProblem: string | null;
  lines: { key: string; kind: "box" | "custom"; id: string; date: string; qty: number; name: string; details: string | null; unitPrice: number; diet: string; allergens: string[]; customizations: string[]; problem: string | null; warning: string | null }[];
  days: { date: string; subtotal: number; deliveryFee: number; discount: number; tax: number; total: number; companyShare: number; customerShare: number }[];
  subtotal: number;
  deliveryFee: number;
  companyDiscount: number;
  couponDiscount: number;
  tax: number;
  taxInclusive: boolean;
  total: number;
  companyShare: number;
  customerShare: number;
  couponCode: string | null;
  couponError: string | null;
  company: { name: string; billingMode: string } | null;
  kitchenId: string | null;
};

export async function quoteCartAction(input: { lines: CartLine[]; addressId?: string | null; couponCode?: string | null }): Promise<CartQuoteDTO> {
  const user = await getCurrentUser();
  const q = await quoteCart(user, { lines: input.lines, addressId: input.addressId ?? null, couponCode: input.couponCode ?? null });
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

const placeSchema = z.object({
  lines: z.array(z.object({ kind: z.enum(["box", "custom"]), id: z.string().min(1), date: z.string(), qty: z.number().int().min(1).max(25), subs: z.array(z.string()).max(4).optional() })).min(1).max(60),
  addressId: z.string().min(1, "Choose a delivery address"),
  slotId: z.string().nullable().optional(),
  couponCode: z.string().max(30).nullable().optional(),
  method: z.enum(METHODS as [PaymentMethod, ...PaymentMethod[]]),
  notes: z.string().max(500).nullable().optional(),
  idempotencyKey: z.string().min(8).max(80),
});

export async function placeOrderAction(input: z.input<typeof placeSchema>): Promise<Result<{ paymentId: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Log in to place your order", redirectTo: "/login?next=/checkout" };
  const p = placeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check your order" };
  try {
    const res = await placeCartOrder(user, { ...p.data, slotId: p.data.slotId || null, couponCode: p.data.couponCode || null });
    revalidatePath("/account", "layout");
    const pay = res.payment;
    const needsPayment = "needsPayment" in res ? res.needsPayment : pay.status === "PENDING" && pay.method !== "CASH";
    return { ok: true, data: { paymentId: pay.id }, redirectTo: needsPayment ? `/pay/${pay.id}` : `/thank-you/${pay.id}` };
  } catch (e) {
    return { ok: false, error: errText(e, "We couldn't place your order") };
  }
}

// ───────── plans ─────────

const planSchema = z.object({
  planId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.array(z.enum(WEEKDAYS as [Weekday, ...Weekday[]])).min(1).max(7),
  picks: z.record(z.string(), z.object({ boxId: z.string().optional(), customBoxId: z.string().optional() })).optional(),
  vegOnly: z.boolean().optional(),
  addressId: z.string().nullable().optional(),
  couponCode: z.string().max(30).nullable().optional(),
});

export type PlanQuoteDTO = {
  ok: boolean;
  error: string | null;
  addressProblem: string | null;
  meals: { date: string; name: string; price: number; surcharge: number; followsRotation: boolean; problem: string | null; boxId: string | null; customBoxId: string | null }[];
  skippedDates: string[];
  closures: { date: string; name: string }[];
  mealsTotal: number;
  perMealEffective: number;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  couponDiscount: number;
  companyDiscount: number;
  tax: number;
  taxInclusive: boolean;
  total: number;
  companyShare: number;
  customerShare: number;
  savings: number;
  endDate: string | null;
  couponCode: string | null;
  couponError: string | null;
};

export async function quotePlanAction(input: z.input<typeof planSchema>): Promise<PlanQuoteDTO | { ok: false; error: string }> {
  const user = await getCurrentUser();
  const p = planSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the plan details" };
  try {
    const q = await quoteSubscription(user, { ...p.data, addressId: p.data.addressId ?? null, couponCode: p.data.couponCode ?? null } as PlanInput);
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
  } catch (e) {
    return { ok: false, error: errText(e, "We couldn't price that plan") };
  }
}

export async function subscribeAction(
  input: z.input<typeof planSchema> & { addressId: string; slotId?: string | null; method: PaymentMethod; notes?: string | null; idempotencyKey: string },
): Promise<Result<{ paymentId: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Log in to start a plan", redirectTo: "/login?next=/plans" };
  const p = planSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the plan details" };
  if (!input.addressId) return { ok: false, error: "Choose a delivery address" };
  if (!METHODS.includes(input.method)) return { ok: false, error: "Choose how to pay" };
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) return { ok: false, error: "Please refresh and try again" };
  try {
    const r = await createSubscription(user, {
      ...p.data,
      addressId: input.addressId,
      slotId: input.slotId || null,
      method: input.method,
      notes: input.notes ?? null,
      couponCode: p.data.couponCode || null,
      idempotencyKey: input.idempotencyKey,
    } as Parameters<typeof createSubscription>[1]);
    revalidatePath("/account", "layout");
    return { ok: true, data: { paymentId: r.payment.id }, redirectTo: r.needsPayment ? `/pay/${r.payment.id}` : `/thank-you/${r.payment.id}` };
  } catch (e) {
    return { ok: false, error: errText(e, "We couldn't start your plan") };
  }
}

// ───────── payment ─────────

export async function startPaymentAction(paymentId: string): Promise<{ ok: boolean; error?: string; start?: StartResult }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Log in to pay" };
  try {
    return { ok: true, start: await startPayment(paymentId, user.id, await siteUrl()) };
  } catch (e) {
    return { ok: false, error: errText(e, "We couldn't reach the payment provider — try again or pick another method") };
  }
}

export async function switchMethodAction(paymentId: string, method: PaymentMethod): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Log in first" };
  if (!METHODS.includes(method)) return { ok: false, error: "Choose a payment method" };
  try {
    await switchPaymentMethod(paymentId, user.id, method);
    revalidatePath(`/pay/${paymentId}`);
    const p = await db.payment.findUnique({ where: { id: paymentId }, select: { status: true, method: true } });
    const settled = p?.status === "PAID" || p?.method === "CASH";
    return { ok: true, redirectTo: settled ? `/thank-you/${paymentId}` : `/pay/${paymentId}` };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

export async function uploadProofAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return fail("Log in first");
  const paymentId = str(fd.get("paymentId"));
  const reference = str(fd.get("reference"));
  const file = fd.get("proof");
  if (!(file instanceof File) || !file.size) return fail("Attach the screenshot or receipt", { proof: "Required" });
  if (reference.length < 3) return fail("Enter the transaction reference from your bank app", { reference: "Required" });
  try {
    const up = await storeUpload(file, { allowPdf: true, folder: "payment-proofs" });
    await submitTransferProof(paymentId, user.id, up.url, reference);
    revalidatePath(`/pay/${paymentId}`);
    return done("Thanks — we'll confirm your payment shortly. Your order is saved.");
  } catch (e) {
    return fail(errText(e, "Upload failed — try again"));
  }
}

// ───────── saved Build-a-Dabba boxes ─────────

const pickSchema = z.array(z.object({ menuItemId: z.string().min(1), qty: z.number().int().min(1).max(5) }).passthrough()).min(1).max(15);

export async function saveCustomBoxAction(input: { name: string; items: CustomPick[]; id?: string }): Promise<Result<{ id: string; price: number; name: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Log in to save your dabba", redirectTo: "/login?next=/build" };
  const items = pickSchema.safeParse(input.items);
  if (!items.success) return { ok: false, error: "Add something to your dabba first" };
  const settings = await getSettings();
  const priced = await priceCustomBox(items.data.map((i) => ({ menuItemId: i.menuItemId, qty: i.qty })), settings);
  if (priced.problem) return { ok: false, error: priced.problem };
  const name = (input.name || "My dabba").trim().slice(0, 60);
  const data = { name, items: priced.picks, price: priced.price };
  if (!input.id && (await db.customBox.count({ where: { userId: user.id } })) >= 12) return { ok: false, error: "You can keep up to 12 saved dabbas — delete one first" };
  const box = input.id ? await db.customBox.update({ where: { id: input.id, userId: user.id }, data }) : await db.customBox.create({ data: { ...data, userId: user.id } });
  revalidatePath("/account/boxes");
  return { ok: true, data: { id: box.id, price: box.price, name: box.name } };
}

export async function deleteCustomBoxAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Log in first" };
  const used = await db.subscription.findFirst({ where: { userId: user.id, status: { in: ["ACTIVE", "PAUSED", "PENDING_PAYMENT"] }, orders: { some: { items: { some: { customBoxId: id } }, status: { in: ["SCHEDULED", "PENDING_PAYMENT"] } } } } });
  if (used) return { ok: false, message: "This dabba is booked in an active plan — it stays until those days pass" };
  await db.customBox.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/account/boxes");
  return { ok: true };
}

export async function renameCustomBoxAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return fail("Log in first");
  const name = str(fd.get("name")).slice(0, 60);
  if (name.length < 2) return fail("Give it a name");
  await db.customBox.updateMany({ where: { id: str(fd.get("id")), userId: user.id }, data: { name } });
  revalidatePath("/account/boxes");
  return done("Renamed");
}
