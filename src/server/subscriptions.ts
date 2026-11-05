import type { MealPlan, Order, PaymentMethod, Prisma, Weekday } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { addDays, dateOnly, isoDate, ktmNow, todayKTM, weekdayOf, WEEKDAYS } from "@/lib/dates";
import { randomCode } from "@/lib/utils";
import { rs } from "@/lib/money";
import { activeCompany, type CurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { changeWindowOpen, dateProblem, getClosures, getLockedDates, nextServiceDates, planDatesFrom } from "./calendar";
import { boxComponents, boxFacts, getOffersForDates, rotationPick, type DayOffer } from "./menu";
import { priceDays, taxFor, type CompanySpec } from "./pricing";
import { checkCoupon, redeemCoupon } from "./coupons";
import { assertDayCapacity, CapacityError, lockKitchenDay } from "./capacity";
import { addCredit, spendCredit, walletBalance } from "./ledger";
import { availableMethods } from "./payments/methods";
import { companySpecFor } from "./corporate";
import { priceCustomBox, type CustomPick } from "./builder";
import { bumpPaymentRefund, handoffOtp, initialState, orderNumber, OrderError, paymentRef, setOrderStatus, taxRuleFor } from "./orders";
import { LIVE_STATUSES } from "./transitions";
import { notify } from "./notify";

type Tx = Prisma.TransactionClient;

export type DayPick = { boxId?: string; customBoxId?: string };

export type PlanInput = {
  planId: string;
  startDate: string;
  days: Weekday[];
  /** Plan length in weeks; must sit inside the plan's min/max weeks. Defaults to the plan's own length. */
  weeks?: number | null;
  /** Calendar picks keyed by ISO date; dates without a pick follow the chef's rotation. */
  picks?: Record<string, DayPick>;
  vegOnly?: boolean;
  addressId?: string | null;
  zoneId?: string | null;
  couponCode?: string | null;
};

// ───────────── versioned plan pricing ─────────────
//
// MealPlanPrice rows are effective-dated. A sale uses the row effective on the purchase date (Kathmandu) and stores
// Subscription.priceId + pricePerMeal, so a later price change never touches existing subscriptions or their meals.
// MealPlan.pricePerMeal / compareAtPrice are a mirror of the current row for pages that read the plan directly.

export type PlanPrice = { id: string | null; pricePerMeal: number; compareAtPrice: number | null; effectiveFrom: string | null; effectiveTo: string | null };

/** Price row effective on `date` (latest effectiveFrom, then latest created). Falls back to the plan's own fields. */
export async function planPriceOn(plan: Pick<MealPlan, "id" | "pricePerMeal" | "compareAtPrice">, date: string = todayKTM(), client: Tx | typeof db = db): Promise<PlanPrice> {
  const d = dateOnly(date);
  const row = await client.mealPlanPrice.findFirst({
    where: { planId: plan.id, effectiveFrom: { lte: d }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: d } }] },
    orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
  });
  if (!row) return { id: null, pricePerMeal: plan.pricePerMeal, compareAtPrice: plan.compareAtPrice, effectiveFrom: null, effectiveTo: null };
  return { id: row.id, pricePerMeal: row.pricePerMeal, compareAtPrice: row.compareAtPrice, effectiveFrom: isoDate(row.effectiveFrom), effectiveTo: row.effectiveTo ? isoDate(row.effectiveTo) : null };
}

/** Bring MealPlan.pricePerMeal/compareAtPrice in line with today's price row (a scheduled change becomes current). */
export async function syncPlanPriceMirrors(planIds?: string[]) {
  const plans = await db.mealPlan.findMany({ where: planIds ? { id: { in: planIds } } : {}, select: { id: true, pricePerMeal: true, compareAtPrice: true } });
  let changed = 0;
  for (const p of plans) {
    const now = await planPriceOn(p);
    if (now.id && (now.pricePerMeal !== p.pricePerMeal || now.compareAtPrice !== p.compareAtPrice)) {
      await db.mealPlan.updateMany({ where: { id: p.id, pricePerMeal: p.pricePerMeal }, data: { pricePerMeal: now.pricePerMeal, compareAtPrice: now.compareAtPrice } });
      changed++;
    }
  }
  return changed;
}

/**
 * Record a new price for a plan from `effectiveFrom` (today or later — history is never rewritten).
 * The row open at that date is closed the day before; unused rows scheduled on/after it are replaced.
 * Rows already used by a subscription are never deleted or edited (except closing their end date).
 */
export async function changePlanPrice(planId: string, input: { pricePerMeal: number; compareAtPrice: number | null; effectiveFrom?: string | null; reason?: string | null }, actorId: string | null) {
  const today = todayKTM();
  const from = input.effectiveFrom || today;
  if (from < today) throw new OrderError("A price change can't start in the past — existing sales keep their price");
  if (!Number.isInteger(input.pricePerMeal) || input.pricePerMeal <= 0) throw new OrderError("Price must be above zero");
  if (input.compareAtPrice != null && input.compareAtPrice < input.pricePerMeal) throw new OrderError("Compare-at should be the regular (higher) price");
  const plan = await db.mealPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new OrderError("Plan not found");
  const before = await planPriceOn(plan, from);
  if (before.id && before.pricePerMeal === input.pricePerMeal && before.compareAtPrice === input.compareAtPrice && before.effectiveFrom === from) return { price: await db.mealPlanPrice.findUniqueOrThrow({ where: { id: before.id } }), unchanged: true };
  const price = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`planprice:${planId}`}))`;
    const fromD = dateOnly(from);
    const later = await tx.mealPlanPrice.findMany({ where: { planId, effectiveFrom: { gte: fromD } }, include: { _count: { select: { subscriptions: true } } } });
    for (const r of later) {
      if (r._count.subscriptions === 0) await tx.mealPlanPrice.delete({ where: { id: r.id } });
      else await tx.mealPlanPrice.update({ where: { id: r.id }, data: { effectiveTo: dateOnly(addDays(from, -1)) } });
    }
    await tx.mealPlanPrice.updateMany({ where: { planId, effectiveFrom: { lt: fromD }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: fromD } }] }, data: { effectiveTo: dateOnly(addDays(from, -1)) } });
    const row = await tx.mealPlanPrice.create({ data: { planId, pricePerMeal: input.pricePerMeal, compareAtPrice: input.compareAtPrice, effectiveFrom: fromD, createdById: actorId } });
    if (from <= today) await tx.mealPlan.update({ where: { id: planId }, data: { pricePerMeal: input.pricePerMeal, compareAtPrice: input.compareAtPrice } });
    return row;
  });
  await audit({
    actorId,
    action: "plan.price_change",
    entity: "MealPlan",
    entityId: planId,
    summary: `${plan.name}: ${rs(before.pricePerMeal)} → ${rs(input.pricePerMeal)} per meal from ${from}`,
    reason: input.reason ?? null,
    before: { pricePerMeal: before.pricePerMeal, compareAtPrice: before.compareAtPrice, priceId: before.id },
    after: { pricePerMeal: input.pricePerMeal, compareAtPrice: input.compareAtPrice, effectiveFrom: from, priceId: price.id },
  });
  return { price, unchanged: false };
}

/** All price versions of a plan, newest first, with how many subscriptions were sold at each. */
export async function planPriceHistory(planId: string) {
  return db.mealPlanPrice.findMany({ where: { planId }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }], include: { _count: { select: { subscriptions: true } } } });
}

// ───────────── per-plan policies ─────────────

export type SkipPolicy = "EXTEND" | "CREDIT";
export type CancelPolicy = "CREDIT" | "REFUND" | "STAFF_ONLY";
export const CANCEL_POLICIES: CancelPolicy[] = ["CREDIT", "REFUND", "STAFF_ONLY"];

/** Plan length choice: [min, max] weeks and the default (the plan's own length, clamped). */
export function weeksRange(plan: Pick<MealPlan, "durationWeeks" | "minWeeks" | "maxWeeks">) {
  const min = Math.max(1, plan.minWeeks ?? plan.durationWeeks);
  const max = Math.max(min, plan.maxWeeks ?? Math.max(min, plan.durationWeeks));
  return { min, max, default: Math.min(max, Math.max(min, plan.durationWeeks)) };
}

/** The plan's skip policy, or the global setting when the plan doesn't override it. */
export function skipPolicyFor(plan: Pick<MealPlan, "skipPolicy"> | null | undefined, settings: { skipPolicy: string }): SkipPolicy {
  const p = plan?.skipPolicy ?? settings.skipPolicy;
  return p === "CREDIT" ? "CREDIT" : "EXTEND";
}

/** Cancel policy: CREDIT (default — unused paid meals to wallet), REFUND (refund request to finance), STAFF_ONLY (customers ask support). */
export function cancelPolicyFor(plan: Pick<MealPlan, "cancelPolicy"> | null | undefined): CancelPolicy {
  const p = plan?.cancelPolicy;
  return p === "REFUND" || p === "STAFF_ONLY" ? p : "CREDIT";
}

export const POLICY_TEXT = {
  skip: { EXTEND: "A skipped meal moves to the end of your plan.", CREDIT: "A skipped paid meal goes back to your Dabba Bela credit." } as Record<SkipPolicy, string>,
  cancel: {
    CREDIT: "Cancel online any time: meals before their cut-off are cancelled and what you paid for them goes to your credit.",
    REFUND: "Cancel online any time: meals before their cut-off are refunded to your original payment method.",
    STAFF_ONLY: "To cancel this plan, contact support — we'll settle unused meals with you.",
  } as Record<CancelPolicy, string>,
};

/** The earlier of two "HH:MM" cut-offs (null = not set). */
export function earliestCutoff(...cutoffs: (string | null | undefined)[]) {
  const set = cutoffs.filter((c): c is string => Boolean(c));
  return set.length ? set.sort()[0] : null;
}

/** Effective cut-off for one meal: per-day menu cut-off (DayOffer.cutoff), company override, else the global one. */
async function mealCutoff(date: string, kitchenId: string, companyId: string | null, settings: { orderCutoff: string }, offer?: DayOffer) {
  const o = offer ?? (await getOffersForDates([date], kitchenId)).get(date);
  const company = companyId ? await db.company.findUnique({ where: { id: companyId }, select: { cutoffOverride: true } }) : null;
  return earliestCutoff(o?.cutoff, company?.cutoffOverride) ?? settings.orderCutoff;
}

type Meal = {
  date: string;
  name: string;
  details: string | null;
  price: number; // plan price + surcharge
  surcharge: number;
  cost: number;
  diet: Prisma.OrderItemCreateWithoutOrderInput["diet"];
  components: Prisma.InputJsonValue;
  boxId?: string;
  customBoxId?: string;
  followsRotation: boolean;
  capacity: number | null;
  dishes: { id: string; name: string; qty: number; limit: number | null }[];
  problem: string | null;
};

async function resolveMeals(dates: string[], input: PlanInput, plan: { pricePerMeal: number; compareAtPrice: number | null }, userId: string | null, kitchenId: string, preloaded?: Map<string, DayOffer>): Promise<Meal[]> {
  const settings = await getSettings();
  const offers = preloaded ?? (await getOffersForDates(dates, kitchenId));
  const standard = plan.compareAtPrice ?? plan.pricePerMeal;
  const customIds = Object.values(input.picks ?? {}).map((p) => p?.customBoxId).filter(Boolean) as string[];
  const customs = userId && customIds.length ? await db.customBox.findMany({ where: { id: { in: customIds }, userId } }) : [];
  const meals: Meal[] = [];
  for (const date of dates) {
    const pick = input.picks?.[date];
    const offer: DayOffer | undefined = offers.get(date);
    if (pick?.customBoxId) {
      const c = customs.find((x) => x.id === pick.customBoxId);
      if (c) {
        const p = await priceCustomBox(c.items as unknown as CustomPick[], settings);
        const surcharge = Math.max(0, p.price - standard);
        meals.push({ date, name: c.name, details: p.details, price: plan.pricePerMeal + surcharge, surcharge, cost: p.cost, diet: p.diet, components: p.components as unknown as Prisma.InputJsonValue, customBoxId: c.id, followsRotation: false, capacity: null, dishes: p.dishes, problem: p.problem });
        continue;
      }
    }
    let item = pick?.boxId ? offer?.items.find((i) => i.box.id === pick.boxId && !i.soldOut) ?? null : null;
    let followsRotation = false;
    if (!item) {
      item = rotationPick(offer, Boolean(input.vegOnly));
      followsRotation = true;
    }
    if (!item) {
      meals.push({ date, name: "—", details: null, price: 0, surcharge: 0, cost: 0, diet: "VEG", components: [], followsRotation: true, capacity: null, dishes: [], problem: offer?.closed ? "Kitchen closed" : "No menu published for this day yet" });
      continue;
    }
    const f = boxFacts(item.box);
    const surcharge = followsRotation ? 0 : Math.max(0, item.price - standard);
    meals.push({
      date,
      name: item.box.name,
      details: item.box.tagline,
      price: plan.pricePerMeal + surcharge,
      surcharge,
      cost: f.cost,
      diet: f.diet,
      components: boxComponents(item.box) as unknown as Prisma.InputJsonValue,
      boxId: item.box.id,
      followsRotation,
      capacity: item.capacity,
      dishes: [],
      problem: pick?.boxId && followsRotation ? "Your pick isn't on that day's menu — chef's choice instead" : null,
    });
  }
  return meals;
}

export async function quoteSubscription(user: CurrentUser | null, input: PlanInput) {
  const settings = await getSettings();
  const planRow = await db.mealPlan.findFirst({ where: { id: input.planId, isActive: true } });
  if (!planRow) throw new OrderError("Pick a plan");
  // The price effective today; existing subscriptions keep the one they were sold at.
  const price = await planPriceOn(planRow);
  const plan = { ...planRow, pricePerMeal: price.pricePerMeal, compareAtPrice: price.compareAtPrice };
  const range = weeksRange(plan);
  const weeks = input.weeks ?? range.default;
  if (!Number.isInteger(weeks) || weeks < range.min || weeks > range.max) throw new OrderError(range.min === range.max ? `${plan.name} runs for ${range.min} week${range.min === 1 ? "" : "s"}` : `${plan.name} can run for ${range.min}–${range.max} weeks`);
  const days = WEEKDAYS.filter((d) => input.days.includes(d) && settings.deliveryDays.includes(d));
  if (days.length < plan.minDaysPerWeek) throw new OrderError(`${plan.name} needs at least ${plan.minDaysPerWeek} days a week`);

  const address = user && input.addressId ? user.addresses.find((a) => a.id === input.addressId) ?? null : null;
  const zoneId = address?.zoneId ?? (!address ? input.zoneId : null) ?? null;
  const zone = zoneId ? await db.deliveryZone.findFirst({ where: { id: zoneId, isActive: true } }) : null;
  const kitchenId = zone?.kitchenId ?? (await db.kitchen.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } }))?.id;
  if (!kitchenId) throw new OrderError("No kitchen is open yet");

  const closures = await getClosures(input.startDate, addDays(input.startDate, weeks * 7 + 7), kitchenId);
  const company = activeCompany(user);
  const allDates = planDatesFrom(input.startDate, weeks, days, settings.deliveryDays, closures);
  const now = ktmNow();
  const [offers, locked] = await Promise.all([getOffersForDates(allDates, kitchenId), allDates.length ? getLockedDates(allDates[0], allDates[allDates.length - 1], kitchenId) : Promise.resolve(new Set<string>())]);
  // Per-day menu cut-off and the company override: the earlier one wins. Days the kitchen already locked are left out.
  const dates = allDates.filter((d) => !locked.has(d) && !dateProblem(d, settings, closures, { cutoff: earliestCutoff(offers.get(d)?.cutoff, company?.cutoffOverride), now, ignoreHorizon: true }));
  if (!dates.length) throw new OrderError("No delivery days fall in that range — try a later start date");

  const meals = await resolveMeals(dates, input, plan, user?.id ?? null, kitchenId, offers);
  const blocking = meals.find((m) => m.price === 0);

  const spec: CompanySpec = user && company ? await companySpecFor(user.id, company, dates) : null;
  const tax = await taxRuleFor(dates[0]);
  const zoneSpec = plan.includesDelivery || !zone ? null : { fee: zone.fee, freeAbove: null, minOrder: 0 };
  const lines = meals.filter((m) => m.price > 0).map((m) => ({ date: m.date, unitPrice: m.price, unitCost: m.cost, qty: 1 }));
  const pre = priceDays({ lines, zone: zoneSpec, company: spec, tax, globalFreeAbove: 0 });
  let couponId: string | null = null;
  let couponCode: string | null = null;
  let couponError: string | null = null;
  let priced = pre;
  if (input.couponCode?.trim() && user) {
    const r = await checkCoupon(input.couponCode, { userId: user.id, base: pre.subtotal - pre.companyDiscount, scope: "SUBSCRIPTIONS" });
    if (r.ok) {
      couponId = r.coupon.id;
      couponCode = r.coupon.code;
      priced = priceDays({ lines, zone: zoneSpec, company: spec, tax, globalFreeAbove: 0, coupon: r.coupon });
    } else couponError = r.error;
  }
  const regular = meals.reduce((a, m) => a + Math.max(plan.compareAtPrice ?? plan.pricePerMeal, m.price), 0);
  return {
    plan,
    price,
    weeks,
    weekdays: days,
    dates,
    skippedDates: allDates.filter((d) => !dates.includes(d)),
    closures: [...closures.entries()].filter(([d]) => d >= input.startDate).map(([date, name]) => ({ date, name })),
    meals,
    kitchenId,
    zone,
    addressProblem: address && !address.zoneId ? `We don't deliver to ${address.area} yet` : null,
    error: blocking ? `${blocking.date}: ${blocking.problem}` : null,
    mealsTotal: meals.length,
    perMealEffective: meals.length ? Math.round(priced.total / meals.length) : 0,
    savings: Math.max(0, regular - priced.subtotal + priced.discount),
    endDate: dates[dates.length - 1],
    couponId,
    couponCode,
    couponError,
    taxInclusive: tax?.inclusive ?? true,
    ...priced,
  };
}

export async function createSubscription(
  user: CurrentUser,
  input: PlanInput & { addressId: string; slotId?: string | null; method: PaymentMethod; notes?: string | null; idempotencyKey?: string | null; renewedFromId?: string | null },
) {
  if (input.idempotencyKey) {
    const existing = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { subscription: true } });
    if (existing?.subscription && existing.userId === user.id) return { subscription: existing.subscription, payment: existing, replayed: true, needsPayment: existing.status === "PENDING" };
  }
  const settings = await getSettings();
  if (settings.maintenanceMode) throw new OrderError(settings.maintenanceMessage);
  const address = user.addresses.find((a) => a.id === input.addressId);
  if (!address) throw new OrderError("Choose a delivery address");
  if (!address.zoneId) throw new OrderError(`We don't deliver to ${address.area} yet`);
  const q = await quoteSubscription(user, input);
  if (q.error) throw new OrderError(q.error);
  if (input.couponCode && q.couponError) throw new OrderError(q.couponError);
  const slot = input.slotId ? await db.deliverySlot.findFirst({ where: { id: input.slotId, kitchenId: q.kitchenId, isActive: true } }) : null;
  if (input.slotId && !slot) throw new OrderError("That delivery window isn't available for your area");

  const company = activeCompany(user);
  const methods = await availableMethods(settings, { hasCompany: Boolean(company), customerShare: q.customerShare, forPlan: true });
  const method: PaymentMethod = q.customerShare <= 0 ? "COMPANY_INVOICE" : input.method;
  if (q.customerShare > 0 && !methods.includes(method)) throw new OrderError("That payment method isn't available right now");
  if (method === "WALLET" && (await walletBalance(user.id)) < q.customerShare) throw new OrderError("Not enough credit — choose another payment method");
  const state = initialState(method, q.customerShare, q.companyShare);

  try {
    return await db.$transaction(
      async (tx) => {
        if (input.renewedFromId) {
          // One renewal per plan: serialise on the old plan and return the renewal that already exists.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`renew:${input.renewedFromId}`}))`;
          const existing = await tx.subscription.findFirst({ where: { renewedFromId: input.renewedFromId, status: { not: "CANCELLED" } } });
          if (existing) throw new RenewalExists(existing.id);
        }
        for (const m of q.meals) {
          await lockKitchenDay(tx, q.kitchenId, m.date);
          await assertDayCapacity(tx, {
            kitchenId: q.kitchenId,
            date: m.date,
            meals: 1,
            slotId: slot?.id,
            boxes: m.boxId ? new Map([[m.boxId, { qty: 1, capacity: m.capacity, name: m.name }]]) : undefined,
            dishes: new Map(m.dishes.map((d) => [d.id, { qty: d.qty, limit: d.limit, name: d.name }])),
          });
        }
        const sub = await tx.subscription.create({
          data: {
            reference: `PLN-${randomCode(6)}`,
            userId: user.id,
            planId: q.plan.id,
            status: state.status === "PENDING_PAYMENT" ? "PENDING_PAYMENT" : "ACTIVE",
            startDate: dateOnly(q.dates[0]),
            endDate: dateOnly(q.endDate),
            days: q.weekdays,
            boxChoice: input.picks && Object.keys(input.picks).length ? "CUSTOM" : "ROTATION",
            dayChoices: (input.picks ?? undefined) as Prisma.InputJsonValue | undefined,
            vegOnly: Boolean(input.vegOnly),
            addressId: address.id,
            slotId: slot?.id ?? null,
            companyId: company?.id ?? null,
            mealsTotal: q.mealsTotal,
            pricePerMeal: q.plan.pricePerMeal,
            priceId: q.price.id,
            renewedFromId: input.renewedFromId ?? null,
            subtotal: q.subtotal,
            deliveryFee: q.deliveryFee,
            discount: q.discount,
            tax: q.tax,
            total: q.total,
            couponCode: q.couponCode,
            notes: input.notes?.slice(0, 500) || null,
          },
        });
        const payment = await tx.payment.create({
          data: {
            reference: paymentRef(),
            userId: user.id,
            method,
            status: state.payment,
            amount: q.customerShare,
            subscriptionId: sub.id,
            companyId: company?.id ?? null,
            idempotencyKey: input.idempotencyKey || null,
            paidAt: state.payment === "PAID" ? new Date() : null,
          },
        });
        if (q.couponId) await redeemCoupon(tx, { couponId: q.couponId, userId: user.id, amount: q.couponDiscount, paymentId: payment.id });
        if (method === "WALLET") await spendCredit(tx, { userId: user.id, amount: q.customerShare, paymentId: payment.id, note: `Plan ${sub.reference}` });
        const dayTotals = new Map(q.days.map((d) => [d.date, d]));
        for (const m of q.meals) {
          const d = dayTotals.get(m.date)!;
          await tx.order.create({
            data: {
              number: orderNumber(),
              code: randomCode(4),
              userId: user.id,
              source: "SUBSCRIPTION",
              status: state.status,
              paymentStatus: state.orderPayment,
              deliveryDate: dateOnly(m.date),
              kitchenId: q.kitchenId,
              slotId: slot?.id ?? null,
              slotLabel: slot?.label ?? null,
              followsRotation: m.followsRotation,
              addressId: address.id,
              contactName: address.recipientName,
              contactPhone: address.phone,
              addressType: address.type,
              placeName: address.placeName,
              addressLine: address.line1,
              area: address.area,
              ward: address.ward,
              landmark: address.landmark,
              lat: address.lat,
              lng: address.lng,
              instructions: address.instructions,
              zoneId: address.zoneId,
              companyId: company?.id ?? null,
              officeLocationId: user.membership?.officeLocationId ?? null,
              subtotal: d.subtotal,
              deliveryFee: d.deliveryFee,
              discount: d.discount,
              tax: d.tax,
              taxInclusive: q.taxInclusive,
              total: d.total,
              companyShare: d.companyShare,
              customerShare: d.customerShare,
              costTotal: m.cost,
              couponCode: q.couponCode,
              allergenNote: user.allergies.length ? `Avoid: ${user.allergies.join(", ")}` : null,
              deliveryOtp: handoffOtp(),
              subscriptionId: sub.id,
              paymentId: payment.id,
              items: {
                create: [{ boxId: m.boxId ?? null, customBoxId: m.customBoxId ?? null, name: m.name, details: m.details, components: m.components, diet: m.diet, quantity: 1, unitPrice: m.price, unitCost: m.cost, lineTotal: m.price }],
              },
              events: { create: { toStatus: state.status, note: `Plan ${sub.reference}`, actorId: user.id } },
            },
          });
        }
        await tx.subscriptionChange.create({ data: { subscriptionId: sub.id, type: "CREATE", detail: `${q.mealsTotal} meals, ${q.dates[0]} → ${q.endDate}`, amount: q.total, actorId: user.id } });
        return { subscription: sub, payment, replayed: false, needsPayment: state.status === "PENDING_PAYMENT" };
      },
      { timeout: 30_000 },
    );
  } catch (e) {
    if (e instanceof CapacityError) throw new OrderError(e.message);
    throw e;
  }
}

class RenewalExists extends Error {
  constructor(public subscriptionId: string) {
    super("This plan has already been renewed");
  }
}

// ───────────── changes after purchase ─────────────

async function cloneMealOrder(tx: Tx, tpl: Order & { items: Prisma.OrderItemGetPayload<object>[] }, date: string, sub: { id: string; vegOnly: boolean; status: string }, offer: DayOffer | undefined, note: string, actorId: string | null) {
  const item = tpl.items[0];
  let boxId = item?.boxId ?? null;
  let name = item?.name ?? "Lunch dabba";
  let details = item?.details ?? null;
  let unitCost = item?.unitCost ?? 0;
  let components = (item?.components ?? []) as Prisma.InputJsonValue;
  let diet = item?.diet ?? "VEG";
  if (tpl.followsRotation) {
    const pick = rotationPick(offer, sub.vegOnly);
    if (pick) {
      const f = boxFacts(pick.box);
      boxId = pick.box.id;
      name = pick.box.name;
      details = pick.box.tagline;
      unitCost = f.cost;
      diet = f.diet;
      components = boxComponents(pick.box) as unknown as Prisma.InputJsonValue;
    }
  }
  return tx.order.create({
    data: {
      number: orderNumber(),
      code: randomCode(4),
      userId: tpl.userId,
      source: "SUBSCRIPTION",
      status: sub.status === "ACTIVE" ? "SCHEDULED" : "PENDING_PAYMENT",
      paymentStatus: tpl.paymentStatus === "REFUNDED" ? "PAID" : tpl.paymentStatus,
      deliveryDate: dateOnly(date),
      kitchenId: tpl.kitchenId,
      slotId: tpl.slotId,
      slotLabel: tpl.slotLabel,
      followsRotation: tpl.followsRotation,
      addressId: tpl.addressId,
      contactName: tpl.contactName,
      contactPhone: tpl.contactPhone,
      addressType: tpl.addressType,
      placeName: tpl.placeName,
      addressLine: tpl.addressLine,
      area: tpl.area,
      ward: tpl.ward,
      landmark: tpl.landmark,
      lat: tpl.lat,
      lng: tpl.lng,
      instructions: tpl.instructions,
      zoneId: tpl.zoneId,
      companyId: tpl.companyId,
      officeLocationId: tpl.officeLocationId,
      subtotal: tpl.subtotal,
      deliveryFee: tpl.deliveryFee,
      discount: tpl.discount,
      tax: tpl.tax,
      taxInclusive: tpl.taxInclusive,
      total: tpl.total,
      companyShare: tpl.companyShare,
      customerShare: tpl.customerShare,
      costTotal: unitCost,
      couponCode: tpl.couponCode,
      allergenNote: tpl.allergenNote,
      deliveryOtp: handoffOtp(),
      subscriptionId: sub.id,
      paymentId: tpl.paymentId,
      items: { create: [{ boxId, customBoxId: item?.customBoxId ?? null, name, details, components, diet, quantity: 1, unitPrice: item?.unitPrice ?? tpl.subtotal, unitCost, lineTotal: item?.lineTotal ?? tpl.subtotal }] },
      events: { create: { toStatus: sub.status === "ACTIVE" ? "SCHEDULED" : "PENDING_PAYMENT", note, actorId } },
    },
  });
}

/** Re-add `count` meals after the plan's last live meal, copying the money of the given template orders. */
async function appendMeals(subId: string, templates: (Order & { items: Prisma.OrderItemGetPayload<object>[] })[], actorId: string | null, note: string) {
  const settings = await getSettings();
  const sub = await db.subscription.findUniqueOrThrow({ where: { id: subId } });
  const live = await db.order.findMany({ where: { subscriptionId: subId, status: { in: LIVE_STATUSES } }, select: { deliveryDate: true }, orderBy: { deliveryDate: "asc" } });
  const taken = new Set(live.map((o) => isoDate(o.deliveryDate)));
  const last = live.length ? isoDate(live[live.length - 1].deliveryDate) : todayKTM();
  const after = last > todayKTM() ? last : todayKTM();
  const kitchenId = templates[0]?.kitchenId;
  if (!kitchenId || !templates.length) return [];
  const dates = await nextServiceDates(after, templates.length, sub.days, settings, kitchenId, taken);
  const offers = await getOffersForDates(dates, kitchenId);
  const created: string[] = [];
  await db.$transaction(async (tx) => {
    for (let i = 0; i < dates.length; i++) {
      await lockKitchenDay(tx, kitchenId, dates[i]);
      await assertDayCapacity(tx, { kitchenId, date: dates[i], meals: 1, slotId: templates[i].slotId });
      const o = await cloneMealOrder(tx, templates[i], dates[i], sub, offers.get(dates[i]), note, actorId);
      created.push(isoDate(o.deliveryDate));
    }
    const end = await tx.order.findFirst({ where: { subscriptionId: subId, status: { in: LIVE_STATUSES } }, orderBy: { deliveryDate: "desc" } });
    if (end) await tx.subscription.update({ where: { id: subId }, data: { endDate: end.deliveryDate } });
  });
  return created;
}

async function ownMeal(orderId: string, userId: string | null) {
  const order = await db.order.findFirst({ where: { id: orderId, source: "SUBSCRIPTION", ...(userId ? { userId } : {}) }, include: { subscription: { include: { plan: true, price: true } }, items: true, payment: true } });
  if (!order || !order.subscription) throw new OrderError("Meal not found");
  return order as typeof order & { subscription: NonNullable<typeof order.subscription> };
}

/**
 * Skip one meal before the cut-off. Policy (MealPlan.skipPolicy, else Settings → skipPolicy):
 * EXTEND = the meal moves to the end of the plan; CREDIT = its paid value goes to the wallet.
 * Unpaid plans always EXTEND (there is nothing to credit yet).
 */
export async function skipMeal(orderId: string, actor: { id: string; isStaff: boolean }, userId: string | null) {
  const settings = await getSettings();
  const order = await ownMeal(orderId, userId);
  if (!["SCHEDULED", "PENDING_PAYMENT"].includes(order.status)) throw new OrderError("This meal can't be skipped any more");
  const date = isoDate(order.deliveryDate);
  const cutoff = await mealCutoff(date, order.kitchenId, order.companyId, settings);
  if (!actor.isStaff && !(await changeWindowOpen(date, order.kitchenId, settings, cutoff))) throw new OrderError(`Skips for ${date} closed at ${cutoff}`);
  const paid = order.paymentStatus === "PAID" && order.customerShare > 0;
  const policy = paid ? skipPolicyFor(order.subscription.plan, settings) : "EXTEND";
  await setOrderStatus([order.id], "SKIPPED", actor.id, policy === "CREDIT" ? "Skipped — credited" : "Skipped — moved to end of plan");
  let moved: string[] = [];
  if (policy === "CREDIT") {
    await db.$transaction(async (tx) => {
      await addCredit(tx, { userId: order.userId, amount: order.customerShare, reason: "SKIP_CREDIT", orderId: order.id, paymentId: order.paymentId, actorId: actor.id });
      await tx.order.update({ where: { id: order.id }, data: { refundedAmount: order.customerShare, paymentStatus: "REFUNDED" } });
      if (order.paymentId) await bumpPaymentRefund(tx, order.paymentId, order.customerShare);
      await tx.subscription.update({ where: { id: order.subscription.id }, data: { mealsTotal: { decrement: 1 } } });
    });
  } else {
    moved = await appendMeals(order.subscription.id, [order], actor.id, `Moved from ${date}`);
  }
  await db.subscriptionChange.create({ data: { subscriptionId: order.subscription.id, type: "SKIP", date: order.deliveryDate, detail: policy === "CREDIT" ? `Credited ${rs(order.customerShare)}` : `Moved to ${moved.join(", ") || "end of plan"}`, amount: policy === "CREDIT" ? order.customerShare : null, actorId: actor.id } });
  return { policy, moved, credited: policy === "CREDIT" ? order.customerShare : 0 };
}

/** Undo a skip before the cut-off (only for EXTEND skips: the appended meal is removed again). */
export async function unskipMeal(orderId: string, actor: { id: string; isStaff: boolean }, userId: string | null) {
  const settings = await getSettings();
  const order = await ownMeal(orderId, userId);
  if (order.status !== "SKIPPED") throw new OrderError("This meal isn't skipped");
  if (order.paymentStatus === "REFUNDED") throw new OrderError("This skip was credited to your wallet — order the day again instead");
  const date = isoDate(order.deliveryDate);
  const cutoff = await mealCutoff(date, order.kitchenId, order.companyId, settings);
  if (!actor.isStaff && !(await changeWindowOpen(date, order.kitchenId, settings, cutoff))) throw new OrderError(`Changes for ${date} closed at ${cutoff}`);
  const lastAppended = await db.order.findFirst({ where: { subscriptionId: order.subscription.id, status: { in: ["SCHEDULED", "PENDING_PAYMENT"] }, deliveryDate: { gt: order.deliveryDate } }, orderBy: { deliveryDate: "desc" } });
  await db.$transaction(async (tx) => {
    await lockKitchenDay(tx, order.kitchenId, date);
    await assertDayCapacity(tx, { kitchenId: order.kitchenId, date, meals: 1, slotId: order.slotId });
  });
  await setOrderStatus([order.id], "SCHEDULED", actor.id, "Skip undone");
  if (lastAppended) await setOrderStatus([lastAppended.id], "CANCELLED", actor.id, `Removed — ${date} un-skipped`);
  const end = await db.order.findFirst({ where: { subscriptionId: order.subscription.id, status: { in: LIVE_STATUSES } }, orderBy: { deliveryDate: "desc" } });
  if (end) await db.subscription.update({ where: { id: order.subscription.id }, data: { endDate: end.deliveryDate } });
  await db.subscriptionChange.create({ data: { subscriptionId: order.subscription.id, type: "UNSKIP", date: order.deliveryDate, actorId: actor.id } });
}

/** Pause: every future editable meal from `from` is skipped (no credit). Resume appends them again. */
export async function pauseSubscription(subId: string, actor: { id: string; isStaff: boolean }, opts: { userId?: string; from?: string; reason?: string } = {}) {
  const settings = await getSettings();
  const sub = await db.subscription.findFirst({ where: { id: subId, ...(opts.userId ? { userId: opts.userId } : {}) }, include: { plan: true } });
  if (!sub || sub.status !== "ACTIVE") throw new OrderError("Only active plans can be paused");
  const now = ktmNow();
  let from = opts.from && opts.from > now.date ? opts.from : now.time < settings.orderCutoff ? now.date : addDays(now.date, 1);
  if (from < now.date) from = now.date;
  const future = await db.order.findMany({ where: { subscriptionId: subId, status: "SCHEDULED", deliveryDate: { gte: dateOnly(from) } }, select: { id: true } });
  const r = await setOrderStatus(future.map((o) => o.id), "SKIPPED", actor.id, "Plan paused");
  await db.subscription.update({ where: { id: subId }, data: { status: "PAUSED", pausedUntil: null } });
  await db.subscriptionPause.create({ data: { subscriptionId: subId, fromDate: dateOnly(from), reason: opts.reason } });
  await db.subscriptionChange.create({ data: { subscriptionId: subId, type: "PAUSE", date: dateOnly(from), detail: `${r.changed.length} meals on hold`, actorId: actor.id } });
  return r.changed.length;
}

export async function resumeSubscription(subId: string, actor: { id: string; isStaff: boolean }, opts: { userId?: string } = {}) {
  const sub = await db.subscription.findFirst({ where: { id: subId, ...(opts.userId ? { userId: opts.userId } : {}) }, include: { plan: true, pauses: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!sub || sub.status !== "PAUSED") throw new OrderError("This plan isn't paused");
  const pause = sub.pauses[0];
  const held = await db.order.findMany({
    where: { subscriptionId: subId, status: "SKIPPED", events: { some: { note: "Plan paused" } }, paymentStatus: { not: "REFUNDED" } },
    include: { items: true },
    orderBy: { deliveryDate: "asc" },
  });
  // Each held meal is re-created once; mark the originals so a second resume can't duplicate them.
  const fresh = [];
  for (const h of held) {
    const already = await db.orderStatusEvent.findFirst({ where: { orderId: h.id, note: "Re-added on resume" } });
    if (!already) fresh.push(h);
  }
  // Meals are re-added as an ACTIVE plan; if that fails (capacity, closures) the plan goes back to
  // PAUSED with its meals still on hold instead of ending up "active" with nothing scheduled.
  await db.subscription.update({ where: { id: subId }, data: { status: "ACTIVE" } });
  let added: string[];
  try {
    added = await appendMeals(subId, fresh, actor.id, "Re-added after pause");
  } catch (e) {
    await db.subscription.update({ where: { id: subId }, data: { status: "PAUSED" } });
    throw e;
  }
  if (pause && !pause.toDate) await db.subscriptionPause.update({ where: { id: pause.id }, data: { toDate: dateOnly(todayKTM()) } });
  for (const h of fresh.slice(0, added.length)) await db.orderStatusEvent.create({ data: { orderId: h.id, fromStatus: "SKIPPED", toStatus: "SKIPPED", note: "Re-added on resume", actorId: actor.id } });
  await db.subscriptionChange.create({ data: { subscriptionId: subId, type: "RESUME", detail: `${added.length} meals re-added`, actorId: actor.id } });
  return added.length;
}

/**
 * Cancel a plan. Meals still before their cut-off are cancelled and their paid value goes back
 * as wallet credit (or a refund request when staff choose so). Meals already locked are kept.
 */
export async function cancelSubscription(subId: string, actor: { id: string; isStaff: boolean }, opts: { userId?: string; reason: string; settlement?: "CREDIT" | "REFUND" }) {
  const settings = await getSettings();
  const sub = await db.subscription.findFirst({ where: { id: subId, ...(opts.userId ? { userId: opts.userId } : {}) }, include: { plan: true } });
  if (!sub || ["CANCELLED", "COMPLETED"].includes(sub.status)) throw new OrderError("This plan can't be cancelled");
  // Per-plan cancel policy decides how a customer's own cancellation settles; staff choose explicitly.
  const policy = cancelPolicyFor(sub.plan);
  if (!actor.isStaff && policy === "STAFF_ONLY" && sub.status !== "PENDING_PAYMENT") throw new OrderError(POLICY_TEXT.cancel.STAFF_ONLY);
  if (!actor.isStaff) opts = { ...opts, settlement: policy === "REFUND" ? "REFUND" : "CREDIT" };
  const orders = await db.order.findMany({ where: { subscriptionId: subId, status: { in: ["SCHEDULED", "PENDING_PAYMENT", "SKIPPED"] } }, include: { payment: true } });
  let credit = 0;
  const cancel: string[] = [];
  for (const o of orders) {
    if (o.status === "SKIPPED") continue;
    if (!(await changeWindowOpen(isoDate(o.deliveryDate), o.kitchenId, settings))) continue; // locked meals still go out
    cancel.push(o.id);
    if (o.paymentStatus === "PAID") credit += o.customerShare - o.refundedAmount;
  }
  // Paid meals still on hold from a pause (never re-added) also come back. Skips that were moved
  // to the end of the plan, and pause-holds already re-added on resume, carry no money any more.
  const heldIds = new Set(
    (
      await db.order.findMany({
        where: {
          subscriptionId: subId,
          status: "SKIPPED",
          paymentStatus: "PAID",
          events: { some: { note: "Plan paused" }, none: { note: "Re-added on resume" } },
        },
        select: { id: true },
      })
    ).map((o) => o.id),
  );
  const held = orders.filter((o) => heldIds.has(o.id) && o.refundedAmount < o.customerShare);
  credit += held.reduce((a, o) => a + o.customerShare - o.refundedAmount, 0);
  await setOrderStatus(cancel, "CANCELLED", actor.id, `Plan cancelled: ${opts.reason}`);
  const settlement = opts.settlement ?? "CREDIT";
  const paymentId = orders[0]?.paymentId ?? null;
  await db.$transaction(async (tx) => {
    for (const id of [...cancel, ...held.map((h) => h.id)]) {
      const o = orders.find((x) => x.id === id)!;
      if (o.paymentStatus !== "PAID") continue;
      await tx.order.update({ where: { id }, data: { refundedAmount: o.customerShare, paymentStatus: settlement === "CREDIT" ? "REFUNDED" : o.paymentStatus } });
    }
    if (credit > 0 && paymentId) {
      if (settlement === "CREDIT") {
        await addCredit(tx, { userId: sub.userId, amount: credit, reason: "CANCEL_CREDIT", paymentId, actorId: actor.id, note: `Plan ${sub.reference} cancelled` });
        await bumpPaymentRefund(tx, paymentId, credit);
      } else {
        await tx.refund.create({ data: { paymentId, amount: credit, reason: `Plan ${sub.reference} cancelled: ${opts.reason}`, method: "ORIGINAL", requestedById: actor.id } });
      }
    }
    // Only the plan's own payment (an extra-meal payment linked to the plan settles with its own order).
    const pending = await tx.payment.findFirst({ where: { subscriptionId: subId, status: "PENDING", orders: { some: { subscriptionId: subId } } } });
    if (pending) await tx.payment.update({ where: { id: pending.id }, data: { status: "CANCELLED" } });
    await tx.subscription.update({ where: { id: subId }, data: { status: "CANCELLED", cancelReason: opts.reason } });
    await tx.subscriptionChange.create({ data: { subscriptionId: subId, type: "CANCEL", detail: `${cancel.length} meals cancelled${credit ? `, ${rs(credit)} ${settlement === "CREDIT" ? "credited" : "to refund"}` : ""}`, amount: credit || null, actorId: actor.id } });
  });
  return { cancelled: cancel.length, credit, settlement };
}

/** Move all editable future meals of a plan to another saved address (zone must be served). */
export async function changePlanAddress(subId: string, user: CurrentUser, addressId: string) {
  const settings = await getSettings();
  const sub = await db.subscription.findFirst({ where: { id: subId, userId: user.id } });
  const address = user.addresses.find((a) => a.id === addressId);
  if (!sub || !address) throw new OrderError("Not found");
  if (!address.zoneId || !address.zone) throw new OrderError(`We don't deliver to ${address.area} yet — your meals stay at the current address`);
  const orders = await db.order.findMany({ where: { subscriptionId: subId, status: { in: ["SCHEDULED", "PENDING_PAYMENT"] } } });
  let moved = 0;
  for (const o of orders) {
    if (!(await changeWindowOpen(isoDate(o.deliveryDate), o.kitchenId, settings))) continue;
    const kitchenChanged = address.zone.kitchenId !== o.kitchenId;
    await db.$transaction(async (tx) => {
      if (kitchenChanged) {
        await lockKitchenDay(tx, address.zone!.kitchenId, isoDate(o.deliveryDate));
        await assertDayCapacity(tx, { kitchenId: address.zone!.kitchenId, date: isoDate(o.deliveryDate), meals: 1 });
      }
      await tx.order.update({
        where: { id: o.id },
        data: {
          addressId: address.id,
          contactName: address.recipientName,
          contactPhone: address.phone,
          addressType: address.type,
          placeName: address.placeName,
          addressLine: address.line1,
          area: address.area,
          ward: address.ward,
          landmark: address.landmark,
          instructions: address.instructions,
          zoneId: address.zoneId,
          kitchenId: address.zone!.kitchenId,
          slotId: kitchenChanged ? null : o.slotId,
          slotLabel: kitchenChanged ? null : o.slotLabel,
          version: { increment: 1 },
        },
      });
    });
    moved++;
  }
  await db.subscription.update({ where: { id: subId }, data: { addressId } });
  await db.subscriptionChange.create({ data: { subscriptionId: subId, type: "ADDRESS", detail: `${moved} meals → ${address.label} (${address.area})`, actorId: user.id } });
  return moved;
}

// ───────────── swap a day's pick · add a meal · renew ─────────────
//
// Policy for changing an existing subscription (see docs/ADMIN_IMPLEMENTATION_TRACKER.md → WP-06):
// * The price per meal is fixed at purchase (Subscription.pricePerMeal / priceId). Plan price changes never reprice it.
// * Swaps and extra meals are priced at the subscription's own per-meal price plus the dabba's surcharge over the
//   regular price of that price version (the same rule as at purchase).
// * Plan length, days and start are fixed; customers change them only through skip / pause / resume / renew.
// * Skip and cancel policy are read from the plan when the action happens (staff see how many live plans an edit affects).

type SubForPricing = { pricePerMeal: number; price: { compareAtPrice: number | null } | null; plan: { compareAtPrice: number | null } };

/** Per-meal price of a dabba inside a plan: the plan's per-meal price + surcharge above the regular price. */
export function planMealPrice(sub: SubForPricing, boxPrice: number) {
  const standard = sub.price?.compareAtPrice ?? sub.plan.compareAtPrice ?? sub.pricePerMeal;
  return sub.pricePerMeal + Math.max(0, boxPrice - standard);
}

/** Money effect of moving one meal to a new unit price, keeping the day's discount/delivery and its tax basis. */
async function repriceMeal(order: Order, item: { unitPrice: number; quantity: number }, newUnit: number) {
  if (newUnit === item.unitPrice) return { subtotal: order.subtotal, tax: order.tax, total: order.total, delta: 0 };
  const rule = await taxRuleFor(isoDate(order.deliveryDate));
  const subtotal = order.subtotal + (newUnit - item.unitPrice) * item.quantity;
  const before = taxFor(Math.max(0, order.subtotal - order.discount + order.deliveryFee), rule);
  const after = taxFor(Math.max(0, subtotal - order.discount + order.deliveryFee), rule);
  const delta = after.total - before.total;
  return { subtotal, tax: order.tax + (after.tax - before.tax), total: order.total + delta, delta };
}

export type SwapOption = { boxId: string; name: string; isVeg: boolean; price: number; delta: number; current: boolean; soldOut: boolean };

/** Dabbas a plan meal can be swapped to, with the price difference for each (positive = customer pays more). */
export async function swapOptions(orderId: string, userId: string | null) {
  const order = await ownMeal(orderId, userId);
  const date = isoDate(order.deliveryDate);
  const offer = (await getOffersForDates([date], order.kitchenId)).get(date);
  const item = order.items[0];
  const out: SwapOption[] = [];
  for (const i of offer?.items ?? []) {
    const f = boxFacts(i.box);
    if (order.subscription.vegOnly && !f.isVeg) continue;
    const price = planMealPrice(order.subscription, i.price);
    const r = await repriceMeal(order, item ?? { unitPrice: order.subtotal, quantity: 1 }, price);
    out.push({ boxId: i.box.id, name: i.box.name, isVeg: f.isVeg, price, delta: r.delta, current: item?.boxId === i.box.id, soldOut: i.soldOut });
  }
  return { date, cutoff: await mealCutoff(date, order.kitchenId, order.companyId, await getSettings(), offer), options: out };
}

/**
 * Swap one plan meal to another dabba on that day's menu, before the day's cut-off (per-day menu cut-off and company
 * override respected). The order is re-priced; the difference settles once:
 * paid meals → extra from wallet credit (refused if short) / saving back to wallet credit;
 * meals paid later (cash on delivery) → the pending payment's amount moves with it.
 * Idempotent: swapping to the dabba the meal already has changes nothing; concurrent swaps are version-checked.
 */
export async function swapMeal(orderId: string, boxId: string, actor: { id: string; isStaff: boolean }, userId: string | null, opts: { reason?: string | null } = {}) {
  const settings = await getSettings();
  const order = await ownMeal(orderId, userId);
  const sub = order.subscription;
  if (order.status === "PENDING_PAYMENT") throw new OrderError("Finish paying for your plan first, then you can swap meals");
  if (order.status !== "SCHEDULED") throw new OrderError("This meal can't be changed any more");
  if (sub.status !== "ACTIVE") throw new OrderError("Only meals of an active plan can be swapped");
  const date = isoDate(order.deliveryDate);
  const offer = (await getOffersForDates([date], order.kitchenId)).get(date);
  const cutoff = await mealCutoff(date, order.kitchenId, order.companyId, settings, offer);
  if (!actor.isStaff && !(await changeWindowOpen(date, order.kitchenId, settings, cutoff))) throw new OrderError(`Changes for ${date} closed at ${cutoff}`);
  const item = order.items[0];
  if (!item) throw new OrderError("Meal not found");
  if (item.boxId === boxId) return { changed: false, delta: 0, settlement: "NONE" as const };
  const pick = offer?.items.find((i) => i.box.id === boxId);
  if (!pick) throw new OrderError(`That dabba isn't on the menu for ${date}`);
  if (pick.soldOut) throw new OrderError(`${pick.box.name} is sold out on ${date}`);
  const f = boxFacts(pick.box);
  if (sub.vegOnly && !f.isVeg) throw new OrderError("This plan is veg only — pick a veg dabba");
  const newUnit = planMealPrice(sub, pick.price);
  const r = await repriceMeal(order, item, newUnit);
  const custDelta = Math.max(r.delta, -order.customerShare);
  const compDelta = r.delta - custDelta;
  const paid = order.paymentStatus === "PAID";
  if (paid && custDelta > 0 && (await walletBalance(order.userId)) < custDelta)
    throw new OrderError(`${pick.box.name} costs ${rs(custDelta)} more than your current meal — add credit to your wallet or pick a dabba at your plan price`);
  const settlement = custDelta === 0 ? "NONE" : paid ? (custDelta > 0 ? "WALLET_CHARGE" : "WALLET_CREDIT") : "DUE_LATER";
  const note = `Swapped: ${item.name} → ${pick.box.name}${custDelta ? ` (${custDelta > 0 ? "+" : "−"}${rs(Math.abs(custDelta))})` : ""}`;
  try {
    await db.$transaction(async (tx) => {
      await lockKitchenDay(tx, order.kitchenId, date);
      await assertDayCapacity(tx, { kitchenId: order.kitchenId, date, meals: 0, boxes: new Map([[boxId, { qty: item.quantity, capacity: pick.capacity, name: pick.box.name }]]) });
      const upd = await tx.order.updateMany({
        where: { id: order.id, version: order.version, status: "SCHEDULED" },
        data: { subtotal: r.subtotal, tax: r.tax, total: r.total, customerShare: order.customerShare + custDelta, companyShare: order.companyShare + compDelta, costTotal: f.cost * item.quantity, followsRotation: false, version: { increment: 1 } },
      });
      if (!upd.count) throw new OrderError("This meal was just changed — refresh and try again");
      await tx.orderItem.update({
        where: { id: item.id },
        data: { boxId, customBoxId: null, name: pick.box.name, details: pick.box.tagline, components: boxComponents(pick.box) as unknown as Prisma.InputJsonValue, diet: f.diet, unitPrice: newUnit, unitCost: f.cost, lineTotal: newUnit * item.quantity },
      });
      await tx.orderStatusEvent.create({ data: { orderId: order.id, fromStatus: order.status, toStatus: order.status, note, actorId: actor.id } });
      if (custDelta !== 0) await tx.orderAdjustment.create({ data: { orderId: order.id, amount: custDelta, reason: note, actorId: actor.id } });
      if (settlement === "WALLET_CHARGE") await spendCredit(tx, { userId: order.userId, amount: custDelta, orderId: order.id, actorId: actor.id, note });
      if (settlement === "WALLET_CREDIT") {
        await addCredit(tx, { userId: order.userId, amount: -custDelta, reason: "ADJUSTMENT", orderId: order.id, paymentId: order.paymentId, actorId: actor.id, note });
        if (order.paymentId) await bumpPaymentRefund(tx, order.paymentId, -custDelta);
      }
      if (settlement === "DUE_LATER" && order.paymentId) await tx.payment.updateMany({ where: { id: order.paymentId, status: "PENDING" }, data: { amount: { increment: custDelta } } });
      const choices = { ...((sub.dayChoices as Record<string, DayPick> | null) ?? {}), [date]: { boxId } };
      await tx.subscription.update({ where: { id: sub.id }, data: { dayChoices: choices as Prisma.InputJsonValue, boxChoice: "CUSTOM" } });
      await tx.subscriptionChange.create({ data: { subscriptionId: sub.id, type: "SWAP", date: order.deliveryDate, detail: `${item.name} → ${pick.box.name}${opts.reason ? ` — ${opts.reason}` : ""}`, amount: custDelta || null, actorId: actor.id } });
    });
  } catch (e) {
    if (e instanceof CapacityError) throw new OrderError(e.message);
    throw e;
  }
  return { changed: true, delta: custDelta, settlement };
}

async function planKitchen(sub: { id: string; addressId: string | null }) {
  const address = sub.addressId ? await db.address.findUnique({ where: { id: sub.addressId }, include: { zone: true } }) : null;
  if (address?.zone) return { kitchenId: address.zone.kitchenId, address, zone: address.zone };
  const last = await db.order.findFirst({ where: { subscriptionId: sub.id }, orderBy: { deliveryDate: "desc" }, select: { kitchenId: true } });
  return { kitchenId: last?.kitchenId ?? null, address, zone: null };
}

/**
 * Price one extra meal for a plan: the plan's own per-meal price (+ surcharge), delivery free when the plan includes
 * delivery or a plan meal already goes out that day, tax per the day's rule.
 */
export async function quoteAddMeal(user: CurrentUser, subId: string, input: { date: string; boxId: string }) {
  const settings = await getSettings();
  const sub = await db.subscription.findFirst({ where: { id: subId, userId: user.id }, include: { plan: true, price: true } });
  if (!sub) throw new OrderError("Plan not found");
  if (sub.status !== "ACTIVE") throw new OrderError("Extra meals can be added to an active plan");
  const { kitchenId, address, zone } = await planKitchen(sub);
  if (!kitchenId || !address) throw new OrderError("Set a delivery address for this plan first");
  const offer = (await getOffersForDates([input.date], kitchenId)).get(input.date);
  const closures = await getClosures(input.date, input.date, kitchenId);
  const cutoff = earliestCutoff(offer?.cutoff, sub.companyId ? (await db.company.findUnique({ where: { id: sub.companyId }, select: { cutoffOverride: true } }))?.cutoffOverride : null);
  const problem = dateProblem(input.date, settings, closures, { cutoff });
  if (problem) throw new OrderError(problem);
  if ((await getLockedDates(input.date, input.date, kitchenId)).has(input.date)) throw new OrderError(`Orders for ${input.date} are closed — the kitchen has locked the day`);
  const pick = offer?.items.find((i) => i.box.id === input.boxId);
  if (!pick) throw new OrderError(`That dabba isn't on the menu for ${input.date}`);
  if (pick.soldOut) throw new OrderError(`${pick.box.name} is sold out on ${input.date}`);
  const f = boxFacts(pick.box);
  const unitPrice = planMealPrice(sub, pick.price);
  const sameDay = await db.order.count({ where: { subscriptionId: sub.id, deliveryDate: dateOnly(input.date), status: { in: LIVE_STATUSES } } });
  const zoneSpec = sub.plan.includesDelivery || sameDay > 0 || !zone ? null : { fee: zone.fee, freeAbove: null, minOrder: 0 };
  const tax = await taxRuleFor(input.date);
  const priced = priceDays({ lines: [{ date: input.date, unitPrice, unitCost: f.cost, qty: 1 }], zone: zoneSpec, company: null, tax, globalFreeAbove: 0 });
  return { sub, kitchenId, address, pick, facts: f, unitPrice, tax, priced, day: priced.days[0] };
}

/**
 * Add an extra meal to a plan. It's a normal order (subscriptionId null, so it is booked once as its own sale) paid
 * through the normal payment flow; its Payment links to the plan (Payment.subscriptionId) so the plan page lists it.
 * Idempotent on the checkout key.
 */
export async function addMealToPlan(user: CurrentUser, subId: string, input: { date: string; boxId: string; method: PaymentMethod; idempotencyKey: string }) {
  if (!input.idempotencyKey || input.idempotencyKey.length < 8) throw new OrderError("Please refresh and try again");
  const existing = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { orders: true } });
  if (existing) {
    if (existing.userId !== user.id) throw new OrderError("Please refresh and try again");
    return { payment: existing, order: existing.orders[0], replayed: true, needsPayment: existing.status === "PENDING" && existing.method !== "CASH" };
  }
  const settings = await getSettings();
  if (settings.maintenanceMode) throw new OrderError(settings.maintenanceMessage);
  const q = await quoteAddMeal(user, subId, input);
  const total = q.priced.total;
  const methods = await availableMethods(settings, { hasCompany: false, customerShare: total });
  if (!methods.includes(input.method)) throw new OrderError("That payment method isn't available right now");
  if (input.method === "WALLET" && (await walletBalance(user.id)) < total) throw new OrderError("Not enough credit — choose another payment method");
  const state = initialState(input.method, total, 0);
  const a = q.address;
  try {
    return await db.$transaction(async (tx) => {
      await lockKitchenDay(tx, q.kitchenId, input.date);
      await assertDayCapacity(tx, { kitchenId: q.kitchenId, date: input.date, meals: 1, slotId: q.sub.slotId, boxes: new Map([[q.pick.box.id, { qty: 1, capacity: q.pick.capacity, name: q.pick.box.name }]]) });
      const slot = q.sub.slotId ? await tx.deliverySlot.findUnique({ where: { id: q.sub.slotId } }) : null;
      const payment = await tx.payment.create({
        data: { reference: paymentRef(), userId: user.id, method: input.method, status: state.payment, amount: total, subscriptionId: q.sub.id, idempotencyKey: input.idempotencyKey, paidAt: state.payment === "PAID" ? new Date() : null, note: `Extra meal for ${q.sub.reference}` },
      });
      if (input.method === "WALLET") await spendCredit(tx, { userId: user.id, amount: total, paymentId: payment.id, note: `Extra meal for ${q.sub.reference}` });
      const order = await tx.order.create({
        data: {
          number: orderNumber(),
          code: randomCode(4),
          userId: user.id,
          source: "SINGLE",
          status: state.status,
          paymentStatus: state.orderPayment,
          deliveryDate: dateOnly(input.date),
          kitchenId: q.kitchenId,
          slotId: slot?.id ?? null,
          slotLabel: slot?.label ?? null,
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
          subtotal: q.day.subtotal,
          deliveryFee: q.day.deliveryFee,
          discount: q.day.discount,
          tax: q.day.tax,
          taxInclusive: q.tax?.inclusive ?? true,
          total: q.day.total,
          companyShare: 0,
          customerShare: q.day.total,
          costTotal: q.facts.cost,
          allergenNote: user.allergies.length ? `Avoid: ${user.allergies.join(", ")}` : null,
          deliveryOtp: handoffOtp(),
          paymentId: payment.id,
          items: { create: [{ boxId: q.pick.box.id, name: q.pick.box.name, details: q.pick.box.tagline, components: boxComponents(q.pick.box) as unknown as Prisma.InputJsonValue, diet: q.facts.diet, quantity: 1, unitPrice: q.unitPrice, unitCost: q.facts.cost, lineTotal: q.unitPrice }] },
          events: { create: { toStatus: state.status, note: `Extra meal for plan ${q.sub.reference}`, actorId: user.id } },
        },
      });
      await tx.subscriptionChange.create({ data: { subscriptionId: q.sub.id, type: "ADD_MEAL", date: dateOnly(input.date), detail: `${q.pick.box.name} · order ${order.number}`, amount: total, actorId: user.id } });
      return { payment, order, replayed: false, needsPayment: state.status === "PENDING_PAYMENT" };
    });
  } catch (e) {
    if (e instanceof CapacityError) throw new OrderError(e.message);
    if (e instanceof Error && e.message.includes("Unique constraint") && e.message.includes("idempotencyKey")) return addMealToPlan(user, subId, input);
    throw e;
  }
}

/** Extra meals bought for a plan (their payment links to it). */
export async function extraMeals(subId: string) {
  return db.order.findMany({ where: { subscriptionId: null, payment: { subscriptionId: subId } }, include: { items: { select: { name: true, quantity: true } } }, orderBy: { deliveryDate: "asc" } });
}

/** Plan input for renewing `sub`: same plan, days, address, slot and veg setting; the weekday picks carry over. */
async function renewalInput(user: CurrentUser, subId: string, weeks?: number | null) {
  const sub = await db.subscription.findFirst({ where: { id: subId, userId: user.id }, include: { plan: true, renewals: { where: { status: { not: "CANCELLED" } }, take: 1 } } });
  if (!sub) throw new OrderError("Plan not found");
  if (!["ACTIVE", "PAUSED", "COMPLETED"].includes(sub.status)) throw new OrderError(sub.status === "PENDING_PAYMENT" ? "Finish paying for this plan first" : "This plan can't be renewed — start a new one instead");
  if (!sub.plan.isActive) throw new OrderError(`${sub.plan.name} isn't sold any more — pick another plan`);
  const address = user.addresses.find((a) => a.id === sub.addressId) ?? user.addresses.find((a) => a.isDefault && a.zoneId) ?? user.addresses.find((a) => a.zoneId);
  if (!address) throw new OrderError("Add a delivery address first");
  const settings = await getSettings();
  const today = todayKTM();
  const end = isoDate(sub.endDate);
  const startDate = end >= today ? addDays(end, 1) : today;
  const kitchenId = address.zone?.kitchenId ?? null;
  // Picks by weekday from the old plan (latest wins); dates whose dabba isn't on the new menu fall back to the chef's rotation.
  const byWeekday = new Map<Weekday, DayPick>();
  for (const [d, p] of Object.entries((sub.dayChoices as Record<string, DayPick> | null) ?? {}).sort(([a], [b]) => a.localeCompare(b))) if (p?.boxId || p?.customBoxId) byWeekday.set(weekdayOf(d), p);
  const range = weeksRange(sub.plan);
  const w = weeks ?? range.default;
  const closures = await getClosures(startDate, addDays(startDate, w * 7 + 7), kitchenId);
  const dates = planDatesFrom(startDate, w, sub.days, settings.deliveryDays, closures);
  const offers = byWeekday.size ? await getOffersForDates(dates, kitchenId) : new Map<string, DayOffer>();
  const picks: Record<string, DayPick> = {};
  for (const d of dates) {
    const p = byWeekday.get(weekdayOf(d));
    if (p?.customBoxId) picks[d] = { customBoxId: p.customBoxId };
    else if (p?.boxId && offers.get(d)?.items.some((i) => i.box.id === p.boxId && !i.soldOut)) picks[d] = { boxId: p.boxId };
  }
  const input: PlanInput = { planId: sub.planId, startDate, days: sub.days, weeks: w, picks, vegOnly: sub.vegOnly, addressId: address.id };
  return { sub, input, address, existing: sub.renewals[0] ?? null };
}

/** Preview a renewal (dates re-picked from the next service day, respecting menus, holidays, locks and cut-offs). */
export async function quoteRenewal(user: CurrentUser, subId: string, weeks?: number | null) {
  const r = await renewalInput(user, subId, weeks);
  return { ...r, quote: await quoteSubscription(user, r.input) };
}

/**
 * One-click renewal: a new subscription pre-filled from the old one, linked by renewedFromId, at today's price.
 * Payment goes through the normal flow (a PENDING payment → /pay/…, or wallet/cash as chosen) — never auto-charged.
 * Idempotent: renewing a plan that already has a (non-cancelled) renewal returns that renewal.
 */
export async function renewSubscription(user: CurrentUser, subId: string, input: { method: PaymentMethod; idempotencyKey?: string | null; weeks?: number | null; slotId?: string | null }) {
  const r = await renewalInput(user, subId, input.weeks);
  const replay = async (id: string) => {
    const subscription = await db.subscription.findUniqueOrThrow({ where: { id } });
    const payment = await db.payment.findFirstOrThrow({ where: { subscriptionId: id, orders: { some: { subscriptionId: id } } }, orderBy: { createdAt: "asc" } });
    return { subscription, payment, replayed: true, needsPayment: payment.status === "PENDING" && payment.method !== "CASH" };
  };
  if (r.existing) return replay(r.existing.id);
  try {
    const res = await createSubscription(user, { ...r.input, addressId: r.address.id, slotId: input.slotId ?? r.sub.slotId, method: input.method, idempotencyKey: input.idempotencyKey ?? null, renewedFromId: r.sub.id });
    if (!res.replayed) await db.subscriptionChange.create({ data: { subscriptionId: r.sub.id, type: "RENEW", detail: `Renewed as ${res.subscription.reference}`, amount: res.subscription.total, actorId: user.id } });
    return res;
  } catch (e) {
    if (e instanceof RenewalExists) return replay(e.subscriptionId);
    throw e;
  }
}

/**
 * After a weekly menu is published/edited: re-point rotation meals that are still editable to the
 * new chef's pick, keep the price paid, and tell customers what changed. Locked days are untouched.
 */
export async function syncRotationOrders(weekStart: string, actorId: string | null) {
  const end = addDays(weekStart, 6);
  const orders = await db.order.findMany({
    where: { followsRotation: true, deliveryDate: { gte: dateOnly(weekStart), lte: dateOnly(end) }, status: { in: ["PENDING_PAYMENT", "SCHEDULED"] } },
    include: { items: true, subscription: { select: { vegOnly: true } } },
  });
  if (!orders.length) return 0;
  const byKitchen = new Map<string, typeof orders>();
  for (const o of orders) byKitchen.set(o.kitchenId, [...(byKitchen.get(o.kitchenId) ?? []), o]);
  let changed = 0;
  for (const [kitchenId, list] of byKitchen) {
    const offers = await getOffersForDates(list.map((o) => isoDate(o.deliveryDate)), kitchenId);
    for (const o of list) {
      const pick = rotationPick(offers.get(isoDate(o.deliveryDate)), Boolean(o.subscription?.vegOnly));
      const item = o.items[0];
      if (!pick || !item || item.boxId === pick.box.id) continue;
      const f = boxFacts(pick.box);
      await db.$transaction([
        db.orderItem.update({ where: { id: item.id }, data: { boxId: pick.box.id, name: pick.box.name, details: pick.box.tagline, unitCost: f.cost, diet: f.diet, components: boxComponents(pick.box) as unknown as Prisma.InputJsonValue } }),
        db.order.update({ where: { id: o.id }, data: { costTotal: f.cost * item.quantity, version: { increment: 1 } } }),
        db.orderStatusEvent.create({ data: { orderId: o.id, fromStatus: o.status, toStatus: o.status, note: `Menu changed: ${item.name} → ${pick.box.name}`, actorId } }),
      ]);
      void notify("service.disruption", { userId: o.userId }, { date: isoDate(o.deliveryDate), reason: `Menu update: ${item.name} is now ${pick.box.name}`, outcome: "Same price. Skip or swap from your account before the cut-off if you prefer." }, { dedupeKey: `menuchg:${o.id}:${pick.box.id}` });
      changed++;
    }
  }
  return changed;
}

/** Cron: mark plans with no live meals left as completed; remind plans ending in `MealPlan.renewalReminderDays` days (not yet renewed). */
export async function completeAndRemind() {
  const today = todayKTM();
  const active = await db.subscription.findMany({ where: { status: "ACTIVE", endDate: { lt: dateOnly(today) } }, select: { id: true } });
  let completed = 0;
  for (const s of active) {
    const live = await db.order.count({ where: { subscriptionId: s.id, status: { in: ["SCHEDULED", "PENDING_PAYMENT", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY"] } } });
    if (!live) {
      await db.subscription.update({ where: { id: s.id }, data: { status: "COMPLETED" } });
      completed++;
    }
  }
  const soon = await db.subscription.findMany({
    where: { status: "ACTIVE", endDate: { gte: dateOnly(today), lte: dateOnly(addDays(today, 30)) }, renewals: { none: { status: { not: "CANCELLED" } } } },
    include: { plan: true },
  });
  const ending = soon.filter((s) => isoDate(s.endDate) === addDays(today, Math.max(0, s.plan.renewalReminderDays)));
  for (const s of ending) void notify("plan.reminder", { userId: s.userId }, { plan: s.plan.name, date: isoDate(s.endDate) }, { link: `/account/plans/${s.id}#renew`, dedupeKey: `remind:${s.id}:${isoDate(s.endDate)}` });
  return { completed, reminded: ending.length };
}

export { weekdayOf };
