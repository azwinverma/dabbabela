import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { formatDay, formatStamp, isoDate } from "@/lib/dates";
import { METHOD_LABEL, REFUND_STATUS } from "@/lib/labels";
import { PageHeader, Panel, KV, Table, Th, Td, EmptyRow, PaymentBadge, OrderBadge } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { VerifyForms } from "../VerifyForms";
import { RefundRequestForm } from "../../refunds/RefundRequestForm";

export default async function PaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("payments.view");
  const { id } = await params;
  const p = await db.payment.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true } },
      orders: { orderBy: { deliveryDate: "asc" } },
      attempts: { orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      refunds: { orderBy: { createdAt: "desc" } },
      subscription: { select: { id: true, reference: true } },
    },
  });
  if (!p) notFound();
  const available = p.amount - p.refundedAmount - p.refunds.filter((r) => r.status === "REQUESTED" || r.status === "APPROVED").reduce((a, r) => a + r.amount, 0);

  return (
    <div>
      <PageHeader title={`Payment ${p.reference}`} back={{ href: "/admin/payments", label: "Payments" }} actions={<PaymentBadge status={p.status} />} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Summary">
          <KV
            items={[
              ["Customer", can(user.role, "customers") ? <Link className="text-sindoor underline" href={`/admin/customers/${p.user.id}`}>{p.user.name}</Link> : p.user.name],
              ["Method", METHOD_LABEL[p.method]],
              ["Amount", rs(p.amount)],
              ["Refunded", rs(p.refundedAmount)],
              ["Paid at", p.paidAt ? formatStamp(p.paidAt) : "—"],
              ["Verified by", p.verifiedById ? "Staff (see audit log)" : p.paidAt ? "Gateway server check" : "—"],
              ["Plan", p.subscription?.reference ?? "—"],
              ["Note", p.note],
              ["Created", formatStamp(p.createdAt)],
            ]}
          />
          {p.proofUrl && (
            <a href={p.proofUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-sindoor underline">
              View transfer proof
            </a>
          )}
          {p.method === "BANK_TRANSFER" && p.status === "PENDING" && can(user.role, "payments.verify") && (
            <div className="mt-4 border-t border-ink-line/60 pt-3">
              <VerifyForms id={p.id} />
            </div>
          )}
        </Panel>
        <Panel title="Orders on this payment" className="lg:col-span-2" bodyClass="p-0">
          <Table className="rounded-none border-0 shadow-none">
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th className="text-right">Customer pays</Th>
                <Th className="text-right">Company pays</Th>
              </tr>
            </thead>
            <tbody>
              {p.orders.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link href={`/admin/orders/${o.id}`} className="font-semibold text-sindoor hover:underline">
                      {o.number}
                    </Link>
                  </Td>
                  <Td>{formatDay(isoDate(o.deliveryDate))}</Td>
                  <Td>
                    <OrderBadge status={o.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{rs(o.customerShare)}</Td>
                  <Td className="text-right tabular-nums">{o.companyShare ? rs(o.companyShare) : "—"}</Td>
                </tr>
              ))}
              {!p.orders.length && <EmptyRow colSpan={5} />}
            </tbody>
          </Table>
        </Panel>

        <Panel title="Gateway attempts" className="lg:col-span-3" bodyClass="p-0">
          <Table className="rounded-none border-0 shadow-none">
            <thead>
              <tr>
                <Th>Provider ref</Th>
                <Th>Method</Th>
                <Th>Status</Th>
                <Th className="text-right">Amount</Th>
                <Th>Started</Th>
                <Th>Response</Th>
              </tr>
            </thead>
            <tbody>
              {p.attempts.map((a) => (
                <tr key={a.id}>
                  <Td className="font-mono text-xs">{a.providerRef}</Td>
                  <Td>{METHOD_LABEL[a.method]}</Td>
                  <Td>
                    <Badge tone={a.status === "SUCCESS" ? "good" : a.status === "FAILED" ? "bad" : "warn"}>{a.status.toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{rs(a.amount)}</Td>
                  <Td className="text-xs text-ink-mute">{formatStamp(a.createdAt)}</Td>
                  <Td>
                    {a.response ? (
                      <details>
                        <summary className="cursor-pointer text-xs font-semibold text-ink-soft">raw</summary>
                        <pre className="mt-1 max-h-48 max-w-md overflow-auto rounded bg-paper p-2 text-[10px]">{JSON.stringify(a.response, null, 2)}</pre>
                      </details>
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              ))}
              {!p.attempts.length && <EmptyRow colSpan={6}>No gateway sessions (cash, wallet, company or not started).</EmptyRow>}
            </tbody>
          </Table>
        </Panel>

        <Panel title="Provider events (deduplicated)" className="lg:col-span-2">
          {p.events.length ? (
            <ul className="space-y-2 text-sm">
              {p.events.map((e) => (
                <li key={e.id} className="rounded-lg border border-ink-line/60 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={e.outcome === "PAID" ? "good" : e.outcome === "MISMATCH" || e.outcome === "FAILED" ? "bad" : "neutral"}>{e.outcome ?? "—"}</Badge>
                    <span className="font-mono text-xs">{e.eventKey}</span>
                    <span className="text-xs text-ink-mute">{e.verified ? "verified" : "not verified"} · {formatStamp(e.createdAt)}</span>
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-ink-mute">payload</summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded bg-paper p-2 text-[10px]">{JSON.stringify(e.payload, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">No callbacks received for this payment.</p>
          )}
        </Panel>

        <Panel title="Refunds">
          {p.refunds.length ? (
            <ul className="mb-3 space-y-1 text-sm">
              {p.refunds.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span>
                    {rs(r.amount)} · {r.method.replace("_", " ").toLowerCase()}
                  </span>
                  <Badge tone={REFUND_STATUS[r.status].tone}>{REFUND_STATUS[r.status].label}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-ink-mute">None.</p>
          )}
          {can(user.role, "refunds.request") && ["PAID", "PARTIALLY_REFUNDED"].includes(p.status) && available > 0 && (
            <RefundRequestForm paymentId={p.id} max={available} orders={p.orders.map((o) => ({ id: o.id, label: `${o.number} · ${formatDay(isoDate(o.deliveryDate))}` }))} />
          )}
        </Panel>
      </div>
    </div>
  );
}
