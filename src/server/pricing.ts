/**
 * Pure pricing maths (no database). All amounts in paisa.
 * Used by cart quotes, subscriptions and tests. Callers load prices from the DB — never from the client.
 */
import { allocate, bpsOf, inclusiveTax, percentOf } from "@/lib/money";

export type TaxSpec = { rateBps: number; inclusive: boolean } | null;

export type ZoneSpec = { fee: number; freeAbove: number | null; minOrder: number } | null;

export type CompanySpec = {
  discountPct: number;
  freeDelivery: boolean;
  billingMode: "EMPLOYEE_PAID" | "COMPANY_PAID" | "SPLIT";
  subsidyPct: number;
  subsidyCap: number | null; // per meal
  allowanceRemaining: number | null; // this month, null = unlimited
} | null;

/** `boxId` (optional) lets box-scoped coupons find the lines they cover; custom dabbas have none. */
export type PricedLine = { date: string; unitPrice: number; unitCost: number; qty: number; boxId?: string | null };

/**
 * The coupon fields pricing needs (a full `Coupon` row also fits).
 * - `freeDelivery`: the delivery fee becomes 0 on every day of the order.
 * - `boxIds`: when non-empty, the discount is worked out only on lines for those dabbas.
 * - `stackable`: only matters when several coupons are passed (see `stackableCoupons`).
 */
export type CouponSpec = {
  type: "PERCENT" | "FLAT";
  value: number;
  maxDiscount: number | null;
  minSubtotal: number;
  freeDelivery?: boolean;
  boxIds?: string[] | null;
  stackable?: boolean;
};

export type DayTotals = {
  date: string;
  meals: number;
  subtotal: number;
  deliveryFee: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
  companyShare: number;
  customerShare: number;
  cost: number;
};

export function deliveryFeeFor(subtotal: number, zone: ZoneSpec, company: CompanySpec, globalFreeAbove: number) {
  if (!zone || company?.freeDelivery) return 0;
  const freeAbove = zone.freeAbove ?? (globalFreeAbove > 0 ? globalFreeAbove : null);
  if (freeAbove != null && subtotal >= freeAbove) return 0;
  return zone.fee;
}

export function taxFor(amount: number, tax: TaxSpec) {
  if (!tax || tax.rateBps <= 0) return { tax: 0, total: amount };
  if (tax.inclusive) return { tax: inclusiveTax(amount, tax.rateBps), total: amount };
  const t = bpsOf(amount, tax.rateBps);
  return { tax: t, total: amount + t };
}

/** Employer share of a total for `meals` meals; the remainder is the eater's. */
export function companyShareFor(total: number, meals: number, company: CompanySpec) {
  if (!company || total <= 0) return 0;
  let share = 0;
  if (company.billingMode === "COMPANY_PAID") share = total;
  else if (company.billingMode === "SPLIT") {
    share = percentOf(total, company.subsidyPct);
    if (company.subsidyCap != null) share = Math.min(share, company.subsidyCap * meals);
  }
  if (company.allowanceRemaining != null) share = Math.min(share, Math.max(0, company.allowanceRemaining));
  return Math.max(0, Math.min(total, share));
}

/**
 * Coupon amount. `base` is checked against `minSubtotal`; the discount is worked out on `eligible`
 * (the part of the base the coupon covers — all of it by default) and never exceeds it.
 */
export function couponDiscount(
  base: number,
  c: { type: "PERCENT" | "FLAT"; value: number; maxDiscount: number | null; minSubtotal: number },
  eligible: number = base,
) {
  if (base < c.minSubtotal) return 0;
  const on = Math.max(0, Math.min(eligible, base));
  let d = c.type === "PERCENT" ? percentOf(on, c.value) : c.value;
  if (c.maxDiscount != null) d = Math.min(d, c.maxDiscount);
  return Math.max(0, Math.min(d, on));
}

/** True when the coupon only covers some dabbas. */
export function isBoxScoped(c: Pick<CouponSpec, "boxIds"> | null | undefined) {
  return Boolean(c?.boxIds && c.boxIds.length > 0);
}

/** Does this line count towards the coupon? Unscoped coupons cover every line. */
export function lineEligible(line: Pick<PricedLine, "boxId">, c: Pick<CouponSpec, "boxIds">) {
  if (!isBoxScoped(c)) return true;
  return Boolean(line.boxId && c.boxIds!.includes(line.boxId));
}

/**
 * Coupons never stack unless every one of them is `stackable`; otherwise only the first is kept.
 * (Checkout applies one code today; this keeps the rule in one place.)
 */
export function stackableCoupons<T extends object>(coupons: (T | null | undefined)[]): T[] {
  const list = coupons.filter((c): c is T => Boolean(c));
  if (list.length <= 1) return list;
  return list.every((c) => (c as { stackable?: boolean }).stackable === true) ? list : [list[0]];
}

/**
 * Negotiated company price for a dabba (`CorporateContract.boxPrices` = { [boxId]: paisa }).
 * Falls back to the list price; only whole, non-negative paisa values are used.
 */
export function negotiatedUnitPrice(listPrice: number, boxId: string | null | undefined, boxPrices: unknown) {
  if (!boxId || !boxPrices || typeof boxPrices !== "object" || Array.isArray(boxPrices)) return listPrice;
  const v = (boxPrices as Record<string, unknown>)[boxId];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : listPrice;
}

/**
 * Price a multi-day basket: per-day delivery fee, company discount, a coupon spread across days
 * by subtotal, tax per day, and the employer/eater split (allowance consumed day by day).
 */
export function priceDays(input: {
  lines: PricedLine[];
  zone: ZoneSpec;
  company: CompanySpec;
  tax: TaxSpec;
  globalFreeAbove: number;
  coupon?: CouponSpec | null;
  /** Extra coupons. They apply only if every coupon (including `coupon`) is `stackable`. */
  coupons?: CouponSpec[] | null;
}) {
  const coupons = stackableCoupons([input.coupon, ...(input.coupons ?? [])]);
  const freeDelivery = coupons.some((c) => c.freeDelivery);
  const dates = [...new Set(input.lines.map((l) => l.date))].sort();
  const days: DayTotals[] = dates.map((date) => {
    const ls = input.lines.filter((l) => l.date === date);
    const subtotal = ls.reduce((a, l) => a + l.unitPrice * l.qty, 0);
    const cost = ls.reduce((a, l) => a + l.unitCost * l.qty, 0);
    const meals = ls.reduce((a, l) => a + l.qty, 0);
    return {
      date,
      meals,
      subtotal,
      deliveryFee: freeDelivery ? 0 : deliveryFeeFor(subtotal, input.zone, input.company, input.globalFreeAbove),
      discount: 0,
      taxable: 0,
      tax: 0,
      total: 0,
      companyShare: 0,
      customerShare: 0,
      cost,
    };
  });
  const subtotal = days.reduce((a, d) => a + d.subtotal, 0);
  const companyDiscount = input.company ? percentOf(subtotal, input.company.discountPct) : 0;
  // Each coupon works on what is left after the company discount and earlier coupons, so the
  // discount never exceeds the subtotal and totals never go negative.
  let remaining = subtotal - companyDiscount;
  let couponSum = 0;
  const scopedParts: number[][] = [];
  for (const c of coupons) {
    if (!isBoxScoped(c)) {
      const d = couponDiscount(remaining, c);
      couponSum += d;
      remaining -= d;
      continue;
    }
    // Box-scoped: eligible = those lines' share of what is left, spread over the days that carry them.
    const eligibleByDay = dates.map((date) => input.lines.filter((l) => l.date === date && lineEligible(l, c)).reduce((a, l) => a + l.unitPrice * l.qty, 0));
    const eligibleGross = eligibleByDay.reduce((a, b) => a + b, 0);
    const eligible = subtotal > 0 ? Math.floor((eligibleGross * remaining) / subtotal) : 0;
    const d = couponDiscount(remaining, c, eligible);
    couponSum += d;
    remaining -= d;
    scopedParts.push(allocate(d, eligibleByDay));
  }
  const scopedTotal = scopedParts.reduce((a, p) => a + p.reduce((x, y) => x + y, 0), 0);
  const parts = allocate(companyDiscount + couponSum - scopedTotal, days.map((d) => d.subtotal));
  for (const p of scopedParts) p.forEach((v, i) => (parts[i] += v));
  // Belt and braces: no day is discounted below zero.
  days.forEach((d, i) => (parts[i] = Math.min(parts[i], d.subtotal)));
  const coupon = Math.max(0, parts.reduce((a, b) => a + b, 0) - companyDiscount);
  let allowance = input.company?.allowanceRemaining ?? null;
  days.forEach((d, i) => {
    d.discount = parts[i];
    d.taxable = d.subtotal - d.discount + d.deliveryFee;
    const t = taxFor(d.taxable, input.tax);
    d.tax = t.tax;
    d.total = t.total;
    d.companyShare = companyShareFor(d.total, d.meals, input.company ? { ...input.company, allowanceRemaining: allowance } : null);
    if (allowance != null) allowance -= d.companyShare;
    d.customerShare = d.total - d.companyShare;
  });
  const sum = (k: keyof DayTotals) => days.reduce((a, d) => a + (d[k] as number), 0);
  return {
    days,
    subtotal,
    deliveryFee: sum("deliveryFee"),
    companyDiscount,
    couponDiscount: coupon,
    discount: companyDiscount + coupon,
    tax: sum("tax"),
    total: sum("total"),
    companyShare: sum("companyShare"),
    customerShare: sum("customerShare"),
    cost: sum("cost"),
  };
}

/** Spread a per-plan total over its meals so per-order amounts add up exactly. */
export function spreadOverMeals(
  perMealSubtotals: number[],
  totals: { deliveryFee: number; discount: number; tax: number; companyShare: number },
  taxInclusive: boolean,
) {
  const n = perMealSubtotals.length;
  const fee = allocate(totals.deliveryFee, Array(n).fill(1));
  const disc = allocate(totals.discount, perMealSubtotals);
  const tax = allocate(totals.tax, perMealSubtotals);
  const rows = perMealSubtotals.map((s, i) => {
    const base = s - disc[i] + fee[i];
    return { subtotal: s, deliveryFee: fee[i], discount: disc[i], tax: tax[i], total: taxInclusive ? base : base + tax[i] };
  });
  const cs = allocate(totals.companyShare, rows.map((r) => r.total));
  return rows.map((r, i) => ({ ...r, companyShare: cs[i], customerShare: r.total - cs[i] }));
}
