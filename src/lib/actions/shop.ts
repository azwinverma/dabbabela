"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import type { PaymentMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { siteUrl } from "@/lib/site-url";
import { storeUpload } from "@/lib/upload";
import { log } from "@/lib/logger";
import { LIMITS, rateLimit, requestIp } from "@/lib/rate-limit";
import { done, fail, type ActionResult } from "@/lib/action";
import { str } from "@/lib/utils";
import { quoteCart, placeCartOrder, OrderError, type CartLine } from "@/server/orders";
import { startPayment, switchPaymentMethod, submitTransferProof, PaymentError, type StartResult } from "@/server/payments";
import type { CustomPick } from "@/server/builder";
import { CustomBoxError, deleteCustomBox, saveBuiltBox, updateBuiltBox } from "@/server/custom-boxes";
import { CapacityError } from "@/server/capacity";
import { assertCustomerCanOrder, campaignIdFor, CrmError } from "@/server/crm";
import { orderTouch, readAttribution } from "@/lib/attribution";

type Result<T = unknown> = { ok: boolean; error?: string; fieldErrors?: Record<string, string>; redirectTo?: string; data?: T };

const METHODS: PaymentMethod[] = ["ESEWA", "KHALTI", "BANK_TRANSFER", "CASH", "COMPANY_INVOICE", "WALLET"];

const SLOW_DOWN = "Too many attempts — wait a minute and try again";

/** Per-user limits on checkout / payment actions (LIMITS in src/lib/rate-limit.ts). */
async function perUser(name: "checkout" | "payStart" | "proofUpload", userId: string) {
  return rateLimit(`shop:${name}`, userId, LIMITS[name].max, LIMITS[name].windowMs);
}

/** Peek at the wrong-coupon counter for this IP without counting a hit. */
async function couponAttemptsLeft() {
  const row = await db.rateLimit.findUnique({ where: { key: `rl:shop:coupon-fail:${await requestIp()}` } });
  if (!row || Date.now() - Number(row.lastRequest) > LIMITS.couponFail.windowMs) return true;
  return row.count < LIMITS.couponFail.max;
}

async function recordCouponFailure() {
  await rateLimit("shop:coupon-fail", await requestIp(), LIMITS.couponFail.max, LIMITS.couponFail.windowMs);
}

function errText(e: unknown, fallback = "Something went wrong — please try again") {
  if (e instanceof OrderError || e instanceof PaymentError || e instanceof CapacityError || e instanceof CrmError) return e.message;
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
  let couponCode = input.couponCode ?? null;
  // Coupon guessing: after LIMITS.couponFail wrong codes per IP in the window, codes are no longer checked.
  const couponBlocked = Boolean(couponCode) && !(await couponAttemptsLeft());
  if (couponBlocked) couponCode = null;
  const q = await quoteCart(user, { lines: input.lines, addressId: input.addressId ?? null, couponCode });
  if (couponBlocked) q.couponError = "Too many coupon attempts — try again in a few minutes";
  else if (couponCode && q.couponError) await recordCouponFailure();
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

/** Last (else first) marketing touch from the consented attribution cookies, for Order.attribution / campaignId (WP-11). */
async function checkoutAttribution() {
  try {
    const touch = orderTouch(readAttribution(await cookies()));
    if (!touch) return null;
    return { ...touch, campaignId: await campaignIdFor(touch.campaign) };
  } catch {
    return null;
  }
}

export async function placeOrderAction(input: z.input<typeof placeSchema>): Promise<Result<{ paymentId: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Log in to place your order", redirectTo: "/login?next=/checkout" };
  if (!(await perUser("checkout", user.id))) return { ok: false, error: SLOW_DOWN };
  const p = placeSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check your order" };
  try {
    await assertCustomerCanOrder(user.id);
    const res = await placeCartOrder(user, { ...p.data, slotId: p.data.slotId || null, couponCode: p.data.couponCode || null, attribution: await checkoutAttribution() });
    revalidatePath("/account", "layout");
    const pay = res.payment;
    const needsPayment = "needsPayment" in res ? res.needsPayment : pay.status === "PENDING" && pay.method !== "CASH";
    return { ok: true, data: { paymentId: pay.id }, redirectTo: needsPayment ? `/pay/${pay.id}` : `/thank-you/${pay.id}` };
  } catch (e) {
    return { ok: false, error: errText(e, "We couldn't place your order") };
  }
}

// ───────── plans ─────────

/** Plan quote shape returned by `quotePlanLengthAction` (src/lib/actions/plans.ts, WP-06), which replaced the old shop plan actions. */
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

// ───────── payment ─────────

export async function startPaymentAction(paymentId: string): Promise<{ ok: boolean; error?: string; start?: StartResult }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Log in to pay" };
  if (!(await perUser("payStart", user.id))) return { ok: false, error: SLOW_DOWN };
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
  if (!(await perUser("payStart", user.id))) return { ok: false, error: SLOW_DOWN };
  try {
    await switchPaymentMethod(paymentId, user.id, method);
    revalidatePath(`/pay/${paymentId}`);
    const p = await db.payment.findFirst({ where: { id: paymentId, userId: user.id }, select: { status: true, method: true } });
    const settled = p?.status === "PAID" || p?.method === "CASH";
    return { ok: true, redirectTo: settled ? `/thank-you/${paymentId}` : `/pay/${paymentId}` };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

export async function uploadProofAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return fail("Log in first");
  if (!(await perUser("proofUpload", user.id))) return fail(SLOW_DOWN);
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

const pickSchema = z.array(z.object({ menuItemId: z.string().min(1), qty: z.number().int().min(1).max(5), portionId: z.string().max(64).nullable().optional() })).min(1).max(15);

export async function saveCustomBoxAction(input: { name: string; items: CustomPick[]; id?: string }): Promise<Result<{ id: string; price: number; name: string }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Log in to save your dabba", redirectTo: "/login?next=/build" };
  const items = pickSchema.safeParse(input.items);
  if (!items.success) return { ok: false, error: "Add something to your dabba first" };
  const picks = items.data.map((i) => ({ menuItemId: i.menuItemId, qty: i.qty, portionId: typeof i.portionId === "string" && i.portionId ? i.portionId : null }));
  try {
    const name = (input.name || "My dabba").trim().slice(0, 60);
    const box = input.id ? await updateBuiltBox(user.id, input.id, { name: name.length >= 2 ? name : undefined, picks }) : await saveBuiltBox(user.id, { name, picks });
    revalidatePath("/account/boxes");
    return { ok: true, data: { id: box.id, price: box.price, name: box.name } };
  } catch (e) {
    if (e instanceof CustomBoxError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function deleteCustomBoxAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, message: "Log in first" };
  try {
    await deleteCustomBox(user.id, String(id));
  } catch (e) {
    if (e instanceof CustomBoxError) return { ok: false, message: e.message };
    throw e;
  }
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
