import Link from "next/link";
import type { PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { addDays, dateOnly, formatDay, formatStamp, isoDate, ktmNow } from "@/lib/dates";
import { METHOD_LABEL, PAYMENT_STATUS } from "@/lib/labels";
import { PageHeader, Table, Th, Td, EmptyRow, PaymentBadge, Tabs, Pagination, Panel } from "@/components/admin/ui";
import { readRange, RangeForm, Empty } from "@/components/admin/finance/kit";
import { duplicatePaymentSuspects, statementDuplicates } from "@/server/finance/statements";
import { VerifyForms } from "./VerifyForms";

export const metadata = { title: "Payments" };
const PER = 40;

export default async function Payments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("payments.view");
  const sp = await searchParams;
  const view = sp.view ?? "all";
  const canVerify = can(user, "payments.approve");
  const verifyCount = await db.payment.count({ where: { method: "BANK_TRANSFER", status: "PENDING" } });
  const tabs = [
    { key: "all", label: "All payments", href: "/admin/payments" },
    { key: "verify", label: "Bank transfers to verify", href: "/admin/payments?view=verify", count: verifyCount },
    { key: "reconcile", label: "Reconciliation", href: "/admin/payments?view=reconcile" },
  ];

  return (
    <div>
      <PageHeader title="Payments" description="Every payment, how it was verified, and what the gateways told us." />
      <Tabs tabs={tabs} current={view} />
      {view === "verify" ? <VerifyQueue canVerify={canVerify} /> : view === "reconcile" ? <Reconcile sp={sp} /> : <List sp={sp} />}
    </div>
  );
}

async function List({ sp }: { sp: Record<string, string | undefined> }) {
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.PaymentWhereInput = {
    ...(sp.status && sp.status in PAYMENT_STATUS ? { status: sp.status as PaymentStatus } : {}),
    ...(sp.method && sp.method in METHOD_LABEL ? { method: sp.method as PaymentMethod } : {}),
    ...(sp.from ? { createdAt: { gte: dateOnly(sp.from), ...(sp.to ? { lt: dateOnly(addDays(sp.to, 1)) } : {}) } } : {}),
    ...(sp.q ? { OR: [{ reference: { contains: sp.q, mode: "insensitive" } }, { user: { name: { contains: sp.q, mode: "insensitive" } } }, { orders: { some: { number: { contains: sp.q, mode: "insensitive" } } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.payment.findMany({ where, include: { user: { select: { name: true } }, _count: { select: { orders: true, attempts: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER }),
    db.payment.count({ where }),
  ]);
  return (
    <>
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Reference, order no. or customer" className="field max-w-xs" />
        <select name="status" defaultValue={sp.status ?? ""} className="field w-40">
          <option value="">Any status</option>
          {Object.entries(PAYMENT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select name="method" defaultValue={sp.method ?? ""} className="field w-44">
          <option value="">Any method</option>
          {Object.entries(METHOD_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={sp.from} className="field w-40" aria-label="Created from" />
        <input type="date" name="to" defaultValue={sp.to} className="field w-40" aria-label="Created to" />
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Filter</button>
      </form>
      <Table>
        <thead>
          <tr>
            <Th>Reference</Th>
            <Th>Customer</Th>
            <Th>Method</Th>
            <Th>Status</Th>
            <Th className="text-right">Amount</Th>
            <Th className="text-right">Refunded</Th>
            <Th>Orders</Th>
            <Th>Created</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((p) => (
              <tr key={p.id} className="hover:bg-paper/40">
                <Td>
                  <Link href={`/admin/payments/${p.id}`} className="font-mono text-xs font-semibold text-sindoor hover:underline">
                    {p.reference}
                  </Link>
                </Td>
                <Td>{p.user.name}</Td>
                <Td>{METHOD_LABEL[p.method]}</Td>
                <Td>
                  <PaymentBadge status={p.status} />
                </Td>
                <Td className="text-right tabular-nums">{rs(p.amount)}</Td>
                <Td className="text-right tabular-nums text-ink-mute">{p.refundedAmount ? rs(p.refundedAmount) : "—"}</Td>
                <Td className="tabular-nums">{p._count.orders}</Td>
                <Td className="whitespace-nowrap text-xs text-ink-mute">{formatStamp(p.createdAt)}</Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={8}>No payments match.</EmptyRow>
          )}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / PER)} params={sp} basePath="/admin/payments" />
    </>
  );
}

async function VerifyQueue({ canVerify }: { canVerify: boolean }) {
  const rows = await db.payment.findMany({
    where: { method: "BANK_TRANSFER", status: "PENDING" },
    include: { user: { select: { name: true } }, orders: { select: { number: true, deliveryDate: true }, orderBy: { deliveryDate: "asc" }, take: 3 } },
    orderBy: { createdAt: "asc" },
  });
  if (!rows.length) return <Empty>No bank transfers are waiting. Customers upload a screenshot or reference from their payment page; it appears here.</Empty>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-mute">Match each one against the bank statement before verifying. Verifying releases the orders to the kitchen; first delivery dates are shown so you can prioritise.</p>
      {rows.map((p) => (
        <Panel key={p.id} title={<span className="font-mono text-sm">{p.reference}</span>} actions={<span className="font-display text-lg font-bold tabular-nums">{rs(p.amount)}</span>}>
          <div className="grid gap-4 md:grid-cols-[200px_1fr]">
            <div>
              {p.proofUrl ? (
                p.proofUrl.endsWith(".pdf") ? (
                  <a href={p.proofUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-sindoor underline">
                    Open PDF proof
                  </a>
                ) : (
                  <a href={p.proofUrl} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.proofUrl} alt={`Transfer proof for ${p.reference}`} className="max-h-48 rounded-lg border border-ink-line object-contain" />
                  </a>
                )
              ) : (
                <p className="rounded-lg bg-paper px-3 py-6 text-center text-xs text-ink-mute">No proof uploaded yet</p>
              )}
            </div>
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-ink-mute">Customer:</span> {p.user.name} · <span className="text-ink-mute">Their note/ref:</span> {p.note || "—"}
              </p>
              <p>
                <span className="text-ink-mute">First delivery:</span> {p.orders[0] ? formatDay(isoDate(p.orders[0].deliveryDate)) : "—"} · {p.orders.map((o) => o.number).join(", ")}
              </p>
              <p className="text-xs text-ink-mute">Created {formatStamp(p.createdAt)}</p>
              {canVerify ? <VerifyForms id={p.id} /> : <p className="text-xs text-ink-mute">Finance verifies these.</p>}
            </div>
          </div>
        </Panel>
      ))}
    </div>
  );
}

async function Reconcile({ sp }: { sp: Record<string, string | undefined> }) {
  const { from, to } = readRange(sp, 7);
  const stamp = { gte: dateOnly(from), lt: dateOnly(addDays(to, 1)) };
  const [dupes, statementDupes, unmatched] = await Promise.all([duplicatePaymentSuspects(dateOnly(from), dateOnly(addDays(to, 1))), statementDuplicates(), db.gatewayStatementLine.count({ where: { matchedPaymentId: null } })]);
  const [payments, attempts, mismatches, stale] = await Promise.all([
    db.payment.findMany({ where: { createdAt: stamp }, select: { method: true, status: true, amount: true, createdAt: true } }),
    db.paymentAttempt.findMany({ where: { createdAt: stamp, method: { in: ["ESEWA", "KHALTI"] } }, select: { method: true, status: true, amount: true } }),
    db.paymentProviderEvent.findMany({ where: { createdAt: stamp, outcome: "MISMATCH" }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.paymentAttempt.findMany({ where: { status: "STARTED", createdAt: { lt: new Date(Date.now() - 30 * 60_000), gte: dateOnly(addDays(ktmNow().date, -3)) } }, include: { payment: { select: { reference: true, status: true } } }, take: 50 }),
  ]);
  const days = new Map<string, Map<string, { expected: number; paid: number; count: number; paidCount: number }>>();
  for (const p of payments) {
    const d = ktmNow(p.createdAt).date;
    if (!days.has(d)) days.set(d, new Map());
    const m = days.get(d)!;
    const row = m.get(p.method) ?? { expected: 0, paid: 0, count: 0, paidCount: 0 };
    if (p.status !== "CANCELLED") {
      row.expected += p.amount;
      row.count++;
    }
    if (["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(p.status)) {
      row.paid += p.amount;
      row.paidCount++;
    }
    m.set(p.method, row);
  }
  const gw = (method: string) => {
    const a = attempts.filter((x) => x.method === method);
    return { started: a.length, success: a.filter((x) => x.status === "SUCCESS").length, failed: a.filter((x) => x.status === "FAILED").length, open: a.filter((x) => x.status === "STARTED").length };
  };
  return (
    <div className="space-y-4">
      <RangeForm from={from} to={to} />
      <div className="grid gap-3 sm:grid-cols-2">
        {(["ESEWA", "KHALTI"] as const).map((m) => {
          const g = gw(m);
          return (
            <Panel key={m} title={`${METHOD_LABEL[m]} gateway attempts`}>
              <p className="text-sm">
                {g.started} started · <b className="text-saag">{g.success} confirmed by server check</b> · {g.failed} failed · {g.open} still open
              </p>
              <p className="mt-1 text-xs text-ink-mute">Confirmed = signature/lookup verified AND the provider&apos;s status API said complete. Match these against the merchant portal settlement report.</p>
            </Panel>
          );
        })}
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Day</Th>
            <Th>Method</Th>
            <Th className="text-right">Payments</Th>
            <Th className="text-right">Expected</Th>
            <Th className="text-right">Paid</Th>
            <Th className="text-right">Gap</Th>
          </tr>
        </thead>
        <tbody>
          {[...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).flatMap(([d, m]) =>
            [...m.entries()].map(([method, r]) => (
              <tr key={d + method}>
                <Td>{formatDay(d)}</Td>
                <Td>{METHOD_LABEL[method as PaymentMethod]}</Td>
                <Td className="text-right tabular-nums">
                  {r.paidCount}/{r.count}
                </Td>
                <Td className="text-right tabular-nums">{rs(r.expected)}</Td>
                <Td className="text-right tabular-nums">{rs(r.paid)}</Td>
                <Td className={`text-right tabular-nums ${r.expected - r.paid ? "font-semibold text-besar-dark" : "text-ink-mute"}`}>{rs(r.expected - r.paid)}</Td>
              </tr>
            )),
          )}
          {!days.size && <EmptyRow colSpan={6}>No payments in this range.</EmptyRow>}
        </tbody>
      </Table>
      <Panel
        title={`Possible duplicate payments (${dupes.length + statementDupes.length})`}
        actions={
          <Link href="/admin/settlements?tab=statements" className="text-sm font-semibold text-sindoor underline">
            Gateway statements{unmatched ? ` · ${unmatched} unmatched line(s)` : ""}
          </Link>
        }
      >
        {dupes.length || statementDupes.length ? (
          <ul className="divide-y divide-ink-line/50 text-sm">
            {dupes.map((d) => (
              <li key={`${d.a}-${d.b}`} className="py-2">
                Same customer paid {rs(d.amount)} twice within {Math.round(d.gap_s / 60)} min:{" "}
                <Link href={`/admin/payments/${d.a}`} className="font-mono text-xs text-sindoor underline">
                  {d.aref}
                </Link>{" "}
                ({d.method_a}) and{" "}
                <Link href={`/admin/payments/${d.b}`} className="font-mono text-xs text-sindoor underline">
                  {d.bref}
                </Link>{" "}
                ({d.method_b})
              </li>
            ))}
            {statementDupes.map((d) => (
              <li key={d.payment.id} className="py-2">
                <Link href={`/admin/payments/${d.payment.id}`} className="font-mono text-xs text-sindoor underline">
                  {d.payment.reference}
                </Link>{" "}
                settled {d.lines}× on gateway statements ({rs(d.settled)} for a {rs(d.payment.amount)} payment)
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-mute">None — no customer paid the same amount twice within 10 minutes in this range, and no payment appears twice on imported statements.</p>
        )}
      </Panel>
      <Panel title={`Mismatched callbacks (${mismatches.length})`}>
        {mismatches.length ? (
          <ul className="divide-y divide-ink-line/50 text-sm">
            {mismatches.map((e) => (
              <li key={e.id} className="py-2">
                <span className="font-mono text-xs">{e.eventKey}</span> · {e.provider} · {formatStamp(e.createdAt)}
                {e.paymentId && (
                  <Link href={`/admin/payments/${e.paymentId}`} className="ml-2 text-sindoor underline">
                    payment
                  </Link>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-mute">None — no callback failed signature, amount or reference checks.</p>
        )}
      </Panel>
      <Panel title={`Gateway sessions never completed (${stale.length})`}>
        {stale.length ? (
          <ul className="divide-y divide-ink-line/50 text-sm">
            {stale.map((a) => (
              <li key={a.id} className="flex justify-between py-2">
                <Link href={`/admin/payments/${a.paymentId}`} className="font-mono text-xs text-sindoor underline">
                  {a.payment.reference}
                </Link>
                <span className="text-ink-mute">
                  {a.method} · {rs(a.amount)} · payment {a.payment.status.toLowerCase()} · {formatStamp(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-mute">None. The early-morning job re-checks open sessions with the gateways automatically.</p>
        )}
      </Panel>
    </div>
  );
}
