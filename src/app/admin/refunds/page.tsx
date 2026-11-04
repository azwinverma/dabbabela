import Link from "next/link";
import type { RefundStatus } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { formatStamp } from "@/lib/dates";
import { maskEmail } from "@/lib/phone";
import { REFUND_STATUS } from "@/lib/labels";
import { PageHeader, Table, Th, Td, EmptyRow, Tabs, Panel } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { walletBalance } from "@/server/ledger";
import { ApproveButton, RejectForm, ProcessForm, AdjustForm } from "./RefundForms";

export const metadata = { title: "Refunds & credit" };

export default async function Refunds({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("refunds.view");
  const sp = await searchParams;
  const view = sp.view ?? "REQUESTED";
  const approver = can(user, "refunds.approve");
  const counts = await db.refund.groupBy({ by: ["status"], _count: true });
  const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const tabs = [
    ...(["REQUESTED", "APPROVED", "PROCESSED", "REJECTED"] as RefundStatus[]).map((s) => ({ key: s, label: REFUND_STATUS[s].label, href: `/admin/refunds?view=${s}`, count: s === "REQUESTED" || s === "APPROVED" ? n(s) : undefined })),
    { key: "ledger", label: "Wallet ledger", href: "/admin/refunds?view=ledger" },
  ];

  return (
    <div>
      <PageHeader title="Refunds & credit" description="Requested → approved by finance → processed with proof. Money is never marked returned without a transaction reference or receipt (wallet credit is posted to the ledger)." />
      <Tabs tabs={tabs} current={view} />
      {view === "ledger" ? <Ledger q={sp.q} canAdjust={approver} pii={can(user, "customers.pii")} /> : <Queue status={view as RefundStatus} approver={approver} />}
    </div>
  );
}

async function Queue({ status, approver }: { status: RefundStatus; approver: boolean }) {
  const rows = await db.refund.findMany({
    where: { status: status in REFUND_STATUS ? status : "REQUESTED" },
    include: { payment: { select: { id: true, reference: true, method: true, user: { select: { name: true } } } }, order: { select: { id: true, number: true } } },
    orderBy: { createdAt: status === "REQUESTED" || status === "APPROVED" ? "asc" : "desc" },
    take: 100,
  });
  return (
    <Table>
      <thead>
        <tr>
          <Th>Payment</Th>
          <Th>Customer</Th>
          <Th>Order</Th>
          <Th className="text-right">Amount</Th>
          <Th>Back via</Th>
          <Th>Reason</Th>
          <Th>{status === "PROCESSED" ? "Proof" : "Requested"}</Th>
          {(status === "REQUESTED" || status === "APPROVED") && <Th>Action</Th>}
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((r) => (
            <tr key={r.id} className="align-top">
              <Td>
                <Link href={`/admin/payments/${r.payment.id}`} className="font-mono text-xs text-sindoor hover:underline">
                  {r.payment.reference}
                </Link>
                <div className="text-xs text-ink-mute">{r.payment.method}</div>
              </Td>
              <Td>{r.payment.user.name}</Td>
              <Td>{r.order ? <Link href={`/admin/orders/${r.order.id}`} className="hover:underline">{r.order.number}</Link> : "Whole payment"}</Td>
              <Td className="text-right font-semibold tabular-nums">{rs(r.amount)}</Td>
              <Td>
                <Badge tone="neutral">{r.method.replace("_", " ").toLowerCase()}</Badge>
              </Td>
              <Td className="max-w-56 text-xs">{r.reason}{r.note ? <div className="text-ink-mute">{r.note}</div> : null}</Td>
              <Td className="text-xs text-ink-mute">
                {status === "PROCESSED" ? (
                  <>
                    {r.providerRef && <div className="font-mono">{r.providerRef}</div>}
                    {r.proofUrl && <a className="text-sindoor underline" href={r.proofUrl} target="_blank" rel="noreferrer">receipt</a>}
                    {!r.providerRef && !r.proofUrl && "Wallet ledger"}
                    <div>{r.processedAt ? formatStamp(r.processedAt) : ""}</div>
                  </>
                ) : (
                  formatStamp(r.createdAt)
                )}
              </Td>
              {(status === "REQUESTED" || status === "APPROVED") && (
                <Td>
                  {approver ? (
                    <div className="flex flex-col gap-2">
                      {status === "REQUESTED" && <ApproveButton id={r.id} />}
                      {status === "APPROVED" && <ProcessForm id={r.id} wallet={r.method === "WALLET_CREDIT"} />}
                      <RejectForm id={r.id} />
                    </div>
                  ) : (
                    <span className="text-xs text-ink-mute">Waiting for finance</span>
                  )}
                </Td>
              )}
            </tr>
          ))
        ) : (
          <EmptyRow colSpan={8}>Nothing in this queue.</EmptyRow>
        )}
      </tbody>
    </Table>
  );
}

async function Ledger({ q, canAdjust, pii }: { q?: string; canAdjust: boolean; pii: boolean }) {
  const customers = q
    ? await db.user.findMany({
        where: { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phoneNumber: { contains: q.replace(/\D/g, "") || q } }] },
        select: { id: true, name: true, email: true },
        take: 10,
      })
    : [];
  const one = customers.length === 1 ? customers[0] : null;
  const [entries, balance] = one ? await Promise.all([db.creditLedger.findMany({ where: { userId: one.id }, orderBy: { createdAt: "desc" }, take: 100 }), walletBalance(one.id)]) : [[], 0];
  const recent = !q ? await db.creditLedger.findMany({ include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 30 }) : [];
  return (
    <div className="space-y-4">
      <form className="flex gap-2">
        <input type="hidden" name="view" value="ledger" />
        <input name="q" defaultValue={q} placeholder="Find a customer by name, email or phone" className="field max-w-sm" />
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Search</button>
      </form>
      {q && customers.length > 1 && (
        <ul className="flex flex-wrap gap-2 text-sm">
          {customers.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/refunds?view=ledger&q=${encodeURIComponent(c.email)}`} className="rounded-full border border-ink-line bg-white px-3 py-1 hover:border-ink">
                {c.name} · {pii ? c.email : maskEmail(c.email)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {q && !customers.length && <p className="text-sm text-ink-mute">No customer matches.</p>}
      {one && (
        <Panel title={`${one.name} — balance ${rs(balance)}`} actions={canAdjust ? <AdjustForm userId={one.id} /> : null} bodyClass="p-0">
          <LedgerTable rows={entries.map((e) => ({ ...e, who: null }))} />
        </Panel>
      )}
      {!q && (
        <Panel title="Latest ledger entries" bodyClass="p-0">
          <LedgerTable rows={recent.map((e) => ({ ...e, who: e.user.name }))} />
        </Panel>
      )}
    </div>
  );
}

function LedgerTable({ rows }: { rows: { id: string; createdAt: Date; amount: number; reason: string; note: string | null; orderId: string | null; who: string | null }[] }) {
  return (
    <Table className="rounded-none border-0 shadow-none">
      <thead>
        <tr>
          <Th>When</Th>
          {rows.some((r) => r.who) && <Th>Customer</Th>}
          <Th>Reason</Th>
          <Th>Note</Th>
          <Th className="text-right">Amount</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          rows.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap text-xs text-ink-mute">{formatStamp(e.createdAt)}</Td>
              {e.who && <Td>{e.who}</Td>}
              <Td className="text-xs font-semibold">{e.reason.replace(/_/g, " ").toLowerCase()}</Td>
              <Td className="text-xs">
                {e.note}
                {e.orderId && (
                  <Link href={`/admin/orders/${e.orderId}`} className="ml-1 text-sindoor underline">
                    order
                  </Link>
                )}
              </Td>
              <Td className={`text-right font-semibold tabular-nums ${e.amount < 0 ? "text-sindoor" : "text-saag"}`}>
                {e.amount > 0 ? "+" : ""}
                {rs(e.amount)}
              </Td>
            </tr>
          ))
        ) : (
          <EmptyRow colSpan={5}>No ledger entries.</EmptyRow>
        )}
      </tbody>
    </Table>
  );
}
