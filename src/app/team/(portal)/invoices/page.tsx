import Link from "next/link";
import { requireCompanyAdmin } from "@/lib/auth";
import { rs } from "@/lib/money";
import { formatDay, isoDate, todayKTM } from "@/lib/dates";
import { INVOICE_STATUS } from "@/lib/labels";
import { Table, Th, Td, EmptyRow, Panel, Callout } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { teamInvoices, teamPayments } from "@/server/team";
import { creditTermsOn } from "@/server/corporate";

export const metadata = { title: "Invoices" };

export default async function TeamInvoices() {
  const { company } = await requireCompanyAdmin();
  const [invoices, { unpaid, history }, terms] = await Promise.all([teamInvoices(company.id), teamPayments(company.id), creditTermsOn(company.id, todayKTM())]);
  const owed = unpaid.reduce((a, u) => a + u.outstanding, 0);
  const overdue = unpaid.filter((u) => u.overdueDays > 0);
  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-bold">Invoices</h1>
      <p className="mb-4 text-sm text-ink-mute">Monthly invoices for the company-paid share of lunches. Credit terms: {terms} days from issue.</p>
      {unpaid.length > 0 && (
        <Callout tone={overdue.length ? "bad" : "info"} title={`${rs(owed)} unpaid on ${unpaid.length} invoice${unpaid.length === 1 ? "" : "s"}`} className="mb-4">
          {overdue.length ? overdue.map((u) => `${u.number} is ${u.overdueDays} days overdue (${rs(u.outstanding)})`).join(" · ") : "Nothing overdue."}
        </Callout>
      )}
      <Table>
        <thead>
          <tr>
            <Th>Number</Th>
            <Th>Period</Th>
            <Th>Status</Th>
            <Th className="text-right">Total</Th>
            <Th className="text-right">Balance</Th>
            <Th>Due</Th>
          </tr>
        </thead>
        <tbody>
          {invoices.length ? (
            invoices.map((i) => (
              <tr key={i.id}>
                <Td>
                  <Link href={`/team/invoices/${i.id}`} className="font-mono text-xs font-semibold text-sindoor hover:underline">
                    {i.number}
                  </Link>
                  {i.kind === "CREDIT_NOTE" && <span className="ml-1 text-[10px] uppercase text-ink-mute">credit note</span>}
                </Td>
                <Td className="text-xs">
                  {formatDay(isoDate(i.periodStart))} – {formatDay(isoDate(i.periodEnd))}
                </Td>
                <Td>
                  <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
                </Td>
                <Td className="text-right tabular-nums">{rs(i.total)}</Td>
                <Td className="text-right tabular-nums">{i.kind === "INVOICE" ? rs(i.total - i.paidAmount) : "—"}</Td>
                <Td className="text-xs">{i.dueDate ? formatDay(isoDate(i.dueDate)) : "—"}</Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={6}>No invoices yet. They&apos;re issued after each month.</EmptyRow>
          )}
        </tbody>
      </Table>
      <Panel title="Payments we've recorded" className="mt-4" bodyClass="p-0">
        <Table className="rounded-none border-0 shadow-none">
          <thead>
            <tr>
              <Th>Recorded on</Th>
              <Th>Invoice</Th>
              <Th>Amount · reference</Th>
            </tr>
          </thead>
          <tbody>
            {history.length ? (
              history.map((p, i) => (
                <tr key={i}>
                  <Td className="text-xs">{formatDay(p.at.toISOString().slice(0, 10))}</Td>
                  <Td className="font-mono text-xs">{p.number}</Td>
                  <Td className="text-xs">{p.summary}</Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={3}>No payments recorded yet.</EmptyRow>
            )}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
