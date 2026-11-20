import { beforeAll, describe, expect, it } from "vitest";
import type { OrderPaymentStatus, OrderStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { parseFilters, type AnalyticsFilters } from "@/server/analytics/filters";
import * as rev from "@/server/analytics/revenue";
import { stockValuation } from "@/server/inventory";
import { deliveryPerformance } from "@/server/dispatch";
import { cac } from "@/server/reports";
import { REPORT_LIST, ReportDenied, exportReport, runReport } from "@/server/reports-center";
import { unzipEntries } from "@/server/reports-center/xlsx";
import { ensureFoundationData } from "@/server/foundation";
import { loadUser } from "../helpers";

/**
 * WP-10 reports center. A fixed dataset in brand-new kitchens in May 2019 (no other test uses those kitchens or
 * dates). Report totals are asserted against hand-computed values AND against the analytics / inventory / dispatch
 * functions they must reconcile with.
 */

const R = { from: "2019-05-01", to: "2019-05-31" };
const at = (d: string, time = "10:00") => new Date(`${d}T${time}:00+05:45`);
const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
let n = 0;
const ids = {} as { k1: string; k2: string; co: string; u1: string; u2: string; o1: string; o2: string; o4: string; ing: string; slot: string };
let F: AnalyticsFilters;
let SP: Record<string, string>;

async function order(o: {
  user: string;
  kitchen: string;
  company?: string | null;
  created: Date;
  delivery: string;
  status: OrderStatus;
  pay?: OrderPaymentStatus;
  total: number;
  tax?: number;
  refunded?: number;
  companyShare?: number;
  customerShare?: number;
  items: { name: string; line: number; cost?: number; qty?: number }[];
  payment?: string | null;
  slot?: string | null;
}) {
  n++;
  return db.order.create({
    data: {
      number: `RC-${n}-${Date.now()}`,
      code: `R${n}`,
      userId: o.user,
      kitchenId: o.kitchen,
      companyId: o.company ?? null,
      createdAt: o.created,
      deliveryDate: day(o.delivery),
      status: o.status,
      paymentStatus: o.pay ?? "PAID",
      source: "SINGLE",
      contactName: "Test",
      contactPhone: "+9779812345678",
      addressLine: "Line",
      area: "Baneshwor",
      subtotal: o.total,
      total: o.total,
      tax: o.tax ?? 0,
      refundedAmount: o.refunded ?? 0,
      companyShare: o.companyShare ?? 0,
      customerShare: o.customerShare ?? o.total,
      costTotal: o.items.reduce((a, i) => a + (i.cost ?? 0) * (i.qty ?? 1), 0),
      paymentId: o.payment ?? null,
      slotId: o.slot ?? null,
      items: { create: o.items.map((i) => ({ name: i.name, components: [{ menuItemId: "x", name: `${i.name} curry`, qty: 1 }], diet: "VEG", quantity: i.qty ?? 1, unitPrice: i.line, lineTotal: i.line, unitCost: i.cost ?? 0 })) },
    },
  });
}

async function payment(p: { user: string; method: Prisma.PaymentCreateInput["method"]; status: Prisma.PaymentCreateInput["status"]; amount: number; paidAt?: Date | null }) {
  n++;
  return db.payment.create({ data: { reference: `RCP-${n}-${Date.now()}`, userId: p.user, method: p.method, status: p.status, amount: p.amount, paidAt: p.paidAt ?? null } });
}

beforeAll(async () => {
  const stamp = Date.now();
  const k1 = await db.kitchen.create({ data: { name: "Reports K1", code: `RK1${stamp}` } });
  const k2 = await db.kitchen.create({ data: { name: "Reports K2", code: `RK2${stamp}` } });
  const co = await db.company.create({ data: { name: "Reports Co", slug: `reports-co-${stamp}` } });
  const u1 = await db.user.create({ data: { name: "Rc One", email: `rc1-${stamp}@test.local` } });
  const u2 = await db.user.create({ data: { name: "Rc Two", email: `rc2-${stamp}@test.local` } });
  const slot = await db.deliverySlot.create({ data: { kitchenId: k1.id, label: "12:00 – 13:00", startTime: "12:00", endTime: "13:00" } });

  // O1 — delivered, eSewa. recognised 20000 − 2300 = 17700. Box A cost 8000.
  const p1 = await payment({ user: u1.id, method: "ESEWA", status: "PAID", amount: 20000, paidAt: at("2019-05-02") });
  const o1 = await order({ user: u1.id, kitchen: k1.id, created: at("2019-05-02"), delivery: "2019-05-03", status: "DELIVERED", total: 20000, tax: 2300, items: [{ name: "RC Box A", line: 20000, cost: 8000 }], payment: p1.id, slot: slot.id });
  // O2 — corporate, cash, refunded 5000 (bank) + 1000 wallet. recognised 30000 − 3450 − 5000 = 21550,
  //      allocated by line value: A 21550 × 1/3 = 7183.33 → 7183, B 21550 × 2/3 = 14366.67 → 14367.
  const p2 = await payment({ user: u2.id, method: "CASH", status: "PARTIALLY_REFUNDED", amount: 30000, paidAt: at("2019-05-10") });
  const o2 = await order({
    user: u2.id,
    kitchen: k1.id,
    company: co.id,
    created: at("2019-05-09"),
    delivery: "2019-05-10",
    status: "DELIVERED",
    pay: "PARTIALLY_REFUNDED",
    total: 30000,
    tax: 3450,
    refunded: 5000,
    companyShare: 20000,
    customerShare: 10000,
    items: [
      { name: "RC Box A", line: 10000, cost: 3000 },
      { name: "RC Box B", line: 20000, cost: 9000 },
    ],
    payment: p2.id,
    slot: slot.id,
  });
  await db.refund.create({ data: { paymentId: p2.id, orderId: o2.id, amount: 5000, reason: "cold", method: "BANK", status: "PROCESSED", processedAt: at("2019-05-11") } });
  await db.refund.create({ data: { paymentId: p2.id, orderId: o2.id, amount: 1000, reason: "late", method: "WALLET_CREDIT", status: "PROCESSED", processedAt: at("2019-05-11") } });
  // Staff edits on O2 (WP-03): company share +1500, customer −500.
  await db.orderAdjustment.create({ data: { orderId: o2.id, amount: 1500, reason: "Company share — Swap: extra egg" } });
  await db.orderAdjustment.create({ data: { orderId: o2.id, amount: -500, reason: "Swap: extra egg — credited to wallet" } });
  // O3 — cancelled (cancelled value 15000; not booked).
  const o3 = await order({ user: u1.id, kitchen: k1.id, created: at("2019-05-11"), delivery: "2019-05-12", status: "CANCELLED", pay: "UNPAID", total: 15000, items: [{ name: "RC Box A", line: 15000 }] });
  await db.orderStatusEvent.create({ data: { orderId: o3.id, fromStatus: "SCHEDULED", toStatus: "CANCELLED", note: "customer travelling" } });
  // O4 — scheduled, cash pending 12000 (booked, not recognised; receivable).
  const p4 = await payment({ user: u1.id, method: "CASH", status: "PENDING", amount: 12000 });
  const o4 = await order({ user: u1.id, kitchen: k1.id, created: at("2019-05-15"), delivery: "2019-05-20", status: "SCHEDULED", pay: "PENDING", total: 12000, items: [{ name: "RC Box B", line: 12000 }], payment: p4.id });
  // K2 order — must never show under kitchen K1.
  await order({ user: u2.id, kitchen: k2.id, created: at("2019-05-04"), delivery: "2019-05-05", status: "DELIVERED", total: 9900, items: [{ name: "RC Box Z", line: 9900 }] });

  // Company invoice: 50000 issued, 10000 paid → 40000 outstanding.
  await db.invoice.create({ data: { number: `RC-INV-${stamp}`, companyId: co.id, periodStart: day("2019-04-01"), periodEnd: day("2019-04-30"), status: "PARTIALLY_PAID", billingName: "Reports Co", subtotal: 50000, total: 50000, paidAmount: 10000 } });

  // Stock: +10 unlotted, +5 in a lot at 150, usage −2 @120, waste −1 @120 (cost 100/unit otherwise).
  const ing = await db.ingredient.create({ data: { name: `RC Rice ${stamp}`, unit: "KG", costPerUnit: 100 } });
  const lot = await db.stockLot.create({ data: { ingredientId: ing.id, kitchenId: k1.id, code: `RCL${stamp}`, receivedQty: 5, remainingQty: 5, unitCost: 150 } });
  await db.stockMovement.createMany({
    data: [
      { ingredientId: ing.id, kitchenId: k1.id, type: "RECEIPT", quantity: 10, unitCost: 100, createdAt: at("2019-05-01") },
      { ingredientId: ing.id, kitchenId: k1.id, type: "RECEIPT", quantity: 5, unitCost: 150, lotId: lot.id, createdAt: at("2019-05-01") },
      { ingredientId: ing.id, kitchenId: k1.id, type: "USAGE", quantity: -2, unitCost: 120, createdAt: at("2019-05-03") },
      { ingredientId: ing.id, kitchenId: k1.id, type: "WASTE", quantity: -1, unitCost: 120, note: "spilled", createdAt: at("2019-05-04") },
    ],
  });

  // Delivery events: O1 delivered 12:30 (on time, slot ends 13:00), O2 delivered 14:00 (late).
  await db.deliveryEvent.create({ data: { orderId: o1.id, type: "DELIVERED", createdAt: at("2019-05-03", "12:30") } });
  await db.deliveryEvent.create({ data: { orderId: o2.id, type: "DELIVERED", createdAt: at("2019-05-10", "14:00") } });

  // Campaign spend for CAC (May 2019).
  const camp = await db.campaign.create({ data: { name: `RC Campaign ${stamp}`, channel: "FACEBOOK" } });
  await db.campaignSpend.create({ data: { campaignId: camp.id, date: day("2019-05-15"), amount: 30000 } });

  Object.assign(ids, { k1: k1.id, k2: k2.id, co: co.id, u1: u1.id, u2: u2.id, o1: o1.id, o2: o2.id, o4: o4.id, ing: ing.id, slot: slot.id });
  SP = { ...R, kitchen: k1.id };
  F = parseFilters(SP, { kitchenIds: null });
});

const owner = () => loadUser("owner@test.local");

describe("reports center totals reconcile with analytics", () => {
  it("sales: period rows add up to the analytics revenue bases", async () => {
    const u = await owner();
    const [r, b, c] = await Promise.all([rev.recognised(F), rev.bookings(F), rev.cash(F)]);
    expect(r.value).toBe(17700 + 21550);
    expect(r.adjustments).toBe(1000); // +1500 company − 500 customer
    expect([r.adjustmentsCompany, r.adjustmentsCustomer]).toEqual([1500, -500]);
    expect(b.total).toBe(20000 + 30000 + 12000); // O3 cancelled isn't booked
    expect(c.net).toBe(20000 + 30000 - 5000); // wallet refund moves no cash

    for (const key of ["daily-sales", "weekly-sales", "monthly-sales", "annual-sales"]) {
      const out = await runReport(u, key, SP, { all: true });
      expect([key, out.totals?.recognised, out.totals?.bookings, out.totals?.cash]).toEqual([key, r.value, b.total, c.net]);
    }
    const monthly = await runReport(u, "monthly-sales", SP);
    expect(monthly.rows).toHaveLength(1);
    expect(monthly.rows[0]).toMatchObject({ period: "2019-05", delivered: 2, recognised: 39250 });
    expect(monthly.summary?.find((s) => s.label === "Order adjustments on delivered orders")?.value).toBe(1000);
  });

  it("revenue by meal / kitchen / corporate client and meal profitability", async () => {
    const u = await owner();
    const meal = await runReport(u, "revenue-by-meal", SP, { all: true });
    expect(meal.rows.map((x) => [x.name, x.qty, x.revenue])).toEqual([
      ["RC Box A", 2, 17700 + 7183],
      ["RC Box B", 1, 14367],
    ]);
    expect(meal.totals?.revenue).toBe(39250);

    const prof = await runReport(u, "meal-profitability", SP, { all: true });
    expect(prof.rows.find((x) => x.name === "RC Box A")).toMatchObject({ cost: 11000, margin: 24883 - 11000 });
    expect(prof.totals).toMatchObject({ revenue: 39250, cost: 20000, margin: 19250 });

    const kit = await runReport(u, "revenue-by-kitchen", SP, { all: true });
    expect(kit.rows).toEqual([expect.objectContaining({ kitchen: "Reports K1", orders: 2, revenue: 39250 })]);

    const corp = await runReport(u, "revenue-by-corporate", SP, { all: true });
    expect(corp.rows).toEqual([expect.objectContaining({ company: "Reports Co", orders: 1, revenue: 21550, companyShare: 20000, companyAdjustments: 1500, employeeShare: 10000 })]);
  });

  it("order status, cancellations and refunds", async () => {
    const u = await owner();
    const st = await runReport(u, "order-status", SP, { all: true });
    const by = Object.fromEntries(st.rows.map((x) => [x.status, x.count]));
    expect([by.DELIVERED, by.CANCELLED, by.SCHEDULED]).toEqual([2, 1, 1]);
    expect(st.totals).toMatchObject({ count: 4, value: 20000 + 30000 + 15000 + 12000 });

    const canc = await runReport(u, "cancellations", SP);
    expect(canc.count).toBe(1);
    expect(canc.totals?.total).toBe((await rev.cancelled(F)).value);
    expect(canc.rows[0].reason).toContain("customer travelling");

    const ref = await runReport(u, "refunds", SP);
    expect(ref.count).toBe(2);
    expect(ref.totals?.amount).toBe(6000);
    const cashOut = ref.summary?.find((s) => s.label === "Refunds paid out")?.value;
    expect(cashOut).toBe(5000);
    expect(cashOut).toBe((await rev.cash(F)).refunds);
    expect(ref.summary?.find((s) => s.label === "Refunded as wallet credit")?.value).toBe(1000);
  });

  it("outstanding payments include unbilled company adjustments and reconcile with receivables", async () => {
    const u = await owner();
    const companies = await runReport(u, "outstanding-payments", { company: ids.co, side: "companies" }, { all: true });
    // invoices 50000 − 10000; meals not invoiced = O2 company share 20000; unbilled company adjustment 1500.
    expect(companies.rows).toEqual([expect.objectContaining({ company: "Reports Co", invoices: 40000, uninvoiced: 20000, adjustments: 1500, total: 61500 })]);
    const recv = await rev.receivables(parseFilters({ company: ids.co }, { kitchenIds: null }));
    expect(recv.invoicesOutstanding).toBe(40000);
    expect(recv.companyUnbilled).toBe(21500);

    const customers = await runReport(u, "outstanding-payments", { ...SP, side: "customers" });
    expect(customers.count).toBe(1);
    expect(customers.totals?.amount).toBe(12000);
    expect(customers.totals?.amount).toBe((await rev.receivables(F)).pending);
  });

  it("inventory valuation, consumption and wastage reconcile with stockValuation / food cost", async () => {
    const u = await owner();
    const val = await runReport(u, "inventory-valuation", { kitchen: ids.k1 }, { all: true });
    // on hand 10 + 5 − 2 − 1 = 12: lot 5 × 150 = 750 + unlotted 7 × 100 = 700.
    expect(val.totals?.value).toBe(1450);
    expect(val.totals?.value).toBe((await stockValuation([ids.k1])).total);

    const cons = await runReport(u, "ingredient-consumption", SP, { all: true });
    expect(cons.rows).toEqual([expect.objectContaining({ used: 2, wasted: 1, usageCost: 240, wasteCost: 120, cost: 360 })]);
    const food = (await rev.profitability(F)).lines.find((l) => l.key === "food");
    expect(food?.actual).toBe(360);

    const waste = await runReport(u, "stock-wastage", SP);
    expect([waste.count, waste.totals?.cost, waste.rows[0].note]).toEqual([1, 120, "spilled"]);
  });

  it("delivery performance matches dispatch.deliveryPerformance", async () => {
    const u = await owner();
    const out = await runReport(u, "delivery-performance", { ...SP, by: "zone" }, { all: true });
    const dp = await deliveryPerformance({ ...R, kitchenIds: [ids.k1] });
    expect(out.totals).toMatchObject({ delivered: 2, withSlot: 2, onTime: 1, onTimeRate: 0.5 });
    expect(out.totals?.delivered).toBe(dp.total.delivered);
    expect(out.totals?.onTime).toBe(dp.total.onTime);
  });

  it("CAC reads Σ CampaignSpend for the month", async () => {
    const r = await cac("2019-05");
    expect(r.spend).toBe(30000);
    expect(r.cac).toBe(r.newCustomers ? Math.round(30000 / r.newCustomers) : null);
  });
});

describe("pagination, filters, permissions, export", () => {
  it("paginates server-side with whole-result totals", async () => {
    const u = await owner();
    const p1 = await runReport(u, "daily-sales", { ...SP, per: "25" });
    const p2 = await runReport(u, "daily-sales", { ...SP, per: "25", page: "2" });
    expect([p1.count, p1.rows.length, p2.rows.length]).toEqual([31, 25, 6]);
    expect(p2.rows[0].period).toBe("2019-05-26");
    expect(p1.totals?.recognised).toBe(39250);
    expect(p2.totals?.recognised).toBe(39250);
  });

  it("applies kitchen scope and filters", async () => {
    const u = await owner();
    const corporate = await runReport(u, "revenue-by-kitchen", { ...SP, ctype: "CORPORATE" });
    expect(corporate.totals?.revenue).toBe(21550);
    const k2 = await runReport(u, "revenue-by-kitchen", { ...R, kitchen: ids.k2 });
    expect(k2.totals?.revenue).toBe(9900);

    // A finance user scoped to K1 asking for K2 still only sees K1.
    const scoped = await db.user.create({ data: { name: "Scoped Finance", email: `rc-fin-${Date.now()}@test.local`, role: "FINANCE", kitchenId: ids.k1 } });
    const su = await loadUser(scoped.email);
    const out = await runReport(su, "revenue-by-kitchen", { ...R, kitchen: ids.k2 });
    expect(out.rows.map((r) => r.kitchen)).toEqual(["Reports K1"]);
    expect(out.totals?.revenue).toBe(39250);
  });

  it("export needs reports.export + the report's export keys; masks PII; audits; XLSX is a valid workbook", async () => {
    const chef = await loadUser("chef@demo.dabbabela.local");
    await expect(exportReport(chef, "order-status", SP, "csv")).rejects.toBeInstanceOf(ReportDenied);
    await expect(runReport(chef, "daily-sales", SP)).rejects.toBeInstanceOf(ReportDenied);
    const ops = await loadUser("ops@demo.dabbabela.local"); // reports.export but no analytics.export / analytics.view
    await expect(exportReport(ops, "daily-sales", SP, "csv")).rejects.toBeInstanceOf(ReportDenied);
    expect((await exportReport(ops, "order-status", SP, "csv")).rows).toBeGreaterThan(0);

    const u1 = await db.user.findUniqueOrThrow({ where: { id: ids.u1 } });
    const finance = await loadUser("finance@demo.dabbabela.local"); // no customers.pii
    const masked = await exportReport(finance, "cancellations", SP, "csv");
    expect(masked.body).not.toContain(u1.email!);
    expect(masked.body).not.toContain("+9779812345678");
    const view = await runReport(finance, "cancellations", SP);
    expect(view.piiMasked).toBe(true);
    expect(view.rows[0].email).not.toBe(u1.email);
    const log = await db.auditLog.findFirst({ where: { action: "report.export", actorId: finance.id, entityId: "cancellations" }, orderBy: { createdAt: "desc" } });
    expect((log?.after as { piiMasked: boolean; rows: number; format: string }) ?? null).toMatchObject({ piiMasked: true, rows: 1, format: "csv" });

    const o = await owner();
    const full = await exportReport(o, "cancellations", SP, "csv");
    expect(full.body).toContain(u1.email!);
    expect(full.body).toContain("150.00"); // order total in rupees

    const x = await exportReport(o, "revenue-by-meal", SP, "xlsx");
    expect(x.filename).toMatch(/\.xlsx$/);
    const buf = x.body as Buffer;
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const entries = unzipEntries(buf);
    expect([...entries.keys()].sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    expect(entries.get("xl/workbook.xml")!.toString()).toContain('<sheet name="Revenue by meal"');
    const sheet = entries.get("xl/worksheets/sheet1.xml")!.toString();
    expect(sheet).toContain("Recognised revenue (Rs)");
    expect(sheet).toContain("RC Box A");
    expect(sheet).toContain("<v>392.50</v>"); // totals row, rupees
    expect(await db.auditLog.count({ where: { action: "report.export", actorId: o.id, entityId: "revenue-by-meal" } })).toBeGreaterThan(0);
  });

  it("every one of the 28 reports (27 + wallet top-ups) runs and exports for the owner", async () => {
    const u = await owner();
    expect(REPORT_LIST).toHaveLength(28);
    expect(new Set(REPORT_LIST.map((r) => r.key)).size).toBe(28);
    for (const def of REPORT_LIST) {
      for (const c of def.choices ?? [{ name: "_", options: [{ value: "" }] }]) {
        for (const opt of c.options) {
          const sp = { ...SP, company: ids.co, [c.name]: opt.value };
          const out = await runReport(u, def.key, def.filters.includes("company") ? sp : { ...SP, [c.name]: opt.value });
          expect(Array.isArray(out.rows), def.key).toBe(true);
          expect(out.count, def.key).toBeGreaterThanOrEqual(out.rows.length);
        }
      }
      const csv = await exportReport(u, def.key, SP, "csv");
      expect(typeof csv.body, def.key).toBe("string");
    }
  });
});

describe("test hygiene", () => {
  it("leaves foundation backfills idempotent for other test files", async () => {
    expect(Object.values(await ensureFoundationData(db)).every((x) => x === 0)).toBe(true);
  });
});
