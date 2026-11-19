import type { Coupon, CouponScope, DiscountType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { rs } from "@/lib/money";
import { couponDiscount, isBoxScoped, lineEligible, type PricedLine } from "./pricing";
import { lockUser } from "./capacity";
import { RECOGNISED_STATUSES } from "./analytics/metrics";
import { assertReferralRedeemable, getReferralSettings, referralCouponFor, type Actor } from "./marketing";

type Tx = Prisma.TransactionClient;

export type CouponCheck = { ok: true; coupon: Coupon; discount: number } | { ok: false; error: string };

/**
 * Check a code typed at checkout (quote time; no writes except a referral claim, see below).
 *
 * - `base`: the amount the coupon works on (subtotal after the company discount).
 * - `lines` (optional): the priced lines. For a box-scoped coupon (`boxIds`) the minimum order and the discount are
 *   worked out on the eligible lines only (their share of `base`, the same maths as `pricing.ts`). Without lines the
 *   whole base is used (older callers).
 * - A free-delivery coupon is accepted even when its discount is 0 (pricing then zeroes the delivery fee).
 * - A friend's referral code is accepted on the referee's first order: it maps to the configured referral welcome
 *   coupon (returned with `code` = the referral code so the order records which code was used). Typing it links the
 *   account to that friend (one referral per customer, fraud rules in `marketing.ts`).
 */
export async function checkCoupon(
  rawCode: string,
  opts: { userId: string; base: number; scope: "ORDERS" | "SUBSCRIPTIONS"; lines?: PricedLine[] | null },
  client: Tx | typeof db = db,
): Promise<CouponCheck> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a code" };
  let coupon = await client.coupon.findUnique({ where: { code } });
  const referral = await getReferralSettings(client);
  if (coupon && referral.couponId && coupon.id === referral.couponId) return { ok: false, error: "That code isn't valid" };
  if (!coupon) {
    const r = await referralCouponFor(opts.userId, code, client);
    if (!r) return { ok: false, error: "That code isn't valid" };
    if (!r.ok) return { ok: false, error: r.error };
    coupon = { ...r.coupon, code };
  }
  if (!coupon.isActive) return { ok: false, error: "That code isn't valid" };
  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) return { ok: false, error: "That code isn't active yet" };
  if (coupon.endsAt && coupon.endsAt < now) return { ok: false, error: "That code has expired" };
  if (coupon.scope !== "ALL" && coupon.scope !== opts.scope)
    return { ok: false, error: coupon.scope === "ORDERS" ? "This code works on single orders only" : "This code works on meal plans only" };
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return { ok: false, error: "That code has been fully used" };

  // Box-scoped: the minimum and the discount use the eligible lines' share of the base.
  let eligible = opts.base;
  const scoped = isBoxScoped(coupon) && Array.isArray(opts.lines);
  if (scoped) {
    const gross = opts.lines!.reduce((a, l) => a + l.unitPrice * l.qty, 0);
    const eligibleGross = opts.lines!.filter((l) => lineEligible(l, coupon)).reduce((a, l) => a + l.unitPrice * l.qty, 0);
    if (eligibleGross <= 0) return { ok: false, error: "This code doesn't cover the dabbas in your cart" };
    eligible = gross > 0 ? Math.floor((eligibleGross * opts.base) / gross) : 0;
  }
  if (eligible < coupon.minSubtotal)
    return { ok: false, error: scoped ? `This code needs at least ${rs(coupon.minSubtotal)} of the dabbas it covers` : `This code needs an order of at least ${rs(coupon.minSubtotal)}` };

  if (coupon.perUserLimit != null) {
    const used = await client.couponRedemption.count({ where: { couponId: coupon.id, userId: opts.userId } });
    if (used >= coupon.perUserLimit) return { ok: false, error: "You've already used this code" };
  }
  if (coupon.firstOrderOnly) {
    const prior = await client.order.count({ where: { userId: opts.userId, status: { notIn: ["CANCELLED", "PENDING_PAYMENT"] } } });
    if (prior > 0) return { ok: false, error: "This code is for your first order" };
  }
  const discount = couponDiscount(opts.base, { ...coupon, minSubtotal: 0 }, eligible);
  if (discount <= 0 && !coupon.freeDelivery) return { ok: false, error: "This code doesn't apply to this order" };
  return { ok: true, coupon, discount };
}

export type CouponsCheck = { ok: true; coupons: { coupon: Coupon; discount: number }[] } | { ok: false; error: string };

/**
 * Several codes on one order: refused unless every coupon is `stackable` (referral welcome coupons never stack).
 * Checkout applies one code today; this is the single place the rule lives for callers that accept more.
 */
export async function checkCoupons(rawCodes: string[], opts: Parameters<typeof checkCoupon>[1], client: Tx | typeof db = db): Promise<CouponsCheck> {
  const codes = [...new Set(rawCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (!codes.length) return { ok: false, error: "Enter a code" };
  const out: { coupon: Coupon; discount: number }[] = [];
  for (const c of codes) {
    const r = await checkCoupon(c, opts, client);
    if (!r.ok) return { ok: false, error: `${c}: ${r.error}` };
    out.push({ coupon: r.coupon, discount: r.discount });
  }
  if (out.length > 1) {
    const referral = await getReferralSettings(client);
    const blocker = out.find((x) => !x.coupon.stackable || x.coupon.id === referral.couponId);
    if (blocker) return { ok: false, error: `${blocker.coupon.code} can't be combined with other codes` };
  }
  return { ok: true, coupons: out };
}

/**
 * Record a redemption inside the order transaction. The customer's redemptions are serialised with an advisory lock
 * (per-user limit can't be beaten by simultaneous checkouts) and the usage counter is bumped with a guarded UPDATE so
 * the global limit can't be exceeded either.
 */
export async function redeemCoupon(tx: Tx, p: { couponId: string; userId: string; amount: number; paymentId?: string; orderId?: string }) {
  await lockUser(tx, p.userId);
  const c = await tx.coupon.findUniqueOrThrow({ where: { id: p.couponId } });
  if (c.perUserLimit != null) {
    const used = await tx.couponRedemption.count({ where: { couponId: c.id, userId: p.userId } });
    if (used >= c.perUserLimit) throw new Error("You've already used this code");
  }
  await assertReferralRedeemable(tx, c.id, p.userId);
  const n = await tx.$executeRaw`
    UPDATE "Coupon" SET "usedCount" = "usedCount" + 1, "updatedAt" = now()
    WHERE id = ${p.couponId} AND "isActive" = true AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
  if (n !== 1) throw new Error("That coupon was just used up — please remove it and try again");
  await tx.couponRedemption.create({ data: p });
}

// ───────────────────────────── Admin: create / edit (pricing.edit) ─────────────────────────────

export class CouponError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export type CouponInput = {
  code: string;
  description?: string | null;
  type: DiscountType;
  value: number; // percent or paisa
  scope: CouponScope;
  minSubtotal: number;
  maxDiscount: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  firstOrderOnly: boolean;
  isActive: boolean;
  freeDelivery: boolean;
  boxIds: string[];
  stackable: boolean;
  campaignId: string | null;
};

function needPricing(actor: Actor, edit: boolean) {
  if (!can(actor, edit ? "pricing.edit" : "pricing.view")) throw new CouponError(`You don't have permission for this (${edit ? "pricing.edit" : "pricing.view"})`);
}

export function normaliseCouponCode(raw: string) {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 30);
}

/** Create or update a coupon. Validated on the server; audited with before/after; a used code needs a reason to change its value. */
export async function saveCouponRecord(actor: Actor, id: string | null, input: CouponInput, reason?: string | null) {
  needPricing(actor, true);
  const code = normaliseCouponCode(input.code);
  if (code.length < 3) throw new CouponError("Use at least 3 letters/numbers", "code");
  if (input.type === "PERCENT" && (input.value < 0 || input.value > 100 || !Number.isInteger(input.value))) throw new CouponError("Percent must be 0–100", "value");
  if (input.type === "FLAT" && (input.value < 0 || !Number.isInteger(input.value))) throw new CouponError("Enter the rupee discount", "value");
  if (input.value === 0 && !input.freeDelivery) throw new CouponError("A coupon needs a discount or free delivery", "value");
  if (input.startsAt && input.endsAt && input.endsAt < input.startsAt) throw new CouponError("Ends before it starts", "endsAt");
  for (const [k, v] of [["usageLimit", input.usageLimit], ["perUserLimit", input.perUserLimit]] as const)
    if (v != null && (!Number.isInteger(v) || v < 1)) throw new CouponError("Use a whole number of 1 or more (blank = unlimited)", k);
  if (input.minSubtotal < 0 || (input.maxDiscount != null && input.maxDiscount < 0)) throw new CouponError("Amounts can't be negative", "minSubtotal");
  const boxIds = [...new Set(input.boxIds.filter(Boolean))];
  if (boxIds.length) {
    const found = await db.lunchBox.count({ where: { id: { in: boxIds } } });
    if (found !== boxIds.length) throw new CouponError("One of the dabbas no longer exists", "boxIds");
  }
  if (input.campaignId && !(await db.campaign.findUnique({ where: { id: input.campaignId }, select: { id: true } }))) throw new CouponError("Campaign not found", "campaignId");
  if (await db.referralCode.findUnique({ where: { code }, select: { id: true } })) throw new CouponError("That code is a customer's referral code", "code");
  const clash = await db.coupon.findUnique({ where: { code }, select: { id: true } });
  if (clash && clash.id !== id) throw new CouponError("That code already exists", "code");

  const data = {
    code,
    description: input.description?.trim().slice(0, 200) || null,
    type: input.type,
    value: input.value,
    scope: input.scope,
    minSubtotal: input.minSubtotal,
    maxDiscount: input.maxDiscount,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    usageLimit: input.usageLimit,
    perUserLimit: input.perUserLimit,
    firstOrderOnly: input.firstOrderOnly,
    isActive: input.isActive,
    freeDelivery: input.freeDelivery,
    boxIds,
    stackable: input.stackable,
    campaignId: input.campaignId,
  };
  const before = id ? await db.coupon.findUnique({ where: { id } }) : null;
  if (id && !before) throw new CouponError("Coupon not found");
  const referral = await getReferralSettings();
  if (before && before.id === referral.couponId) throw new CouponError("This is the referral welcome coupon — change it under Campaigns → Referrals");
  if (before && before.usedCount > 0) {
    const valueChanged = before.type !== data.type || before.value !== data.value || before.freeDelivery !== data.freeDelivery || before.boxIds.join() !== data.boxIds.join() || before.maxDiscount !== data.maxDiscount;
    if (valueChanged && !reason?.trim()) throw new CouponError("This code has been used — give a reason for changing its value", "reason");
  }
  const c = id ? await db.coupon.update({ where: { id }, data }) : await db.coupon.create({ data });
  await audit({ actorId: actor.id, action: id ? "coupon.update" : "coupon.create", entity: "Coupon", entityId: c.id, summary: c.code, before, after: data, reason: reason?.trim() || null });
  return c;
}

export async function setCouponActive(actor: Actor, id: string, active: boolean) {
  needPricing(actor, true);
  const c = await db.coupon.findUnique({ where: { id } });
  if (!c) throw new CouponError("Not found");
  if (c.isActive === active) return c;
  const referral = await getReferralSettings();
  if (c.id === referral.couponId) throw new CouponError("Switch the referral programme on or off under Campaigns → Referrals");
  const u = await db.coupon.update({ where: { id }, data: { isActive: active } });
  await audit({ actorId: actor.id, action: active ? "coupon.enable" : "coupon.disable", entity: "Coupon", entityId: id, summary: c.code, before: { isActive: c.isActive }, after: { isActive: active } });
  return u;
}

// ───────────────────────────── Usage stats ─────────────────────────────

export type CouponUsage = {
  redemptions: number;
  customers: number;
  discount: number; // paisa given away (recorded at redemption)
  lastUsedAt: Date | null;
  orders: number; // orders paid with a redeeming payment
  /** Recognised revenue (analytics definition: Σ total − VAT − refunded of Delivered orders) of those orders. */
  revenue: number;
};

/** Usage per coupon id, from CouponRedemption rows and the orders sharing the redemption's payment. */
export async function couponUsage(couponIds: string[]): Promise<Map<string, CouponUsage>> {
  const out = new Map<string, CouponUsage>();
  if (!couponIds.length) return out;
  const reds = await db.couponRedemption.findMany({ where: { couponId: { in: couponIds } }, select: { couponId: true, userId: true, amount: true, paymentId: true, orderId: true, createdAt: true } });
  const paymentIds = [...new Set(reds.map((r) => r.paymentId).filter((x): x is string => Boolean(x)))];
  const orderIds = [...new Set(reds.map((r) => r.orderId).filter((x): x is string => Boolean(x)))];
  const orders = paymentIds.length || orderIds.length
    ? await db.order.findMany({
        where: { OR: [...(paymentIds.length ? [{ paymentId: { in: paymentIds } }] : []), ...(orderIds.length ? [{ id: { in: orderIds } }] : [])] },
        select: { id: true, paymentId: true, status: true, total: true, tax: true, refundedAmount: true },
      })
    : [];
  for (const id of couponIds) {
    const list = reds.filter((r) => r.couponId === id);
    const pay = new Set(list.map((r) => r.paymentId).filter(Boolean));
    const ord = new Set(list.map((r) => r.orderId).filter(Boolean));
    const os = orders.filter((o) => (o.paymentId && pay.has(o.paymentId)) || ord.has(o.id));
    out.set(id, {
      redemptions: list.length,
      customers: new Set(list.map((r) => r.userId)).size,
      discount: list.reduce((a, r) => a + r.amount, 0),
      lastUsedAt: list.reduce<Date | null>((a, r) => (!a || r.createdAt > a ? r.createdAt : a), null),
      orders: os.length,
      revenue: os.filter((o) => RECOGNISED_STATUSES.includes(o.status)).reduce((a, o) => a + o.total - o.tax - o.refundedAmount, 0),
    });
  }
  return out;
}
