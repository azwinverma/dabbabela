"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PaymentMethod, Weekday } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { log } from "@/lib/logger";
import { done, fail, type ActionResult } from "@/lib/action";
import { str } from "@/lib/utils";
import { OrderError } from "@/server/orders";
import { CapacityError } from "@/server/capacity";
import { addMealToPlan, createSubscription, quoteAddMeal, quoteSubscription, renewSubscription, swapMeal, type PlanInput } from "@/server/subscriptions";
import type { PlanQuoteDTO } from "./shop";

/**
 * Customer plan actions (WP-06): quote/subscribe with a chosen length, swap a day's dabba, add a meal, renew.
 * The user always comes from the session and every service call is scoped to that user's own subscriptions/meals.
 */

const METHODS: PaymentMethod[] = ["ESEWA", "KHALTI", "BANK_TRANSFER", "CASH", "COMPANY_INVOICE", "WALLET"];
const WEEKDAYS: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function errText(e: unknown, fallback = "Something went wrong — please try again") {
  if (e instanceof OrderError || e instanceof CapacityError) return e.message;
  if (e instanceof Error && e.message && e.message.length < 200 && !/prisma|invocation/i.test(e.message)) return e.message;
  log.error("plans.action_failed", { error: e });
  return fallback;
}

const planSchema = z.object({
  planId: z.string().min(1),
  startDate: z.string().regex(ISO),
  days: z.array(z.enum(WEEKDAYS as [Weekday, ...Weekday[]])).min(1).max(7),
  weeks: z.number().int().min(1).max(26).nullable().optional(),
  picks: z.record(z.string(), z.object({ boxId: z.string().optional(), customBoxId: z.string().optional() })).optional(),
  vegOnly: z.boolean().optional(),
  addressId: z.string().nullable().optional(),
  couponCode: z.string().max(30).nullable().optional(),
});

/** Plan quote that honours the plan's min/max weeks (the shop action uses the default length only). */
export async function quotePlanLengthAction(input: z.input<typeof planSchema>): Promise<PlanQuoteDTO | { ok: false; error: string }> {
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

export async function subscribePlanAction(
  input: z.input<typeof planSchema> & { addressId: string; slotId?: string | null; method: PaymentMethod; notes?: string | null; idempotencyKey: string },
): Promise<{ ok: boolean; error?: string; redirectTo?: string; data?: { paymentId: string } }> {
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

// ───────── swap · add a meal · renew ─────────

export async function swapMealAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return fail("Log in first");
  const orderId = str(fd.get("orderId"));
  const boxId = str(fd.get("boxId"));
  if (!orderId || !boxId) return fail("Pick a dabba");
  try {
    const r = await swapMeal(orderId, boxId, { id: user.id, isStaff: false }, user.id);
    revalidatePath("/account", "layout");
    if (!r.changed) return done("That's already your dabba for the day");
    const money = r.delta > 0 ? (r.settlement === "WALLET_CHARGE" ? ` — Rs ${(r.delta / 100).toFixed(0)} taken from your credit` : ` — Rs ${(r.delta / 100).toFixed(0)} more, paid with the rest of your plan`) : r.delta < 0 ? (r.settlement === "WALLET_CREDIT" ? ` — Rs ${(-r.delta / 100).toFixed(0)} added to your credit` : ` — Rs ${(-r.delta / 100).toFixed(0)} less to pay`) : "";
    return done(`Swapped${money}`);
  } catch (e) {
    return fail(errText(e, "We couldn't swap that meal"));
  }
}

export type AddMealQuoteDTO = { ok: true; unitPrice: number; deliveryFee: number; tax: number; total: number; taxInclusive: boolean; name: string } | { ok: false; error: string };

export async function quoteAddMealAction(input: { subscriptionId: string; date: string; boxId: string }): Promise<AddMealQuoteDTO> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Log in first" };
  if (!ISO.test(input.date ?? "") || !input.boxId) return { ok: false, error: "Pick a day and a dabba" };
  try {
    const q = await quoteAddMeal(user, input.subscriptionId, { date: input.date, boxId: input.boxId });
    return { ok: true, unitPrice: q.unitPrice, deliveryFee: q.priced.deliveryFee, tax: q.priced.tax, total: q.priced.total, taxInclusive: q.tax?.inclusive ?? true, name: q.pick.box.name };
  } catch (e) {
    return { ok: false, error: errText(e, "We couldn't price that meal") };
  }
}

export async function addMealAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return fail("Log in first");
  const subId = str(fd.get("subscriptionId"));
  const date = str(fd.get("date"));
  const boxId = str(fd.get("boxId"));
  const method = str(fd.get("method")) as PaymentMethod;
  if (!ISO.test(date) || !boxId) return fail("Pick a day and a dabba");
  if (!METHODS.includes(method)) return fail("Choose how to pay");
  try {
    const r = await addMealToPlan(user, subId, { date, boxId, method, idempotencyKey: str(fd.get("idempotencyKey")) });
    revalidatePath("/account", "layout");
    return done("Meal added", r.needsPayment ? `/pay/${r.payment.id}` : `/thank-you/${r.payment.id}`);
  } catch (e) {
    return fail(errText(e, "We couldn't add that meal"));
  }
}

export async function renewPlanAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return fail("Log in first");
  const method = str(fd.get("method")) as PaymentMethod;
  if (!METHODS.includes(method)) return fail("Choose how to pay");
  const weeks = parseInt(str(fd.get("weeks")), 10);
  try {
    const r = await renewSubscription(user, str(fd.get("id")), { method, idempotencyKey: str(fd.get("idempotencyKey")) || null, weeks: Number.isFinite(weeks) ? weeks : null });
    revalidatePath("/account", "layout");
    return done(r.replayed ? "This plan is already renewed" : "Renewed", r.needsPayment ? `/pay/${r.payment.id}` : `/account/plans/${r.subscription.id}`);
  } catch (e) {
    return fail(errText(e, "We couldn't renew this plan"));
  }
}
