import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dateOnly, daysBetween, isoDate, isValidISODate, todayKTM } from "@/lib/dates";
import { audit } from "@/lib/audit";
import { rs } from "@/lib/money";
import { REVENUE_STATUSES } from "./transitions";
import { COMPANY_SHARE_PREFIX, CorporateError, UNBILLED_ADJUSTMENT, generateCompanyInvoice, issueCompanyInvoice, type StaffActor } from "./corporate";
import { expireOpenAttempts } from "./payments/attempts";

type Tx = Prisma.TransactionClient;

export class InvoiceError extends Error {}

async function nextNumber(tx: Tx, prefix: "INV" | "CN", year: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-number:${prefix}:${year}`}))`;
  const last = await tx.invoice.findFirst({ where: { number: { startsWith: `${prefix}-${year}-` } }, orderBy: { number: "desc" }, select: { number: true } });
  const n = last ? parseInt(last.number.split("-")[2], 10) + 1 : 1;
  return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
}

/** VAT contained in the employer's share of an order (proportional to the share of the order total). */
export function shareTax(o: { tax: number; total: number; companyShare: number }) {
  if (!o.tax || !o.total) return 0;
  return Math.round((o.tax * o.companyShare) / o.total);
}

/** Staff actor (role, custom grants, company scopes) for the corporate invoice services. */
async function staffActor(actorId: string): Promise<StaffActor> {
  const u = await db.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, staffRole: { select: { permissions: true } }, scopes: { select: { companyId: true } } } });
  if (!u) throw new InvoiceError("Unknown staff member");
  return { id: u.id, role: u.role, customGrants: u.staffRole?.permissions ?? [], scopes: u.scopes };
}

const asInvoiceError = (e: unknown) => (e instanceof CorporateError ? new InvoiceError(e.message) : e);

/**
 * Bill the employer share of a company's meals for a period (DRAFT). Delegates to the contract-aware
 * `generateCompanyInvoice` (corporate.ts): only not-yet-invoiced, due (delivery ≤ today), live orders, plus
 * company-share `OrderAdjustment` rows billed exactly once, due date from the contract's credit terms.
 * Running it twice for the same period never double-bills. Company scope + `invoices.edit` are checked there.
 */
export async function generateInvoice(input: { companyId: string; periodStart: string; periodEnd: string; actorId: string; grouping?: "ORDER" | "DAY" }) {
  if (input.periodEnd < input.periodStart) throw new InvoiceError("Period end is before the start");
  const actor = await staffActor(input.actorId);
  try {
    return await generateCompanyInvoice(actor, { companyId: input.companyId, periodStart: input.periodStart, periodEnd: input.periodEnd, grouping: input.grouping });
  } catch (e) {
    throw asInvoiceError(e);
  }
}

/** Issue a draft. Company invoices: due = issue date + credit terms of the contract in force (else the company's terms). */
export async function issueInvoice(id: string, actorId: string) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id } });
  if (inv.status !== "DRAFT") throw new InvoiceError("Only drafts can be issued");
  if (inv.companyId) {
    try {
      return await issueCompanyInvoice(await staffActor(actorId), id);
    } catch (e) {
      throw asInvoiceError(e);
    }
  }
  const updated = await db.invoice.update({ where: { id }, data: { status: "ISSUED", issuedAt: new Date(), dueDate: dateOnly(addDays(todayKTM(), 15)) } });
  await audit({ actorId, action: "invoice.issue", entity: "Invoice", entityId: id, summary: inv.number });
  return updated;
}

function outstanding(inv: { total: number; paidAmount: number }) {
  return inv.total - inv.paidAmount;
}

export const RECEIPT_METHODS = ["BANK_TRANSFER", "CHEQUE", "CASH", "ESEWA", "KHALTI", "OTHER"] as const;
export type ReceiptMethod = (typeof RECEIPT_METHODS)[number];

/**
 * Serialise every change to one invoice's balance: manual receipts, credit notes, void, and online payment
 * (start + verification). Lock order where a payment is involved: invoice → payment (markPaymentPaid takes the
 * invoice lock first for a purpose-INVOICE payment).
 */
export async function lockInvoice(tx: Tx, invoiceId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${invoiceId}`}))`;
}

/** Idempotency-key prefix that links an online payment (purpose INVOICE) to its invoice before any receipt exists. */
export const invoicePaymentKeyPrefix = (invoiceId: string) => `invoice:${invoiceId}:`;
/** The invoice an online invoice payment is for (from its idempotency key), or null. */
export function invoiceIdOfPayment(p: { purpose?: string | null; idempotencyKey: string | null }): string | null {
  if (p.purpose && p.purpose !== "INVOICE") return null;
  const m = /^invoice:([^:]+):/.exec(p.idempotencyKey ?? "");
  return m ? m[1] : null;
}

/**
 * The invoice's balance is about to change (manual receipt, credit note, void): cancel every unpaid online payment
 * for it and expire their gateway sessions. Their amount was fixed at start = the old outstanding; a session still
 * paid at the gateway afterwards is refused by markPaymentPaid (INVOICE_CANCELLED + GATEWAY_MISMATCH alert) and
 * finance refunds it at the gateway. Call under the invoice lock. No payment lock (lock order invoice → payment is
 * kept by markPaymentPaid; the guarded update + version bump makes a concurrent method switch fail cleanly).
 */
export async function cancelOpenInvoicePayments(tx: Tx, invoiceId: string) {
  const open = await tx.payment.findMany({ where: { purpose: "INVOICE", idempotencyKey: { startsWith: invoicePaymentKeyPrefix(invoiceId) }, status: { in: ["PENDING", "FAILED"] } }, select: { id: true } });
  let cancelled = 0;
  for (const p of open) {
    await expireOpenAttempts(tx, p.id);
    const u = await tx.payment.updateMany({ where: { id: p.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "CANCELLED", version: { increment: 1 }, note: "Cancelled: the invoice changed before payment" } });
    cancelled += u.count;
  }
  return cancelled;
}

type ReceiptInput = { amount: number; method: string; reference: string; receivedAt: Date; receivedOn: string; recordedById: string | null; note?: string | null; paymentId?: string | null };

/**
 * Write one dated `InvoiceReceipt` and move the invoice's `paidAmount` / status — the shared core of manual receipts
 * (recordInvoicePayment) and online payments (markPaymentPaid → INVOICE). Caller holds the invoice lock and has
 * checked the invoice is open and `amount` ≤ outstanding.
 */
export async function applyInvoiceReceiptTx(tx: Tx, i: { id: string; total: number; paidAmount: number; note: string | null }, r: ReceiptInput) {
  const paid = i.paidAmount + r.amount;
  const receipt = await tx.invoiceReceipt.create({
    data: { invoiceId: i.id, amount: r.amount, method: r.method, reference: r.reference.trim().slice(0, 120), receivedAt: r.receivedAt, recordedById: r.recordedById, note: r.note?.trim().slice(0, 500) || null, paymentId: r.paymentId ?? null },
  });
  const inv = await tx.invoice.update({
    where: { id: i.id },
    data: { paidAmount: paid, status: paid >= i.total ? "PAID" : "PARTIALLY_PAID", note: [i.note, `${r.receivedOn} received ${rs(r.amount)} (${r.reference.trim()})`].filter(Boolean).join("\n") },
  });
  return { inv, receipt };
}

/**
 * Record money received against an issued invoice. Writes a dated `InvoiceReceipt` (the cash record: method,
 * reference, the day the money arrived) and moves `paidAmount` / status in the same transaction. `paidAmount` also
 * includes credit-note settlements, so cash reports use Σ receipts, never `paidAmount`. Unpaid online payments for
 * the invoice are cancelled (their amount was the old balance).
 */
export async function recordInvoicePayment(
  id: string,
  actorId: string,
  amount: number,
  reference: string,
  opts: { method?: ReceiptMethod | string | null; receivedOn?: string | null; note?: string | null } = {},
) {
  if (amount <= 0) throw new InvoiceError("Enter the amount received");
  if (!reference.trim()) throw new InvoiceError("Enter the bank / cheque reference");
  const method = (opts.method || "BANK_TRANSFER") as ReceiptMethod;
  if (!RECEIPT_METHODS.includes(method)) throw new InvoiceError("Choose how the money was received");
  const today = todayKTM();
  const receivedOn = opts.receivedOn || today;
  if (!isValidISODate(receivedOn) || receivedOn > today) throw new InvoiceError("The received date can't be in the future");
  // Money that arrived today is stamped now; an earlier day is stamped at noon Kathmandu time on that day.
  const receivedAt = receivedOn === today ? new Date() : new Date(`${receivedOn}T12:00:00+05:45`);
  const { inv, receipt, cancelled } = await db.$transaction(async (tx) => {
    await lockInvoice(tx, id);
    const i = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (i.kind !== "INVOICE" || !["ISSUED", "PARTIALLY_PAID"].includes(i.status)) throw new InvoiceError("Issue the invoice before recording payment");
    if (amount > outstanding(i)) throw new InvoiceError(`Only ${rs(outstanding(i))} is outstanding`);
    const cancelled = await cancelOpenInvoicePayments(tx, id);
    return { ...(await applyInvoiceReceiptTx(tx, i, { amount, method, reference, receivedAt, receivedOn, recordedById: actorId, note: opts.note })), cancelled };
  });
  await audit({ actorId, action: "invoice.payment", entity: "Invoice", entityId: id, summary: `${rs(amount)} · ${reference}`, after: { receiptId: receipt.id, method, receivedOn, ...(cancelled ? { onlinePaymentsCancelled: cancelled } : {}) } });
  return inv;
}

/** Receipts recorded against one invoice (newest first). */
export async function invoiceReceipts(invoiceId: string) {
  return db.invoiceReceipt.findMany({ where: { invoiceId }, orderBy: { receivedAt: "desc" } });
}

/** Void an unpaid invoice: its orders become billable again. */
export async function voidInvoice(id: string, actorId: string, reason: string) {
  if (!reason.trim()) throw new InvoiceError("Give a reason");
  const inv = await db.$transaction(async (tx) => {
    await lockInvoice(tx, id);
    const i = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (i.status === "VOID") throw new InvoiceError("Already void");
    if (i.paidAmount > 0) throw new InvoiceError("Money has been received on this invoice — issue a credit note instead");
    await cancelOpenInvoicePayments(tx, id);
    await tx.order.updateMany({ where: { invoiceId: id }, data: { invoiceId: null } });
    return tx.invoice.update({ where: { id }, data: { status: "VOID", note: [i.note, `VOID: ${reason}`].filter(Boolean).join("\n") } });
  });
  await audit({ actorId, action: "invoice.void", entity: "Invoice", entityId: id, summary: inv.number, reason });
  return inv;
}

/**
 * Credit note against an issued invoice (e.g. meals that arrived cold). It reduces what the company
 * owes on the original invoice; the original lines are never edited.
 */
export async function createCreditNote(invoiceId: string, actorId: string, amount: number, reason: string) {
  if (amount <= 0) throw new InvoiceError("Enter an amount");
  if (!reason.trim()) throw new InvoiceError("Give a reason");
  const cn = await db.$transaction(async (tx) => {
    await lockInvoice(tx, invoiceId);
    const i = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (i.kind !== "INVOICE" || !["ISSUED", "PARTIALLY_PAID", "PAID"].includes(i.status)) throw new InvoiceError("Credit notes need an issued invoice");
    const credited = await tx.invoice.aggregate({ where: { relatedId: i.id, kind: "CREDIT_NOTE", status: { not: "VOID" } }, _sum: { total: true } });
    const room = i.total - (credited._sum.total ?? 0);
    if (amount > room) throw new InvoiceError(`At most ${rs(room)} can still be credited`);
    const tax = i.total ? Math.round((i.tax * amount) / i.total) : 0;
    const note = await tx.invoice.create({
      data: {
        number: await nextNumber(tx, "CN", todayKTM().slice(0, 4)),
        kind: "CREDIT_NOTE",
        companyId: i.companyId,
        userId: i.userId,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
        status: "ISSUED",
        billingName: i.billingName,
        billingAddress: i.billingAddress,
        panVat: i.panVat,
        subtotal: amount - tax,
        tax,
        total: amount,
        issuedAt: new Date(),
        relatedId: i.id,
        note: reason,
        createdById: actorId,
        lines: { create: [{ description: `Credit against ${i.number}: ${reason}`.slice(0, 300), quantity: 1, unitPrice: amount, amount }] },
      },
    });
    // Settle the original by the credited amount (what is still unpaid first).
    const settle = Math.min(amount, outstanding(i));
    if (settle > 0) {
      // The balance shrinks: an online payment started for the old balance must not be completed.
      await cancelOpenInvoicePayments(tx, i.id);
      const paid = i.paidAmount + settle;
      await tx.invoice.update({ where: { id: i.id }, data: { paidAmount: paid, status: paid >= i.total ? "PAID" : "PARTIALLY_PAID", note: [i.note, `${note.number} credited ${rs(amount)}`].join("\n") } });
    }
    return note;
  });
  await audit({ actorId, action: "invoice.credit_note", entity: "Invoice", entityId: cn.id, summary: `${cn.number} ${rs(amount)} on ${invoiceId}`, reason });
  return cn;
}

export type Ageing = { current: number; d30: number; d60: number; d90: number; over90: number; total: number };

/** Company filter: one id, a staff member's company scope (array; [] = none), or undefined/null = every company. */
type CompanyFilter = string | string[] | null | undefined;
const companyIn = (f: CompanyFilter) => (f == null ? undefined : typeof f === "string" ? f : { in: f });

/** Outstanding by days past due (0–30 includes not yet due). Pass the staff member's `companyScope` to scope it. */
export async function ageing(companyId?: CompanyFilter): Promise<{ buckets: Ageing; rows: { id: string; number: string; company: string; due: string | null; days: number; outstanding: number }[] }> {
  const invs = await db.invoice.findMany({
    where: { kind: "INVOICE", status: { in: ["ISSUED", "PARTIALLY_PAID"] }, ...(companyId != null ? { companyId: companyIn(companyId) } : {}) },
    include: { company: { select: { name: true } } },
    orderBy: { dueDate: "asc" },
  });
  const today = todayKTM();
  const buckets: Ageing = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 };
  const rows = invs.map((i) => {
    const due = i.dueDate ? isoDate(i.dueDate) : null;
    const days = due ? Math.max(0, daysBetween(due, today)) : 0;
    const amt = i.total - i.paidAmount;
    if (!due || today <= due) buckets.current += amt;
    else if (days <= 30) buckets.d30 += amt;
    else if (days <= 60) buckets.d60 += amt;
    else if (days <= 90) buckets.d90 += amt;
    else buckets.over90 += amt;
    buckets.total += amt;
    return { id: i.id, number: i.number, company: i.company?.name ?? i.billingName, due, days, outstanding: amt };
  });
  return { buckets, rows };
}

/**
 * Company-share `OrderAdjustment` rows (staff edits, WP-03) on due, billable orders that no non-void invoice has billed
 * yet (`OrderAdjustment.invoiceLineId`, set by `generateCompanyInvoice`), summed per company.
 */
export async function unbilledAdjustmentsByCompany(companyId?: CompanyFilter) {
  const adjustments = await db.orderAdjustment.findMany({
    where: {
      reason: { startsWith: COMPANY_SHARE_PREFIX },
      ...UNBILLED_ADJUSTMENT,
      order: { companyId: companyIn(companyId) ?? { not: null }, status: { in: REVENUE_STATUSES }, deliveryDate: { lte: dateOnly(todayKTM()) } },
    },
    select: { id: true, amount: true, order: { select: { companyId: true, deliveryDate: true } } },
  });
  const out = new Map<string, { amount: number; count: number; from: string; to: string }>();
  for (const a of adjustments) {
    if (!a.order.companyId) continue;
    const d = isoDate(a.order.deliveryDate);
    const cur = out.get(a.order.companyId) ?? { amount: 0, count: 0, from: d, to: d };
    out.set(a.order.companyId, { amount: cur.amount + a.amount, count: cur.count + 1, from: d < cur.from ? d : cur.from, to: d > cur.to ? d : cur.to });
  }
  return out;
}

/**
 * Companies with billable employer share that isn't on an invoice yet (meals + unbilled company-share adjustments).
 * `companyIds` = the staff member's company scope (null = all companies).
 */
export async function uninvoicedByCompany(companyIds?: string[] | null) {
  const [rows, adjustments] = await Promise.all([
    db.order.groupBy({
      by: ["companyId"],
      where: { companyId: companyIds ? { in: companyIds } : { not: null }, invoiceId: null, companyShare: { gt: 0 }, status: { in: REVENUE_STATUSES }, deliveryDate: { lte: dateOnly(todayKTM()) } },
      _sum: { companyShare: true },
      _count: true,
      _min: { deliveryDate: true },
      _max: { deliveryDate: true },
    }),
    unbilledAdjustmentsByCompany(companyIds ?? undefined),
  ]);
  const ids = [...new Set([...rows.map((r) => r.companyId!), ...adjustments.keys()])];
  const companies = await db.company.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return ids
    .map((companyId) => {
      const r = rows.find((x) => x.companyId === companyId);
      const adj = adjustments.get(companyId);
      const from = [r?._min.deliveryDate ? isoDate(r._min.deliveryDate) : null, adj?.from ?? null].filter((x): x is string => !!x).sort()[0] ?? null;
      const to = [r?._max.deliveryDate ? isoDate(r._max.deliveryDate) : null, adj?.to ?? null].filter((x): x is string => !!x).sort().reverse()[0] ?? null;
      return {
        companyId,
        name: companies.find((c) => c.id === companyId)?.name ?? "—",
        amount: (r?._sum.companyShare ?? 0) + (adj?.amount ?? 0),
        adjustments: adj?.amount ?? 0,
        orders: r?._count ?? 0,
        from,
        to,
      };
    })
    .filter((r) => r.amount !== 0);
}
