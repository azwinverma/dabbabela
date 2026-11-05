import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { FINANCE_SETTING, FinanceDenied, FinanceError, saveFinanceConfig, estimateGatewayFee } from "@/server/finance/common";
import { approveExpense, correctExpense, createExpense, markExpensePaid, reverseExpense, updateDraftExpense, voidExpense, expenseTotals } from "@/server/finance/expenses";
import { ageingBucket, createSupplierInvoice, payablesAgeing, recordSupplierPayment, reverseSupplierPayment, threeWayMatch, voidSupplierInvoice } from "@/server/finance/payables";
import { cashFlow, closePeriod, closeSettlement, reopenPeriod, saveSettlement, settlementSheet } from "@/server/finance/settlement";
import { duplicatePaymentSuspects, importStatement, parseCsv, statementDuplicates } from "@/server/finance/statements";
import { buildJournal, exportJournal } from "@/server/finance/journal";
import { profitAndLoss } from "@/server/finance/profitability";
import { markPaymentPaid } from "@/server/payments";
import { refreshBoxCosts } from "@/app/admin/_kit/costing";
import { boxFacts, boxInclude } from "@/server/menu";
import { loadUser } from "../helpers";

/**
 * WP-09 finance ERP. Every scenario uses its own month in 2022 (no other test touches 2022), its own kitchen and
 * supplier, so closing a period here can't affect other suites.
 */

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const at = (d: string, t = "10:00") => new Date(`${d}T${t}:00+05:45`);
const stamp = Date.now();
let seq = 0;

let owner: CurrentUser; // SUPER_ADMIN
let finance: CurrentUser; // FINANCE
let ops: CurrentUser; // OPERATIONS_MANAGER (no expense / export rights)
let stores: CurrentUser; // INVENTORY_MANAGER (can enter supplier invoices, can't pay them)
let cat: Record<string, string>;
let kitchenId: string;
let customerId: string;

async function payment(p: { method: "ESEWA" | "KHALTI" | "BANK_TRANSFER" | "CASH"; amount: number; status?: "PENDING" | "PAID" | "FAILED"; paidAt?: Date | null; user?: string; fee?: number; ref?: string }) {
  seq++;
  return db.payment.create({
    data: { reference: p.ref ?? `FE-${seq}-${stamp}`, userId: p.user ?? customerId, method: p.method, status: p.status ?? "PAID", amount: p.amount, paidAt: p.paidAt === undefined ? at("2022-09-05") : p.paidAt, gatewayFee: p.fee ?? 0 },
  });
}

beforeAll(async () => {
  [owner, finance, ops, stores] = await Promise.all([loadUser("owner@test.local"), loadUser("finance@demo.dabbabela.local"), loadUser("ops@demo.dabbabela.local"), loadUser("stores@demo.dabbabela.local")]);
  cat = Object.fromEntries((await db.expenseCategory.findMany()).map((c) => [c.key, c.id]));
  kitchenId = (await db.kitchen.create({ data: { name: "Finance K", code: `FK${stamp}` } })).id;
  customerId = (await db.user.create({ data: { name: "Fin Customer", email: `fin-${stamp}@test.local` } })).id;
});

afterAll(async () => {
  await db.setting.deleteMany({ where: { key: FINANCE_SETTING } });
});

const base = (date: string, amount = 10000) => ({ date, categoryId: cat.RENT, kitchenId, description: "Shop rent", amount, tax: 0 });

describe("expenses", () => {
  it("approval flow records the approver on the expense and in the audit log; no self-approval", async () => {
    const e = await createExpense(finance, { ...base("2022-01-10", 250000), tax: 32500, method: "BANK" });
    expect(e.status).toBe("DRAFT");
    expect(e.number).toMatch(/^EXP-202201-\d{4}$/);
    await expect(createExpense(ops, base("2022-01-10"))).rejects.toBeInstanceOf(FinanceDenied);
    await expect(approveExpense(finance, e.id)).rejects.toThrow(/Someone else must approve/);
    const ok = await approveExpense(owner, e.id);
    expect(ok.status).toBe("APPROVED");
    expect(ok.approvedById).toBe(owner.id);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "expense.approve", entityId: e.id } });
    expect(log.approvedById).toBe(owner.id);
    expect(log.actorId).toBe(owner.id);
    await expect(approveExpense(owner, e.id)).rejects.toThrow(/Only drafts/);
    const paid = await markExpensePaid(finance, e.id, { method: "BANK", reference: "CHQ-1" });
    expect(paid.status).toBe("PAID");
    expect(paid.amount).toBe(250000); // never changed
  });

  it("drafts can be edited or voided; approved expenses can't", async () => {
    const e = await createExpense(finance, base("2022-01-11", 5000));
    const edited = await updateDraftExpense(finance, e.id, { ...base("2022-01-12", 6000) });
    expect(edited.amount).toBe(6000);
    await voidExpense(finance, e.id, "Duplicate entry");
    expect((await db.expense.findUniqueOrThrow({ where: { id: e.id } })).status).toBe("VOID");
    const a = await createExpense(finance, base("2022-01-12", 7000));
    await approveExpense(owner, a.id);
    await expect(updateDraftExpense(finance, a.id, base("2022-01-12", 1))).rejects.toThrow(/Only drafts/);
    await expect(voidExpense(finance, a.id, "x")).rejects.toThrow(/reverse it instead/);
    await expect(createExpense(finance, base("2999-01-01"))).rejects.toThrow(/future/);
  });

  it("corrections are reversing entries, never an overwrite", async () => {
    const e = await createExpense(finance, { ...base("2022-02-03", 40000), categoryId: cat.UTILITIES, tax: 5200 });
    await approveExpense(owner, e.id);
    const { reversal, replacement } = await correctExpense(owner, e.id, { ...base("2022-02-03", 4000), categoryId: cat.UTILITIES, tax: 520 }, "typo: extra zero");
    const original = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    expect(original.amount).toBe(40000); // untouched
    expect(original.tax).toBe(5200);
    expect(original.status).toBe("APPROVED");
    expect(reversal.amount).toBe(-40000);
    expect(reversal.tax).toBe(-5200);
    expect(reversal.reference).toBe(`REV:${e.number}`);
    expect(reversal.status).toBe("APPROVED");
    expect(replacement.status).toBe("DRAFT");
    await expect(reverseExpense(owner, e.id, "again")).rejects.toThrow(/Already reversed/);
    await expect(reverseExpense(owner, reversal.id, "x")).rejects.toThrow(/can't be reversed/);
    await approveExpense(owner, replacement.id);
    // Net recorded utilities = only the corrected figure (original + reversal cancel out).
    const totals = await expenseTotals({ from: "2022-01-01", to: "2026-12-31", categoryId: cat.UTILITIES, kitchenIds: [kitchenId] });
    expect(totals.reduce((a, t) => a + t.amount, 0)).toBe(4000);
    expect(await db.auditLog.count({ where: { action: "expense.reverse", entityId: e.id, approvedById: owner.id } })).toBe(1);
  });

  it("a closed period blocks back-dated expense writes; corrections post in an open month", async () => {
    const approved = await createExpense(finance, base("2022-03-05", 9000));
    await approveExpense(owner, approved.id);
    const draft = await createExpense(finance, base("2022-03-06", 1000));
    await expect(closePeriod(owner, "2022-03")).rejects.toThrow(/draft expense/);
    await voidExpense(finance, draft.id, "not needed");
    await expect(closePeriod(finance, "2099-01")).rejects.toThrow(/after it ends/);
    await expect(closePeriod(ops, "2022-03")).rejects.toBeInstanceOf(FinanceDenied);
    const p = await closePeriod(finance, "2022-03", "March reconciled");
    expect(p.closedAt).toBeTruthy();
    expect(await db.auditLog.count({ where: { action: "period.close", entityId: p.id } })).toBe(1);

    await expect(createExpense(finance, base("2022-03-20"))).rejects.toThrow(/2022-03 is closed/);
    const late = await createExpense(finance, base("2022-04-01", 500));
    await expect(updateDraftExpense(finance, late.id, base("2022-03-31", 500))).rejects.toThrow(/closed/);
    await expect(reverseExpense(owner, approved.id, "wrong", "2022-03-31")).rejects.toThrow(/closed/);
    const rev = await reverseExpense(owner, approved.id, "wrong kitchen", "2022-04-02");
    expect(rev.date.toISOString().slice(0, 10)).toBe("2022-04-02");
    await expect(createSupplierInvoice(finance, { supplierId: (await db.supplier.create({ data: { name: `Closed Sup ${stamp}` } })).id, number: "C-1", date: "2022-03-10", subtotal: 100 })).rejects.toThrow(/closed/);

    await expect(reopenPeriod(finance, "2022-03", "audit fix")).rejects.toThrow(/Only the owner/);
    await reopenPeriod(owner, "2022-03", "audit fix");
    const e = await createExpense(finance, base("2022-03-21", 100));
    expect(e.status).toBe("DRAFT");
    await voidExpense(finance, e.id, "test");
  });
});

describe("supplier payables", () => {
  it("invoices, partial payments, reversal and ageing buckets", async () => {
    const sup = await db.supplier.create({ data: { name: `Veg Supplier ${stamp}` } });
    await expect(createSupplierInvoice(ops, { supplierId: sup.id, number: "X", date: "2022-05-01", subtotal: 100 })).rejects.toBeInstanceOf(FinanceDenied);
    const i1 = await createSupplierInvoice(stores, { supplierId: sup.id, number: `INV-A-${stamp}`, date: "2022-05-01", dueDate: "2022-05-31", subtotal: 100000, tax: 13000 });
    const i2 = await createSupplierInvoice(stores, { supplierId: sup.id, number: `INV-B-${stamp}`, date: "2022-05-20", dueDate: "2022-06-20", subtotal: 50000 });
    expect(i1.total).toBe(113000);
    expect([i2.total, i2.status]).toEqual([50000, "OPEN"]);
    await expect(createSupplierInvoice(stores, { supplierId: sup.id, number: `INV-A-${stamp}`, date: "2022-05-02", subtotal: 1 })).rejects.toThrow(/Unique constraint/);

    await expect(recordSupplierPayment(stores, { invoiceId: i1.id, amount: 1000, method: "BANK", reference: "T1" })).rejects.toBeInstanceOf(FinanceDenied);
    const pay = await recordSupplierPayment(finance, { invoiceId: i1.id, amount: 63000, method: "BANK", reference: "TXN-1", paidAt: "2022-06-01" });
    let inv = await db.supplierInvoice.findUniqueOrThrow({ where: { id: i1.id } });
    expect([inv.paidAmount, inv.status]).toEqual([63000, "PARTIAL"]);
    await expect(recordSupplierPayment(finance, { invoiceId: i1.id, amount: 50001, method: "BANK", reference: "TXN-2" })).rejects.toThrow(/outstanding/);
    await expect(voidSupplierInvoice(finance, i1.id, "x")).rejects.toThrow(/reverse the payments/);

    // Reversal: a negative mirror row; the original payment row is untouched.
    const rev = await reverseSupplierPayment(finance, pay.id, "paid wrong supplier");
    expect(rev.amount).toBe(-63000);
    expect((await db.supplierPayment.findUniqueOrThrow({ where: { id: pay.id } })).amount).toBe(63000);
    inv = await db.supplierInvoice.findUniqueOrThrow({ where: { id: i1.id } });
    expect([inv.paidAmount, inv.status]).toEqual([0, "OPEN"]);
    await expect(reverseSupplierPayment(finance, pay.id, "again")).rejects.toThrow(/Already reversed/);
    await recordSupplierPayment(finance, { invoiceId: i1.id, amount: 13000, method: "CASH", reference: "RCPT-9", paidAt: "2022-06-02" });

    // As of 2022-07-15: i1 is 45 days late (31–60), i2 is 25 days late (1–30).
    expect(ageingBucket("2022-07-15", "2022-07-15")).toBe("current");
    const ag = await payablesAgeing("2022-07-15");
    const mine = ag.suppliers.find((s) => s.supplierId === sup.id)!;
    expect(mine.buckets.d60).toBe(100000);
    expect(mine.buckets.d30).toBe(50000);
    expect(mine.total).toBe(150000);
    expect(ag.invoices.find((i) => i.id === i1.id)!.daysOverdue).toBe(45);
    // As of 2022-05-25 i2 isn't due yet.
    expect((await payablesAgeing("2022-05-25")).suppliers.find((s) => s.supplierId === sup.id)!.buckets.current).toBe(150000);
  });

  it("three-way match hint compares PO, goods received and invoice", async () => {
    const sup = await db.supplier.create({ data: { name: `PO Supplier ${stamp}` } });
    const ing = await db.ingredient.create({ data: { name: `Rice ${stamp}`, unit: "KG", costPerUnit: 10000 } });
    const po = await db.purchaseOrder.create({ data: { number: `PO-FE-${stamp}`, supplierId: sup.id, kitchenId, status: "PARTIAL", lines: { create: [{ ingredientId: ing.id, quantity: 10, unitCost: 10000, receivedQty: 6 }] } } });
    const over = await createSupplierInvoice(finance, { supplierId: sup.id, poId: po.id, number: `PO-INV-${stamp}`, date: "2022-05-10", subtotal: 100000 });
    const m = await threeWayMatch(over.id);
    expect([m.status, m.ordered, m.received, m.invoiced]).toEqual(["OVER_INVOICED", 100000, 60000, 100000]);
    const other = await db.supplier.create({ data: { name: `Other ${stamp}` } });
    await expect(createSupplierInvoice(finance, { supplierId: other.id, poId: po.id, number: "Z", date: "2022-05-10", subtotal: 1 })).rejects.toThrow(/another supplier/);
  });
});

describe("daily settlement", () => {
  it("cash variance per kitchen, note required to close, locked after close", async () => {
    const date = "2022-07-10";
    await db.deliveryRoute.create({ data: { kitchenId, date: day(date), name: "R1", cashCollected: 120000, cashHandedIn: 115000 } });
    await db.deliveryRoute.create({ data: { kitchenId, date: day(date), name: "R2", cashCollected: 30000, cashHandedIn: null } });
    const sheet = await settlementSheet(date, [kitchenId]);
    const row = sheet.find((r) => r.kitchenId === kitchenId && r.method === "CASH")!;
    expect(row.expected).toBe(150000);
    expect(row.suggested).toBe(115000);
    expect(row.detail).toMatch(/1 not handed in/);
    expect(sheet.some((r) => r.method === "ESEWA")).toBe(false); // kitchen-scoped view has no company-wide rows

    await expect(saveSettlement(ops, { date, kitchenId, method: "CASH", counted: 1 })).rejects.toBeInstanceOf(FinanceDenied);
    const s = await saveSettlement(finance, { date, kitchenId, method: "CASH", counted: 145000 });
    expect([s.expected, s.counted, s.variance]).toEqual([150000, 145000, -5000]);
    const again = await saveSettlement(finance, { date, kitchenId, method: "CASH", counted: 146000 });
    expect(again.id).toBe(s.id); // upsert, not a second row
    expect(again.variance).toBe(-4000);
    await expect(closeSettlement(finance, s.id)).rejects.toThrow(/Explain/);
    const closed = await closeSettlement(finance, s.id, "Rider R2 short Rs 40, recovering from wages");
    expect(closed.closedById).toBe(finance.id);
    expect(closed.closedAt).toBeTruthy();
    await expect(saveSettlement(finance, { date, kitchenId, method: "CASH", counted: 150000 })).rejects.toThrow(/closed and locked/);
    expect(await db.auditLog.count({ where: { action: "settlement.close", entityId: s.id, approvedById: finance.id } })).toBe(1);
  });

  it("company-wide gateway rows are de-duplicated (null kitchen) and cash needs a kitchen", async () => {
    const date = "2022-07-11";
    await payment({ method: "BANK_TRANSFER", amount: 22000, paidAt: at(date) });
    const a = await saveSettlement(owner, { date, kitchenId: null, method: "BANK_TRANSFER", counted: 22000 });
    const b = await saveSettlement(owner, { date, kitchenId: null, method: "BANK_TRANSFER", counted: 22000 });
    expect(a.id).toBe(b.id);
    expect(a.variance).toBe(0);
    expect(await db.dailySettlement.count({ where: { date: day(date), kitchenId: null, method: "BANK_TRANSFER" } })).toBe(1);
    await expect(saveSettlement(owner, { date, kitchenId: null, method: "CASH", counted: 1 })).rejects.toThrow(/per kitchen/);
    await expect(closePeriod(owner, "2022-07")).rejects.toThrow(/settlement\(s\) not closed/);
  });
});

describe("gateway statements and fees", () => {
  it("estimates the fee from the configured rate when a payment is marked paid", async () => {
    await expect(saveFinanceConfig(ops, { feeBps: { ESEWA: 150 } })).rejects.toBeInstanceOf(FinanceDenied);
    await saveFinanceConfig(finance, { feeBps: { ESEWA: 150, KHALTI: 200 } });
    expect(await estimateGatewayFee("ESEWA", 50000)).toBe(750);
    expect(await estimateGatewayFee("CASH", 50000)).toBe(0);
    const p = await payment({ method: "ESEWA", amount: 50000, status: "PENDING", paidAt: null });
    await markPaymentPaid(p.id, { amount: 50000 });
    const paid = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(paid.status).toBe("PAID");
    expect(paid.gatewayFee).toBe(750);
    expect(paid.feeActual).toBeNull();
  });

  it("imports a statement: matches, unmatched, duplicates, fee actuals; re-import is idempotent", async () => {
    const p1 = await payment({ method: "ESEWA", amount: 20000, fee: 300 });
    await db.paymentAttempt.create({ data: { paymentId: p1.id, method: "ESEWA", providerRef: `${p1.reference}-1`, amount: 20000, status: "SUCCESS" } });
    const p2 = await payment({ method: "ESEWA", amount: 15000, fee: 225 }); // matched by payment reference
    const p3 = await payment({ method: "ESEWA", amount: 10000, status: "FAILED", paidAt: null }); // gateway settled, we show failed
    const khalti = await payment({ method: "KHALTI", amount: 5000 });
    const csv = [
      "Transaction UUID,Amount,Service Charge,Settlement Date",
      `${p1.reference}-1,200.00,2.80,2022-09-06`,
      `${p2.reference},"150",2.10,06/09/2022`,
      `${p3.reference},100,1.50,2022-09-06`,
      `UNKNOWN-${stamp},99.00,1,2022-09-06`,
      `${khalti.reference},50,1,2022-09-06`,
      `${p1.reference}-1,200.00,2.80,2022-09-06`,
      `${p1.reference}-2,200.00,2.80,2022-09-07`,
      `BAD-${stamp},abc,1,2022-09-06`,
    ].join("\r\n");
    await expect(importStatement(ops, { provider: "ESEWA", csv })).rejects.toBeInstanceOf(FinanceDenied);
    const r = await importStatement(finance, { provider: "ESEWA", csv, filename: "esewa-sep.csv" });
    expect(r.errors).toEqual([{ line: 9, error: "Amount isn't a positive number" }]);
    expect(r.imported).toBe(6);
    expect(r.matched).toBe(4); // p1 (twice: -1 and -2), p2, p3
    expect(r.unmatched.map((u) => u.providerRef).sort()).toEqual([`UNKNOWN-${stamp}`, khalti.reference].sort());
    expect(r.unmatched.find((u) => u.providerRef === khalti.reference)!.reason).toMatch(/KHALTI/);
    expect(r.duplicatesInFile).toEqual([{ line: 7, providerRef: `${p1.reference}-1` }]);
    expect(r.duplicatePayments).toEqual([{ paymentId: p1.id, reference: p1.reference, lines: 2, amount: 40000 }]);
    expect(r.notPaidInSystem.map((x) => x.paymentId)).toEqual([p3.id]);
    expect(r.amountMismatches).toEqual([]);

    const f1 = await db.payment.findUniqueOrThrow({ where: { id: p1.id } });
    const f2 = await db.payment.findUniqueOrThrow({ where: { id: p2.id } });
    expect([f1.gatewayFee, f1.feeActual]).toEqual([300, 560]); // estimate kept, actual = Σ matched line fees
    expect([f2.gatewayFee, f2.feeActual]).toEqual([225, 210]);
    expect((await statementDuplicates()).some((d) => d.payment.id === p1.id && d.lines === 2)).toBe(true);
    expect(await db.auditLog.count({ where: { action: "statement.import", entityId: r.batch } })).toBe(1);

    const again = await importStatement(finance, { provider: "ESEWA", csv });
    expect(again.imported).toBe(0);
    expect(again.alreadyImported).toBe(6);
    expect(await db.gatewayStatementLine.count({ where: { providerRef: { startsWith: p1.reference } } })).toBe(2);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p1.id } })).feeActual).toBe(560);
  });

  it("flags double checkouts: same customer and amount paid within 10 minutes", async () => {
    const u = (await db.user.create({ data: { name: "Double", email: `dbl-${stamp}@test.local` } })).id;
    const a = await payment({ method: "KHALTI", amount: 33300, user: u, paidAt: at("2022-09-08", "12:00") });
    const b = await payment({ method: "ESEWA", amount: 33300, user: u, paidAt: at("2022-09-08", "12:07") });
    await payment({ method: "ESEWA", amount: 33300, user: u, paidAt: at("2022-09-08", "13:00") }); // an hour later: fine
    const s = await duplicatePaymentSuspects(at("2022-09-08", "00:00"), at("2022-09-09", "00:00"));
    const mine = s.filter((x) => x.userId === u);
    expect(mine).toHaveLength(1);
    expect([mine[0].a, mine[0].b, mine[0].gap_s]).toEqual([a.id, b.id, 420]);
  });

  it("parses quoted CSV cells", () => {
    expect(parseCsv('a,"b, c","d ""q"""\n1,2,3')).toEqual([
      ["a", "b, c", 'd "q"'],
      ["1", "2", "3"],
    ]);
  });
});

describe("profitability, cash flow and journal", () => {
  let pk: string;
  beforeAll(async () => {
    pk = (await db.kitchen.create({ data: { name: "Profit K", code: `PK${stamp}` } })).id;
    const pay = await payment({ method: "ESEWA", amount: 40000, paidAt: at("2022-08-03"), fee: 600 });
    await db.payment.update({ where: { id: pay.id }, data: { feeActual: 520 } });
    for (const [i, total] of [20000, 20000].entries())
      await db.order.create({
        data: {
          number: `FE-O-${i}-${stamp}`,
          code: `FE${i}`,
          userId: customerId,
          kitchenId: pk,
          deliveryDate: day("2022-08-04"),
          status: "DELIVERED",
          paymentStatus: "PAID",
          contactName: "T",
          contactPhone: "+9779811111111",
          addressLine: "L",
          area: "A",
          subtotal: total,
          total,
          tax: 0,
          costTotal: 7000,
          packagingCost: 500,
          paymentId: pay.id,
        },
      });
    const pack = await createExpense(finance, { date: "2022-08-05", categoryId: cat.PACKAGING, kitchenId: pk, description: "Dabbas", amount: 1500 });
    await approveExpense(owner, pack.id);
    const wrong = await createExpense(finance, { date: "2022-08-06", categoryId: cat.PACKAGING, kitchenId: pk, description: "Dabbas dup", amount: 9000 });
    await approveExpense(owner, wrong.id);
    await reverseExpense(owner, wrong.id, "duplicate bill", "2022-08-07");
    const rent = await createExpense(finance, { date: "2022-08-01", categoryId: cat.RENT, kitchenId: pk, description: "Rent", amount: 10000, tax: 1300, method: "BANK" });
    await approveExpense(owner, rent.id);
    await markExpensePaid(finance, rent.id, { method: "BANK", reference: "B1" });
  });

  it("shows estimated vs recorded per line and labels the bottom line honestly until the period is closed", async () => {
    const f = { from: "2022-08-01", to: "2022-08-31", kitchenIds: [pk] };
    await expect(profitAndLoss(stores, f)).rejects.toBeInstanceOf(FinanceDenied);
    const p = await profitAndLoss(finance, f);
    expect(p.revenue).toBe(40000);
    const line = (k: string) => p.lines.find((l) => l.key === k)!;
    expect([line("food").estimated, line("food").actual]).toEqual([14000, null]); // no stock usage → no recorded food cost
    expect([line("packaging").estimated, line("packaging").actual]).toEqual([1000, 1500]); // reversal nets the 9000 out
    expect([line("gateway").estimated, line("gateway").actual]).toEqual([600, 520]);
    expect(line("delivery").estimated).toBeNull();
    expect(line("overheads").actual).toBe(10000); // rent, before tax
    expect(p.estimatedCosts).toBe(14000 + 1000 + 600);
    expect(p.recordedCosts).toBe(1500 + 520 + 10000);
    expect(p.estimatedProfit).toBe(40000 - 15600);
    expect(p.recordedProfit).toBe(40000 - 12020);
    expect(p.bottomLine).toEqual({ label: "Operating estimate", value: 40000 - (14000 + 1500 + 520 + 10000), final: false });
    expect(p.periods).toHaveLength(1);
    expect(p.periods[0]).toMatchObject({ month: "2022-08", closedAt: null, expenses: 4, drafts: 0 });

    await closePeriod(finance, "2022-08");
    const closed = await profitAndLoss(finance, f);
    expect(closed.bottomLine.label).toBe("Net profit (closed periods)");
    expect(closed.bottomLine.final).toBe(true);
    expect(closed.closedMonths).toBe(1);
  });

  it("cash flow by day", async () => {
    const cf = await cashFlow("2022-08-01", "2022-08-31");
    const d = (x: string) => cf.rows.find((r) => r.date === x)!;
    expect(d("2022-08-03").inflow).toBeGreaterThanOrEqual(40000);
    expect(d("2022-08-03").fees).toBeGreaterThanOrEqual(520);
    expect(d("2022-08-01").expenses).toBeGreaterThanOrEqual(11300); // the paid rent incl. VAT; approved-but-unpaid isn't cash
    expect(cf.rows).toHaveLength(31);
    expect(cf.totals.net).toBe(cf.totals.inflow - cf.totals.outflow);
  });

  it("journal export: balanced entries, configurable account mapping, permission + audit", async () => {
    const j = await buildJournal("2022-08-01", "2022-08-31");
    expect(j.balanced).toBe(true);
    const rent = j.lines.filter((l) => l.memo === "Rent");
    expect(rent.find((l) => l.key === "expense.RENT")!.debit).toBe(10000);
    expect(rent.find((l) => l.key === "tax.input")!.debit).toBe(1300);
    expect(rent.find((l) => l.journal === "EXPENSE_PAYMENTS" && l.key === "cash.BANK")!.credit).toBe(11300);
    const rev = j.lines.filter((l) => l.memo.startsWith("Reversal of"));
    expect(rev.find((l) => l.key === "expense.PACKAGING")!.credit).toBe(9000); // reversal posts the opposite way

    await expect(exportJournal(ops, "2022-08-01", "2022-08-31")).rejects.toBeInstanceOf(FinanceDenied);
    expect(await db.auditLog.count({ where: { action: "finance.journal_export", actorId: ops.id } })).toBe(0);
    await saveFinanceConfig(finance, { chartOfAccounts: { "expense.RENT": "6100 Rent expense", "bogus.key": "x" } });
    const out = await exportJournal(finance, "2022-08-01", "2022-08-31");
    expect(out.balanced).toBe(true);
    expect(out.body).toContain("6100 Rent expense");
    expect(out.body).toContain("UNMAPPED tax.input");
    expect(out.body).not.toContain("bogus.key");
    expect(out.unmapped).not.toContain("expense.RENT");
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "finance.journal_export", actorId: finance.id }, orderBy: { createdAt: "desc" } });
    expect(log.entityId).toBe("2022-08-01..2022-08-31");
    await expect(exportJournal(finance, "2022-08-31", "2022-08-01")).rejects.toBeInstanceOf(FinanceError);
  });
});

describe("box costing uses the dabba's own packaging cost (WP-04 request)", () => {
  it("adds LunchBox.packagingCost when set", async () => {
    const box = await db.lunchBox.findFirstOrThrow({ where: { items: { some: {} } }, include: boxInclude });
    await db.lunchBox.update({ where: { id: box.id }, data: { packagingCost: 1234 } });
    await refreshBoxCosts({ boxId: box.id });
    const after = await db.lunchBox.findUniqueOrThrow({ where: { id: box.id }, include: boxInclude });
    expect(after.costPrice).toBe(boxFacts(after).cost + 1234);
    await db.lunchBox.update({ where: { id: box.id }, data: { packagingCost: 0 } });
    await refreshBoxCosts({ boxId: box.id });
  });
});
