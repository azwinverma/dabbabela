import type { Order, PaymentMethod, Prisma, Weekday } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { addDays, dateOnly, isoDate, ktmNow, todayKTM, weekdayOf, WEEKDAYS } from "@/lib/dates";
import { randomCode } from "@/lib/utils";
import { rs } from "@/lib/money";
import { activeCompany, type CurrentUser } from "@/lib/auth";
import { changeWindowOpen, dateProblem, getClosures, nextServiceDates, planDatesFrom } from "./calendar";
import { boxComponents, boxFacts, getOffersForDates, rotationPick, type DayOffer } from "./menu";
import { priceDays, type CompanySpec } from "./pricing";
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
  /** Calendar picks keyed by ISO date; dates without a pick follow the chef's rotation. */
  picks?: Record<string, DayPick>;
  vegOnly?: boolean;
  addressId?: string | null;
  zoneId?: string | null;
  couponCode?: string | null;
};

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

async function resolveMeals(dates: string[], input: PlanInput, plan: { pricePerMeal: number; compareAtPrice: number | null }, userId: string | null, kitchenId: string): Promise<Meal[]> {
  const settings = await getSettings();
  const offers = await getOffersForDates(dates, kitchenId);
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
  const plan = await db.mealPlan.findFirst({ where: { id: input.planId, isActive: true } });
  if (!plan) throw new OrderError("Pick a plan");
  const days = WEEKDAYS.filter((d) => input.days.includes(d) && settings.deliveryDays.includes(d));
  if (days.length < plan.minDaysPerWeek) throw new OrderError(`${plan.name} needs at least ${plan.minDaysPerWeek} days a week`);

  const address = user && input.addressId ? user.addresses.find((a) => a.id === input.addressId) ?? null : null;
  const zoneId = address?.zoneId ?? (!address ? input.zoneId : null) ?? null;
  const zone = zoneId ? await db.deliveryZone.findFirst({ where: { id: zoneId, isActive: true } }) : null;
  const kitchenId = zone?.kitchenId ?? (await db.kitchen.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } }))?.id;
  if (!kitchenId) throw new OrderError("No kitchen is open yet");

  const closures = await getClosures(input.startDate, addDays(input.startDate, plan.durationWeeks * 7 + 7), kitchenId);
  const company = activeCompany(user);
  const cutoff = company?.cutoffOverride ?? null;
  const allDates = planDatesFrom(input.startDate, plan.durationWeeks, days, settings.deliveryDays, closures);
  const now = ktmNow();
  const dates = allDates.filter((d) => !dateProblem(d, settings, closures, { cutoff, now, ignoreHorizon: true }));
  if (!dates.length) throw new OrderError("No delivery days fall in that range — try a later start date");

  const meals = await resolveMeals(dates, input, plan, user?.id ?? null, kitchenId);
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
  input: PlanInput & { addressId: string; slotId?: string | null; method: PaymentMethod; notes?: string | null; idempotencyKey?: string | null },
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
  const order = await db.order.findFirst({ where: { id: orderId, source: "SUBSCRIPTION", ...(userId ? { userId } : {}) }, include: { subscription: true, items: true, payment: true } });
  if (!order || !order.subscription) throw new OrderError("Meal not found");
  return order as typeof order & { subscription: NonNullable<typeof order.subscription> };
}

/**
 * Skip one meal before the cut-off. Policy (Settings → skipPolicy):
 * EXTEND = the meal moves to the end of the plan; CREDIT = its paid value goes to the wallet.
 * Unpaid plans always EXTEND (there is nothing to credit yet).
 */
export async function skipMeal(orderId: string, actor: { id: string; isStaff: boolean }, userId: string | null) {
  const settings = await getSettings();
  const order = await ownMeal(orderId, userId);
  if (!["SCHEDULED", "PENDING_PAYMENT"].includes(order.status)) throw new OrderError("This meal can't be skipped any more");
  const date = isoDate(order.deliveryDate);
  if (!actor.isStaff && !(await changeWindowOpen(date, order.kitchenId, settings))) throw new OrderError(`Skips for ${date} closed at ${settings.orderCutoff}`);
  const paid = order.paymentStatus === "PAID" && order.customerShare > 0;
  const policy = paid ? settings.skipPolicy : "EXTEND";
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
  if (!actor.isStaff && !(await changeWindowOpen(date, order.kitchenId, settings))) throw new OrderError(`Changes for ${date} closed at ${settings.orderCutoff}`);
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
  await db.subscription.update({ where: { id: subId }, data: { status: "ACTIVE" } });
  if (pause && !pause.toDate) await db.subscriptionPause.update({ where: { id: pause.id }, data: { toDate: dateOnly(todayKTM()) } });
  const added = await appendMeals(subId, fresh, actor.id, "Re-added after pause");
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
  const sub = await db.subscription.findFirst({ where: { id: subId, ...(opts.userId ? { userId: opts.userId } : {}) } });
  if (!sub || ["CANCELLED", "COMPLETED"].includes(sub.status)) throw new OrderError("This plan can't be cancelled");
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
    const pending = await tx.payment.findFirst({ where: { subscriptionId: subId, status: "PENDING" } });
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

/** Cron: mark plans with no live meals left as completed; remind plans ending in 2 days. */
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
  const ending = await db.subscription.findMany({ where: { status: "ACTIVE", endDate: dateOnly(addDays(today, 2)) }, include: { plan: true } });
  for (const s of ending) void notify("plan.reminder", { userId: s.userId }, { plan: s.plan.name, date: isoDate(s.endDate) }, { link: "/plans", dedupeKey: `remind:${s.id}:${isoDate(s.endDate)}` });
  return { completed, reminded: ending.length };
}

export { weekdayOf };
