import "server-only";
import { randomUUID } from "node:crypto";
import type { Payment, PaymentMethod, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rs } from "@/lib/money";
import { ktmNow } from "@/lib/dates";
import { getSettings, type SiteSettings } from "@/lib/settings";
import { paymentRef } from "./orders";
import { availableMethods } from "./payments/methods";
import { expireOpenAttempts, lockPayment } from "./payments/attempts";
import { applyInvoiceReceiptTx, invoiceIdOfPayment, invoicePaymentKeyPrefix, lockInvoice } from "./invoices";

/**
 * Online payment of a company invoice (Payment.purpose INVOICE). A company admin pays the invoice's outstanding
 * balance with eSewa / Khalti through the normal gateway code (startPayment → return handler / reconcile cron →
 * markPaymentPaid). Rules (same as the 2026-11-23 money-path fixes):
 *   - the amount is fixed at start = the outstanding balance; the payment is linked to the invoice by its
 *     idempotency key `invoice:<invoiceId>:<uuid>` (no schema change, same pattern as swap payments);
 *   - any change to the balance (manual receipt, credit note, void) cancels the unpaid payment and expires its
 *     gateway sessions (invoices.cancelOpenInvoicePayments);
 *   - markPaymentPaid takes the invoice lock, then the payment lock, and accepts the money only when the payment is
 *     still open, the invoice is still open and the verified amount equals the balance — otherwise nothing changes,
 *     the attempt is marked MISMATCH and a GATEWAY_MISMATCH alert is raised (underpayment, a cancelled payment, an
 *     invoice that changed: finance refunds at the gateway);
 *   - on success exactly one InvoiceReceipt (paymentId unique) with method ESEWA / KHALTI, and paidAmount / status
 *     move exactly like a manual receipt.
 */

type Tx = Prisma.TransactionClient;

export class InvoicePaymentError extends Error {}

export const INVOICE_PAY_METHODS = ["ESEWA", "KHALTI"] as const satisfies readonly PaymentMethod[];
export type InvoicePayMethod = (typeof INVOICE_PAY_METHODS)[number];
const isInvoicePayMethod = (m: string): m is InvoicePayMethod => (INVOICE_PAY_METHODS as readonly string[]).includes(m);

/** Another admin's gateway session younger than this blocks a new start (so two admins don't both pay). */
export const CONCURRENT_SESSION_MS = 20 * 60_000;

/** eSewa / Khalti, when enabled and configured (same rule as checkout). */
export async function invoicePayMethods(settings?: SiteSettings): Promise<InvoicePayMethod[]> {
  const s = settings ?? (await getSettings());
  return (await availableMethods(s, { hasCompany: false, customerShare: 1 })).filter(isInvoicePayMethod);
}

const OPEN_INVOICE_STATUSES = ["ISSUED", "PARTIALLY_PAID"] as const;

/** Is this user an active admin of the company (the corporate-portal rule, requireCompanyAdmin)? */
async function isCompanyAdmin(client: Tx | typeof db, userId: string, companyId: string) {
  const m = await client.companyMember.findUnique({ where: { userId }, select: { companyId: true, role: true, status: true, user: { select: { isActive: true, deletedAt: true } }, company: { select: { isActive: true } } } });
  return Boolean(m && m.companyId === companyId && m.role === "ADMIN" && m.status === "ACTIVE" && m.user.isActive && !m.user.deletedAt && m.company.isActive);
}

/** Why an invoice can't be paid online by this user now, or null. */
async function payProblem(client: Tx | typeof db, invoiceId: string, userId: string, companyId?: string | null) {
  const inv = await client.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, number: true, kind: true, status: true, total: true, paidAmount: true, companyId: true, note: true } });
  if (!inv || !inv.companyId || (companyId && inv.companyId !== companyId)) return { problem: "Invoice not found", inv: null };
  if (!(await isCompanyAdmin(client, userId, inv.companyId))) return { problem: "Only your company's admins can pay its invoices", inv: null };
  if (inv.kind !== "INVOICE" || !(OPEN_INVOICE_STATUSES as readonly string[]).includes(inv.status)) return { problem: inv.status === "PAID" ? "This invoice is already paid" : "This invoice can't be paid online", inv };
  if (inv.total - inv.paidAmount <= 0) return { problem: "Nothing is outstanding on this invoice", inv };
  return { problem: null, inv };
}

/**
 * Start (or resume) paying an invoice's outstanding balance online. Company scope: the invoice must belong to the
 * caller's company and the caller must be an active company admin. Runs under the invoice lock:
 *   - the caller's own open payment for the same balance is reused (method switched if needed, sessions expired);
 *   - another admin's payment with a gateway session started in the last 20 minutes → refused (they're paying);
 *   - any other open payment (stale amount, older session) is cancelled and its sessions expired.
 * Returns the PENDING payment; the caller then uses startPayment (eSewa form / Khalti URL).
 */
export async function startInvoicePayment(user: { id: string }, input: { invoiceId: string; method: string; companyId?: string | null }): Promise<{ payment: Payment; reused: boolean }> {
  const settings = await getSettings();
  if (!isInvoicePayMethod(input.method) || !(await invoicePayMethods(settings)).includes(input.method)) throw new InvoicePaymentError("Pay invoices online with eSewa or Khalti (when enabled), or by bank transfer");
  const method = input.method;
  const out = await db.$transaction(async (tx) => {
    await lockInvoice(tx, input.invoiceId);
    const { problem, inv } = await payProblem(tx, input.invoiceId, user.id, input.companyId);
    if (problem || !inv) throw new InvoicePaymentError(problem ?? "Invoice not found");
    const outstanding = inv.total - inv.paidAmount;
    const open = await tx.payment.findMany({
      where: { purpose: "INVOICE", idempotencyKey: { startsWith: invoicePaymentKeyPrefix(inv.id) }, status: { in: ["PENDING", "FAILED"] } },
      include: { attempts: { where: { status: "STARTED" }, orderBy: { createdAt: "desc" }, take: 1 }, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    let reuse: Payment | null = null;
    for (const p of open) {
      await lockPayment(tx, p.id);
      if (!reuse && p.userId === user.id && p.amount === outstanding) {
        if (p.method !== method) {
          await expireOpenAttempts(tx, p.id);
          reuse = await tx.payment.update({ where: { id: p.id }, data: { method, status: "PENDING", version: { increment: 1 } } });
        } else reuse = p;
        continue;
      }
      const live = p.attempts[0];
      if (p.userId !== user.id && live && Date.now() - live.createdAt.getTime() < CONCURRENT_SESSION_MS)
        throw new InvoicePaymentError(`${p.user.name} started paying this invoice a few minutes ago — wait for that payment to finish, or try again in 20 minutes`);
      await expireOpenAttempts(tx, p.id);
      await tx.payment.updateMany({ where: { id: p.id, status: { in: ["PENDING", "FAILED"] } }, data: { status: "CANCELLED", version: { increment: 1 }, note: "Cancelled: superseded by a newer invoice payment" } });
    }
    if (reuse) return { payment: reuse, reused: true, inv };
    const payment = await tx.payment.create({
      data: {
        reference: paymentRef(),
        userId: user.id,
        method,
        status: "PENDING",
        amount: outstanding,
        companyId: inv.companyId,
        purpose: "INVOICE",
        idempotencyKey: `${invoicePaymentKeyPrefix(inv.id)}${randomUUID()}`,
        note: `Invoice ${inv.number}`,
      },
    });
    return { payment, reused: false, inv };
  });
  if (!out.reused)
    await audit({ actorId: user.id, action: "invoice.payment_start", entity: "Invoice", entityId: out.inv.id, summary: `${out.inv.number}: online payment of ${rs(out.payment.amount)} started (${method}, ${out.payment.reference})`, after: { paymentId: out.payment.id, method, amount: out.payment.amount } });
  return { payment: out.payment, reused: out.reused };
}

/** startPayment's extra check for an INVOICE payment: still open, still the balance, still a company admin. */
export async function assertInvoicePaymentStartable(p: Pick<Payment, "userId" | "amount" | "purpose" | "idempotencyKey" | "companyId">) {
  const invoiceId = invoiceIdOfPayment(p);
  if (!invoiceId) throw new InvoicePaymentError("This payment isn't linked to an invoice");
  const { problem, inv } = await payProblem(db, invoiceId, p.userId, p.companyId);
  if (problem || !inv) throw new InvoicePaymentError(problem ?? "Invoice not found");
  if (inv.total - inv.paidAmount !== p.amount) throw new InvoicePaymentError("The invoice changed since you started — start the payment again from the invoice");
}

export type InvoiceAcceptance = { ok: true; invoiceId: string } | { ok: false; reason: "INVOICE_CANCELLED" | "INVOICE_CHANGED" | "UNDERPAID" | "INVOICE_OVERPAID" };

/**
 * markPaymentPaid's gate for an INVOICE payment (caller holds invoice + payment locks, before the status flip):
 * the payment is not cancelled, the invoice is still open and its balance is exactly the payment amount, and the
 * verified amount (when given) equals it. Anything else is refused — never a partial or surplus receipt.
 */
export async function acceptInvoicePayment(tx: Tx, p: Pick<Payment, "status" | "amount" | "purpose" | "idempotencyKey">, verified: number | null | undefined): Promise<InvoiceAcceptance> {
  if (p.status === "CANCELLED") return { ok: false, reason: "INVOICE_CANCELLED" };
  const invoiceId = invoiceIdOfPayment(p);
  if (!invoiceId) return { ok: false, reason: "INVOICE_CHANGED" };
  if (verified != null && verified < p.amount) return { ok: false, reason: "UNDERPAID" };
  if (verified != null && verified > p.amount) return { ok: false, reason: "INVOICE_OVERPAID" };
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, select: { kind: true, status: true, total: true, paidAmount: true } });
  if (!inv || inv.kind !== "INVOICE" || !(OPEN_INVOICE_STATUSES as readonly string[]).includes(inv.status) || inv.total - inv.paidAmount !== p.amount) return { ok: false, reason: "INVOICE_CHANGED" };
  return { ok: true, invoiceId };
}

/**
 * Fulfil a freshly-flipped INVOICE payment (inside markPaymentPaid's transaction, invoice + payment locks held):
 * exactly one InvoiceReceipt for the payment (existence check + unique paymentId), invoice paid / status moved.
 */
export async function settleInvoicePayment(tx: Tx, p: Pick<Payment, "id" | "reference" | "method" | "amount" | "purpose" | "idempotencyKey" | "userId">, paid: number, opts: { attemptId?: string | null; actorId?: string | null }) {
  const invoiceId = invoiceIdOfPayment(p);
  if (!invoiceId) throw new InvoicePaymentError("Payment isn't linked to an invoice");
  if (await tx.invoiceReceipt.findUnique({ where: { paymentId: p.id }, select: { id: true } })) return null;
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { id: true, total: true, paidAmount: true, note: true, number: true } });
  const attempt = opts.attemptId ? await tx.paymentAttempt.findUnique({ where: { id: opts.attemptId }, select: { providerRef: true } }) : null;
  const now = new Date();
  const { receipt } = await applyInvoiceReceiptTx(tx, inv, {
    amount: paid,
    method: p.method === "KHALTI" ? "KHALTI" : "ESEWA",
    reference: attempt?.providerRef ?? p.reference,
    receivedAt: now,
    receivedOn: ktmNow(now).date,
    recordedById: opts.actorId ?? null,
    note: `Paid online (${p.reference})`,
    paymentId: p.id,
  });
  return { receipt, invoiceId: inv.id, number: inv.number };
}

/** Open online payments for an invoice (staff invoice page: "payment in progress"). */
export async function openInvoicePayments(invoiceId: string) {
  return db.payment.findMany({
    where: { purpose: "INVOICE", idempotencyKey: { startsWith: invoicePaymentKeyPrefix(invoiceId) }, status: { in: ["PENDING", "FAILED"] } },
    select: { id: true, reference: true, method: true, amount: true, status: true, createdAt: true, user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export { invoiceIdOfPayment };
