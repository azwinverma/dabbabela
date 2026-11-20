import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate, ktmNow, todayKTM } from "@/lib/dates";
import type { CurrentUser } from "@/lib/auth";
import { placeCartOrder } from "@/server/orders";
import { createCreditNote, generateInvoice, issueInvoice, recordInvoicePayment, unbilledAdjustmentsByCompany, voidInvoice } from "@/server/invoices";
import { companyOutstanding, invoicePaymentHistory } from "@/server/corporate";
import { cashFlow } from "@/server/finance/settlement";
import { buildJournal } from "@/server/finance/journal";
import { claimReferral, decideReferral, ensureReferralCode, saveReferralSettings, settleReferral } from "@/server/marketing";
import { getClosures } from "@/server/calendar";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

/** Phase 2C: InvoiceReceipt, OrderAdjustment.invoiceLineId, Referral.rewardedAt/note, CouponRedemption.orderId. */

const A = "customer.a@demo.dabbabela.local";
const D = "customer.d@demo.dabbabela.local";
let owner: CurrentUser;
let companyId: string;
let zoneId: string;
let area: string;
const past = addDays(todayKTM(), -6);
const yesterday = addDays(todayKTM(), -1);

async function companyOrder(email: string, n: number, on = past) {
  const user = await loadUser(email);
  let d = serviceDay(14, n % 10);
  for (let k = 1; (await getClosures(d, d)).size; k++) d = serviceDay(14, (n % 10) + k);
  const box = await primaryBoxOn(d);
  const r = await placeCartOrder(user, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: user.addresses[0].id, method: "CASH" });
  return db.order.update({ where: { id: r.orders[0].id }, data: { deliveryDate: dateOnly(on), status: "DELIVERED" } });
}

let n = 0;
async function customer(tag: string, line1?: string) {
  n++;
  const email = `p2c.${tag}@test.local`;
  const u = await db.user.create({ data: { name: `P2C ${tag}`, email, emailVerified: true } });
  await db.address.create({ data: { userId: u.id, label: "Home", recipientName: `P2C ${tag}`, phone: `+97798200${String(1000 + n).padStart(5, "0")}`, line1: line1 ?? `P2C house ${tag}`, area, zoneId, isDefault: true } });
  return loadUser(email);
}

beforeAll(async () => {
  owner = await loadUser("owner@test.local");
  companyId = (await db.company.findUniqueOrThrow({ where: { slug: "demo-company" } })).id;
  const b = await loadUser("customer.b@demo.dabbabela.local");
  zoneId = b.addresses[0].zoneId!;
  area = b.addresses[0].area;
});

afterAll(async () => {
  await db.order.updateMany({ where: { user: { email: { startsWith: "p2c." } } }, data: { status: "CANCELLED", cancelledAt: new Date() } });
});

describe("company invoice receipts", () => {
  it("writes a dated receipt per payment, keeps credit notes out of cash, and reads legacy audit rows in the history", async () => {
    await companyOrder(A, 1);
    const inv = await generateInvoice({ companyId, periodStart: past, periodEnd: past, actorId: owner.id });
    await issueInvoice(inv.id, owner.id);
    const half = Math.floor(inv.total / 2);

    await expect(recordInvoicePayment(inv.id, owner.id, 100, "x", { receivedOn: addDays(todayKTM(), 1) })).rejects.toThrow(/future/);
    await expect(recordInvoicePayment(inv.id, owner.id, 100, "x", { method: "BITCOIN" })).rejects.toThrow(/how the money/);
    expect(await db.invoiceReceipt.count({ where: { invoiceId: inv.id } })).toBe(0);

    const paid = await recordInvoicePayment(inv.id, owner.id, half, "CHQ-7781", { method: "CHEQUE", receivedOn: yesterday, note: "Deposited at NIBL" });
    expect(paid.status).toBe("PARTIALLY_PAID");
    const receipts = await db.invoiceReceipt.findMany({ where: { invoiceId: inv.id } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ amount: half, method: "CHEQUE", reference: "CHQ-7781", recordedById: owner.id, note: "Deposited at NIBL", paymentId: null });
    expect(ktmNow(receipts[0].receivedAt).date).toBe(yesterday);

    // Credit note settles the rest: paidAmount moves, but no receipt (not cash).
    await createCreditNote(inv.id, owner.id, inv.total - half, "Cold meals");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).paidAmount).toBe(inv.total);
    expect(await db.invoiceReceipt.aggregate({ where: { invoiceId: inv.id }, _sum: { amount: true } })).toMatchObject({ _sum: { amount: half } });

    // A legacy payment (before receipts existed) is only an audit row.
    await db.auditLog.create({ data: { actorId: owner.id, action: "invoice.payment", entity: "Invoice", entityId: inv.id, summary: "Rs 10 · OLD-REF", createdAt: new Date(Date.now() - 10 * 86400_000) } });
    const history = (await invoicePaymentHistory(companyId)).filter((h) => h.invoiceId === inv.id);
    expect(history).toHaveLength(2); // the receipt's own audit row is not shown twice
    const fromReceipt = history.find((h) => h.source === "receipt")!;
    expect(fromReceipt).toMatchObject({ amount: half, method: "CHEQUE", reference: "CHQ-7781", number: inv.number });
    expect(fromReceipt.summary).toContain("CHQ-7781");
    const legacy = history.find((h) => h.source === "legacy")!;
    expect(legacy).toMatchObject({ amount: null, summary: "Rs 10 · OLD-REF" });
    expect(history[0].source).toBe("receipt"); // newest first

    // Cash flow and journal count the receipt on the day the money arrived.
    const cf = await cashFlow(yesterday, todayKTM());
    expect(cf.rows.find((r) => r.date === yesterday)!.companyReceipts).toBeGreaterThanOrEqual(half);
    expect(cf.totals.companyReceipts).toBeGreaterThanOrEqual(half);
    const j = await buildJournal(yesterday, yesterday);
    const lines = j.lines.filter((l) => l.entry === "CHQ-7781");
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.debit === half)?.key).toBe("cash.BANK_TRANSFER");
    expect(lines.find((l) => l.credit === half)?.key).toBe("revenue.sales");
    expect(j.balanced).toBe(true);
  });
});

describe("adjustment ↔ invoice line", () => {
  it("links billed company-share adjustments by invoiceLineId, never bills twice, and frees them when the invoice is voided", async () => {
    const day = addDays(todayKTM(), -7);
    const order = await companyOrder(D, 2, day);
    const adj = await db.orderAdjustment.create({ data: { orderId: order.id, amount: 900, reason: "Company share: extra salad", actorId: owner.id } });
    expect((await unbilledAdjustmentsByCompany(companyId)).get(companyId)?.amount).toBeGreaterThanOrEqual(900);
    const before = await companyOutstanding(companyId);

    const inv = await generateInvoice({ companyId, periodStart: day, periodEnd: day, actorId: owner.id });
    const linked = await db.orderAdjustment.findUniqueOrThrow({ where: { id: adj.id }, include: { invoiceLine: true } });
    expect(linked.invoiceLine?.invoiceId).toBe(inv.id);
    expect(linked.invoiceLine?.amount).toBe(900);
    expect(linked.invoiceLine?.orderId).toBe(order.id);
    expect(inv.total).toBe(order.companyShare + 900);
    expect(await companyOutstanding(companyId)).toBe(before - order.companyShare - 900); // on a draft now: left the unbilled pile (drafts are not counted as unpaid)
    const unbilledIds = await db.orderAdjustment.findMany({ where: { id: adj.id, invoiceLineId: null } });
    expect(unbilledIds).toHaveLength(0);
    await expect(generateInvoice({ companyId, periodStart: day, periodEnd: day, actorId: owner.id })).rejects.toThrow(/Nothing to invoice/);

    // Voiding keeps the link for history but the adjustment is billable again — and billed once on the next invoice.
    await voidInvoice(inv.id, owner.id, "Wrong period");
    const again = await generateInvoice({ companyId, periodStart: day, periodEnd: day, actorId: owner.id });
    expect(again.total).toBe(order.companyShare + 900);
    const moved = await db.orderAdjustment.findUniqueOrThrow({ where: { id: adj.id }, include: { invoiceLine: true } });
    expect(moved.invoiceLine?.invoiceId).toBe(again.id);
    await expect(generateInvoice({ companyId, periodStart: day, periodEnd: day, actorId: owner.id })).rejects.toThrow(/Nothing to invoice/);
  });

  it("treats an adjustment linked by the backfill (column only, no tag) as billed", async () => {
    const day = addDays(todayKTM(), -8);
    const order = await companyOrder(A, 3, day);
    const inv = await generateInvoice({ companyId, periodStart: day, periodEnd: day, actorId: owner.id });
    const line = await db.invoiceLine.create({ data: { invoiceId: inv.id, orderId: order.id, description: "Adjustment (older wording)", quantity: 1, unitPrice: 400, amount: 400 } });
    await db.orderAdjustment.create({ data: { orderId: order.id, amount: 400, reason: "Company share: old edit", actorId: owner.id, invoiceLineId: line.id } });
    await expect(generateInvoice({ companyId, periodStart: day, periodEnd: day, actorId: owner.id })).rejects.toThrow(/Nothing to invoice/);
  });
});

describe("referral rewardedAt / note", () => {
  it("records the hold reason, the staff decision and the reward time", async () => {
    await saveReferralSettings(owner, { enabled: true, refereeType: "FLAT", refereeValue: 50_00, refereeMaxDiscount: null, refereeMinSubtotal: 0, referrerReward: 75_00, maxRewardsPerReferrer: 20, maxRewardsPerMonth: 20 });
    const referrer = await customer("referrer", "Gyan Bhawan 2nd floor");
    const code = (await ensureReferralCode(referrer.id)).code;

    const twin = await customer("twin", "Gyan bhawan, 2nd floor");
    const held = await claimReferral(twin.id, code);
    expect(held.ok && held.status).toBe("HELD");
    const heldRow = await db.referral.findUniqueOrThrow({ where: { refereeId: twin.id } });
    expect(heldRow.note).toMatch(/^Held at sign-up: /);
    await decideReferral(owner, heldRow.id, false, "Same flat, same person");
    const rejected = await db.referral.findUniqueOrThrow({ where: { id: heldRow.id } });
    expect(rejected).toMatchObject({ status: "REJECTED", note: "Rejected: Same flat, same person", rewardedAt: null });

    const friend = await customer("friend");
    expect((await claimReferral(friend.id, code)).ok).toBe(true);
    const d = serviceDay(14, 5);
    const box = await primaryBoxOn(d);
    const placed = await placeCartOrder(friend, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: friend.addresses[0].id, method: "CASH" });
    await db.order.update({ where: { id: placed.orders[0].id }, data: { status: "DELIVERED", deliveredAt: new Date(), paymentStatus: "PAID" } });
    const ref = await db.referral.findUniqueOrThrow({ where: { refereeId: friend.id } });
    expect(ref.note).toBeNull();
    expect((await settleReferral(ref.id)).outcome).toBe("REWARDED");
    const rewarded = await db.referral.findUniqueOrThrow({ where: { id: ref.id } });
    const ledger = await db.creditLedger.findUniqueOrThrow({ where: { id: rewarded.rewardLedgerId! } });
    expect(rewarded.rewardedAt?.getTime()).toBe(ledger.createdAt.getTime());
  });
});

describe("coupon redemption orderId", () => {
  it("sets orderId for a one-order checkout and leaves it null (paymentId only) for a multi-day checkout", async () => {
    const c = await db.coupon.create({ data: { code: "P2CORDER", type: "PERCENT", value: 5, perUserLimit: null } });
    try {
      const u = await customer("coupon");
      const d1 = serviceDay(14, 6);
      const d2 = serviceDay(14, 7);
      const b1 = await primaryBoxOn(d1);
      const b2 = await primaryBoxOn(d2);
      const one = await placeCartOrder(u, { lines: [{ kind: "box", id: b1.id, date: d1, qty: 1 }], addressId: u.addresses[0].id, method: "CASH", couponCode: "P2CORDER" });
      const r1 = await db.couponRedemption.findFirstOrThrow({ where: { couponId: c.id, paymentId: one.payment.id } });
      expect(r1.orderId).toBe(one.orders[0].id);

      const two = await placeCartOrder(u, {
        lines: [
          { kind: "box", id: b1.id, date: d1, qty: 1 },
          { kind: "box", id: b2.id, date: d2, qty: 1 },
        ],
        addressId: u.addresses[0].id,
        method: "CASH",
        couponCode: "P2CORDER",
      });
      expect(two.orders).toHaveLength(2);
      const r2 = await db.couponRedemption.findFirstOrThrow({ where: { couponId: c.id, paymentId: two.payment.id } });
      expect(r2.orderId).toBeNull();
      expect(isoDate(two.orders[0].deliveryDate)).toBe(d1);
    } finally {
      await db.coupon.update({ where: { id: c.id }, data: { isActive: false } });
    }
  });
});
