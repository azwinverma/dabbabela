import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rs } from "@/lib/money";
import { isValidISODate, todayKTM } from "@/lib/dates";
import { assertCan, assertPeriodOpen, day, FinanceError, iso, isUnique, nextNumber, type Actor } from "./common";

/**
 * Expense ledger (WP-09).
 *
 * Lifecycle: DRAFT → APPROVED → PAID, or DRAFT → VOID. Only drafts can be edited or voided.
 * An approved/paid expense is never changed: `reverseExpense` posts a negative mirror entry (reference `REV:<number>`)
 * and `correctExpense` = reversal + a new draft with the right figures. A closed accounting month refuses any write
 * dated in it (create, edit, approve, void, reversal).
 */

export const EXPENSE_STATUSES = ["DRAFT", "APPROVED", "PAID", "VOID"] as const;
export const EXPENSE_METHODS = ["CASH", "BANK", "ESEWA", "KHALTI", "OTHER"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
const REV = "REV:";

export type ExpenseInput = {
  date: string;
  categoryId: string;
  kitchenId?: string | null;
  supplierId?: string | null;
  description: string;
  amount: number; // paisa before tax
  tax?: number;
  method?: string | null;
  reference?: string | null;
  attachmentUrl?: string | null;
};

function validate(input: ExpenseInput) {
  if (!isValidISODate(input.date)) throw new FinanceError("Pick the expense date");
  if (input.date > todayKTM()) throw new FinanceError("An expense can't be dated in the future");
  if (!input.categoryId) throw new FinanceError("Pick a category");
  if (!input.description.trim()) throw new FinanceError("Describe the expense");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new FinanceError("Enter an amount above zero");
  if (input.tax != null && (!Number.isInteger(input.tax) || input.tax < 0)) throw new FinanceError("Tax can't be negative");
  if (input.method && !(EXPENSE_METHODS as readonly string[]).includes(input.method)) throw new FinanceError("Unknown payment method");
}

function fields(input: ExpenseInput) {
  return {
    date: day(input.date),
    categoryId: input.categoryId,
    kitchenId: input.kitchenId || null,
    supplierId: input.supplierId || null,
    description: input.description.trim().slice(0, 300),
    amount: input.amount,
    tax: input.tax ?? 0,
    method: input.method || null,
    reference: input.reference?.trim().slice(0, 120) || null,
    attachmentUrl: input.attachmentUrl || null,
  };
}

const snapshot = (e: { number: string; date: Date; amount: number; tax: number; status: string; categoryId: string; kitchenId: string | null; description: string }) => ({
  number: e.number,
  date: iso(e.date),
  amount: e.amount,
  tax: e.tax,
  status: e.status,
  categoryId: e.categoryId,
  kitchenId: e.kitchenId,
  description: e.description,
});

async function create(data: Omit<Prisma.ExpenseUncheckedCreateInput, "number">, isoDate: string, client: Prisma.TransactionClient | typeof db = db) {
  for (let attempt = 0; ; attempt++) {
    const number = await nextNumber("EXP", isoDate, (stem) => client.expense.count({ where: { number: { startsWith: stem } } }));
    try {
      return await client.expense.create({ data: { ...data, number: attempt ? `${number}-${attempt}` : number } });
    } catch (e) {
      if (!isUnique(e) || attempt >= 4) throw e;
    }
  }
}

async function ensureCategory(categoryId: string) {
  const c = await db.expenseCategory.findUnique({ where: { id: categoryId } });
  if (!c || !c.isActive) throw new FinanceError("Pick an active category");
}

export async function createExpense(actor: Actor, input: ExpenseInput) {
  assertCan(actor, "expenses.create");
  validate(input);
  await ensureCategory(input.categoryId);
  await assertPeriodOpen(input.date);
  const e = await create({ ...fields(input), status: "DRAFT", createdById: actor.id }, input.date);
  await audit({ actorId: actor.id, action: "expense.create", entity: "Expense", entityId: e.id, summary: `${e.number} ${rs(e.amount + e.tax)} — ${e.description}`, after: snapshot(e) });
  return e;
}

/** Edit a draft (the only state that can change). Both the old and the new date must be in open months. */
export async function updateDraftExpense(actor: Actor, id: string, input: ExpenseInput) {
  assertCan(actor, "expenses.create");
  validate(input);
  await ensureCategory(input.categoryId);
  const before = await db.expense.findUniqueOrThrow({ where: { id } });
  if (before.status !== "DRAFT") throw new FinanceError("Only drafts can be edited — reverse or correct an approved expense");
  await assertPeriodOpen(iso(before.date));
  await assertPeriodOpen(input.date);
  const r = await db.expense.updateMany({ where: { id, status: "DRAFT", updatedAt: before.updatedAt }, data: fields(input) });
  if (!r.count) throw new FinanceError("This expense changed — reload and try again");
  const after = await db.expense.findUniqueOrThrow({ where: { id } });
  await audit({ actorId: actor.id, action: "expense.update", entity: "Expense", entityId: id, summary: before.number, before: snapshot(before), after: snapshot(after) });
  return after;
}

/**
 * Approve a draft. The approver is recorded on the expense and as `approvedById` in the audit log.
 * Segregation of duties: you can't approve an expense you entered, unless you're the owner / super admin.
 */
export async function approveExpense(approver: Actor, id: string) {
  assertCan(approver, "expenses.approve");
  const e = await db.expense.findUniqueOrThrow({ where: { id } });
  if (e.status !== "DRAFT") throw new FinanceError("Only drafts wait for approval");
  if (e.createdById === approver.id && !["OWNER", "SUPER_ADMIN"].includes(approver.role)) throw new FinanceError("Someone else must approve an expense you entered");
  await assertPeriodOpen(iso(e.date));
  const r = await db.expense.updateMany({ where: { id, status: "DRAFT" }, data: { status: "APPROVED", approvedById: approver.id } });
  if (!r.count) throw new FinanceError("Already approved or voided");
  await audit({
    actorId: approver.id,
    approvedById: approver.id,
    action: "expense.approve",
    entity: "Expense",
    entityId: id,
    summary: `${e.number} ${rs(e.amount + e.tax)} approved`,
    before: { status: "DRAFT" },
    after: { status: "APPROVED", createdById: e.createdById },
  });
  return db.expense.findUniqueOrThrow({ where: { id } });
}

/** Record that an approved expense was paid (status only; amounts never change). */
export async function markExpensePaid(actor: Actor, id: string, payment: { method: string; reference?: string | null }) {
  assertCan(actor, "expenses.approve");
  if (!(EXPENSE_METHODS as readonly string[]).includes(payment.method)) throw new FinanceError("Pick how it was paid");
  const e = await db.expense.findUniqueOrThrow({ where: { id } });
  const r = await db.expense.updateMany({ where: { id, status: "APPROVED" }, data: { status: "PAID", method: payment.method, reference: payment.reference?.trim().slice(0, 120) || e.reference } });
  if (!r.count) throw new FinanceError("Approve the expense before marking it paid");
  await audit({ actorId: actor.id, approvedById: e.approvedById, action: "expense.paid", entity: "Expense", entityId: id, summary: `${e.number} paid by ${payment.method}`, after: payment });
  return db.expense.findUniqueOrThrow({ where: { id } });
}

/** Void a draft (expenses are never deleted). Approved expenses are reversed instead. */
export async function voidExpense(actor: Actor, id: string, reason: string) {
  assertCan(actor, "expenses.create");
  if (!reason.trim()) throw new FinanceError("Give a reason");
  const e = await db.expense.findUniqueOrThrow({ where: { id } });
  if (e.status !== "DRAFT") throw new FinanceError(e.status === "VOID" ? "Already void" : "Approved expenses can't be voided — reverse it instead");
  await assertPeriodOpen(iso(e.date));
  const r = await db.expense.updateMany({ where: { id, status: "DRAFT" }, data: { status: "VOID" } });
  if (!r.count) throw new FinanceError("This expense changed — reload");
  await audit({ actorId: actor.id, action: "expense.void", entity: "Expense", entityId: id, summary: e.number, reason, before: { status: "DRAFT" }, after: { status: "VOID" } });
}

/** Attach / replace the receipt (not an amount, so allowed in any state except VOID). */
export async function attachReceipt(actor: Actor, id: string, url: string) {
  assertCan(actor, "expenses.create");
  const e = await db.expense.findUniqueOrThrow({ where: { id } });
  if (e.status === "VOID") throw new FinanceError("This expense is void");
  await db.expense.update({ where: { id }, data: { attachmentUrl: url } });
  await audit({ actorId: actor.id, action: "expense.receipt", entity: "Expense", entityId: id, summary: e.number, before: { attachmentUrl: e.attachmentUrl }, after: { attachmentUrl: url } });
}

export const isReversal = (e: { reference: string | null }) => Boolean(e.reference?.startsWith(REV));

/**
 * Reverse an approved/paid expense with a negative mirror entry (same category, kitchen and status).
 * Dated `date` (default today), which must be in an open month — so a closed month is corrected in the current one.
 */
export async function reverseExpense(actor: Actor, id: string, reason: string, date = todayKTM()) {
  assertCan(actor, "expenses.approve");
  if (!reason.trim()) throw new FinanceError("Give a reason");
  if (!isValidISODate(date)) throw new FinanceError("Pick the reversal date");
  const out = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`expense:${id}`}))`;
    const e = await tx.expense.findUniqueOrThrow({ where: { id } });
    if (!["APPROVED", "PAID"].includes(e.status)) throw new FinanceError("Only approved or paid expenses are reversed (void a draft instead)");
    if (isReversal(e)) throw new FinanceError("A reversal can't be reversed — enter a new expense instead");
    if (await tx.expense.count({ where: { reference: `${REV}${e.number}` } })) throw new FinanceError("Already reversed");
    await assertPeriodOpen(date, tx);
    const rev = await create(
      {
        date: day(date),
        categoryId: e.categoryId,
        kitchenId: e.kitchenId,
        supplierId: e.supplierId,
        description: `Reversal of ${e.number}: ${reason.trim()}`.slice(0, 300),
        amount: -e.amount,
        tax: -e.tax,
        method: e.method,
        reference: `${REV}${e.number}`,
        status: e.status,
        approvedById: actor.id,
        createdById: actor.id,
      },
      date,
      tx,
    );
    return { original: e, reversal: rev };
  });
  await audit({
    actorId: actor.id,
    approvedById: actor.id,
    action: "expense.reverse",
    entity: "Expense",
    entityId: id,
    summary: `${out.original.number} reversed by ${out.reversal.number} (${rs(out.reversal.amount + out.reversal.tax)})`,
    reason,
    after: { reversalId: out.reversal.id, reversalNumber: out.reversal.number },
  });
  return out.reversal;
}

/** Correct an approved expense: reverse it and open a new draft with the corrected figures (approved again normally). */
export async function correctExpense(actor: Actor, id: string, input: ExpenseInput, reason: string) {
  assertCan(actor, "expenses.approve", "expenses.create");
  validate(input);
  await assertPeriodOpen(input.date);
  const reversal = await reverseExpense(actor, id, `Corrected: ${reason}`);
  const replacement = await createExpense(actor, input);
  return { reversal, replacement };
}

/** Reversal entry (if any) for each of these expense numbers. */
export async function reversalsFor(numbers: string[]) {
  if (!numbers.length) return new Map<string, string>();
  const rows = await db.expense.findMany({ where: { reference: { in: numbers.map((n) => `${REV}${n}`) } }, select: { number: true, reference: true } });
  return new Map(rows.map((r) => [r.reference!.slice(REV.length), r.number]));
}

export type ExpenseFilter = { from?: string; to?: string; status?: string; categoryId?: string; kitchenIds?: string[] | null; q?: string };

export function expenseWhere(f: ExpenseFilter): Prisma.ExpenseWhereInput {
  const and: Prisma.ExpenseWhereInput[] = [];
  if (f.from || f.to) and.push({ date: { ...(f.from ? { gte: day(f.from) } : {}), ...(f.to ? { lte: day(f.to) } : {}) } });
  if (f.status && (EXPENSE_STATUSES as readonly string[]).includes(f.status)) and.push({ status: f.status });
  if (f.categoryId) and.push({ categoryId: f.categoryId });
  // Kitchen-scoped staff see their kitchens' expenses plus company-wide (untagged) ones.
  if (f.kitchenIds) and.push({ OR: [{ kitchenId: { in: f.kitchenIds } }, { kitchenId: null }] });
  if (f.q) and.push({ OR: [{ number: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }, { reference: { contains: f.q, mode: "insensitive" } }] });
  return and.length ? { AND: and } : {};
}

/** Totals per category for APPROVED + PAID entries (reversals net out automatically). */
export async function expenseTotals(f: ExpenseFilter) {
  const rows = await db.expense.groupBy({ by: ["categoryId"], where: { AND: [expenseWhere({ ...f, status: undefined }), { status: { in: ["APPROVED", "PAID"] } }] }, _sum: { amount: true, tax: true }, _count: { _all: true } });
  return rows.map((r) => ({ categoryId: r.categoryId, amount: r._sum.amount ?? 0, tax: r._sum.tax ?? 0, count: r._count._all }));
}
