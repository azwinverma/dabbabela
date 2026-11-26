import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { addDays, dateOnly, todayKTM } from "@/lib/dates";
import { handleEsewaReturn, markPaymentPaid, PaymentError, requestRefund, startPayment, switchPaymentMethod } from "@/server/payments";
import { esewaConfig, esewaSign } from "@/server/payments/esewa";
import { CONCURRENT_SESSION_MS, InvoicePaymentError, startInvoicePayment } from "@/server/invoice-payments";
import { createCreditNote, recordInvoicePayment, voidInvoice } from "@/server/invoices";
import { invoicePaymentHistory } from "@/server/corporate";
import { cashFlow } from "@/server/finance/settlement";
import { buildJournal } from "@/server/finance/journal";
import { pendingPaymentsWhere } from "@/server/analytics/revenue";
import { parseFilters } from "@/server/analytics/filters";

/** Online payment of company invoices (Payment.purpose INVOICE). eSewa status API stubbed; everything else real. */

const T = `${Date.now()}`;
let seq = 0;
let original: Awaited<ReturnType<typeof getSettings>>;
let finance: { id: string };
let companyId: string;
let otherCompanyId: string;
let admin: { id: string };
let admin2: { id: string };
let member: { id: string };
let otherAdmin: { id: string };

async function user(tag: string) {
  seq++;
  return db.user.create({ data: { name: `InvPay ${tag} ${seq}`, email: `invpay-${tag}-${seq}-${T}@test.local`, role: "CUSTOMER" } });
}

async function invoice(total: number, opts: { status?: "DRAFT" | "ISSUED" | "PARTIALLY_PAID" | "PAID"; paid?: number; company?: string } = {}) {
  seq++;
  const today = todayKTM();
  return db.invoice.create({
    data: {
      number: `INV-PAY-${T}-${seq}`,
      companyId: opts.company ?? companyId,
      status: opts.status ?? "ISSUED",
      periodStart: dateOnly(addDays(today, -30)),
      periodEnd: dateOnly(addDays(today, -1)),
      billingName: "InvPay Co",
      subtotal: total,
      total,
      paidAmount: opts.paid ?? 0,
      issuedAt: new Date(),
      dueDate: dateOnly(addDays(today, 15)),
    },
  });
}

function esewaData(uuid: string, amountRs: string) {
  const body = { transaction_code: `T${Date.now()}${seq++}`, status: "COMPLETE", total_amount: amountRs, transaction_uuid: uuid, product_code: esewaConfig().productCode, signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names" };
  const sig = esewaSign(`transaction_code=${body.transaction_code},status=COMPLETE,total_amount=${amountRs},transaction_uuid=${uuid},product_code=${body.product_code},signed_field_names=${body.signed_field_names}`);
  return Buffer.from(JSON.stringify({ ...body, signature: sig })).toString("base64");
}
const esewaComplete = () => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "COMPLETE", ref_id: "R1" }), { status: 200 })));

/** Start the gateway session (eSewa form) and return its attempt. */
async function session(paymentId: string, userId: string) {
  await startPayment(paymentId, userId, "http://localhost:3100");
  return db.paymentAttempt.findFirstOrThrow({ where: { paymentId }, orderBy: { createdAt: "desc" } });
}

/** eSewa comes back COMPLETE for an attempt (status API stubbed). */
async function esewaReturn(paymentId: string, attempt: { providerRef: string; amount: number }, amount = attempt.amount) {
  esewaComplete();
  try {
    return await handleEsewaReturn(paymentId, esewaData(attempt.providerRef, String(amount / 100)));
  } finally {
    vi.unstubAllGlobals();
  }
}

beforeAll(async () => {
  original = await getSettings();
  await saveSettings({ paymentMethods: { ...original.paymentMethods, ESEWA: true }, bankDetails: original.bankDetails || "Test bank · A/C 000" });
  finance = await db.user.create({ data: { name: "InvPay Finance", email: `invpay-finance-${T}@test.local`, role: "FINANCE" } });
  companyId = (await db.company.create({ data: { name: `InvPay Co ${T}`, slug: `invpay-co-${T}`, billingMode: "COMPANY_PAID" } })).id;
  otherCompanyId = (await db.company.create({ data: { name: `InvPay Other ${T}`, slug: `invpay-other-${T}`, billingMode: "COMPANY_PAID" } })).id;
  admin = await user("admin");
  admin2 = await user("admin2");
  member = await user("member");
  otherAdmin = await user("other-admin");
  await db.companyMember.createMany({
    data: [
      { companyId, userId: admin.id, role: "ADMIN", status: "ACTIVE" },
      { companyId, userId: admin2.id, role: "ADMIN", status: "ACTIVE" },
      { companyId, userId: member.id, role: "MEMBER", status: "ACTIVE" },
      { companyId: otherCompanyId, userId: otherAdmin.id, role: "ADMIN", status: "ACTIVE" },
    ],
  });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await saveSettings({ paymentMethods: original.paymentMethods, bankDetails: original.bankDetails });
});

describe("starting an online invoice payment", () => {
  it("fixes the amount at the outstanding balance and enforces company scope + admin role", async () => {
    const inv = await invoice(120_000, { status: "PARTIALLY_PAID", paid: 20_000 });
    const { payment } = await startInvoicePayment(admin, { invoiceId: inv.id, method: "ESEWA", companyId });
    expect(payment).toMatchObject({ purpose: "INVOICE", amount: 100_000, method: "ESEWA", status: "PENDING", companyId, userId: admin.id });
    expect(payment.idempotencyKey).toMatch(new RegExp(`^invoice:${inv.id}:`));
    expect(await db.auditLog.count({ where: { action: "invoice.payment_start", entityId: inv.id } })).toBe(1);

    await expect(startInvoicePayment(member, { invoiceId: inv.id, method: "ESEWA" })).rejects.toThrow(/admins/);
    await expect(startInvoicePayment(otherAdmin, { invoiceId: inv.id, method: "ESEWA" })).rejects.toThrow(/admins|not found/);
    // The portal passes the admin's own company: an invoice of another company is "not found".
    await expect(startInvoicePayment(admin, { invoiceId: inv.id, method: "ESEWA", companyId: otherCompanyId })).rejects.toThrow(/not found/);
    await expect(startInvoicePayment(admin, { invoiceId: inv.id, method: "BANK_TRANSFER" })).rejects.toThrow(InvoicePaymentError);
    await expect(startInvoicePayment(admin, { invoiceId: inv.id, method: "WALLET" })).rejects.toThrow(InvoicePaymentError);
    const draft = await invoice(5_000, { status: "DRAFT" });
    await expect(startInvoicePayment(admin, { invoiceId: draft.id, method: "ESEWA" })).rejects.toThrow(/can't be paid online/);
    const paid = await invoice(5_000, { status: "PAID", paid: 5_000 });
    await expect(startInvoicePayment(admin, { invoiceId: paid.id, method: "ESEWA" })).rejects.toThrow(/already paid/);
    // Only eSewa / Khalti afterwards too (no cash / wallet / bank switch).
    await expect(switchPaymentMethod(payment.id, admin.id, "CASH")).rejects.toThrow(/eSewa or Khalti|isn't available/);
  });

  it("reuses the admin's own open payment, blocks a second admin while a session is live, supersedes stale ones", async () => {
    const inv = await invoice(40_000);
    const a = await startInvoicePayment(admin, { invoiceId: inv.id, method: "ESEWA" });
    const again = await startInvoicePayment(admin, { invoiceId: inv.id, method: "ESEWA" });
    expect(again.reused).toBe(true);
    expect(again.payment.id).toBe(a.payment.id);
    const attempt = await session(a.payment.id, admin.id);
    await expect(startInvoicePayment(admin2, { invoiceId: inv.id, method: "ESEWA" })).rejects.toThrow(/started paying this invoice/);
    // An older session no longer blocks: the second admin's start cancels the first payment and expires its session.
    await db.paymentAttempt.update({ where: { id: attempt.id }, data: { createdAt: new Date(Date.now() - CONCURRENT_SESSION_MS - 60_000) } });
    const b = await startInvoicePayment(admin2, { invoiceId: inv.id, method: "ESEWA" });
    expect(b.payment.id).not.toBe(a.payment.id);
    expect((await db.payment.findUniqueOrThrow({ where: { id: a.payment.id } })).status).toBe("CANCELLED");
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("EXPIRED");
    // The first admin's old session paid late → refused (no receipt), alert raised.
    const r = await esewaReturn(a.payment.id, attempt);
    expect(r.ok).toBe(false);
    expect(await db.invoiceReceipt.count({ where: { invoiceId: inv.id } })).toBe(0);
    expect(await db.alert.count({ where: { type: "GATEWAY_MISMATCH", entityId: a.payment.id } })).toBe(1);
    // An unpaid online invoice payment is not a receivable (the invoice balance already is).
    expect(await db.payment.count({ where: { AND: [pendingPaymentsWhere(parseFilters({}, { kitchenIds: null })), { id: b.payment.id }] } })).toBe(0);
  });
});

describe("verified payment", () => {
  it("writes exactly one ESEWA receipt and settles the invoice; cash flow, journal and history pick it up once", async () => {
    const inv = await invoice(75_000);
    const { payment } = await startInvoicePayment(admin, { invoiceId: inv.id, method: "ESEWA" });
    const attempt = await session(payment.id, admin.id);
    const r = await esewaReturn(payment.id, attempt);
    expect(r.ok).toBe(true);
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after).toMatchObject({ status: "PAID", paidAmount: 75_000 });
    const receipts = await db.invoiceReceipt.findMany({ where: { invoiceId: inv.id } });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ amount: 75_000, method: "ESEWA", paymentId: payment.id, reference: attempt.providerRef });
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PAID");
    expect(await db.auditLog.count({ where: { action: "invoice.payment_online", entityId: inv.id } })).toBe(1);
    // A replayed return / reconcile changes nothing.
    await esewaReturn(payment.id, attempt);
    await markPaymentPaid(payment.id, { amount: 75_000 });
    expect(await db.invoiceReceipt.count({ where: { invoiceId: inv.id } })).toBe(1);

    const history = await invoicePaymentHistory(companyId);
    expect(history.filter((h) => h.invoiceId === inv.id)).toEqual([expect.objectContaining({ source: "receipt", amount: 75_000, method: "ESEWA" })]);
    const today = todayKTM();
    const cf = await cashFlow(today, today);
    const journal = await buildJournal(today, today);
    // Counted once: through the Payment (the linked receipt is skipped), and shown as a company receipt.
    expect(cf.totals.companyReceipts).toBeGreaterThanOrEqual(75_000);
    expect(journal.lines.filter((l) => l.entry === payment.reference && l.journal === "RECEIPTS")).toHaveLength(2);
    expect(journal.lines.filter((l) => l.entry === attempt.providerRef && l.journal === "RECEIPTS")).toHaveLength(0);
    expect(journal.balanced).toBe(true);
  });

  it("pays a partly paid invoice's remainder; concurrent verifications write one receipt", async () => {
    const inv = await invoice(90_000);
    await recordInvoicePayment(inv.id, finance.id, 30_000, "CHQ-1", { method: "CHEQUE" });
    const { payment } = await startInvoicePayment(admin, { invoiceId: inv.id, method: "ESEWA" });
    expect(payment.amount).toBe(60_000);
    const attempt = await session(payment.id, admin.id);
    const results = await Promise.all([1, 2, 3, 4].map(() => markPaymentPaid(payment.id, { amount: 60_000, attemptId: attempt.id })));
    expect(results.filter((x) => !x.already && !x.mismatch)).toHaveLength(1);
    expect(await db.invoiceReceipt.count({ where: { invoiceId: inv.id, paymentId: payment.id } })).toBe(1);
    expect(await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ status: "PAID", paidAmount: 90_000 });
  });

  it("refuses an underpayment and an overpayment (no receipt, attempt MISMATCH, alert)", async () => {
    const inv = await invoice(50_000);
    const { payment } = await startInvoicePayment(admin, { invoiceId: inv.id, method: "ESEWA" });
    const attempt = await session(payment.id, admin.id);
    const under = await markPaymentPaid(payment.id, { amount: 49_900, attemptId: attempt.id });
    expect(under).toMatchObject({ mismatch: true, refused: "UNDERPAID" });
    expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("MISMATCH");
    const over = await markPaymentPaid(payment.id, { amount: 50_100 });
    expect(over).toMatchObject({ mismatch: true, refused: "INVOICE_OVERPAID" });
    expect(await db.invoiceReceipt.count({ where: { invoiceId: inv.id } })).toBe(0);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
    expect(await db.alert.count({ where: { type: "GATEWAY_MISMATCH", entityId: payment.id } })).toBeGreaterThanOrEqual(1);
  });
});

describe("the invoice changes while a payment is open", () => {
  for (const change of ["credit note", "manual receipt", "void"] as const) {
    it(`${change}: cancels the payment, expires its session, and refuses the stale gateway money`, async () => {
      const inv = await invoice(80_000);
      const { payment } = await startInvoicePayment(admin, { invoiceId: inv.id, method: "ESEWA" });
      const attempt = await session(payment.id, admin.id);
      if (change === "credit note") await createCreditNote(inv.id, finance.id, 10_000, "Cold lunches");
      if (change === "manual receipt") await recordInvoicePayment(inv.id, finance.id, 10_000, "NEFT-1");
      if (change === "void") await voidInvoice(inv.id, finance.id, "Wrong period");
      expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("CANCELLED");
      expect((await db.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("EXPIRED");
      const before = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
      const r = await esewaReturn(payment.id, attempt);
      expect(r.ok).toBe(false);
      expect(await db.invoiceReceipt.count({ where: { invoiceId: inv.id, paymentId: payment.id } })).toBe(0);
      expect(await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).toMatchObject({ paidAmount: before.paidAmount, status: before.status });
      expect(await db.alert.count({ where: { type: "GATEWAY_MISMATCH", entityId: payment.id } })).toBe(1);
      // A fresh start can't reuse the cancelled session.
      await expect(startPayment(payment.id, admin.id, "http://localhost:3100")).rejects.toThrow(/invoice changed/);
      if (change !== "void") {
        const fresh = await startInvoicePayment(admin, { invoiceId: inv.id, method: "ESEWA" });
        expect(fresh.payment.amount).toBe(70_000);
      }
    });
  }

  it("a credit note racing the verification never double-settles (lock order invoice → payment)", async () => {
    const inv = await invoice(60_000);
    const { payment } = await startInvoicePayment(admin, { invoiceId: inv.id, method: "ESEWA" });
    const attempt = await session(payment.id, admin.id);
    const [paid] = await Promise.allSettled([markPaymentPaid(payment.id, { amount: 60_000, attemptId: attempt.id }), createCreditNote(inv.id, finance.id, 5_000, "Late")]);
    const after = await db.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    const receipts = await db.invoiceReceipt.count({ where: { invoiceId: inv.id } });
    expect(after.paidAmount).toBeLessThanOrEqual(after.total);
    if (paid.status === "fulfilled" && !paid.value.mismatch) {
      // Payment first: invoice fully paid by the receipt; the credit note settles nothing more.
      expect(receipts).toBe(1);
      expect(after).toMatchObject({ status: "PAID", paidAmount: 60_000 });
    } else {
      // Credit note first: payment cancelled + refused.
      expect(receipts).toBe(0);
      expect(after.paidAmount).toBe(5_000);
    }
  });

  it("an online invoice payment can't be refunded (credit note instead)", async () => {
    const inv = await invoice(20_000);
    const { payment } = await startInvoicePayment(admin, { invoiceId: inv.id, method: "ESEWA" });
    const attempt = await session(payment.id, admin.id);
    expect((await esewaReturn(payment.id, attempt)).ok).toBe(true);
    await expect(requestRefund({ paymentId: payment.id, amount: 1_000, reason: "x", method: "ORIGINAL", actorId: finance.id })).rejects.toThrow(PaymentError);
  });
});
