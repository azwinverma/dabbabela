import "server-only";
import { Prisma, type ApprovalKind, type ApprovalRequest, type ApprovalStatus, type RefundMethod, type Role } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { log } from "@/lib/logger";
import { rs } from "@/lib/money";
import { getSettings } from "@/lib/settings";
import { can, isStaffRole, type Permission } from "@/lib/permissions";
import { kitchenScope } from "@/lib/user-context";
import { adjustCreditTx, walletBalance } from "./ledger";
import { adjustOrderTx } from "./orders";
import { refundableNow, requestRefundTx } from "./payments";
import { notify } from "./notify";

/**
 * Maker-checker approvals (Phase 2B, docs/PRODUCTION_READINESS_PLAN.md).
 *
 * Money actions whose absolute amount is at or above `settings.approvalThreshold` (paisa) — refunds, manual wallet
 * adjustments (credit or debit) and order adjustments — are stored as a PENDING `ApprovalRequest` instead of running.
 * A second staff member decides it:
 *   - the requester can never approve (or reject) their own request — super admins included;
 *   - the approver needs `approvals.approve` AND the permission of the action itself (KIND_PERMISSION), and the
 *     request's kitchen must be in their scope;
 *   - approving executes at once: the normal service runs again inside one transaction (current refundable amount,
 *     wallet balance, order existence are re-validated), under a per-request lock, so it is EXECUTED at most once;
 *   - a failed execution is recorded as FAILED with the error and can be retried by an approver;
 *   - every step is audited; approvers are notified (in-app + email outbox) and the `approvals` alert detector flags
 *     requests left pending too long.
 * Below the threshold nothing changes: the caller runs the action directly.
 */

export type ApprovalActor = { id: string; role: Role | string; customGrants?: readonly string[] | null; kitchenIds?: string[] | null };

export class ApprovalError extends Error {}

const deny = (msg: string): never => {
  throw new ApprovalError(msg);
};

/** Kinds this module can execute. EXPENSE / SUPPLIER_CREDIT / OTHER exist in the schema for later use. */
export const EXECUTABLE_KINDS = ["REFUND", "WALLET_ADJUSTMENT", "ORDER_ADJUSTMENT"] as const satisfies readonly ApprovalKind[];
export type ExecutableKind = (typeof EXECUTABLE_KINDS)[number];

/** Permission (besides approvals.approve) an approver must hold for each kind — the one that guards the action itself. */
export const KIND_PERMISSION: Record<ExecutableKind, Permission> = {
  REFUND: "refunds.approve",
  WALLET_ADJUSTMENT: "refunds.approve",
  ORDER_ADJUSTMENT: "refunds.approve",
};

export const KIND_LABEL: Record<ApprovalKind, string> = {
  REFUND: "Refund",
  WALLET_ADJUSTMENT: "Wallet adjustment",
  ORDER_ADJUSTMENT: "Order adjustment",
  EXPENSE: "Expense",
  SUPPLIER_CREDIT: "Supplier credit",
  OTHER: "Other",
};

export type RefundPayload = { paymentId: string; orderId?: string | null; amount: number; method: RefundMethod; reason: string };
export type WalletPayload = { userId: string; amount: number; note: string; reason?: "ADJUSTMENT" | "GOODWILL" };
export type OrderAdjustmentPayload = { orderId: string; amount: number; reason: string };
export type PayloadFor<K extends ExecutableKind> = K extends "REFUND" ? RefundPayload : K extends "WALLET_ADJUSTMENT" ? WalletPayload : OrderAdjustmentPayload;

const REFUND_METHODS: RefundMethod[] = ["ORIGINAL", "BANK", "CASH", "WALLET_CREDIT"];
const isExecutable = (k: string): k is ExecutableKind => (EXECUTABLE_KINDS as readonly string[]).includes(k);

/** Approval threshold in paisa (0 or less = maker-checker off). */
export async function approvalThreshold() {
  return (await getSettings()).approvalThreshold;
}

/** Does an action of this (signed) amount need a second person? */
export async function needsApproval(amount: number) {
  const t = await approvalThreshold();
  return t > 0 && Math.abs(amount) >= t;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Validate and normalise a payload; returns it plus the absolute amount. Throws ApprovalError on bad input. */
export function normalizePayload<K extends ExecutableKind>(kind: K, raw: unknown): { payload: PayloadFor<K>; amount: number } {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const amount = Number(p.amount);
  if (!Number.isInteger(amount) || amount === 0) deny("Enter a non-zero amount");
  if (Math.abs(amount) > 100_000_000) deny("That amount is too large");
  if (kind === "REFUND") {
    const paymentId = str(p.paymentId, 64);
    const method = str(p.method, 20) as RefundMethod;
    const reason = str(p.reason, 500);
    if (!paymentId) deny("Payment missing");
    if (amount <= 0) deny("A refund amount must be positive");
    if (!REFUND_METHODS.includes(method)) deny("Pick how the money goes back");
    if (reason.length < 3) deny("Give a reason");
    return { payload: { paymentId, orderId: str(p.orderId, 64) || null, amount, method, reason } as PayloadFor<K>, amount };
  }
  if (kind === "WALLET_ADJUSTMENT") {
    const userId = str(p.userId, 64);
    const note = str(p.note, 300);
    if (!userId) deny("Customer missing");
    if (note.length < 3) deny("A reason is required for every manual adjustment");
    const reason = p.reason === "GOODWILL" ? "GOODWILL" : "ADJUSTMENT";
    if (reason === "GOODWILL" && amount < 0) deny("Goodwill credit must be positive");
    return { payload: { userId, amount, note, reason } as PayloadFor<K>, amount: Math.abs(amount) };
  }
  const orderId = str(p.orderId, 64);
  const reason = str(p.reason, 500);
  if (!orderId) deny("Order missing");
  if (reason.length < 3) deny("Give a reason");
  return { payload: { orderId, amount, reason } as PayloadFor<K>, amount: Math.abs(amount) };
}

function describe(kind: ApprovalKind, payload: unknown, amount: number) {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (kind === "REFUND") return `Refund ${rs(amount)} via ${String(p.method ?? "").toLowerCase().replace("_", " ")}`;
  if (kind === "WALLET_ADJUSTMENT") return `Wallet ${Number(p.amount) < 0 ? "debit" : "credit"} ${rs(amount)}`;
  if (kind === "ORDER_ADJUSTMENT") return `Order adjustment ${Number(p.amount) < 0 ? "−" : "+"}${rs(amount)}`;
  return `${KIND_LABEL[kind]} ${rs(amount)}`;
}

export const describeRequest = (r: Pick<ApprovalRequest, "kind" | "payload" | "amount">) => describe(r.kind, r.payload, r.amount);

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;

/** Entity + kitchen of what the request touches (for linking, scope and the "current state" view). */
async function targetOf(kind: ExecutableKind, payload: RefundPayload | WalletPayload | OrderAdjustmentPayload) {
  if (kind === "REFUND") {
    const p = payload as RefundPayload;
    const pay = await db.payment.findUnique({ where: { id: p.paymentId }, select: { id: true, purpose: true, orders: { select: { id: true, kitchenId: true }, take: 50 } } });
    if (!pay) deny("Payment not found");
    // Wallet top-ups (Phase 2A): refund to source only, whole payment; the unspent cap is re-checked at execution.
    if (pay!.purpose === "WALLET_TOPUP" && p.method === "WALLET_CREDIT") deny("A top-up is refunded to the customer's eSewa / Khalti / bank, not to credit");
    if (pay!.purpose === "WALLET_TOPUP" && p.orderId) deny("A top-up has no orders — refund the whole payment");
    if (p.orderId && !pay!.orders.some((o) => o.id === p.orderId)) deny("That order wasn't paid with this payment");
    const kitchenId = (p.orderId ? pay!.orders.find((o) => o.id === p.orderId)?.kitchenId : pay!.orders[0]?.kitchenId) ?? null;
    return { entity: "Payment", entityId: pay!.id, kitchenId };
  }
  if (kind === "WALLET_ADJUSTMENT") {
    const u = await db.user.findUnique({ where: { id: (payload as WalletPayload).userId }, select: { id: true, deletedAt: true } });
    if (!u) deny("Customer not found");
    if (u!.deletedAt) deny("This customer's personal data was deleted");
    return { entity: "User", entityId: u!.id, kitchenId: null };
  }
  const o = await db.order.findUnique({ where: { id: (payload as OrderAdjustmentPayload).orderId }, select: { id: true, kitchenId: true } });
  if (!o) deny("Order not found");
  return { entity: "Order", entityId: o!.id, kitchenId: o!.kitchenId };
}

function inKitchenScope(actor: ApprovalActor, kitchenId: string | null) {
  return !actor.kitchenIds || !kitchenId || actor.kitchenIds.includes(kitchenId);
}

/** May this actor decide (approve/reject/retry) this request? Returns the reason when not. */
export function decisionBlocker(actor: ApprovalActor, req: Pick<ApprovalRequest, "kind" | "requestedById" | "kitchenId">): string | null {
  if (req.requestedById === actor.id) return "Someone else has to decide a request you made";
  if (!can(actor, "approvals.approve")) return "You don't have permission to decide approvals";
  if (!isExecutable(req.kind)) return "This kind of request can't be decided here yet";
  if (!can(actor, KIND_PERMISSION[req.kind])) return "You don't have permission to approve this kind of request";
  if (!inKitchenScope(actor, req.kitchenId)) return "This request is for a kitchen outside your scope";
  return null;
}

/** Active staff (other than the requester) who could decide a request — the notification audience. */
export async function eligibleApprovers(req: Pick<ApprovalRequest, "kind" | "requestedById" | "kitchenId">, limit = 25) {
  const staff = await db.user.findMany({
    where: { isActive: true, deletedAt: null, role: { not: "CUSTOMER" }, id: { not: req.requestedById } },
    select: { id: true, role: true, kitchenId: true, staffRole: { select: { permissions: true } }, scopes: { select: { kitchenId: true } } },
    take: 500,
  });
  return staff
    .filter((u) => isStaffRole(u.role))
    .filter((u) => !decisionBlocker({ id: u.id, role: u.role, customGrants: u.staffRole?.permissions ?? [], kitchenIds: kitchenScope(u) }, req))
    .slice(0, limit)
    .map((u) => u.id);
}

async function notifyApprovers(req: ApprovalRequest) {
  try {
    const ids = await eligibleApprovers(req);
    const who = await db.user.findUnique({ where: { id: req.requestedById }, select: { name: true } });
    for (const userId of ids)
      await notify(
        "approval.requested",
        { userId },
        { summary: describeRequest(req), requester: who?.name ?? "A colleague", reason: req.reason.slice(0, 200) },
        { link: `/admin/approvals/${req.id}`, dedupeKey: `approval:${req.id}:${userId}` },
      );
  } catch (e) {
    log.warn("approvals.notify_failed", { id: req.id, error: e });
  }
}

export type RequestInput<K extends ExecutableKind> = { kind: K; payload: PayloadFor<K>; reason: string; idempotencyKey?: string | null };

/**
 * Create a PENDING request (the caller already decided the amount needs approval — see needsApproval()).
 * A retried submit returns the existing request: same idempotencyKey, or the same requester + kind + entity + amount
 * while still pending.
 */
export async function requestApproval<K extends ExecutableKind>(actor: ApprovalActor, input: RequestInput<K>) {
  if (!isStaffRole(actor.role)) deny("Only staff can request approvals");
  if (!isExecutable(input.kind)) deny("Unknown approval kind");
  const { payload, amount } = normalizePayload(input.kind, input.payload);
  const reason = str(input.reason, 500) || ("reason" in payload ? String(payload.reason) : "note" in payload ? String(payload.note) : "");
  if (reason.length < 3) deny("Give a reason");
  const key = str(input.idempotencyKey, 100) || null;
  if (key) {
    const ex = await db.approvalRequest.findUnique({ where: { idempotencyKey: key } });
    if (ex) {
      if (ex.requestedById !== actor.id || ex.kind !== input.kind) deny("That request key is already used");
      return { request: ex, replayed: true };
    }
  }
  const target = await targetOf(input.kind, payload);
  const dup = await db.approvalRequest.findFirst({ where: { status: "PENDING", kind: input.kind, requestedById: actor.id, entityId: target.entityId, amount } });
  if (dup && JSON.stringify(dup.payload) === JSON.stringify(json(payload))) return { request: dup, replayed: true };
  let request: ApprovalRequest;
  try {
    request = await db.approvalRequest.create({
      data: { kind: input.kind, amount, entity: target.entity, entityId: target.entityId, kitchenId: target.kitchenId, payload: json(payload), reason, idempotencyKey: key, requestedById: actor.id },
    });
  } catch (e) {
    if (key && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const ex = await db.approvalRequest.findUniqueOrThrow({ where: { idempotencyKey: key } });
      return { request: ex, replayed: true };
    }
    throw e;
  }
  await audit({ actorId: actor.id, action: "approval.request", entity: "ApprovalRequest", entityId: request.id, summary: describeRequest(request), reason, after: { kind: request.kind, amount, entity: target.entity, entityId: target.entityId, payload } });
  await notifyApprovers(request);
  return { request, replayed: false };
}

async function load(id: string) {
  const r = await db.approvalRequest.findUnique({ where: { id } });
  if (!r) deny("Approval request not found");
  return r!;
}

export type ExecuteResult = { status: ApprovalStatus; error?: string | null; result?: Record<string, unknown> | null; request: ApprovalRequest };

/** Run the money movement for an approved request. Re-validates current state; the caller holds the request lock. */
async function run(tx: Prisma.TransactionClient, req: ApprovalRequest, approverId: string): Promise<Record<string, unknown>> {
  if (!isExecutable(req.kind)) throw new ApprovalError("This kind of request can't be executed");
  const { payload } = normalizePayload(req.kind, req.payload);
  if (req.kind === "REFUND") {
    const p = payload as RefundPayload;
    const refund = await requestRefundTx(tx, { paymentId: p.paymentId, orderId: p.orderId ?? null, amount: p.amount, reason: p.reason, method: p.method, actorId: req.requestedById, approvedById: approverId });
    return { refundId: refund.id, refundStatus: refund.status };
  }
  if (req.kind === "WALLET_ADJUSTMENT") {
    const p = payload as WalletPayload;
    const u = await tx.user.findUnique({ where: { id: p.userId }, select: { deletedAt: true } });
    if (!u || u.deletedAt) throw new ApprovalError("This customer's personal data was deleted");
    const row = await adjustCreditTx(tx, { userId: p.userId, amount: p.amount, reason: p.reason ?? "ADJUSTMENT", actorId: req.requestedById, note: `${p.note} (approved)` });
    return { ledgerId: row.id };
  }
  const p = payload as OrderAdjustmentPayload;
  const adj = await adjustOrderTx(tx, p.orderId, req.requestedById, p.amount, p.reason);
  return { adjustmentId: adj.id };
}

/**
 * Execute an APPROVED (or retry a FAILED) request exactly once. A per-request advisory lock serialises concurrent
 * calls; the status flip to EXECUTED commits with the money movement or not at all. Failures are stored as FAILED.
 */
export async function executeApproval(actor: ApprovalActor, id: string): Promise<ExecuteResult> {
  const req = await load(id);
  if (req.status === "EXECUTED") return { status: "EXECUTED", request: req };
  const blocker = decisionBlocker(actor, req);
  if (blocker) deny(blocker);
  if (req.status !== "APPROVED" && req.status !== "FAILED") deny("Only approved (or failed) requests can be executed");
  try {
    const out = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`approval:${id}`}))`;
      const fresh = await tx.approvalRequest.findUniqueOrThrow({ where: { id } });
      if (fresh.status === "EXECUTED") return { already: true as const, request: fresh, result: null };
      if (fresh.status !== "APPROVED" && fresh.status !== "FAILED") throw new ApprovalError("This request changed — reload");
      const result = await run(tx, fresh, fresh.decidedById ?? actor.id);
      const done = await tx.approvalRequest.update({ where: { id }, data: { status: "EXECUTED", executedAt: new Date(), error: null } });
      return { already: false as const, request: done, result };
    });
    if (!out.already)
      await audit({ actorId: actor.id, approvedById: out.request.decidedById, action: "approval.execute", entity: "ApprovalRequest", entityId: id, summary: describeRequest(out.request), after: { status: "EXECUTED", ...out.result } });
    return { status: "EXECUTED", request: out.request, result: out.result };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const failed = await db.approvalRequest.updateMany({ where: { id, status: { in: ["APPROVED", "FAILED"] } }, data: { status: "FAILED", error } });
    if (failed.count) await audit({ actorId: actor.id, action: "approval.failed", entity: "ApprovalRequest", entityId: id, summary: describeRequest(req), reason: error, after: { status: "FAILED", error } });
    log.warn("approvals.execute_failed", { id, error });
    return { status: "FAILED", error, request: await load(id) };
  }
}

/** Approve someone else's PENDING request and execute it straight away. */
export async function approveRequest(actor: ApprovalActor, id: string, note?: string | null): Promise<ExecuteResult> {
  const req = await load(id);
  const blocker = decisionBlocker(actor, req);
  if (blocker) deny(blocker);
  if (req.status !== "PENDING") deny("This request isn't waiting for a decision");
  const decisionNote = str(note, 500) || null;
  const flipped = await db.approvalRequest.updateMany({ where: { id, status: "PENDING", requestedById: { not: actor.id } }, data: { status: "APPROVED", decidedById: actor.id, decidedAt: new Date(), decisionNote } });
  if (!flipped.count) deny("This request was decided by someone else — reload");
  await audit({ actorId: actor.id, approvedById: actor.id, action: "approval.approve", entity: "ApprovalRequest", entityId: id, summary: describeRequest(req), reason: decisionNote, before: { status: "PENDING" }, after: { status: "APPROVED" } });
  const res = await executeApproval(actor, id);
  void notify(
    "approval.decided",
    { userId: req.requestedById },
    { summary: describeRequest(req), decision: res.status === "EXECUTED" ? "approved and carried out" : `approved, but it failed: ${res.error ?? "unknown error"}` },
    { link: `/admin/approvals/${id}`, dedupeKey: `approval-decided:${id}:${res.status}` },
  );
  return res;
}

/** Reject someone else's PENDING request (a note is required). */
export async function rejectRequest(actor: ApprovalActor, id: string, note: string) {
  const req = await load(id);
  const blocker = decisionBlocker(actor, req);
  if (blocker) deny(blocker);
  const decisionNote = str(note, 500);
  if (decisionNote.length < 3) deny("Say why you're rejecting it");
  const flipped = await db.approvalRequest.updateMany({ where: { id, status: "PENDING", requestedById: { not: actor.id } }, data: { status: "REJECTED", decidedById: actor.id, decidedAt: new Date(), decisionNote } });
  if (!flipped.count) deny("This request isn't waiting for a decision");
  await audit({ actorId: actor.id, action: "approval.reject", entity: "ApprovalRequest", entityId: id, summary: describeRequest(req), reason: decisionNote, before: { status: "PENDING" }, after: { status: "REJECTED" } });
  void notify("approval.decided", { userId: req.requestedById }, { summary: describeRequest(req), decision: `rejected: ${decisionNote}` }, { link: `/admin/approvals/${id}`, dedupeKey: `approval-decided:${id}:REJECTED` });
  return load(id);
}

/** The requester withdraws their own PENDING request. */
export async function cancelRequest(actor: ApprovalActor, id: string, note?: string | null) {
  const req = await load(id);
  if (req.requestedById !== actor.id) deny("Only the person who asked can withdraw a request");
  const flipped = await db.approvalRequest.updateMany({ where: { id, status: "PENDING", requestedById: actor.id }, data: { status: "CANCELLED", decidedAt: new Date(), decisionNote: str(note, 500) || "Withdrawn" } });
  if (!flipped.count) deny("This request isn't pending any more");
  await audit({ actorId: actor.id, action: "approval.cancel", entity: "ApprovalRequest", entityId: id, summary: describeRequest(req), before: { status: "PENDING" }, after: { status: "CANCELLED" } });
  return load(id);
}

// ───────────── queries for the admin UI ─────────────

export const APPROVAL_STATUSES: ApprovalStatus[] = ["PENDING", "APPROVED", "EXECUTED", "FAILED", "REJECTED", "CANCELLED"];

/** Visibility: approvers see requests in their kitchen scope; everyone else only their own. */
export function approvalWhere(actor: ApprovalActor): Prisma.ApprovalRequestWhereInput {
  if (!can(actor, "approvals.approve")) return { requestedById: actor.id };
  if (!actor.kitchenIds) return {};
  return { OR: [{ requestedById: actor.id }, { kitchenId: null }, { kitchenId: { in: actor.kitchenIds } }] };
}

export async function listApprovals(actor: ApprovalActor, f: { status?: string | null; kind?: string | null; mine?: boolean; page?: number } = {}) {
  const where: Prisma.ApprovalRequestWhereInput = { AND: [approvalWhere(actor)] };
  const and = where.AND as Prisma.ApprovalRequestWhereInput[];
  if (f.status && (APPROVAL_STATUSES as string[]).includes(f.status)) and.push({ status: f.status as ApprovalStatus });
  if (f.kind && (EXECUTABLE_KINDS as readonly string[]).includes(f.kind)) and.push({ kind: f.kind as ApprovalKind });
  if (f.mine) and.push({ requestedById: actor.id });
  const take = 50;
  const page = Math.max(1, f.page ?? 1);
  const [rows, total] = await Promise.all([
    db.approvalRequest.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (page - 1) * take, take, include: { requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } } }),
    db.approvalRequest.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / take)) };
}

/** Pending requests this actor could decide (sidebar badge). */
export async function pendingForApprover(actor: ApprovalActor) {
  if (!can(actor, "approvals.approve")) return 0;
  return db.approvalRequest.count({ where: { AND: [approvalWhere(actor), { status: "PENDING", requestedById: { not: actor.id } }] } });
}

export async function getApproval(actor: ApprovalActor, id: string) {
  const r = await db.approvalRequest.findFirst({ where: { AND: [{ id }, approvalWhere(actor)] }, include: { requestedBy: { select: { name: true, email: true } }, decidedBy: { select: { name: true } } } });
  return r;
}

export type StateRow = { label: string; requested: string; now: string; changed: boolean };

/** "Payload diff": what was asked for vs the live state the execution will re-check. */
export async function currentState(req: Pick<ApprovalRequest, "kind" | "payload" | "status">): Promise<StateRow[]> {
  if (!isExecutable(req.kind)) return [];
  let payload: RefundPayload | WalletPayload | OrderAdjustmentPayload;
  try {
    payload = normalizePayload(req.kind, req.payload).payload;
  } catch {
    return [];
  }
  const settled = req.status === "EXECUTED";
  if (req.kind === "REFUND") {
    const p = payload as RefundPayload;
    const r = await refundableNow(p.paymentId, p.orderId);
    if (!r) return [{ label: "Payment", requested: p.paymentId, now: "not found", changed: true }];
    const rows: StateRow[] = [
      { label: "Payment status", requested: "PAID / PARTIALLY_REFUNDED", now: r.payment.status, changed: !["PAID", "PARTIALLY_REFUNDED"].includes(r.payment.status) && !settled },
      { label: "Refundable on the payment", requested: rs(p.amount), now: rs(r.available), changed: !settled && r.available < p.amount },
    ];
    if (p.orderId) rows.push({ label: "Refundable on the order", requested: rs(p.amount), now: r.orderAvailable === null ? "order not on this payment" : rs(r.orderAvailable), changed: !settled && (r.orderAvailable ?? 0) < p.amount });
    return rows;
  }
  if (req.kind === "WALLET_ADJUSTMENT") {
    const p = payload as WalletPayload;
    const bal = await walletBalance(p.userId);
    return [
      { label: "Adjustment", requested: `${p.amount < 0 ? "−" : "+"}${rs(Math.abs(p.amount))}`, now: "", changed: false },
      { label: "Wallet balance", requested: p.amount < 0 ? `at least ${rs(-p.amount)}` : "any", now: rs(bal), changed: !settled && p.amount < 0 && bal + p.amount < 0 },
      { label: "Balance after", requested: "", now: settled ? "already applied" : rs(bal + p.amount), changed: false },
    ];
  }
  const p = payload as OrderAdjustmentPayload;
  const o = await db.order.findUnique({ where: { id: p.orderId }, select: { number: true, status: true, total: true, refundedAmount: true } });
  if (!o) return [{ label: "Order", requested: p.orderId, now: "not found", changed: true }];
  return [
    { label: "Order", requested: o.number, now: o.status.replace(/_/g, " ").toLowerCase(), changed: false },
    { label: "Adjustment", requested: `${p.amount < 0 ? "−" : "+"}${rs(Math.abs(p.amount))}`, now: `total ${rs(o.total)}, refunded ${rs(o.refundedAmount)}`, changed: false },
  ];
}
