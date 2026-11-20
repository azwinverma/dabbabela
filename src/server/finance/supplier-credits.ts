import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rs } from "@/lib/money";
import { todayKTM } from "@/lib/dates";
import { assertCan, assertPeriodOpen, FinanceError, type Actor, type Tx } from "./common";

/**
 * Supplier credit (Phase 2C): money a supplier owes us, usually for goods returned on a purchase order
 * (`returnToSupplier` → one `SupplierCredit` per return, keyed by `returnKey` for idempotency).
 *
 * Applying a credit to a supplier invoice writes an append-only `SupplierCreditApplication` and — by design —
 * **adds the applied amount to `SupplierInvoice.paidAmount`** (and moves its status OPEN → PARTIAL → PAID), exactly like
 * a payment. So "paidAmount" means *settled* (cash + credits), and everything that reads `total − paidAmount`
 * (payables list, ageing, the payment form's "never more than outstanding" check) shows the net due after credits.
 * It is **not cash**: cash flow, the journal's SUPPLIER_PAYMENTS and settlement reports keep reading `SupplierPayment`
 * only (the journal posts an application as payable.suppliers ↔ inventory.purchases, no cash account).
 *
 * Limits: an application never exceeds the credit's remainder (amount − appliedAmount) nor the invoice's remaining due
 * (total − paidAmount); both rows are locked (advisory locks `supcredit:<id>` then `supinv:<id>`) and updated with
 * guarded writes. Credit status: OPEN (nothing applied) → PARTIAL → APPLIED (fully used). VOID cancels the *unapplied
 * remainder* only — applications already made stay (they are append-only), and a voided credit can't be applied again.
 */

export const CREDIT_STATUSES = ["OPEN", "PARTIAL", "APPLIED", "VOID"] as const;
export type CreditStatus = (typeof CREDIT_STATUSES)[number];

const creditStatus = (applied: number, amount: number): CreditStatus => (applied <= 0 ? "OPEN" : applied >= amount ? "APPLIED" : "PARTIAL");
const invoiceStatus = (paid: number, total: number) => (paid <= 0 ? "OPEN" : paid >= total ? "PAID" : "PARTIAL");

/**
 * Inside a purchase-return transaction: create the supplier credit for that return once. A second call with the same
 * `returnKey` returns the existing credit (`created: false`) and changes nothing.
 */
export async function createReturnCredit(
  tx: Tx,
  input: { supplierId: string; poId: string; returnKey: string; amount: number; number?: string | null; reason?: string | null; actorId?: string | null },
) {
  const existing = await tx.supplierCredit.findUnique({ where: { returnKey: input.returnKey } });
  if (existing) return { credit: existing, created: false };
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new FinanceError("The returned goods have no value to credit");
  const credit = await tx.supplierCredit.create({
    data: {
      supplierId: input.supplierId,
      poId: input.poId,
      returnKey: input.returnKey,
      number: input.number?.trim().slice(0, 60) || null,
      amount: input.amount,
      reason: input.reason?.trim().slice(0, 300) || null,
      createdById: input.actorId ?? null,
    },
  });
  return { credit, created: true };
}

/** Value of returns posted on a PO that no (non-void) supplier credit covers yet. */
export async function uncreditedReturnValue(poId: string, client: Tx | typeof db = db) {
  const po = await client.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, select: { number: true } });
  const rows = await client.stockMovement.findMany({ where: { type: "RETURN", reference: { startsWith: `${po.number}#return:` } }, select: { quantity: true, unitCost: true } });
  const returned = rows.reduce((a, r) => a + Math.round(-r.quantity * (r.unitCost ?? 0)), 0);
  const credited = await client.supplierCredit.aggregate({ where: { poId, status: { not: "VOID" } }, _sum: { amount: true } });
  return { returned, credited: credited._sum.amount ?? 0, uncredited: Math.max(0, returned - (credited._sum.amount ?? 0)) };
}

/**
 * Raise one credit for returns that were posted without one (e.g. the credit note arrived later). Idempotent: the key
 * is the PO plus the returned value it covers, so a double submit creates one credit.
 */
export async function creditUncreditedReturns(actor: Actor, input: { poId: string; number?: string | null; reason?: string | null }) {
  assertCan(actor, "purchasing.create");
  const out = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`po:${input.poId}`}))`;
    const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: input.poId }, select: { id: true, number: true, supplierId: true } });
    const v = await uncreditedReturnValue(po.id, tx);
    if (v.uncredited <= 0) throw new FinanceError("Every return on this order already has a supplier credit");
    return { po, ...(await createReturnCredit(tx, { supplierId: po.supplierId, poId: po.id, returnKey: `${po.number}#returns:${v.returned}`, amount: v.uncredited, number: input.number, reason: input.reason ?? "Credit for earlier returns", actorId: actor.id })) };
  });
  if (out.created) await audit({ actorId: actor.id, action: "supplier_credit.create", entity: "SupplierCredit", entityId: out.credit.id, summary: `${out.po.number}: credit ${rs(out.credit.amount)}${out.credit.number ? ` (note ${out.credit.number})` : ""}`, after: out.credit });
  return out.credit;
}

/** Apply (part of) a credit to an invoice of the same supplier. Never more than the credit has left or the invoice owes. */
export async function applySupplierCredit(actor: Actor, input: { creditId: string; invoiceId: string; amount: number }) {
  assertCan(actor, "purchasing.approve");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new FinanceError("Enter the amount to apply");
  const today = todayKTM();
  await assertPeriodOpen(today);
  const out = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supcredit:${input.creditId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supinv:${input.invoiceId}`}))`;
    const credit = await tx.supplierCredit.findUnique({ where: { id: input.creditId } });
    const inv = await tx.supplierInvoice.findUnique({ where: { id: input.invoiceId } });
    if (!credit) throw new FinanceError("Credit not found");
    if (!inv) throw new FinanceError("Invoice not found");
    if (credit.status === "VOID") throw new FinanceError("This credit is void");
    if (inv.status === "VOID") throw new FinanceError("This invoice is void");
    if (credit.supplierId !== inv.supplierId) throw new FinanceError("The credit and the invoice belong to different suppliers");
    const left = credit.amount - credit.appliedAmount;
    const due = inv.total - inv.paidAmount;
    if (left <= 0) throw new FinanceError("Nothing left on this credit");
    if (due <= 0) throw new FinanceError("Nothing is outstanding on this invoice");
    if (input.amount > left) throw new FinanceError(`Only ${rs(left)} is left on this credit`);
    if (input.amount > due) throw new FinanceError(`Only ${rs(due)} is outstanding on this invoice`);
    const applied = credit.appliedAmount + input.amount;
    const c = await tx.supplierCredit.updateMany({ where: { id: credit.id, appliedAmount: credit.appliedAmount, status: credit.status }, data: { appliedAmount: applied, status: creditStatus(applied, credit.amount) } });
    if (!c.count) throw new FinanceError("This credit changed — reload");
    const paid = inv.paidAmount + input.amount;
    const i = await tx.supplierInvoice.updateMany({ where: { id: inv.id, paidAmount: inv.paidAmount }, data: { paidAmount: paid, status: invoiceStatus(paid, inv.total) } });
    if (!i.count) throw new FinanceError("This invoice changed — reload");
    const app = await tx.supplierCreditApplication.create({ data: { creditId: credit.id, invoiceId: inv.id, amount: input.amount, actorId: actor.id } });
    return { credit, inv, app, applied, paid };
  });
  await audit({
    actorId: actor.id,
    approvedById: actor.id,
    action: "supplier_credit.apply",
    entity: "SupplierCredit",
    entityId: out.credit.id,
    summary: `${rs(input.amount)} of credit${out.credit.number ? ` ${out.credit.number}` : ""} applied to invoice ${out.inv.number}`,
    before: { appliedAmount: out.credit.appliedAmount, invoicePaid: out.inv.paidAmount },
    after: { applicationId: out.app.id, appliedAmount: out.applied, invoicePaid: out.paid },
  });
  return out.app;
}

/** Void a credit's unapplied remainder (applications already made stay). Audited with the reason. */
export async function voidSupplierCredit(actor: Actor, creditId: string, reason: string) {
  assertCan(actor, "purchasing.approve");
  if (!reason.trim()) throw new FinanceError("Give a reason");
  const out = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supcredit:${creditId}`}))`;
    const c = await tx.supplierCredit.findUnique({ where: { id: creditId } });
    if (!c) throw new FinanceError("Credit not found");
    if (c.status === "VOID") throw new FinanceError("Already void");
    if (c.status === "APPLIED") throw new FinanceError("This credit is fully applied — nothing left to void");
    const r = await tx.supplierCredit.updateMany({ where: { id: c.id, status: c.status, appliedAmount: c.appliedAmount }, data: { status: "VOID", reason: [c.reason, `Void: ${reason.trim()}`].filter(Boolean).join(" · ").slice(0, 500) } });
    if (!r.count) throw new FinanceError("This credit changed — reload");
    return c;
  });
  await audit({ actorId: actor.id, action: "supplier_credit.void", entity: "SupplierCredit", entityId: creditId, summary: `Credit ${rs(out.amount)} voided (${rs(out.amount - out.appliedAmount)} unapplied written off)`, reason, before: { status: out.status, appliedAmount: out.appliedAmount }, after: { status: "VOID" } });
}

/** Credits for the payables page: open/partial by default, optionally one supplier. */
export async function listSupplierCredits(opts: { supplierId?: string | null; includeClosed?: boolean } = {}) {
  return db.supplierCredit.findMany({
    where: { ...(opts.supplierId ? { supplierId: opts.supplierId } : {}), ...(opts.includeClosed ? {} : { status: { in: ["OPEN", "PARTIAL"] } }) },
    include: { supplier: { select: { name: true } }, po: { select: { id: true, number: true } }, applications: { include: { invoice: { select: { id: true, number: true } } }, orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

/** Unapplied credit per supplier (open + partial remainders). */
export async function openCreditBySupplier(client: Tx | typeof db = db) {
  const rows = await client.supplierCredit.findMany({ where: { status: { in: ["OPEN", "PARTIAL"] } }, select: { supplierId: true, amount: true, appliedAmount: true } });
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.supplierId, (out.get(r.supplierId) ?? 0) + (r.amount - r.appliedAmount));
  return out;
}

/** Credits applied to one invoice (invoice page). */
export async function creditApplicationsForInvoice(invoiceId: string) {
  return db.supplierCreditApplication.findMany({ where: { invoiceId }, include: { credit: { select: { id: true, number: true, po: { select: { number: true } } } } }, orderBy: { createdAt: "asc" } });
}
