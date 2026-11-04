import Link from "next/link";
import { requireCompanyAdmin } from "@/lib/auth";
import { rs } from "@/lib/money";
import { formatDay, isoDate } from "@/lib/dates";
import { INVOICE_STATUS } from "@/lib/labels";
import { Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { teamInvoices } from "@/server/team";

export const metadata = { title: "Invoices" };

export default async function TeamInvoices() {
  const { company } = await requireCompanyAdmin();
  const invoices = await teamInvoices(company.id);
  return (
    <div>
      <h1 className="mb-1 font-display text-2xl font-bold">Invoices</h1>
      <p className="mb-4 text-sm text-ink-mute">Monthly invoices for the company-paid share of lunches. Terms: {company.invoiceTermsDays} days.</p>
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
    </div>
  );
}
