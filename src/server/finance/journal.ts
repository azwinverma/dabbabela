import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { addDays, daysBetween, isValidISODate, ktmNow } from "@/lib/dates";
import { csv, money } from "@/server/reports";
import { topupCreditUsed } from "@/server/wallet-topup";
import { ACCOUNT_KEYS, assertCan, day, FinanceError, getFinanceConfig, iso, type Actor } from "./common";

/**
 * Accounting journal export (WP-09): a generic double-entry CSV
 * (date, journal, entry, account_key, account, debit, credit, memo).
 *
 * ⛔ The accountant's chart of accounts is an external blocker, so every line carries our internal account key and,
 * when finance has mapped it (Setting `finance.config.chartOfAccounts`), the accountant's account. Unmapped keys
 * export as "UNMAPPED <key>" so nothing is silently misposted. Every entry balances (Σ debit = Σ credit).
 *
 * Sources: payments received (cash methods), gateway fees (actual else estimate), refunds paid out, approved / paid
 * expenses (reversals post the opposite way), supplier invoices and supplier payments, company-invoice receipts
 * (`InvoiceReceipt` by received date; cash basis like customer payments, so they credit sales receipts — receipts
 * linked to an online Payment are already posted through that Payment and are skipped).
 *
 * Wallet top-ups (Phase 2A) are customer credit, a liability — not sales: the receipt credits
 * `liability.customer_credit`, a refunded top-up debits it, and top-up credit spent on orders moves from the liability
 * to `revenue.sales` (one TOPUP_USED entry per period, dated the last day: opening + net top-ups − closing top-up
 * liability, see wallet-topup.topupLiability). Other wallet credit (refunds, goodwill) is unchanged: it never left sales.
 */

export type JournalLine = { date: string; journal: string; entry: string; key: string; debit: number; credit: number; memo: string };

const CASH_METHODS = ["ESEWA", "KHALTI", "BANK_TRANSFER", "CASH"] as const;
const REFUND_ACCOUNT: Record<string, string> = { ORIGINAL: "cash.ESEWA", BANK: "cash.BANK_TRANSFER", CASH: "cash.CASH" };
const EXPENSE_CASH: Record<string, string> = { CASH: "cash.CASH", BANK: "cash.BANK", ESEWA: "cash.ESEWA", KHALTI: "cash.KHALTI" };
const RECEIPT_CASH: Record<string, string> = { BANK_TRANSFER: "cash.BANK_TRANSFER", CHEQUE: "cash.BANK_TRANSFER", CASH: "cash.CASH", ESEWA: "cash.ESEWA", KHALTI: "cash.KHALTI" };
const SUPPLIER_CASH: Record<string, string> = { CASH: "cash.CASH", BANK: "cash.BANK", CHEQUE: "cash.BANK", ESEWA: "cash.ESEWA", KHALTI: "cash.KHALTI" };

/** One balanced entry: a signed amount moves from `credit` to `debit`; a negative amount (reversal) swaps sides. */
function pair(out: JournalLine[], base: Omit<JournalLine, "key" | "debit" | "credit">, debitKey: string, creditKey: string, amount: number) {
  if (!amount) return;
  const [dr, cr] = amount > 0 ? [debitKey, creditKey] : [creditKey, debitKey];
  const a = Math.abs(amount);
  out.push({ ...base, key: dr, debit: a, credit: 0 }, { ...base, key: cr, debit: 0, credit: a });
}

export async function buildJournal(from: string, to: string) {
  const stamp = { gte: new Date(`${from}T00:00:00+05:45`), lt: new Date(`${addDays(to, 1)}T00:00:00+05:45`) };
  const dates = { gte: day(from), lte: day(to) };
  const [payments, refunds, expenses, invoices, supplierPays, receipts] = await Promise.all([
    db.payment.findMany({ where: { status: { in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] }, paidAt: stamp, method: { in: [...CASH_METHODS] } }, orderBy: { paidAt: "asc" } }),
    db.refund.findMany({ where: { status: "PROCESSED", processedAt: stamp, method: { not: "WALLET_CREDIT" } }, include: { payment: { select: { reference: true, method: true, purpose: true } } }, orderBy: { processedAt: "asc" } }),
    db.expense.findMany({ where: { status: { in: ["APPROVED", "PAID"] }, date: dates }, include: { category: { select: { key: true } } }, orderBy: [{ date: "asc" }, { number: "asc" }] }),
    db.supplierInvoice.findMany({ where: { status: { not: "VOID" }, date: dates }, include: { supplier: { select: { name: true } } }, orderBy: { date: "asc" } }),
    db.supplierPayment.findMany({ where: { paidAt: stamp }, include: { invoice: { select: { number: true, supplier: { select: { name: true } } } } }, orderBy: { paidAt: "asc" } }),
    db.invoiceReceipt.findMany({ where: { receivedAt: stamp, paymentId: null }, include: { invoice: { select: { number: true, billingName: true } } }, orderBy: { receivedAt: "asc" } }),
  ]);
  const out: JournalLine[] = [];
  for (const p of payments) {
    const topup = p.purpose === "WALLET_TOPUP";
    const base = { date: ktmNow(p.paidAt!).date, journal: "RECEIPTS", entry: p.reference, memo: `${topup ? "Wallet top-up" : "Payment"} ${p.reference} (${p.method})` };
    pair(out, base, `cash.${p.method}`, topup ? "liability.customer_credit" : "revenue.sales", p.amount);
    const fee = p.feeActual ?? p.gatewayFee;
    pair(out, { ...base, journal: "GATEWAY_FEES", memo: `${p.method} fee on ${p.reference}${p.feeActual == null ? " (estimate)" : ""}` }, "expense.GATEWAY_FEES", `cash.${p.method}`, fee);
  }
  for (const r of refunds) {
    const cashKey = r.method === "ORIGINAL" ? `cash.${r.payment.method}` : (REFUND_ACCOUNT[r.method] ?? "cash.OTHER");
    const topup = r.payment.purpose === "WALLET_TOPUP";
    pair(out, { date: ktmNow(r.processedAt!).date, journal: "REFUNDS", entry: r.providerRef || r.id, memo: `${topup ? "Top-up refund" : "Refund"} on ${r.payment.reference}` }, topup ? "liability.customer_credit" : "revenue.refunds", cashKey, r.amount);
  }
  const used = await topupCreditUsed(stamp.gte, stamp.lt);
  pair(out, { date: to, journal: "TOPUP_USED", entry: `TOPUP-USED-${from}-${to}`, memo: `Wallet top-up credit spent on orders ${from} → ${to}` }, "liability.customer_credit", "revenue.sales", used.used);
  for (const e of expenses) {
    const base = { date: iso(e.date), journal: "EXPENSES", entry: e.number, memo: e.description };
    pair(out, base, `expense.${e.category.key}`, "payable.expenses", e.amount);
    pair(out, base, "tax.input", "payable.expenses", e.tax);
    if (e.status === "PAID") pair(out, { ...base, journal: "EXPENSE_PAYMENTS" }, "payable.expenses", EXPENSE_CASH[e.method ?? ""] ?? "cash.OTHER", e.amount + e.tax);
  }
  for (const i of invoices) {
    const base = { date: iso(i.date), journal: "PURCHASES", entry: i.number, memo: `${i.supplier.name} invoice ${i.number}` };
    pair(out, base, "inventory.purchases", "payable.suppliers", i.subtotal);
    pair(out, base, "tax.input", "payable.suppliers", i.tax);
  }
  for (const s of supplierPays) {
    pair(out, { date: ktmNow(s.paidAt).date, journal: "SUPPLIER_PAYMENTS", entry: s.reference, memo: `${s.invoice.supplier.name} invoice ${s.invoice.number}` }, "payable.suppliers", SUPPLIER_CASH[s.method] ?? "cash.OTHER", s.amount);
  }
  for (const r of receipts) {
    pair(out, { date: ktmNow(r.receivedAt).date, journal: "RECEIPTS", entry: r.reference, memo: `${r.invoice.billingName} invoice ${r.invoice.number} (${r.method})` }, RECEIPT_CASH[r.method] ?? "cash.OTHER", "revenue.sales", r.amount);
  }
  // Supplier credits applied to supplier invoices (purchase returns): settle the payable against purchases — not cash.
  const creditApps = await db.supplierCreditApplication.findMany({ where: { createdAt: stamp }, include: { invoice: { select: { number: true, supplier: { select: { name: true } } } }, credit: { select: { number: true } } }, orderBy: { createdAt: "asc" } });
  for (const c of creditApps) {
    pair(out, { date: ktmNow(c.createdAt).date, journal: "SUPPLIER_CREDITS", entry: c.credit.number || c.id, memo: `${c.invoice.supplier.name} credit applied to invoice ${c.invoice.number}` }, "payable.suppliers", "inventory.purchases", c.amount);
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.journal.localeCompare(b.journal) || a.entry.localeCompare(b.entry));
  const debit = out.reduce((a, l) => a + l.debit, 0);
  const credit = out.reduce((a, l) => a + l.credit, 0);
  return { lines: out, debit, credit, balanced: debit === credit };
}

/** Account label for a key using the configured mapping. */
export function accountFor(key: string, chart: Record<string, string>) {
  return chart[key] ?? `UNMAPPED ${key}`;
}

/** Every account key the journal can produce (for the mapping editor). */
export async function journalAccountKeys() {
  const cats = await db.expenseCategory.findMany({ select: { key: true, name: true }, orderBy: { key: "asc" } });
  return [...Object.entries(ACCOUNT_KEYS).map(([key, label]) => ({ key, label })), ...cats.map((c) => ({ key: `expense.${c.key}`, label: `Expense: ${c.name}` }))];
}

/** CSV export. Requires expenses.export; audited with the range, line count and how many keys were unmapped. */
export async function exportJournal(actor: Actor, from: string, to: string) {
  assertCan(actor, "expenses.export");
  if (!isValidISODate(from) || !isValidISODate(to) || from > to) throw new FinanceError("Pick a valid date range");
  if (daysBetween(from, to) > 400) throw new FinanceError("Export at most about a year at a time");
  const [j, cfg] = await Promise.all([buildJournal(from, to), getFinanceConfig()]);
  const unmapped = [...new Set(j.lines.map((l) => l.key).filter((k) => !cfg.chartOfAccounts[k]))];
  const rows: (string | number)[][] = [["date", "journal", "entry", "account_key", "account", "debit", "credit", "memo"]];
  for (const l of j.lines) rows.push([l.date, l.journal, l.entry, l.key, accountFor(l.key, cfg.chartOfAccounts), l.debit ? money(l.debit) : "", l.credit ? money(l.credit) : "", l.memo]);
  await audit({
    actorId: actor.id,
    action: "finance.journal_export",
    entity: "Journal",
    entityId: `${from}..${to}`,
    summary: `Journal ${from} → ${to}: ${j.lines.length} lines, ${unmapped.length} unmapped account(s)`,
    after: { from, to, lines: j.lines.length, debit: j.debit, credit: j.credit, balanced: j.balanced, unmapped },
  });
  return { filename: `dabbabela-journal-${from}-to-${to}.csv`, body: csv(rows), lines: j.lines.length, balanced: j.balanced, unmapped };
}
