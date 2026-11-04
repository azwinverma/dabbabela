import type { Coupon, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { couponDiscount } from "./pricing";

type Tx = Prisma.TransactionClient;

export type CouponCheck = { ok: true; coupon: Coupon; discount: number } | { ok: false; error: string };

export async function checkCoupon(
  rawCode: string,
  opts: { userId: string; base: number; scope: "ORDERS" | "SUBSCRIPTIONS" },
  client: Tx | typeof db = db,
): Promise<CouponCheck> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a code" };
  const coupon = await client.coupon.findUnique({ where: { code } });
  if (!coupon || !coupon.isActive) return { ok: false, error: "That code isn't valid" };
  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) return { ok: false, error: "That code isn't active yet" };
  if (coupon.endsAt && coupon.endsAt < now) return { ok: false, error: "That code has expired" };
  if (coupon.scope !== "ALL" && coupon.scope !== opts.scope)
    return { ok: false, error: coupon.scope === "ORDERS" ? "This code works on single orders only" : "This code works on meal plans only" };
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) return { ok: false, error: "That code has been fully used" };
  if (opts.base < coupon.minSubtotal) return { ok: false, error: `This code needs an order of at least ${rs(coupon.minSubtotal)}` };
  if (coupon.perUserLimit != null) {
    const used = await client.couponRedemption.count({ where: { couponId: coupon.id, userId: opts.userId } });
    if (used >= coupon.perUserLimit) return { ok: false, error: "You've already used this code" };
  }
  if (coupon.firstOrderOnly) {
    const prior = await client.order.count({ where: { userId: opts.userId, status: { notIn: ["CANCELLED", "PENDING_PAYMENT"] } } });
    if (prior > 0) return { ok: false, error: "This code is for your first order" };
  }
  const discount = couponDiscount(opts.base, coupon);
  if (discount <= 0) return { ok: false, error: "This code doesn't apply to this order" };
  return { ok: true, coupon, discount };
}

/**
 * Record a redemption inside the order transaction. The usage counter is bumped with a guarded
 * UPDATE so the global limit can't be exceeded by concurrent checkouts.
 */
export async function redeemCoupon(tx: Tx, p: { couponId: string; userId: string; amount: number; paymentId?: string; orderId?: string }) {
  const n = await tx.$executeRaw`
    UPDATE "Coupon" SET "usedCount" = "usedCount" + 1, "updatedAt" = now()
    WHERE id = ${p.couponId} AND "isActive" = true AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")`;
  if (n !== 1) throw new Error("That coupon was just used up — please remove it and try again");
  const c = await tx.coupon.findUniqueOrThrow({ where: { id: p.couponId } });
  if (c.perUserLimit != null) {
    const used = await tx.couponRedemption.count({ where: { couponId: c.id, userId: p.userId } });
    if (used >= c.perUserLimit) throw new Error("You've already used this code");
  }
  await tx.couponRedemption.create({ data: p });
}
