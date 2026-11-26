import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));

import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { getSettings, saveSettings } from "@/lib/settings";
import { placeCartOrder } from "@/server/orders";
import { approveRefund, markPaymentPaid, processRefund, requestRefund, requestRefundTx } from "@/server/payments";
import { creditTopupPayment } from "@/server/wallet-topup";
import { walletBalance } from "@/server/ledger";
import {
  approveRequest,
  cancelRequest,
  currentState,
  decisionBlocker,
  executeApproval,
  listApprovals,
  needsApproval,
  pendingForApprover,
  rejectRequest,
  requestApproval,
  type ApprovalActor,
} from "@/server/approvals";
import { issueCredit, issueCreditOrRequest } from "@/server/crm";
import { approvals as approvalsDetector } from "@/server/alerts/detectors/approvals";
import { detectorContext } from "@/server/alerts";
import { assertPaymentInScope, paymentWhere } from "@/components/admin/ops/scope";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

const A = "customer.a@demo.dabbabela.local";
const THRESHOLD = 10_000; // Rs 100 for this file (box prices are a few hundred rupees)

let originalThreshold: number;
let customerId: string;
let paymentId: string;
let orderIds: string[];
let kitchenId: string;
let paid: number;
const created: string[] = [];
let ops: ApprovalActor, finance: ApprovalActor, finance2: ApprovalActor, superAdmin: ApprovalActor, support: ApprovalActor;

async function staff(role: Role, tag: string): Promise<ApprovalActor> {
  const u = await db.user.create({ data: { name: `Approvals ${tag}`, email: `approvals.${tag}.${Date.now()}@test.local`, role } });
  created.push(u.id);
  return { id: u.id, role, customGrants: [], kitchenIds: null };
}

beforeAll(async () => {
  originalThreshold = (await getSettings()).approvalThreshold;
  await saveSettings({ approvalThreshold: THRESHOLD });
  ops = await staff("OPERATIONS_MANAGER", "ops");
  support = await staff("SUPPORT", "support");
  finance = await staff("FINANCE", "fin");
  finance2 = await staff("FINANCE", "fin2");
  superAdmin = await staff("SUPER_ADMIN", "super");
  const user = await loadUser(A);
  customerId = user.id;
  const d1 = serviceDay(5, 0);
  const d2 = serviceDay(5, 1);
  const [b1, b2] = [await primaryBoxOn(d1), await primaryBoxOn(d2)];
  const res = await placeCartOrder(user, { lines: [{ kind: "box", id: b1.id, date: d1, qty: 3 }, { kind: "box", id: b2.id, date: d2, qty: 3 }], addressId: user.addresses[0].id, method: "ESEWA", idempotencyKey: `approvals-${Date.now()}` });
  await markPaymentPaid(res.payment.id, { amount: res.payment.amount });
  paymentId = res.payment.id;
  orderIds = res.orders.map((o) => o.id);
  kitchenId = res.orders[0].kitchenId;
  paid = res.payment.amount;
  expect(paid).toBeGreaterThan(THRESHOLD * 2);
});

afterAll(async () => {
  await saveSettings({ approvalThreshold: originalThreshold });
});

describe("threshold", () => {
  it("needs approval at or above the threshold, either sign", async () => {
    expect(await needsApproval(THRESHOLD - 1)).toBe(false);
    expect(await needsApproval(THRESHOLD)).toBe(true);
    expect(await needsApproval(-THRESHOLD)).toBe(true);
  });
});

describe("refund requests", () => {
  let reqId: string;

  it("creates a PENDING request, notifies approvers, and replays by key", async () => {
    const amount = THRESHOLD + 500;
    const r = await requestApproval(ops, { kind: "REFUND", payload: { paymentId, orderId: orderIds[0], amount, method: "WALLET_CREDIT", reason: "Wrong dabba delivered" }, reason: "Wrong dabba delivered", idempotencyKey: `k-${paymentId}` });
    expect(r.replayed).toBe(false);
    expect(r.request.status).toBe("PENDING");
    expect(r.request.amount).toBe(amount);
    expect(r.request.kitchenId).toBe(kitchenId);
    reqId = r.request.id;
    const again = await requestApproval(ops, { kind: "REFUND", payload: { paymentId, orderId: orderIds[0], amount, method: "WALLET_CREDIT", reason: "Wrong dabba delivered" }, reason: "Wrong dabba delivered", idempotencyKey: `k-${paymentId}` });
    expect(again.replayed).toBe(true);
    expect(again.request.id).toBe(reqId);
    // nothing executed yet
    expect(await db.refund.count({ where: { paymentId } })).toBe(0);
    // approvers (finance) were notified in-app, the requester was not
    expect(await db.notification.count({ where: { userId: finance.id, type: "approval.requested", link: `/admin/approvals/${reqId}` } })).toBe(1);
    expect(await db.notification.count({ where: { userId: ops.id, type: "approval.requested" } })).toBe(0);
    expect(await db.auditLog.count({ where: { entity: "ApprovalRequest", entityId: reqId, action: "approval.request" } })).toBe(1);
  });

  it("refuses another user's idempotency key", async () => {
    await expect(requestApproval(support, { kind: "REFUND", payload: { paymentId, amount: THRESHOLD, method: "WALLET_CREDIT", reason: "x y z" }, reason: "x y z", idempotencyKey: `k-${paymentId}` })).rejects.toThrow(/already used/);
  });

  it("nobody decides their own request — not even a super admin", async () => {
    await expect(approveRequest(ops, reqId)).rejects.toThrow(/Someone else/);
    const own = await requestApproval(superAdmin, { kind: "WALLET_ADJUSTMENT", payload: { userId: customerId, amount: THRESHOLD, note: "Super admin goodwill" }, reason: "Super admin goodwill" });
    await expect(approveRequest(superAdmin, own.request.id)).rejects.toThrow(/Someone else/);
    await expect(rejectRequest(superAdmin, own.request.id, "nope nope")).rejects.toThrow(/Someone else/);
    await cancelRequest(superAdmin, own.request.id);
  });

  it("needs approvals.approve + the kind's permission + kitchen scope", async () => {
    await expect(approveRequest(support, reqId)).rejects.toThrow(/permission/);
    const r = await db.approvalRequest.findUniqueOrThrow({ where: { id: reqId } });
    expect(decisionBlocker({ ...finance, kitchenIds: ["some-other-kitchen"] }, r)).toMatch(/outside your scope/);
    expect(decisionBlocker({ ...finance, kitchenIds: [kitchenId] }, r)).toBeNull();
    expect(decisionBlocker(superAdmin, r)).toBeNull();
  });

  it("only the requester can withdraw", async () => {
    await expect(cancelRequest(finance, reqId)).rejects.toThrow(/Only the person/);
  });

  it("approval executes once: refund created APPROVED by the checker, requested by the maker", async () => {
    expect(await pendingForApprover(finance)).toBeGreaterThanOrEqual(1);
    // two approvers race: exactly one wins
    const results = await Promise.allSettled([approveRequest(finance, reqId, "Checked photos"), approveRequest(finance2, reqId)]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const req = await db.approvalRequest.findUniqueOrThrow({ where: { id: reqId } });
    expect(req.status).toBe("EXECUTED");
    expect(req.executedAt).not.toBeNull();
    const refunds = await db.refund.findMany({ where: { paymentId } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].status).toBe("APPROVED");
    expect(refunds[0].requestedById).toBe(ops.id);
    expect(refunds[0].approvedById).toBe(req.decidedById);
    // executing again is a no-op
    const again = await executeApproval(finance, reqId);
    expect(again.status).toBe("EXECUTED");
    expect(await db.refund.count({ where: { paymentId } })).toBe(1);
    const actions = (await db.auditLog.findMany({ where: { entity: "ApprovalRequest", entityId: reqId } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["approval.request", "approval.approve", "approval.execute"]));
    // approveRequest notifies fire-and-forget (`void notify`), so wait for the in-app row instead of racing it.
    await expect.poll(() => db.notification.count({ where: { userId: ops.id, type: "approval.decided" } })).toBeGreaterThanOrEqual(1);
  });

  it("re-validates at execution: a request that no longer fits FAILS with the error and can't run twice", async () => {
    // Request most of what's left, then let a below-threshold refund eat into it before the decision.
    const left = paid - (THRESHOLD + 500);
    const big = await requestApproval(ops, { kind: "REFUND", payload: { paymentId, amount: left, method: "ORIGINAL", reason: "Whole order" }, reason: "Whole order" });
    const state = await currentState(big.request);
    expect(state.find((s) => s.label === "Refundable on the payment")?.changed).toBe(false);
    // (a raw service-path refund, e.g. from a cancellation — a staff request would itself now need approval because
    // refunds on this payment add up past the threshold)
    await db.$transaction((tx) => requestRefundTx(tx, { paymentId, amount: 1000, reason: "small", method: "WALLET_CREDIT", actorId: support.id }));
    expect((await currentState(big.request)).find((s) => s.label === "Refundable on the payment")?.changed).toBe(true);
    const res = await approveRequest(finance, big.request.id);
    expect(res.status).toBe("FAILED");
    expect(res.error).toMatch(/At most/);
    const stored = await db.approvalRequest.findUniqueOrThrow({ where: { id: big.request.id } });
    expect(stored.status).toBe("FAILED");
    expect(stored.error).toMatch(/At most/);
    // retry still fails (state unchanged) and creates nothing
    expect((await executeApproval(finance2, big.request.id)).status).toBe("FAILED");
    expect(await db.refund.count({ where: { paymentId, amount: left } })).toBe(0);
  });

  it("reject needs a note and tells the requester", async () => {
    const r = await requestApproval(ops, { kind: "REFUND", payload: { paymentId, amount: THRESHOLD, method: "CASH", reason: "Cash back" }, reason: "Cash back" });
    await expect(rejectRequest(finance, r.request.id, "")).rejects.toThrow(/why/);
    const done = await rejectRequest(finance, r.request.id, "Not eligible");
    expect(done.status).toBe("REJECTED");
    await expect(approveRequest(finance, r.request.id)).rejects.toThrow(/isn't waiting/);
  });

  it("visibility: requesters see only their own; approvers see the queue", async () => {
    const mine = await listApprovals(support, { status: null });
    expect(mine.rows.every((r) => r.requestedById === support.id)).toBe(true);
    const all = await listApprovals(finance, { status: null });
    expect(all.rows.some((r) => r.requestedById === ops.id)).toBe(true);
  });
});

describe("wallet and order adjustments", () => {
  it("credit executes as a ledger row; a debit beyond the balance fails at execution", async () => {
    const before = await walletBalance(customerId);
    const credit = await requestApproval(ops, { kind: "WALLET_ADJUSTMENT", payload: { userId: customerId, amount: THRESHOLD, note: "Goodwill for delay" }, reason: "Goodwill for delay" });
    expect((await approveRequest(finance, credit.request.id)).status).toBe("EXECUTED");
    expect(await walletBalance(customerId)).toBe(before + THRESHOLD);
    const row = await db.creditLedger.findFirstOrThrow({ where: { userId: customerId }, orderBy: { createdAt: "desc" } });
    expect(row.reason).toBe("ADJUSTMENT");
    expect(row.actorId).toBe(ops.id);

    const debit = await requestApproval(ops, { kind: "WALLET_ADJUSTMENT", payload: { userId: customerId, amount: -(before + THRESHOLD + 100_000), note: "Claw back" }, reason: "Claw back" });
    expect(debit.request.amount).toBe(before + THRESHOLD + 100_000);
    const res = await approveRequest(finance, debit.request.id);
    expect(res.status).toBe("FAILED");
    expect(res.error).toMatch(/negative/);
    expect(await walletBalance(customerId)).toBe(before + THRESHOLD);
  });

  it("order adjustment executes through the normal service", async () => {
    const r = await requestApproval(ops, { kind: "ORDER_ADJUSTMENT", payload: { orderId: orderIds[1], amount: -THRESHOLD, reason: "Missing item credit" }, reason: "Missing item credit" });
    expect(r.request.kitchenId).toBe(kitchenId);
    const res = await approveRequest(finance, r.request.id);
    expect(res.status).toBe("EXECUTED");
    expect(await db.orderAdjustment.count({ where: { orderId: orderIds[1], amount: -THRESHOLD } })).toBe(1);
  });

  it("profile goodwill credit above the threshold goes to approval (issueCredit refuses it directly)", async () => {
    await expect(issueCredit(finance, customerId, THRESHOLD, "too big for one person")).rejects.toThrow(/second person/);
    const r = await issueCreditOrRequest(finance, customerId, THRESHOLD, "Birthday goodwill");
    expect(r.issued).toBe(false);
    const small = await issueCreditOrRequest(finance, customerId, THRESHOLD - 100, "Small goodwill");
    expect(small.issued).toBe(true);
    if (!r.issued) {
      const req = await db.approvalRequest.findUniqueOrThrow({ where: { id: r.approvalId } });
      expect((req.payload as { reason?: string }).reason).toBe("GOODWILL");
      await approveRequest(finance2, req.id);
      const row = await db.creditLedger.findFirstOrThrow({ where: { userId: customerId, reason: "GOODWILL", amount: THRESHOLD }, orderBy: { createdAt: "desc" } });
      expect(row.actorId).toBe(finance.id);
    }
  });

  it("validates payloads", async () => {
    await expect(requestApproval(ops, { kind: "REFUND", payload: { paymentId, amount: -5, method: "CASH", reason: "neg" }, reason: "neg" })).rejects.toThrow(/positive/);
    await expect(requestApproval(ops, { kind: "WALLET_ADJUSTMENT", payload: { userId: customerId, amount: 0, note: "zero" }, reason: "zero" })).rejects.toThrow(/non-zero/);
    await expect(requestApproval({ id: customerId, role: "CUSTOMER" }, { kind: "WALLET_ADJUSTMENT", payload: { userId: customerId, amount: 100, note: "self" }, reason: "self" })).rejects.toThrow(/Only staff/);
  });
});

describe("wallet top-up refunds (Phase 2A × 2B)", () => {
  it("need approval at/above the threshold and the approved execution keeps 2A's unspent cap and source-only rule", async () => {
    const u = await db.user.create({ data: { name: "Topup approvals", email: `topup.appr.${Date.now()}@test.local` } });
    created.push(u.id);
    const amount = THRESHOLD * 3;
    const p = await db.payment.create({ data: { reference: `PAY-TAPPR-${Date.now()}`, userId: u.id, method: "ESEWA", purpose: "WALLET_TOPUP", status: "PAID", amount, paidAt: new Date() } });
    await db.$transaction((tx) => creditTopupPayment(tx, p));
    expect(await walletBalance(u.id)).toBe(amount);

    // source only, whole payment — refused already at request time
    await expect(requestApproval(finance, { kind: "REFUND", payload: { paymentId: p.id, amount, method: "WALLET_CREDIT", reason: "Back to credit" }, reason: "Back to credit" })).rejects.toThrow(/not to credit/);

    // full refund requested, then the customer spends part of the credit before the decision → execution FAILS on the cap
    const full = await requestApproval(finance, { kind: "REFUND", payload: { paymentId: p.id, amount, method: "ORIGINAL", reason: "Changed mind" }, reason: "Changed mind" });
    expect(full.request.status).toBe("PENDING");
    await db.creditLedger.create({ data: { userId: u.id, amount: -THRESHOLD, reason: "SPEND", note: "lunch" } });
    const failed = await approveRequest(finance2, full.request.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.error).toMatch(/unspent/);
    expect(await db.refund.count({ where: { paymentId: p.id } })).toBe(0);

    // the unspent part goes through; processing it writes the TOPUP_REVERSAL row
    const part = await requestApproval(finance, { kind: "REFUND", payload: { paymentId: p.id, amount: amount - THRESHOLD, method: "ORIGINAL", reason: "Refund the unspent part" }, reason: "Refund the unspent part" });
    expect((await approveRequest(finance2, part.request.id)).status).toBe("EXECUTED");
    const refund = await db.refund.findFirstOrThrow({ where: { paymentId: p.id } });
    expect(refund.status).toBe("APPROVED");
    expect(refund.approvedById).toBe(finance2.id);
    await processRefund(refund.id, finance2.id, { providerRef: `ESW-RF-${Date.now()}` });
    const reversal = await db.creditLedger.findFirstOrThrow({ where: { paymentId: p.id, reason: "TOPUP_REVERSAL" } });
    expect(reversal.amount).toBe(-(amount - THRESHOLD));
    expect(reversal.refundId).toBe(refund.id);
    expect(await walletBalance(u.id)).toBe(0);
  });
});

describe("stale approvals alert", () => {
  it("flags requests pending longer than 4 hours and resolves when decided", async () => {
    const r = await requestApproval(ops, { kind: "REFUND", payload: { paymentId: paymentId, amount: THRESHOLD, method: "BANK", reason: "Old one" }, reason: "Old one" });
    await db.approvalRequest.update({ where: { id: r.request.id }, data: { createdAt: new Date(Date.now() - 5 * 3600_000) } });
    const findings = await approvalsDetector.run(await detectorContext());
    const f = findings.find((x) => x.entityId === r.request.id);
    expect(f?.type).toBe("APPROVAL_PENDING");
    expect(f?.severity).toBe("WARNING");
    expect(f?.href).toBe(`/admin/approvals/${r.request.id}`);
    await cancelRequest(ops, r.request.id);
    expect((await approvalsDetector.run(await detectorContext())).some((x) => x.entityId === r.request.id && x.type === "APPROVAL_PENDING")).toBe(false);
  });
});

describe("refund integrity (IDOR / mismatch)", () => {
  it("rejects an order that wasn't paid with the payment, and caps by the order's share", async () => {
    const b = await loadUser("customer.b@demo.dabbabela.local");
    const d = serviceDay(6, 0);
    const placed = await placeCartOrder(b, { lines: [{ kind: "box", id: (await primaryBoxOn(d)).id, date: d, qty: 1 }], addressId: b.addresses[0].id, method: "CASH", idempotencyKey: `approvals-other-${Date.now()}` });
    const other = placed.orders[0];
    await expect(requestRefund({ paymentId, orderId: other.id, amount: 100, reason: "mismatch", method: "WALLET_CREDIT", actorId: support.id })).rejects.toThrow(/wasn't paid with this payment/);
    await expect(requestApproval(ops, { kind: "REFUND", payload: { paymentId, orderId: other.id, amount: THRESHOLD, method: "WALLET_CREDIT", reason: "mismatch" }, reason: "mismatch" })).rejects.toThrow(/wasn't paid with this payment/);
    const o = await db.order.findUniqueOrThrow({ where: { id: orderIds[1] } });
    await expect(requestRefund({ paymentId, orderId: o.id, amount: o.customerShare + 1, reason: "too much for one order", method: "WALLET_CREDIT", actorId: support.id })).rejects.toThrow(/on order/);
  });

  it("a refund at or above the threshold can't be approved by its own requester (safety net for any path)", async () => {
    const o = await db.order.findUniqueOrThrow({ where: { id: orderIds[1] } });
    // Created through a raw service path (as a cancellation does) — a direct staff request this size goes to approvals.
    const r = await db.$transaction((tx) => requestRefundTx(tx, { paymentId, orderId: o.id, amount: Math.min(THRESHOLD, o.customerShare), reason: "cancel refund", method: "WALLET_CREDIT", actorId: finance.id }));
    await expect(approveRefund(r.id, finance.id)).rejects.toThrow(/second person/);
    await approveRefund(r.id, finance2.id);
    expect((await db.refund.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("APPROVED");
  });

  it("kitchen-scoped staff can't act on another kitchen's payment", async () => {
    await expect(assertPaymentInScope({ kitchenIds: ["not-this-kitchen"] }, paymentId)).rejects.toThrow(/scope/);
    await expect(assertPaymentInScope({ kitchenIds: [kitchenId] }, paymentId)).resolves.toBeUndefined();
    await expect(assertPaymentInScope({ kitchenIds: null }, paymentId)).resolves.toBeUndefined();
    expect(await db.payment.count({ where: { id: paymentId, ...paymentWhere({ kitchenIds: ["not-this-kitchen"] }) } })).toBe(0);
  });
});
