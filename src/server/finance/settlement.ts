import "server-only";
import type { PaymentMethod, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rs } from "@/lib/money";
import { addDays, daysBetween, isValidISODate, ktmNow, monthRange, todayKTM } from "@/lib/dates";
import { assertCan, assertPeriodOpen, day, FinanceError, isMonth, type Actor } from "./common";

/**
 * Daily settlement (WP-09): per day, what the system expected vs what was actually counted / received.
 * - CASH, per kitchen: expected = Σ route `cashCollected` (riders); suggested count = Σ `cashHandedIn`.
 * - ESEWA / KHALTI (company-wide, kitchenId null): expected = payments marked paid that day; suggested count =
 *   imported statement lines matched to those payments.
 * - BANK_TRANSFER (company-wide): expected = transfers verified that day; finance enters the bank statement figure.
 * Saving recomputes `expected` on the server; closing locks the row (a non-zero variance needs a note).
 * Postgres treats NULL kitchenIds as distinct in the unique key, so company-wide rows are de-duplicated here.
 */

export const SETTLE_METHODS = ["CASH", "ESEWA", "KHALTI", "BANK_TRANSFER"] as const satisfies readonly PaymentMethod[];
export type SettleMethod = (typeof SETTLE_METHODS)[number];
const PAID: Prisma.PaymentWhereInput["status"] = { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] };

/** [00:00, 24:00) Kathmandu of an ISO day as UTC instants. */
export function ktmDay(date: string) {
  return { gte: new Date(`${date}T00:00:00+05:45`), lt: new Date(`${addDays(date, 1)}T00:00:00+05:45`) };
}

export async function expectedFor(date: string, kitchenId: string | null, method: SettleMethod) {
  if (method === "CASH") {
    const r = await db.deliveryRoute.aggregate({ where: { date: day(date), ...(kitchenId ? { kitchenId } : {}) }, _sum: { cashCollected: true, cashHandedIn: true }, _count: true });
    const pendingHandIn = await db.deliveryRoute.count({ where: { date: day(date), ...(kitchenId ? { kitchenId } : {}), cashCollected: { gt: 0 }, cashHandedIn: null } });
    return { expected: r._sum.cashCollected ?? 0, suggested: r._sum.cashHandedIn ?? 0, detail: `${r._count} route(s)${pendingHandIn ? ` · ${pendingHandIn} not handed in yet` : ""}` };
  }
  const paidWhere: Prisma.PaymentWhereInput = { method, status: PAID, paidAt: ktmDay(date) };
  const p = await db.payment.aggregate({ where: paidWhere, _sum: { amount: true }, _count: true });
  if (method === "BANK_TRANSFER") return { expected: p._sum.amount ?? 0, suggested: null as number | null, detail: `${p._count} transfer(s) verified` };
  const lines = await db.gatewayStatementLine.aggregate({ where: { provider: method, matchedPayment: paidWhere }, _sum: { amount: true }, _count: true });
  return { expected: p._sum.amount ?? 0, suggested: lines._count ? (lines._sum.amount ?? 0) : null, detail: `${p._count} payment(s) · ${lines._count} on imported statements` };
}

async function findRow(date: string, kitchenId: string | null, method: SettleMethod) {
  return db.dailySettlement.findFirst({ where: { date: day(date), kitchenId, method }, orderBy: { createdAt: "asc" } });
}

/** Every settlement line for a day: cash per kitchen in scope + one row per gateway / bank. */
export async function settlementSheet(date: string, kitchenIds: string[] | null) {
  const kitchens = await db.kitchen.findMany({ where: { isActive: true, ...(kitchenIds ? { id: { in: kitchenIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const keys: { kitchenId: string | null; kitchen: string; method: SettleMethod }[] = [
    ...kitchens.map((k) => ({ kitchenId: k.id, kitchen: k.name, method: "CASH" as const })),
    // Company-wide money is only shown to unscoped finance staff.
    ...(kitchenIds ? [] : (["ESEWA", "KHALTI", "BANK_TRANSFER"] as const).map((m) => ({ kitchenId: null, kitchen: "All kitchens", method: m }))),
  ];
  return Promise.all(
    keys.map(async (k) => {
      const [calc, saved] = await Promise.all([expectedFor(date, k.kitchenId, k.method), findRow(date, k.kitchenId, k.method)]);
      return { ...k, ...calc, saved, closed: Boolean(saved?.closedAt) };
    }),
  );
}

export async function saveSettlement(actor: Actor & { kitchenIds?: string[] | null }, input: { date: string; kitchenId: string | null; method: SettleMethod; counted: number; note?: string | null }) {
  assertCan(actor, "settlements.edit");
  if (!isValidISODate(input.date) || input.date > todayKTM()) throw new FinanceError("Pick a day up to today");
  if (!(SETTLE_METHODS as readonly string[]).includes(input.method)) throw new FinanceError("Unknown method");
  if (input.method === "CASH" && !input.kitchenId) throw new FinanceError("Cash is settled per kitchen");
  if (input.method !== "CASH") input.kitchenId = null;
  if (actor.kitchenIds && (!input.kitchenId || !actor.kitchenIds.includes(input.kitchenId))) throw new FinanceError("That kitchen isn't in your scope");
  if (!Number.isInteger(input.counted) || input.counted < 0) throw new FinanceError("Enter the amount counted");
  await assertPeriodOpen(input.date);
  const { expected } = await expectedFor(input.date, input.kitchenId, input.method);
  const variance = input.counted - expected;
  const out = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`settle:${input.date}:${input.kitchenId ?? "-"}:${input.method}`}))`;
    const row = await tx.dailySettlement.findFirst({ where: { date: day(input.date), kitchenId: input.kitchenId, method: input.method } });
    if (row?.closedAt) throw new FinanceError("This settlement is closed and locked");
    const data = { expected, counted: input.counted, variance, note: input.note?.trim().slice(0, 500) || null };
    return { before: row, after: row ? await tx.dailySettlement.update({ where: { id: row.id }, data }) : await tx.dailySettlement.create({ data: { ...data, date: day(input.date), kitchenId: input.kitchenId, method: input.method } }) };
  });
  await audit({
    actorId: actor.id,
    action: "settlement.save",
    entity: "DailySettlement",
    entityId: out.after.id,
    summary: `${input.date} ${input.method}: counted ${rs(input.counted)} vs expected ${rs(expected)} (variance ${rs(variance)})`,
    before: out.before ? { expected: out.before.expected, counted: out.before.counted, variance: out.before.variance } : null,
    after: { expected, counted: input.counted, variance },
  });
  return out.after;
}

/** Close (lock) a settlement. Expected is recomputed first; a variance must be explained. */
export async function closeSettlement(actor: Actor & { kitchenIds?: string[] | null }, id: string, note?: string | null) {
  assertCan(actor, "settlements.approve");
  const row = await db.dailySettlement.findUniqueOrThrow({ where: { id } });
  if (row.closedAt) throw new FinanceError("Already closed");
  if (actor.kitchenIds && (!row.kitchenId || !actor.kitchenIds.includes(row.kitchenId))) throw new FinanceError("That kitchen isn't in your scope");
  const date = row.date.toISOString().slice(0, 10);
  await assertPeriodOpen(date);
  const { expected } = await expectedFor(date, row.kitchenId, row.method as SettleMethod);
  const variance = row.counted - expected;
  const why = note?.trim() || row.note;
  if (variance !== 0 && !why) throw new FinanceError(`Explain the ${rs(variance)} variance before closing`);
  const r = await db.dailySettlement.updateMany({ where: { id, closedAt: null }, data: { expected, variance, note: why || null, closedAt: new Date(), closedById: actor.id } });
  if (!r.count) throw new FinanceError("Already closed");
  await audit({ actorId: actor.id, approvedById: actor.id, action: "settlement.close", entity: "DailySettlement", entityId: id, summary: `${date} ${row.method} closed, variance ${rs(variance)}`, reason: why, after: { expected, counted: row.counted, variance } });
  return db.dailySettlement.findUniqueOrThrow({ where: { id } });
}

/** Closed settlements with a variance, newest first (for the exceptions list). */
export async function varianceLog(from: string, to: string) {
  return db.dailySettlement.findMany({ where: { date: { gte: day(from), lte: day(to) }, variance: { not: 0 } }, orderBy: { date: "desc" }, take: 200 });
}

// ───────────── accounting periods ─────────────

/** Close a month: nothing dated in it can change afterwards. Refused while drafts or open settlements remain. */
export async function closePeriod(actor: Actor, month: string, note?: string | null) {
  assertCan(actor, "settlements.approve", "expenses.approve");
  if (!isMonth(month)) throw new FinanceError("Pick a month");
  const { start, end } = monthRange(month);
  if (end >= todayKTM()) throw new FinanceError("A month can be closed only after it ends");
  const range = { gte: day(start), lte: day(end) };
  const [drafts, openSettlements] = await Promise.all([db.expense.count({ where: { date: range, status: "DRAFT" } }), db.dailySettlement.count({ where: { date: range, closedAt: null } })]);
  const blockers = [drafts && `${drafts} draft expense(s) — approve or void them`, openSettlements && `${openSettlements} settlement(s) not closed`].filter(Boolean);
  if (blockers.length) throw new FinanceError(`Can't close ${month}: ${blockers.join("; ")}`);
  const existing = await db.accountingPeriod.findUnique({ where: { month } });
  if (existing?.closedAt) throw new FinanceError(`${month} is already closed`);
  const p = await db.accountingPeriod.upsert({
    where: { month },
    create: { month, closedAt: new Date(), closedById: actor.id, note: note?.trim() || null },
    update: { closedAt: new Date(), closedById: actor.id, note: note?.trim() || existing?.note || null },
  });
  await audit({ actorId: actor.id, approvedById: actor.id, action: "period.close", entity: "AccountingPeriod", entityId: p.id, summary: `${month} closed`, reason: note });
  return p;
}

/** Re-open a closed month (owner / super admin only, with a reason). */
export async function reopenPeriod(actor: Actor, month: string, reason: string) {
  assertCan(actor, "settlements.approve", "expenses.approve");
  if (!["OWNER", "SUPER_ADMIN"].includes(actor.role)) throw new FinanceError("Only the owner can re-open a closed month");
  if (!reason.trim()) throw new FinanceError("Give a reason");
  const p = await db.accountingPeriod.findUnique({ where: { month } });
  if (!p?.closedAt) throw new FinanceError(`${month} isn't closed`);
  await db.accountingPeriod.update({ where: { month }, data: { closedAt: null, closedById: null, note: `${p.note ? `${p.note}\n` : ""}Re-opened ${todayKTM()}: ${reason.trim()}`.slice(0, 1000) } });
  await audit({ actorId: actor.id, approvedById: actor.id, action: "period.reopen", entity: "AccountingPeriod", entityId: p.id, summary: `${month} re-opened`, reason, before: { closedAt: p.closedAt, closedById: p.closedById } });
}

export async function periodStatuses(months: string[]) {
  const rows = await db.accountingPeriod.findMany({ where: { month: { in: months } } });
  const by = new Map(rows.map((r) => [r.month, r]));
  return months.map((m) => ({ month: m, closedAt: by.get(m)?.closedAt ?? null, closedById: by.get(m)?.closedById ?? null, note: by.get(m)?.note ?? null }));
}

// ───────────── cash flow ─────────────

export type CashFlowDay = { date: string; inflow: number; refunds: number; expenses: number; suppliers: number; fees: number; outflow: number; net: number };

/**
 * Cash in / out by Kathmandu day (company-wide). In = eSewa, Khalti, bank and cash payments marked paid.
 * Out = refunds paid out (not wallet credit), expenses marked PAID (by expense date, reversals net out),
 * supplier payments, gateway fees (statement actual when imported, else the estimate).
 * Company-invoice receipts aren't dated per payment yet, so they aren't included.
 */
export async function cashFlow(from: string, to: string) {
  if (daysBetween(from, to) > 366) throw new FinanceError("Pick at most a year");
  const stamp = { gte: new Date(`${from}T00:00:00+05:45`), lt: new Date(`${addDays(to, 1)}T00:00:00+05:45`) };
  const [payments, refunds, expenses, supplierPays] = await Promise.all([
    db.payment.findMany({ where: { status: PAID, paidAt: stamp, method: { in: ["ESEWA", "KHALTI", "BANK_TRANSFER", "CASH"] } }, select: { paidAt: true, amount: true, gatewayFee: true, feeActual: true } }),
    db.refund.findMany({ where: { status: "PROCESSED", processedAt: stamp, method: { not: "WALLET_CREDIT" } }, select: { processedAt: true, amount: true } }),
    db.expense.findMany({ where: { status: "PAID", date: { gte: day(from), lte: day(to) } }, select: { date: true, amount: true, tax: true } }),
    db.supplierPayment.findMany({ where: { paidAt: stamp }, select: { paidAt: true, amount: true } }),
  ]);
  const days = new Map<string, CashFlowDay>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { date: d, inflow: 0, refunds: 0, expenses: 0, suppliers: 0, fees: 0, outflow: 0, net: 0 });
  const at = (d: Date) => days.get(ktmNow(d).date);
  for (const p of payments) {
    const r = at(p.paidAt!);
    if (!r) continue;
    r.inflow += p.amount;
    r.fees += p.feeActual ?? p.gatewayFee;
  }
  for (const x of refunds) {
    const r = x.processedAt && at(x.processedAt);
    if (r) r.refunds += x.amount;
  }
  for (const e of expenses) {
    const r = days.get(e.date.toISOString().slice(0, 10));
    if (r) r.expenses += e.amount + e.tax;
  }
  for (const s of supplierPays) {
    const r = at(s.paidAt);
    if (r) r.suppliers += s.amount;
  }
  const rows = [...days.values()].map((r) => {
    const outflow = r.refunds + r.expenses + r.suppliers + r.fees;
    return { ...r, outflow, net: r.inflow - outflow };
  });
  const sum = (k: keyof Omit<CashFlowDay, "date">) => rows.reduce((a, r) => a + r[k], 0);
  return { rows, totals: { inflow: sum("inflow"), refunds: sum("refunds"), expenses: sum("expenses"), suppliers: sum("suppliers"), fees: sum("fees"), outflow: sum("outflow"), net: sum("net") } };
}
