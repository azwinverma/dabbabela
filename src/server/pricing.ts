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

export type PricedLine = { date: string; unitPrice: number; unitCost: number; qty: number };

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

export function couponDiscount(
  base: number,
  c: { type: "PERCENT" | "FLAT"; value: number; maxDiscount: number | null; minSubtotal: number },
) {
  if (base < c.minSubtotal) return 0;
  let d = c.type === "PERCENT" ? percentOf(base, c.value) : c.value;
  if (c.maxDiscount != null) d = Math.min(d, c.maxDiscount);
  return Math.max(0, Math.min(d, base));
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
  coupon?: { type: "PERCENT" | "FLAT"; value: number; maxDiscount: number | null; minSubtotal: number } | null;
}) {
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
      deliveryFee: deliveryFeeFor(subtotal, input.zone, input.company, input.globalFreeAbove),
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
  const coupon = input.coupon ? couponDiscount(subtotal - companyDiscount, input.coupon) : 0;
  const parts = allocate(companyDiscount + coupon, days.map((d) => d.subtotal));
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
