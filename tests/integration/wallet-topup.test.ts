import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { ktmNow } from "@/lib/dates";
import { approveRefund, handleEsewaReturn, handleKhaltiReturn, markPaymentPaid, PaymentError, processRefund, rejectRefund, requestRefund, startPayment, submitTransferProof, switchPaymentMethod, verifyManualPayment } from "@/server/payments";
import { esewaConfig, esewaSign } from "@/server/payments/esewa";
import { spendCredit, walletBalance } from "@/server/ledger";
import { cancelTopup, creditTopupPayment, startTopup, topupLiability, topupLimits, topupMethods, topupReconciliation, topupRefundable, TopupError, ktmDayRange, TOPUP_VELOCITY_LIMIT } from "@/server/wallet-topup";
import { pendingPaymentsWhere } from "@/server/analytics/revenue";
import { parseFilters } from "@/server/analytics/filters";
import { runReport } from "@/server/reports-center";
import { buildJournal } from "@/server/finance/journal";
import { walletTopups, walletTopupVelocity } from "@/server/alerts/detectors/wallet";
import { detectorContext } from "@/server/alerts";
import { loadUser } from "../helpers";

let seq = 0;
async function customer(tag: string) {
  seq++;
  return db.user.create({ data: { name: `Topup ${tag} ${seq}`, email: `topup-${tag}-${seq}-${Date.now()}@test.local`, role: "CUSTOMER" } });
}
const key = () => `tk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let finance: { id: string };
/** Pays out refunds: segregation of duties — never the person who requested the refund (security review H4). */
let payer: { id: string };
let original: Awaited<ReturnType<typeof getSettings>>;

function esewaData(uuid: string, amountRs: string) {
  const body = { transaction_code: `T${Date.now()}`, status: "COMPLETE", total_amount: amountRs, transaction_uuid: uuid, product_code: esewaConfig().productCode, signed_field_names: "transaction_code,status,total_amount,transaction_uuid,product_code,signed_field_names" };
  const sig = esewaSign(`transaction_code=${body.transaction_code},status=COMPLETE,total_amount=${amountRs},transaction_uuid=${uuid},product_code=${body.product_code},signed_field_names=${body.signed_field_names}`);
  return Buffer.from(JSON.stringify({ ...body, signature: sig })).toString("base64");
}
const esewaComplete = () => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "COMPLETE", ref_id: "R1" }), { status: 200 })));

/** A top-up started and verified through the real eSewa return path (status API stubbed). */
async function paidTopup(userId: string, amount: number) {
  const { payment } = await startTopup({ id: userId }, { amount, method: "ESEWA", idempotencyKey: key() });
  await startPayment(payment.id, userId, "http://localhost:3100");
  const attempt = await db.paymentAttempt.findFirstOrThrow({ where: { paymentId: payment.id }, orderBy: { createdAt: "desc" } });
  esewaComplete();
  const r = await handleEsewaReturn(payment.id, esewaData(attempt.providerRef, String(amount / 100)));
  vi.unstubAllGlobals();
  expect(r.ok).toBe(true);
  return payment;
}

beforeAll(async () => {
  original = await getSettings();
  finance = await db.user.create({ data: { name: "Topup Finance", email: `topup-finance-${Date.now()}@test.local`, role: "FINANCE" } });
  payer = await db.user.create({ data: { name: "Topup Payer", email: `topup-payer-${Date.now()}@test.local`, role: "FINANCE" } });
  await saveSettings({ bankDetails: original.bankDetails || "Test bank · A/C 000", flags: { ...original.flags, walletTopup: true, wallet: true }, paymentMethods: { ...original.paymentMethods, ESEWA: true, BANK_TRANSFER: true } });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await saveSettings({ flags: { ...(await getSettings()).flags, walletTopup: original.flags.walletTopup, wallet: original.flags.wallet }, bankDetails: original.bankDetails, paymentMethods: original.paymentMethods });
});

describe("feature flag", () => {
  it("refuses everything when walletTopup is off", async () => {
    const u = await customer("flag");
    const { payment } = await startTopup(u, { amount: 50000, method: "ESEWA", idempotencyKey: key() });
    const s = await getSettings();
    await saveSettings({ flags: { ...s.flags, walletTopup: false } });
    try {
      await expect(startTopup(u, { amount: 50000, method: "ESEWA", idempotencyKey: key() })).rejects.toThrow(TopupError);
      expect(await topupMethods()).toEqual([]);
      expect((await topupLimits(u.id)).enabled).toBe(false);
      await expect(startPayment(payment.id, u.id, "http://localhost:3100")).rejects.toThrow(PaymentError);
      await expect(switchPaymentMethod(payment.id, u.id, "BANK_TRANSFER")).rejects.toThrow(/isn't available/);
      // Money that was already sent is still credited once verified (we never keep money without credit).
      await db.payment.update({ where: { id: payment.id }, data: { method: "BANK_TRANSFER" } });
      const r = await verifyManualPayment(payment.id, finance.id, "BANK-FLAGOFF-1");
      expect(r.already).toBe(false);
      expect(await walletBalance(u.id)).toBe(50000);
    } finally {
      await saveSettings({ flags: { ...s.flags, walletTopup: true } });
    }
  });
});

describe("limits and idempotency", () => {
  it("enforces min / max / method", async () => {
    const u = await customer("lim");
    await expect(startTopup(u, { amount: 9999, method: "ESEWA", idempotencyKey: key() })).rejects.toThrow(/smallest/);
    await expect(startTopup(u, { amount: 1000001, method: "ESEWA", idempotencyKey: key() })).rejects.toThrow(/largest/);
    await expect(startTopup(u, { amount: 50000, method: "WALLET", idempotencyKey: key() })).rejects.toThrow(/method/);
    await expect(startTopup(u, { amount: 50000, method: "CASH", idempotencyKey: key() })).rejects.toThrow(/method/);
  });

  it("counts PAID + PENDING top-ups of the Kathmandu day against the daily limit", async () => {
    const u = await customer("daily");
    await startTopup(u, { amount: 1000000, method: "BANK_TRANSFER", idempotencyKey: key() }); // pending
    await paidTopup(u.id, 900000); // paid (balance 9,000)
    await expect(startTopup(u, { amount: 200000, method: "ESEWA", idempotencyKey: key() })).rejects.toThrow(/up to Rs 1,000 more today/);
    const ok = await startTopup(u, { amount: 100000, method: "ESEWA", idempotencyKey: key() });
    expect(ok.payment.status).toBe("PENDING");
    // A cancelled top-up stops counting.
    await cancelTopup(u.id, ok.payment.id);
    const l = await topupLimits(u.id);
    expect(l.usedToday).toBe(1900000);
    // Yesterday's top-ups don't count today.
    await db.payment.updateMany({ where: { userId: u.id, purpose: "WALLET_TOPUP" }, data: { createdAt: new Date(ktmDayRange(ktmNow().date).gte.getTime() - 3600_000) } });
    expect((await topupLimits(u.id)).usedToday).toBe(0);
  });

  it("caps balance + pending + new amount at walletBalanceCap", async () => {
    const u = await customer("cap");
    await db.creditLedger.create({ data: { userId: u.id, amount: 2000000, reason: "GOODWILL", note: "test" } });
    await expect(startTopup(u, { amount: 600000, method: "ESEWA", idempotencyKey: key() })).rejects.toThrow(/can't go above Rs 25,000/);
    await startTopup(u, { amount: 300000, method: "ESEWA", idempotencyKey: key() });
    await expect(startTopup(u, { amount: 300000, method: "ESEWA", idempotencyKey: key() })).rejects.toThrow(/up to Rs 2,000/);
    expect((await topupLimits(u.id)).maxNow).toBe(200000);
  });

  it("replays the same payment for a retried key, never another customer's", async () => {
    const u = await customer("idem");
    const other = await customer("idem-other");
    const k = key();
    const a = await startTopup(u, { amount: 50000, method: "ESEWA", idempotencyKey: k });
    const b = await startTopup(u, { amount: 50000, method: "ESEWA", idempotencyKey: k });
    expect(b.replayed).toBe(true);
    expect(b.payment.id).toBe(a.payment.id);
    await expect(startTopup(other, { amount: 50000, method: "ESEWA", idempotencyKey: k })).rejects.toThrow(TopupError);
    // Concurrent double submit → one payment.
    const k2 = key();
    const [c1, c2] = await Promise.all([startTopup(u, { amount: 60000, method: "ESEWA", idempotencyKey: k2 }), startTopup(u, { amount: 60000, method: "ESEWA", idempotencyKey: k2 })]);
    expect(c1.payment.id).toBe(c2.payment.id);
    expect(await db.payment.count({ where: { idempotencyKey: k2 } })).toBe(1);
  });

  it("creates a WALLET_TOPUP payment with no orders, and pending top-ups are not receivables", async () => {
    const u = await customer("shape");
    const { payment } = await startTopup(u, { amount: 70000, method: "ESEWA", idempotencyKey: key() });
    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { _count: { select: { orders: true } } } });
    expect(p.purpose).toBe("WALLET_TOPUP");
    expect(p._count.orders).toBe(0);
    const f = parseFilters({}, { kitchenIds: null });
    expect(await db.payment.count({ where: { AND: [pendingPaymentsWhere(f), { id: payment.id }] } })).toBe(0);
  });

  it("only lets top-ups switch between eSewa / Khalti / bank", async () => {
    const u = await customer("switch");
    const { payment } = await startTopup(u, { amount: 50000, method: "ESEWA", idempotencyKey: key() });
    await expect(switchPaymentMethod(payment.id, u.id, "CASH")).rejects.toThrow();
    await switchPaymentMethod(payment.id, u.id, "BANK_TRANSFER");
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).method).toBe("BANK_TRANSFER");
  });
});

describe("crediting", () => {
  it("credits exactly once through the eSewa return, replays included", async () => {
    const u = await customer("esewa");
    const payment = await paidTopup(u.id, 150000);
    expect(await walletBalance(u.id)).toBe(150000);
    const attempt = await db.paymentAttempt.findFirstOrThrow({ where: { paymentId: payment.id } });
    esewaComplete();
    expect((await handleEsewaReturn(payment.id, esewaData(attempt.providerRef, "1500"))).ok).toBe(true); // replay
    const rows = await db.creditLedger.findMany({ where: { paymentId: payment.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "TOPUP", amount: 150000, userId: u.id });
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PAID");
  });

  it("never double-credits when callbacks, the cron and staff race (concurrent)", async () => {
    const u = await customer("race");
    const { payment } = await startTopup(u, { amount: 200000, method: "BANK_TRANSFER", idempotencyKey: key() });
    const results = await Promise.all([
      markPaymentPaid(payment.id, { amount: 200000 }),
      markPaymentPaid(payment.id, { amount: 200000 }),
      markPaymentPaid(payment.id, { actorId: finance.id, note: "Verified: X" }),
      markPaymentPaid(payment.id),
    ]);
    expect(results.filter((r) => !r.already)).toHaveLength(1);
    expect(await db.creditLedger.count({ where: { paymentId: payment.id, reason: "TOPUP" } })).toBe(1);
    expect(await walletBalance(u.id)).toBe(200000);
    // The crediting step itself is idempotent too (two transactions at once).
    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const credited = await Promise.all([db.$transaction((tx) => creditTopupPayment(tx, p)), db.$transaction((tx) => creditTopupPayment(tx, p))]);
    expect(credited).toEqual([0, 0]);
    expect(await db.creditLedger.count({ where: { paymentId: payment.id, reason: "TOPUP" } })).toBe(1);
  });

  it("bank transfer: proof upload, staff verification, audited", async () => {
    const u = await customer("bank");
    const { payment } = await startTopup(u, { amount: 300000, method: "BANK_TRANSFER", idempotencyKey: key() });
    await submitTransferProof(payment.id, u.id, "https://blob.test/proof.png", "IME-123");
    await expect(cancelTopup(u.id, payment.id)).rejects.toThrow(/can't be cancelled/);
    expect(await walletBalance(u.id)).toBe(0); // proof alone credits nothing
    await verifyManualPayment(payment.id, finance.id, "NIC-778899");
    expect(await walletBalance(u.id)).toBe(300000);
    const a = await db.auditLog.findFirst({ where: { action: "wallet.topup_verify", entityId: payment.id } });
    expect(a?.actorId).toBe(finance.id);
  });

  it("does not credit a gateway amount mismatch and raises an alert (eSewa callback)", async () => {
    const u = await customer("mm-esewa");
    const { payment } = await startTopup(u, { amount: 100000, method: "ESEWA", idempotencyKey: key() });
    await startPayment(payment.id, u.id, "http://localhost:3100");
    const attempt = await db.paymentAttempt.findFirstOrThrow({ where: { paymentId: payment.id } });
    esewaComplete();
    const r = await handleEsewaReturn(payment.id, esewaData(attempt.providerRef, "10")); // validly signed, wrong amount
    expect(r.ok).toBe(false);
    expect(await walletBalance(u.id)).toBe(0);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).not.toBe("PAID");
    const alert = await db.alert.findFirst({ where: { type: "GATEWAY_MISMATCH", entityId: payment.id, status: "OPEN" } });
    expect(alert?.message).toMatch(/wallet top-up — not credited/);
  });

  it("does not credit a Khalti lookup with a different amount and raises an alert", async () => {
    const u = await customer("mm-khalti");
    const { payment } = await startTopup(u, { amount: 100000, method: "ESEWA", idempotencyKey: key() });
    await db.payment.update({ where: { id: payment.id }, data: { method: "KHALTI" } });
    const pidx = `pidx-${Date.now()}`;
    await db.paymentAttempt.create({ data: { paymentId: payment.id, method: "KHALTI", providerRef: pidx, amount: 100000 } });
    process.env.KHALTI_SECRET_KEY ??= "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "Completed", total_amount: 1000, pidx }), { status: 200 })));
    const r = await handleKhaltiReturn(payment.id, pidx);
    expect(r.ok).toBe(false);
    expect(await walletBalance(u.id)).toBe(0);
    expect(await db.alert.count({ where: { type: "GATEWAY_MISMATCH", entityId: payment.id } })).toBe(1);
  });

  it("markPaymentPaid with a different verified amount leaves the top-up unpaid and uncredited", async () => {
    const u = await customer("mm-direct");
    const { payment } = await startTopup(u, { amount: 100000, method: "ESEWA", idempotencyKey: key() });
    const r = await markPaymentPaid(payment.id, { amount: 120000 });
    expect(r.mismatch).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
    expect(await db.creditLedger.count({ where: { paymentId: payment.id } })).toBe(0);
    expect(await db.paymentProviderEvent.count({ where: { paymentId: payment.id, outcome: "MISMATCH" } })).toBe(1);
    expect(await db.alert.count({ where: { type: "GATEWAY_MISMATCH", entityId: payment.id } })).toBe(1);
  });
});

describe("refunds", () => {
  it("refunds only the unspent part, to source, never below zero", async () => {
    const u = await customer("refund");
    const payment = await paidTopup(u.id, 100000);
    await db.$transaction((tx) => spendCredit(tx, { userId: u.id, amount: 70000, note: "lunch" }));
    expect(await topupRefundable(payment.id)).toBe(30000);
    const base = { paymentId: payment.id, reason: "Customer asked", actorId: finance.id };
    await expect(requestRefund({ ...base, amount: 50000, method: "ORIGINAL" })).rejects.toThrow(/Only Rs 300 of this top-up is unspent/);
    await expect(requestRefund({ ...base, amount: 10000, method: "WALLET_CREDIT" })).rejects.toThrow(/not to credit/);
    const r1 = await requestRefund({ ...base, amount: 30000, method: "ORIGINAL" });
    // A second request can't reserve the same unspent credit.
    await expect(requestRefund({ ...base, amount: 10000, method: "BANK" })).rejects.toThrow(/already spent|unspent/);
    await approveRefund(r1.id, finance.id);
    // Customer spends some more before finance processes → processing refuses (balance would go negative).
    await db.$transaction((tx) => spendCredit(tx, { userId: u.id, amount: 10000, note: "lunch 2" }));
    await expect(processRefund(r1.id, payer.id, { providerRef: "ESW-RF-1" })).rejects.toThrow(/at most Rs 200/);
    expect((await db.refund.findUniqueOrThrow({ where: { id: r1.id } })).status).toBe("APPROVED");
    await rejectRefund(r1.id, finance.id, "Spent since");
    const r2 = await requestRefund({ ...base, amount: 20000, method: "ORIGINAL" });
    await approveRefund(r2.id, finance.id);
    await processRefund(r2.id, payer.id, { providerRef: "ESW-RF-2" });
    expect(await walletBalance(u.id)).toBe(0);
    const rev = await db.creditLedger.findFirstOrThrow({ where: { paymentId: payment.id, reason: "TOPUP_REVERSAL" } });
    expect(rev).toMatchObject({ amount: -20000, refundId: r2.id });
    const p = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p).toMatchObject({ status: "PARTIALLY_REFUNDED", refundedAmount: 20000 });
    expect(await db.auditLog.count({ where: { action: "refund.process", entityId: r2.id } })).toBe(1);
    await expect(requestRefund({ ...base, amount: 100, method: "ORIGINAL" })).rejects.toThrow(/already spent/);
  });
});

describe("reports, reconciliation and finance", () => {
  it("top-up report totals equal the credit ledger; reconciliation shows no gap", async () => {
    const u = await customer("report");
    const p1 = await paidTopup(u.id, 110000);
    await paidTopup(u.id, 120000);
    const r = await requestRefund({ paymentId: p1.id, amount: 10000, reason: "test", method: "ORIGINAL", actorId: finance.id });
    await approveRefund(r.id, finance.id);
    await processRefund(r.id, payer.id, { providerRef: "RF-REP" });
    const today = ktmNow().date;
    const owner = await loadUser("owner@test.local");
    const out = await runReport(owner, "wallet-topups", { from: today, to: today }, { all: true });
    const range = ktmDayRange(today);
    const paidIds = (await db.payment.findMany({ where: { purpose: "WALLET_TOPUP", status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] }, paidAt: { gte: range.gte, lt: range.lt } }, select: { id: true } })).map((p) => p.id);
    const ledger = await db.creditLedger.groupBy({ by: ["reason"], where: { paymentId: { in: paidIds }, reason: { in: ["TOPUP", "TOPUP_REVERSAL"] } }, _sum: { amount: true } });
    const credited = ledger.find((l) => l.reason === "TOPUP")?._sum.amount ?? 0;
    const reversed = -(ledger.find((l) => l.reason === "TOPUP_REVERSAL")?._sum.amount ?? 0);
    expect(out.totals?.credited).toBe(credited);
    expect(out.totals?.reversed).toBe(reversed);
    expect(out.totals?.net).toBe(credited - reversed);
    expect(out.rows.reduce((a, row) => a + Number(row.credited), 0)).toBe(credited);
    expect(out.count).toBe(paidIds.length);
    const rec = await topupReconciliation(range.gte, range.lt);
    expect(rec.gap).toBe(0);
    expect(rec.paidAmount).toBe(credited);
    expect(rec.uncredited).toHaveLength(0);
    // Liability (unspent top-up credit) never exceeds the wallet total and includes this customer's 2,200.
    expect(await topupLiability()).toBeGreaterThanOrEqual(220000);
  });

  it("journal posts top-ups to the customer-credit liability, balanced", async () => {
    const u = await customer("journal");
    const p = await paidTopup(u.id, 130000);
    await db.$transaction((tx) => spendCredit(tx, { userId: u.id, amount: 30000, note: "lunch" }));
    const today = ktmNow().date;
    const j = await buildJournal(today, today);
    expect(j.balanced).toBe(true);
    const receipt = j.lines.filter((l) => l.entry === (p.reference as string));
    expect(receipt.find((l) => l.credit > 0)?.key).toBe("liability.customer_credit");
    expect(receipt.find((l) => l.credit > 0)?.credit).toBe(130000);
    const used = j.lines.filter((l) => l.journal === "TOPUP_USED");
    expect(used.find((l) => l.key === "revenue.sales")?.credit ?? 0).toBeGreaterThanOrEqual(30000);
  });
});

describe("alert detectors", () => {
  it("flags uncredited paid top-ups, balances over the cap and stuck top-ups", async () => {
    const u = await customer("alerts");
    const ghost = await db.payment.create({ data: { reference: `PAY-GHOST-${Date.now()}`, userId: u.id, method: "BANK_TRANSFER", purpose: "WALLET_TOPUP", status: "PAID", amount: 50000, paidAt: new Date() } });
    const capUser = await customer("overcap");
    const cap = (await getSettings()).walletBalanceCap;
    await db.creditLedger.create({ data: { userId: capUser.id, amount: 10000, reason: "TOPUP", note: "test" } });
    await db.creditLedger.create({ data: { userId: capUser.id, amount: cap, reason: "REFUND", note: "test" } });
    const stuck = await db.payment.create({ data: { reference: `PAY-STUCK-${Date.now()}`, userId: u.id, method: "BANK_TRANSFER", purpose: "WALLET_TOPUP", status: "PENDING", amount: 50000, proofUrl: "https://blob.test/p.png" } });
    await db.$executeRaw`UPDATE "Payment" SET "updatedAt" = NOW() - INTERVAL '2 days' WHERE id = ${stuck.id}`;
    const findings = await walletTopups.run(await detectorContext());
    expect(findings.find((f) => f.type === "TOPUP_UNCREDITED" && f.entityId === ghost.id)).toBeTruthy();
    expect(findings.find((f) => f.type === "WALLET_OVER_CAP" && f.entityId === capUser.id)).toBeTruthy();
    expect(findings.find((f) => f.type === "TOPUP_STUCK" && f.entityId === stuck.id)).toBeTruthy();
    await db.payment.update({ where: { id: ghost.id }, data: { status: "CANCELLED" } }); // keep other tests' reconciliation clean
  });

  it("flags more than N top-ups by one customer in a day", async () => {
    const u = await customer("velocity");
    for (let i = 0; i <= TOPUP_VELOCITY_LIMIT; i++) await db.payment.create({ data: { reference: `PAY-V-${Date.now()}-${i}`, userId: u.id, method: "ESEWA", purpose: "WALLET_TOPUP", status: "CANCELLED", amount: 10000 } });
    const findings = await walletTopupVelocity.run(await detectorContext());
    const f = findings.find((x) => x.entityId === u.id);
    expect(f?.type).toBe("TOPUP_VELOCITY");
    expect(f?.data?.count).toBe(TOPUP_VELOCITY_LIMIT + 1);
  });
});
