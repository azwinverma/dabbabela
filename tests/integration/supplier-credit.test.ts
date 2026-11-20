import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { todayKTM } from "@/lib/dates";
import { FinanceDenied } from "@/server/finance/common";
import { createSupplierInvoice, payablesAgeing, recordSupplierPayment, voidSupplierInvoice } from "@/server/finance/payables";
import { applySupplierCredit, creditUncreditedReturns, listSupplierCredits, uncreditedReturnValue, voidSupplierCredit } from "@/server/finance/supplier-credits";
import { cashFlow } from "@/server/finance/settlement";
import { buildJournal } from "@/server/finance/journal";
import { createPurchaseOrder, receivePurchase, returnToSupplier, setPurchaseStatus, stockOnHand } from "@/server/inventory";
import { loadUser } from "../helpers";

/**
 * Phase 2C: purchase-return supplier credit. A return can raise one SupplierCredit (idempotent by returnKey); credits
 * are applied to the same supplier's invoices (append-only, never over the credit's remainder or the invoice's due),
 * settle the invoice through paidAmount, show as net due in ageing, and never touch cash flow.
 */

const stamp = Date.now();
const today = todayKTM();
let owner: CurrentUser;
let stores: CurrentUser; // INVENTORY_MANAGER: can return goods / enter invoices, can't apply credits
let kitchenId: string;
let seq = 0;

async function supplier() {
  return db.supplier.create({ data: { name: `SC Supplier ${stamp}-${++seq}` } });
}

/** PO for 10 kg at Rs 100/kg, received in full. */
async function receivedPO(supplierId: string) {
  const ing = await db.ingredient.create({ data: { name: `SC Rice ${stamp}-${++seq}`, unit: "KG", costPerUnit: 10000, allergenCodes: [] } });
  const po = await createPurchaseOrder({ supplierId, kitchenId, lines: [{ ingredientId: ing.id, quantity: 10, unitCost: 10000 }], actorId: owner.id });
  await setPurchaseStatus(po.id, "SENT");
  const line = await db.purchaseOrderLine.findFirstOrThrow({ where: { poId: po.id } });
  await receivePurchase(po.id, owner.id, [{ lineId: line.id, quantity: 10 }]);
  return { po, line, ing };
}

async function invoice(supplierId: string, subtotal: number, poId?: string) {
  return createSupplierInvoice(owner, { supplierId, poId: poId ?? null, number: `SC-INV-${stamp}-${++seq}`, date: today, dueDate: today, subtotal, tax: 0 });
}

beforeAll(async () => {
  [owner, stores] = await Promise.all([loadUser("owner@test.local"), loadUser("stores@demo.dabbabela.local")]);
  kitchenId = (await db.kitchen.findFirstOrThrow({ where: { code: "KTM-1" } })).id;
});

describe("credit from a purchase return", () => {
  it("creates one credit per return (returnKey) and a retried submit doesn't post the stock again", async () => {
    const sup = await supplier();
    const { po, line, ing } = await receivedPO(sup.id);
    const input = { poId: po.id, reason: "Damp sacks", lines: [{ lineId: line.id, quantity: 2 }], credit: { key: "abc123", number: "CN-77" } };
    const r = await returnToSupplier(owner, input);
    expect(r.credit).toBe(20000);
    expect(r.supplierCredit).toMatchObject({ amount: 20000, number: "CN-77", status: "OPEN", appliedAmount: 0, poId: po.id, supplierId: sup.id, returnKey: `${po.number}#return:abc123` });
    const again = await returnToSupplier(owner, input);
    expect(again.replayed).toBe(true);
    expect(again.supplierCredit!.id).toBe(r.supplierCredit!.id);
    expect((await stockOnHand(kitchenId, [ing.id])).get(ing.id)).toBe(8);
    expect(await db.supplierCredit.count({ where: { poId: po.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "supplier_credit.create", entityId: r.supplierCredit!.id } })).toBe(1);

    // A second, different return gets its own credit.
    const r2 = await returnToSupplier(owner, { ...input, lines: [{ lineId: line.id, quantity: 1 }], credit: { key: "def456" } });
    expect(r2.supplierCredit!.amount).toBe(10000);
    expect(r2.supplierCredit!.id).not.toBe(r.supplierCredit!.id);
    expect((await uncreditedReturnValue(po.id)).uncredited).toBe(0);
  });

  it("a return without a credit can be credited later, once", async () => {
    const sup = await supplier();
    const { po, line } = await receivedPO(sup.id);
    const r = await returnToSupplier(owner, { poId: po.id, reason: "Wrong grade", lines: [{ lineId: line.id, quantity: 3 }] });
    expect(r.supplierCredit).toBeNull();
    expect(await uncreditedReturnValue(po.id)).toMatchObject({ returned: 30000, credited: 0, uncredited: 30000 });
    const c = await creditUncreditedReturns(owner, { poId: po.id, number: "CN-LATE" });
    expect(c.amount).toBe(30000);
    await expect(creditUncreditedReturns(owner, { poId: po.id })).rejects.toThrow(/already has a supplier credit/);
  });
});

describe("applying credits", () => {
  it("never over-applies the credit or the invoice; statuses follow; applications are append-only", async () => {
    const sup = await supplier();
    const { po, line } = await receivedPO(sup.id);
    const { supplierCredit: credit } = await returnToSupplier(owner, { poId: po.id, reason: "Short weight", lines: [{ lineId: line.id, quantity: 4 }], credit: { key: `k${stamp}a` } });
    expect(credit!.amount).toBe(40000);
    const inv1 = await invoice(sup.id, 25000, po.id);
    const inv2 = await invoice(sup.id, 60000);

    await expect(applySupplierCredit(stores, { creditId: credit!.id, invoiceId: inv1.id, amount: 1000 })).rejects.toBeInstanceOf(FinanceDenied);
    await expect(applySupplierCredit(owner, { creditId: credit!.id, invoiceId: inv1.id, amount: 30000 })).rejects.toThrow(/outstanding on this invoice/);
    await expect(applySupplierCredit(owner, { creditId: credit!.id, invoiceId: inv1.id, amount: 0 })).rejects.toThrow(/amount/);

    await applySupplierCredit(owner, { creditId: credit!.id, invoiceId: inv1.id, amount: 25000 });
    let c = await db.supplierCredit.findUniqueOrThrow({ where: { id: credit!.id } });
    expect(c).toMatchObject({ appliedAmount: 25000, status: "PARTIAL" });
    expect(await db.supplierInvoice.findUniqueOrThrow({ where: { id: inv1.id } })).toMatchObject({ paidAmount: 25000, status: "PAID" });

    await expect(applySupplierCredit(owner, { creditId: credit!.id, invoiceId: inv2.id, amount: 20000 })).rejects.toThrow(/left on this credit/);
    await applySupplierCredit(owner, { creditId: credit!.id, invoiceId: inv2.id, amount: 15000 });
    c = await db.supplierCredit.findUniqueOrThrow({ where: { id: credit!.id } });
    expect(c).toMatchObject({ appliedAmount: 40000, status: "APPLIED" });
    expect(await db.supplierInvoice.findUniqueOrThrow({ where: { id: inv2.id } })).toMatchObject({ paidAmount: 15000, status: "PARTIAL" });
    await expect(applySupplierCredit(owner, { creditId: credit!.id, invoiceId: inv2.id, amount: 100 })).rejects.toThrow(/Nothing left/);

    // A payment can only cover what's left after the credit.
    await expect(recordSupplierPayment(owner, { invoiceId: inv2.id, amount: 50000, method: "BANK", reference: "TXN-1" })).rejects.toThrow(/Only Rs/);
    // An invoice settled by credit can't be voided.
    await expect(voidSupplierInvoice(owner, inv2.id, "oops")).rejects.toThrow(/credit applied/);

    expect(await db.supplierCreditApplication.count({ where: { creditId: credit!.id } })).toBe(2);
    expect(await db.auditLog.count({ where: { action: "supplier_credit.apply", entityId: credit!.id } })).toBe(2);
    expect((await listSupplierCredits({ supplierId: sup.id })).length).toBe(0); // fully applied → not open
    expect((await listSupplierCredits({ supplierId: sup.id, includeClosed: true })).length).toBe(1);
  });

  it("refuses another supplier's invoice and concurrent applications can't over-apply", async () => {
    const sup = await supplier();
    const other = await supplier();
    const { po, line } = await receivedPO(sup.id);
    const { supplierCredit: credit } = await returnToSupplier(owner, { poId: po.id, reason: "Expired", lines: [{ lineId: line.id, quantity: 1 }], credit: { key: `k${stamp}b` } });
    const foreign = await invoice(other.id, 50000);
    await expect(applySupplierCredit(owner, { creditId: credit!.id, invoiceId: foreign.id, amount: 1000 })).rejects.toThrow(/different suppliers/);
    const inv = await invoice(sup.id, 50000);
    const results = await Promise.allSettled([1, 2, 3].map(() => applySupplierCredit(owner, { creditId: credit!.id, invoiceId: inv.id, amount: 6000 })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1); // credit is Rs 100: only one Rs 60 fits
    const c = await db.supplierCredit.findUniqueOrThrow({ where: { id: credit!.id } });
    expect(c.appliedAmount).toBe(6000);
    expect((await db.supplierInvoice.findUniqueOrThrow({ where: { id: inv.id } })).paidAmount).toBe(6000);
  });

  it("void cancels only the unapplied remainder, is audited, and blocks further use", async () => {
    const sup = await supplier();
    const { po, line } = await receivedPO(sup.id);
    const { supplierCredit: credit } = await returnToSupplier(owner, { poId: po.id, reason: "Pests", lines: [{ lineId: line.id, quantity: 2 }], credit: { key: `k${stamp}c` } });
    const inv = await invoice(sup.id, 100000);
    await applySupplierCredit(owner, { creditId: credit!.id, invoiceId: inv.id, amount: 5000 });
    await expect(voidSupplierCredit(owner, credit!.id, "")).rejects.toThrow(/reason/);
    await expect(voidSupplierCredit(stores, credit!.id, "no")).rejects.toBeInstanceOf(FinanceDenied);
    await voidSupplierCredit(owner, credit!.id, "Supplier disputes the rest");
    const c = await db.supplierCredit.findUniqueOrThrow({ where: { id: credit!.id } });
    expect(c).toMatchObject({ status: "VOID", appliedAmount: 5000 });
    expect((await db.supplierInvoice.findUniqueOrThrow({ where: { id: inv.id } })).paidAmount).toBe(5000); // application stays
    await expect(applySupplierCredit(owner, { creditId: credit!.id, invoiceId: inv.id, amount: 100 })).rejects.toThrow(/void/);
    await expect(voidSupplierCredit(owner, credit!.id, "again")).rejects.toThrow(/Already void/);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "supplier_credit.void", entityId: credit!.id } });
    expect(log.reason).toBe("Supplier disputes the rest");
  });
});

describe("payables and cash", () => {
  it("ageing shows outstanding net of applied credit plus unapplied credit; cash flow counts only supplier payments", async () => {
    const sup = await supplier();
    const { po, line } = await receivedPO(sup.id);
    const before = await cashFlow(today, today);
    const { supplierCredit: credit } = await returnToSupplier(owner, { poId: po.id, reason: "Torn bags", lines: [{ lineId: line.id, quantity: 5 }], credit: { key: `k${stamp}d` } });
    const inv = await invoice(sup.id, 80000, po.id);

    let row = (await payablesAgeing(today)).suppliers.find((s) => s.supplierId === sup.id)!;
    expect(row).toMatchObject({ total: 80000, unappliedCredit: 50000, net: 30000 });

    await applySupplierCredit(owner, { creditId: credit!.id, invoiceId: inv.id, amount: 20000 });
    const ag = await payablesAgeing(today);
    row = ag.suppliers.find((s) => s.supplierId === sup.id)!;
    expect(row).toMatchObject({ total: 60000, unappliedCredit: 30000, net: 30000 });
    expect(ag.invoices.find((i) => i.id === inv.id)!.outstanding).toBe(60000);
    expect(ag.net).toBe(ag.total - ag.unappliedCredit);

    // Credits are not cash.
    expect((await cashFlow(today, today)).totals.suppliers).toBe(before.totals.suppliers);
    await recordSupplierPayment(owner, { invoiceId: inv.id, amount: 10000, method: "BANK", reference: `SC-PAY-${stamp}` });
    expect((await cashFlow(today, today)).totals.suppliers).toBe(before.totals.suppliers + 10000);

    // Journal: the application settles the payable against purchases, no cash account; still balanced.
    const j = await buildJournal(today, today);
    expect(j.balanced).toBe(true);
    const lines = j.lines.filter((l) => l.journal === "SUPPLIER_CREDITS" && l.memo.includes(inv.number));
    expect(lines).toEqual([expect.objectContaining({ key: "payable.suppliers", debit: 20000 }), expect.objectContaining({ key: "inventory.purchases", credit: 20000 })]);
  });
});
