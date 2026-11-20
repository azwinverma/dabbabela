import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ktmNow } from "@/lib/dates";
import { stampRange } from "@/server/analytics/filters";
import { topupLiability, topupCreditUsed } from "@/server/wallet-topup";
import { windowOf } from "./common";
import type { Col, ReportDef } from "./types";

const COLS: Col[] = [
  { key: "when", label: "Paid / created" },
  { key: "reference", label: "Payment" },
  { key: "customer", label: "Customer" },
  { key: "email", label: "Email", kind: "email" },
  { key: "method", label: "Method" },
  { key: "status", label: "Status" },
  { key: "amount", label: "Amount", kind: "money" },
  { key: "credited", label: "Credited to wallet", kind: "money" },
  { key: "reversed", label: "Reversed (refunded)", kind: "money" },
  { key: "net", label: "Net credit", kind: "money" },
];

const SHOW = { paid: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"], pending: ["PENDING"], failed: ["FAILED", "CANCELLED"] } as const;

/**
 * Wallet top-ups (Phase 2A). Paid view: top-ups by paid time; credited / reversed come from the credit ledger rows
 * (TOPUP / TOPUP_REVERSAL) with that paymentId — so the totals ARE the ledger, not a re-derivation from payments.
 * Top-ups are customer credit (a liability), not revenue: revenue is recognised when the credit pays for delivered orders.
 */
export const walletTopupsReport: ReportDef = {
  key: "wallet-topups",
  title: "Wallet top-ups",
  group: "Money owed",
  description: "Credit customers bought online (eSewa, Khalti, bank) — what was paid, credited, refunded, and what is still unspent.",
  definition:
    "Payments with purpose Wallet top-up. Paid: paid time in the range (Kathmandu); Waiting / Failed: created in the range. Credited = Σ credit-ledger TOPUP rows of the payment, reversed = Σ TOPUP_REVERSAL rows (refunds to source), net = credited − reversed — the ledger itself, so the totals reconcile with the wallet. Top-ups are cash in (Cash collected) but a liability (deferred customer credit), never revenue; revenue is recognised when wallet credit pays for delivered orders. Unspent top-up credit now = Σ per customer min(net top-ups, wallet balance) — other credit is treated as spent first. Unpaid top-ups are not receivables.",
  view: ["payments.view"],
  exportPerms: ["payments.export"],
  filters: ["range"],
  choices: [{ name: "show", label: "Show", options: [{ value: "paid", label: "Paid" }, { value: "pending", label: "Waiting for payment" }, { value: "failed", label: "Failed / cancelled" }] }],
  columns: COLS,
  async run(ctx, paging) {
    const { f, choice } = ctx;
    const show = (choice.show as keyof typeof SHOW) ?? "paid";
    const range = stampRange(f.from, f.to);
    const where: Prisma.PaymentWhereInput = { purpose: "WALLET_TOPUP", status: { in: [...SHOW[show]] }, ...(show === "paid" ? { paidAt: range } : { createdAt: range }) };
    const [count, sums, list] = await Promise.all([
      db.payment.count({ where }),
      db.payment.aggregate({ where, _sum: { amount: true } }),
      db.payment.findMany({
        where,
        orderBy: show === "paid" ? { paidAt: "asc" } : { createdAt: "asc" },
        ...windowOf(paging),
        select: { id: true, reference: true, method: true, status: true, amount: true, paidAt: true, createdAt: true, user: { select: { name: true, email: true } } },
      }),
    ]);
    // Ledger totals over ALL matching payments (not just the page), straight from the ledger.
    // (CreditLedger.paymentId is a plain column, so the "all matching payments" side is SQL with the same conditions.)
    const statuses = [...SHOW[show]];
    const timeCol = Prisma.raw(show === "paid" ? `p."paidAt"` : `p."createdAt"`);
    const [allLedger, pageLedger] = await Promise.all([
      db.$queryRaw<{ reason: string; amount: bigint | null }[]>`
        SELECT l.reason, SUM(l.amount)::bigint AS amount FROM "CreditLedger" l JOIN "Payment" p ON p.id = l."paymentId"
        WHERE l.reason IN ('TOPUP', 'TOPUP_REVERSAL') AND p.purpose = 'WALLET_TOPUP' AND p.status::text = ANY(${statuses})
          AND ${timeCol} >= (${range.gte} AT TIME ZONE 'UTC') AND ${timeCol} < (${range.lt} AT TIME ZONE 'UTC')
        GROUP BY l.reason`,
      list.length ? db.creditLedger.groupBy({ by: ["paymentId", "reason"], where: { reason: { in: ["TOPUP", "TOPUP_REVERSAL"] }, paymentId: { in: list.map((p) => p.id) } }, _sum: { amount: true } }) : Promise.resolve([]),
    ]);
    const of = (rows: { reason: string; amount?: bigint | null; _sum?: { amount?: number | null } }[], reason: string) =>
      rows.filter((r) => r.reason === reason).reduce((a, r) => a + Number(r.amount ?? r._sum?.amount ?? 0), 0);
    const credited = of(allLedger, "TOPUP");
    const reversed = -of(allLedger, "TOPUP_REVERSAL");
    const stamp = (d: Date) => `${ktmNow(d).date} ${ktmNow(d).time}`;
    const rows = list.map((p) => {
      const mine = pageLedger.filter((l) => l.paymentId === p.id);
      const c = of(mine, "TOPUP");
      const r = -of(mine, "TOPUP_REVERSAL");
      return { when: stamp(p.paidAt ?? p.createdAt), reference: p.reference, customer: p.user.name, email: p.user.email, method: p.method, status: p.status, amount: p.amount, credited: c, reversed: r, net: c - r };
    });
    const [unspent, walletAll, used] = await Promise.all([topupLiability(), db.creditLedger.aggregate({ _sum: { amount: true } }), topupCreditUsed(range.gte, range.lt)]);
    return {
      rows,
      count,
      totals: { when: "Total", amount: sums._sum.amount ?? 0, credited, reversed, net: credited - reversed },
      summary: [
        { label: show === "paid" ? "Top-ups paid" : "Top-ups in this view", value: sums._sum.amount ?? 0, kind: "money", note: `${count} payment${count === 1 ? "" : "s"}` },
        { label: "Credited to wallets", value: credited, kind: "money", note: "Σ TOPUP ledger rows of these payments" },
        { label: "Refunded to source", value: reversed, kind: "money", note: "Σ TOPUP_REVERSAL ledger rows" },
        { label: "Top-up credit spent in range", value: used.used, kind: "money", note: "Moved from liability to sales when it paid for orders (opening + net top-ups − closing unspent)" },
        { label: "Unspent top-up credit (now)", value: unspent, kind: "money", note: "Liability: deferred customer credit" },
        { label: "All wallet credit owed (now)", value: walletAll._sum.amount ?? 0, kind: "money", note: "Whole ledger, incl. refund and goodwill credit" },
      ],
      notes: show === "paid" ? undefined : ["Waiting and failed top-ups have no credit; they are listed so finance can follow up. They are not money owed to us."],
    };
  },
};
