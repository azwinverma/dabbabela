"use server";

import type { CouponScope, DiscountType } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

export async function saveCoupon(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("pricing.edit", async (user) => {
    const code = f.str(fd, "code", 30).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    if (code.length < 3) throw new FieldError("code", "Use at least 3 letters/numbers");
    const type = (f.str(fd, "type") === "FLAT" ? "FLAT" : "PERCENT") as DiscountType;
    const scope = (["ALL", "ORDERS", "SUBSCRIPTIONS"].includes(f.str(fd, "scope")) ? f.str(fd, "scope") : "ALL") as CouponScope;
    let value: number;
    if (type === "PERCENT") {
      value = f.int(fd, "value", 0);
      if (value < 1 || value > 100) throw new FieldError("value", "Percent must be 1–100");
    } else {
      value = f.money(fd, "value", "Discount");
      if (value <= 0) throw new FieldError("value", "Enter the rupee discount");
    }
    const startsAt = f.date(fd, "startsAt");
    const endsAt = f.date(fd, "endsAt");
    if (startsAt && endsAt && endsAt < startsAt) throw new FieldError("endsAt", "Ends before it starts");
    const data = {
      code,
      description: f.opt(fd, "description", 200),
      type,
      value,
      scope,
      minSubtotal: f.moneyOpt(fd, "minSubtotal", "Minimum order") ?? 0,
      maxDiscount: f.moneyOpt(fd, "maxDiscount", "Max discount"),
      startsAt: startsAt ? new Date(`${startsAt}T00:00:00+05:45`) : null,
      endsAt: endsAt ? new Date(`${endsAt}T23:59:59+05:45`) : null,
      usageLimit: f.intOpt(fd, "usageLimit"),
      perUserLimit: f.intOpt(fd, "perUserLimit"),
      firstOrderOnly: f.bool(fd, "firstOrderOnly"),
      isActive: f.bool(fd, "isActive"),
    };
    const before = id ? await db.coupon.findUnique({ where: { id } }) : null;
    if (before && before.usedCount > 0 && (before.type !== type || before.value !== value)) {
      if (!f.str(fd, "reason")) throw new FieldError("reason", "This code has been used — give a reason for changing its value");
    }
    const c = id ? await db.coupon.update({ where: { id }, data }) : await db.coupon.create({ data });
    await audit({ actorId: user.id, action: id ? "coupon.update" : "coupon.create", entity: "Coupon", entityId: c.id, summary: c.code, before, after: data, reason: f.opt(fd, "reason") });
    return done(id ? "Coupon saved" : "Coupon created", id ? undefined : `/admin/coupons/${c.id}`);
  }, ["/admin/coupons"]);
}

export async function toggleCoupon(id: string): Promise<ActionResult> {
  return guarded("pricing.edit", async (user) => {
    const c = await db.coupon.findUnique({ where: { id } });
    if (!c) return fail("Not found");
    await db.coupon.update({ where: { id }, data: { isActive: !c.isActive } });
    await audit({ actorId: user.id, action: c.isActive ? "coupon.disable" : "coupon.enable", entity: "Coupon", entityId: id, summary: c.code });
    return done();
  }, ["/admin/coupons"]);
}
