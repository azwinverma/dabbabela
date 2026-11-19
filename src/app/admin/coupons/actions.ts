"use server";

import type { CouponScope, DiscountType } from "@prisma/client";
import { done, fail, type ActionResult } from "@/lib/action";
import { CouponError, saveCouponRecord, setCouponActive } from "@/server/coupons";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

function rethrow(e: unknown): never {
  if (e instanceof CouponError && e.field) throw new FieldError(e.field, e.message);
  throw e;
}

export async function saveCoupon(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("pricing.edit", async (user) => {
    const type = (f.str(fd, "type") === "FLAT" ? "FLAT" : "PERCENT") as DiscountType;
    const scope = (["ALL", "ORDERS", "SUBSCRIPTIONS"].includes(f.str(fd, "scope")) ? f.str(fd, "scope") : "ALL") as CouponScope;
    const freeDelivery = f.bool(fd, "freeDelivery");
    const rawValue = f.str(fd, "value");
    let value = 0;
    if (rawValue || !freeDelivery) {
      if (type === "PERCENT") {
        value = f.int(fd, "value", -1);
        if (value < 0 || value > 100) throw new FieldError("value", "Percent must be 0–100");
      } else value = f.money(fd, "value", "Discount");
    }
    const startsAt = f.date(fd, "startsAt");
    const endsAt = f.date(fd, "endsAt");
    try {
      const c = await saveCouponRecord(
        user,
        id,
        {
          code: f.str(fd, "code", 40),
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
          freeDelivery,
          boxIds: f.all(fd, "boxIds"),
          stackable: f.bool(fd, "stackable"),
          campaignId: f.opt(fd, "campaignId", 64),
        },
        f.opt(fd, "reason", 300),
      );
      return done(id ? "Coupon saved" : "Coupon created", id ? undefined : `/admin/coupons/${c.id}`);
    } catch (e) {
      rethrow(e);
    }
  }, ["/admin/coupons"]);
}

export async function toggleCoupon(id: string, active: boolean): Promise<ActionResult> {
  return guarded("pricing.edit", async (user) => {
    try {
      await setCouponActive(user, id, active);
      return done();
    } catch (e) {
      if (e instanceof CouponError) return fail(e.message);
      throw e;
    }
  }, ["/admin/coupons"]);
}
