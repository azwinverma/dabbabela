import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rs } from "@/lib/money";
import { daysBetween, isValidISODate, todayKTM } from "@/lib/dates";
import { assertCan, assertPeriodOpen, day, FinanceError, iso, type Actor } from "./common";

/**
 * Supplier payables (WP-09): supplier invoices, payments against them, ageing and a three-way match hint
 * (purchase order ↔ goods received ↔ invoice).
 *
 * Payments are immutable; a wrong payment is cancelled by a negative reversing payment (`reverseSupplierPayment`).
 * An invoice with money paid can't be voided.
 */

export const INVOICE_STATUSES = ["OPEN", "PARTIAL", "PAID", "VOID"] as const;
export const PAY_METHODS = ["BANK", "CASH", "ESEWA", "KHALTI", "CHEQUE", "OTHER"] as const;

export type SupplierInvoiceInput = {
  supplierId: string;
  poId?: string | null;
  number: string;
  date: string;
  dueDate?: string | null;
  subtotal: number;
  tax?: number;
  attachmentUrl?: string | null;
};

const statusFor = (paid: number, total: number) => (paid <= 0 ? "OPEN" : paid >= total ? "PAID" : "PARTIAL");

export async function createSupplierInvoice(actor: Actor, input: SupplierInvoiceInput) {
  assertCan(actor, "purchasing.create");
  if (!input.supplierId) throw new FinanceError("Pick the supplier");
  if (!input.number.trim()) throw new FinanceError("Enter the supplier's invoice number");
  if (!isValidISODate(input.date)) throw new FinanceError("Enter the invoice date");
  if (input.dueDate && (!isValidISODate(input.dueDate) || input.dueDate < input.date)) throw new FinanceError("The due date must be on or after the invoice date");
  if (!Number.isInteger(input.subtotal) || input.subtotal <= 0) throw new FinanceError("Enter the invoice amount");
  const tax = input.tax ?? 0;
  if (!Number.isInteger(tax) || tax < 0) throw new FinanceError("Tax can't be negative");
  if (input.poId) {
    const po = await db.purchaseOrder.findUnique({ where: { id: input.poId } });
    if (!po || po.supplierId !== input.supplierId) throw new FinanceError("That purchase order belongs to another supplier");
  }
  await assertPeriodOpen(input.date);
  const inv = await db.supplierInvoice.create({
    data: {
      supplierId: input.supplierId,
      poId: input.poId || null,
      number: input.number.trim().slice(0, 60),
      date: day(input.date),
      dueDate: input.dueDate ? day(input.dueDate) : null,
      subtotal: input.subtotal,
      tax,
      total: input.subtotal + tax,
      attachmentUrl: input.attachmentUrl || null,
    },
  });
  await audit({ actorId: actor.id, action: "payable.invoice_create", entity: "SupplierInvoice", entityId: inv.id, summary: `${inv.number} ${rs(inv.total)}`, after: { ...input, total: inv.total } });
  return inv;
}

export async function voidSupplierInvoice(actor: Actor, id: string, reason: string) {
  assertCan(actor, "purchasing.approve");
  if (!reason.trim()) throw new FinanceError("Give a reason");
  const inv = await db.supplierInvoice.findUniqueOrThrow({ where: { id } });
  if (inv.status === "VOID") throw new FinanceError("Already void");
  if (inv.paidAmount !== 0) throw new FinanceError("Money has been paid on this invoice — reverse the payments first");
  await assertPeriodOpen(iso(inv.date));
  const r = await db.supplierInvoice.updateMany({ where: { id, paidAmount: 0, status: { not: "VOID" } }, data: { status: "VOID" } });
  if (!r.count) throw new FinanceError("This invoice changed — reload");
  await audit({ actorId: actor.id, action: "payable.invoice_void", entity: "SupplierInvoice", entityId: id, summary: inv.number, reason, before: { status: inv.status }, after: { status: "VOID" } });
}

/** Pay (part of) a supplier invoice. Never more than what's outstanding. */
export async function recordSupplierPayment(actor: Actor, input: { invoiceId: string; amount: number; method: string; reference: string; paidAt?: string }) {
  assertCan(actor, "purchasing.approve");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new FinanceError("Enter the amount paid");
  if (!(PAY_METHODS as readonly string[]).includes(input.method)) throw new FinanceError("Pick how it was paid");
  if (!input.reference.trim()) throw new FinanceError("Enter the bank / cheque / receipt reference");
  const paidOn = input.paidAt && isValidISODate(input.paidAt) ? input.paidAt : todayKTM();
  if (paidOn > todayKTM()) throw new FinanceError("A payment can't be dated in the future");
  await assertPeriodOpen(paidOn);
  const out = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supinv:${input.invoiceId}`}))`;
    const inv = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: input.invoiceId } });
    if (inv.status === "VOID") throw new FinanceError("This invoice is void");
    const due = inv.total - inv.paidAmount;
    if (input.amount > due) throw new FinanceError(`Only ${rs(due)} is outstanding`);
    const pay = await tx.supplierPayment.create({ data: { invoiceId: inv.id, amount: input.amount, method: input.method, reference: input.reference.trim().slice(0, 120), paidAt: new Date(`${paidOn}T12:00:00+05:45`), actorId: actor.id } });
    const paid = inv.paidAmount + input.amount;
    await tx.supplierInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: statusFor(paid, inv.total) } });
    return { inv, pay, paid };
  });
  await audit({ actorId: actor.id, approvedById: actor.id, action: "payable.payment", entity: "SupplierInvoice", entityId: input.invoiceId, summary: `${out.inv.number}: paid ${rs(input.amount)} (${input.method} ${input.reference})`, after: { paymentId: out.pay.id, paidAmount: out.paid } });
  return out.pay;
}

/** Cancel a wrong supplier payment with a negative mirror payment (the original row is never changed). */
export async function reverseSupplierPayment(actor: Actor, paymentId: string, reason: string) {
  assertCan(actor, "purchasing.approve");
  if (!reason.trim()) throw new FinanceError("Give a reason");
  const today = todayKTM();
  await assertPeriodOpen(today);
  const out = await db.$transaction(async (tx) => {
    const p = await tx.supplierPayment.findUniqueOrThrow({ where: { id: paymentId } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supinv:${p.invoiceId}`}))`;
    if (p.amount <= 0) throw new FinanceError("A reversal can't be reversed");
    if (await tx.supplierPayment.count({ where: { invoiceId: p.invoiceId, reference: `REV:${p.id}` } })) throw new FinanceError("Already reversed");
    const inv = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
    const rev = await tx.supplierPayment.create({ data: { invoiceId: p.invoiceId, amount: -p.amount, method: p.method, reference: `REV:${p.id}`, paidAt: new Date(), actorId: actor.id } });
    const paid = inv.paidAmount - p.amount;
    await tx.supplierInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status: statusFor(paid, inv.total) } });
    return { inv, rev, p };
  });
  await audit({ actorId: actor.id, approvedById: actor.id, action: "payable.payment_reverse", entity: "SupplierInvoice", entityId: out.inv.id, summary: `${out.inv.number}: reversed ${rs(out.p.amount)}`, reason, after: { reversalId: out.rev.id } });
  return out.rev;
}

export const AGEING_BUCKETS = [
  { key: "current", label: "Not yet due" },
  { key: "d30", label: "1–30 days overdue" },
  { key: "d60", label: "31–60 days" },
  { key: "d90", label: "61–90 days" },
  { key: "d90plus", label: "Over 90 days" },
] as const;
export type AgeingKey = (typeof AGEING_BUCKETS)[number]["key"];

export function ageingBucket(dueIso: string, asOf: string): AgeingKey {
  const late = daysBetween(dueIso, asOf);
  if (late <= 0) return "current";
  if (late <= 30) return "d30";
  if (late <= 60) return "d60";
  if (late <= 90) return "d90";
  return "d90plus";
}

/** Outstanding supplier balances by supplier and age (due date, or invoice date when there's no due date). */
export async function payablesAgeing(asOf = todayKTM()) {
  const open = await db.supplierInvoice.findMany({
    where: { status: { in: ["OPEN", "PARTIAL"] }, date: { lte: day(asOf) } },
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: [{ dueDate: "asc" }, { date: "asc" }],
  });
  const zero = (): Record<AgeingKey, number> => ({ current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 });
  const totals = zero();
  const bySupplier = new Map<string, { supplierId: string; name: string; buckets: Record<AgeingKey, number>; total: number }>();
  const invoices = open.map((i) => {
    const outstanding = i.total - i.paidAmount;
    const due = iso(i.dueDate ?? i.date);
    const bucket = ageingBucket(due, asOf);
    totals[bucket] += outstanding;
    const s = bySupplier.get(i.supplierId) ?? { supplierId: i.supplierId, name: i.supplier.name, buckets: zero(), total: 0 };
    s.buckets[bucket] += outstanding;
    s.total += outstanding;
    bySupplier.set(i.supplierId, s);
    return { id: i.id, number: i.number, supplier: i.supplier.name, due, outstanding, bucket, daysOverdue: Math.max(0, daysBetween(due, asOf)) };
  });
  return { asOf, totals, total: Object.values(totals).reduce((a, b) => a + b, 0), suppliers: [...bySupplier.values()].sort((a, b) => b.total - a.total), invoices };
}

/**
 * Three-way match hint: what was ordered (PO), what was received (PO lines' received qty × unit cost) and what was
 * invoiced (subtotal before tax). A hint for finance, not a block: suppliers round, and partial deliveries happen.
 */
export async function threeWayMatch(invoiceId: string) {
  const inv = await db.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { po: { include: { lines: true } } } });
  if (!inv.po) return { status: "NO_PO" as const, ordered: null, received: null, invoiced: inv.subtotal, message: "Not linked to a purchase order — check the goods were received before paying." };
  const ordered = inv.po.lines.reduce((a, l) => a + Math.round(l.quantity * l.unitCost), 0);
  const received = inv.po.lines.reduce((a, l) => a + Math.round(l.receivedQty * l.unitCost), 0);
  const otherInvoiced = await db.supplierInvoice.aggregate({ where: { poId: inv.po.id, id: { not: inv.id }, status: { not: "VOID" } }, _sum: { subtotal: true } });
  const invoiced = inv.subtotal + (otherInvoiced._sum.subtotal ?? 0);
  const tolerance = Math.max(100, Math.round(received * 0.01)); // Rs 1 or 1%
  if (received === 0) return { status: "NOT_RECEIVED" as const, ordered, received, invoiced, message: "Nothing has been received against this PO yet." };
  if (invoiced > received + tolerance) return { status: "OVER_INVOICED" as const, ordered, received, invoiced, message: `Invoiced ${rs(invoiced - received)} more than the goods received.` };
  if (invoiced < received - tolerance) return { status: "UNDER_INVOICED" as const, ordered, received, invoiced, message: `Received goods worth ${rs(received - invoiced)} not yet invoiced.` };
  return { status: "MATCH" as const, ordered, received, invoiced, message: "PO, goods received and invoice agree (within Rs 1 / 1%)." };
}
