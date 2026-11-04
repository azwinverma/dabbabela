import { describe, expect, it } from "vitest";
import { companyShareFor, couponDiscount, deliveryFeeFor, priceDays, spreadOverMeals, taxFor } from "@/server/pricing";

const zone = { fee: 4000, freeAbove: 100000, minOrder: 0 };

describe("pricing", () => {
  it("charges delivery per day unless free by amount or company", () => {
    expect(deliveryFeeFor(20000, zone, null, 0)).toBe(4000);
    expect(deliveryFeeFor(100000, zone, null, 0)).toBe(0);
    expect(deliveryFeeFor(20000, zone, { discountPct: 0, freeDelivery: true, billingMode: "EMPLOYEE_PAID", subsidyPct: 0, subsidyCap: null, allowanceRemaining: null }, 0)).toBe(0);
    expect(deliveryFeeFor(20000, null, null, 0)).toBe(0);
  });
  it("handles inclusive and exclusive VAT", () => {
    expect(taxFor(11300, { rateBps: 1300, inclusive: true })).toEqual({ tax: 1300, total: 11300 });
    expect(taxFor(10000, { rateBps: 1300, inclusive: false })).toEqual({ tax: 1300, total: 11300 });
    expect(taxFor(10000, null)).toEqual({ tax: 0, total: 10000 });
  });
  it("caps coupons", () => {
    expect(couponDiscount(40000, { type: "PERCENT", value: 15, maxDiscount: 6000, minSubtotal: 0 })).toBe(6000);
    expect(couponDiscount(20000, { type: "PERCENT", value: 15, maxDiscount: 6000, minSubtotal: 0 })).toBe(3000);
    expect(couponDiscount(3000, { type: "FLAT", value: 5000, maxDiscount: null, minSubtotal: 0 })).toBe(3000);
    expect(couponDiscount(3000, { type: "FLAT", value: 5000, maxDiscount: null, minSubtotal: 10000 })).toBe(0);
  });
  it("splits employer subsidy with per-meal cap and monthly allowance", () => {
    const co = { discountPct: 0, freeDelivery: true, billingMode: "SPLIT" as const, subsidyPct: 50, subsidyCap: 8000, allowanceRemaining: null };
    expect(companyShareFor(20000, 1, co)).toBe(8000); // 50% = 100, capped at 80
    expect(companyShareFor(20000, 1, { ...co, subsidyCap: null })).toBe(10000);
    expect(companyShareFor(20000, 1, { ...co, allowanceRemaining: 5000 })).toBe(5000);
    expect(companyShareFor(20000, 1, { ...co, billingMode: "COMPANY_PAID" })).toBe(20000);
    expect(companyShareFor(20000, 1, { ...co, billingMode: "EMPLOYEE_PAID" })).toBe(0);
  });
  it("prices a multi-day basket so parts add up", () => {
    const r = priceDays({
      lines: [
        { date: "2026-11-08", unitPrice: 20000, unitCost: 9000, qty: 2 },
        { date: "2026-11-09", unitPrice: 20000, unitCost: 9000, qty: 1 },
      ],
      zone,
      company: null,
      tax: { rateBps: 1300, inclusive: true },
      globalFreeAbove: 0,
      coupon: { type: "FLAT", value: 5000, maxDiscount: null, minSubtotal: 0 },
    });
    expect(r.subtotal).toBe(60000);
    expect(r.deliveryFee).toBe(8000);
    expect(r.couponDiscount).toBe(5000);
    expect(r.days.map((d) => d.discount)).toEqual([3333, 1667]);
    expect(r.total).toBe(60000 - 5000 + 8000);
    expect(r.days.reduce((a, d) => a + d.total, 0)).toBe(r.total);
    expect(r.customerShare).toBe(r.total);
  });
  it("consumes the allowance across days", () => {
    const r = priceDays({
      lines: [
        { date: "2026-11-08", unitPrice: 20000, unitCost: 0, qty: 1 },
        { date: "2026-11-09", unitPrice: 20000, unitCost: 0, qty: 1 },
      ],
      zone: null,
      company: { discountPct: 0, freeDelivery: true, billingMode: "SPLIT", subsidyPct: 50, subsidyCap: null, allowanceRemaining: 15000 },
      tax: null,
      globalFreeAbove: 0,
    });
    expect(r.days.map((d) => d.companyShare)).toEqual([10000, 5000]);
    expect(r.customerShare).toBe(25000);
  });
  it("spreads plan totals exactly over meals", () => {
    const rows = spreadOverMeals([18000, 18000, 18000], { deliveryFee: 0, discount: 5000, tax: 0, companyShare: 10000 }, true);
    expect(rows.reduce((a, r) => a + r.total, 0)).toBe(54000 - 5000);
    expect(rows.reduce((a, r) => a + r.companyShare, 0)).toBe(10000);
  });
});
