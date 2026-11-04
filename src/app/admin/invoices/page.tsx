import Link from "next/link";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { formatDay, isoDate, monthRange, todayKTM, addDays } from "@/lib/dates";
import { INVOICE_STATUS } from "@/lib/labels";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { Kpi } from "@/components/admin/finance/kit";
import { ageing, uninvoicedByCompany } from "@/server/invoices";
import { GenerateForm } from "./InvoiceForms";

export const metadata = { title: "Invoices" };

export default async function Invoices({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("invoices.view");
  const sp = await searchParams;
  const prev = monthRange(addDays(`${todayKTM().slice(0, 7)}-01`, -1).slice(0, 7));
  const where: Prisma.InvoiceWhereInput = {
    ...(sp.status && sp.status in INVOICE_STATUS ? { status: sp.status as InvoiceStatus } : {}),
    ...(sp.company ? { companyId: sp.company } : {}),
    ...(sp.q ? { OR: [{ number: { contains: sp.q, mode: "insensitive" } }, { billingName: { contains: sp.q, mode: "insensitive" } }] } : {}),
  };
  const [companies, pending, ag, invoices] = await Promise.all([
    db.company.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    uninvoicedByCompany(),
    ageing(),
    db.invoice.findMany({ where, include: { company: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);

  return (
    <div>
      <PageHeader title="Invoices" description="Monthly invoices for the employer-paid share of company lunches. Generating twice for the same period never double-bills: billed meals are linked to their invoice." />
      <div className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Outstanding" value={rs(ag.buckets.total)} />
        <Kpi label="Not yet due" value={rs(ag.buckets.current)} />
        <Kpi label="1–30 days late" value={rs(ag.buckets.d30)} tone={ag.buckets.d30 ? "warn" : "default"} />
        <Kpi label="31–60 days" value={rs(ag.buckets.d60)} tone={ag.buckets.d60 ? "warn" : "default"} />
        <Kpi label="61–90 days" value={rs(ag.buckets.d90)} tone={ag.buckets.d90 ? "bad" : "default"} />
        <Kpi label="90+ days" value={rs(ag.buckets.over90)} tone={ag.buckets.over90 ? "bad" : "default"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Create an invoice" className="lg:col-span-2">
          <GenerateForm companies={companies} from={prev.start} to={prev.end} />
          <p className="mt-2 text-xs text-ink-mute">Includes every company-paid meal in the period that is due (today or earlier), not cancelled or skipped, and not already on an invoice. You get a draft to check before issuing.</p>
        </Panel>
        <Panel title="Not yet invoiced">
          {pending.length ? (
            <ul className="divide-y divide-ink-line/50 text-sm">
              {pending.map((p) => (
                <li key={p.companyId} className="flex justify-between gap-2 py-1.5">
                  <span>
                    {p.name}
                    <span className="block text-xs text-ink-mute">
                      {p.orders} orders · {p.from && formatDay(p.from)} – {p.to && formatDay(p.to)}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{rs(p.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">Everything company-paid so far is invoiced.</p>
          )}
        </Panel>
      </div>

      <form className="my-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Number or billing name" className="field max-w-xs" />
        <select name="status" defaultValue={sp.status ?? ""} className="field w-40">
          <option value="">Any status</option>
          {Object.entries(INVOICE_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select name="company" defaultValue={sp.company ?? ""} className="field w-52">
          <option value="">All companies</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Filter</button>
      </form>
      <Table>
        <thead>
          <tr>
            <Th>Number</Th>
            <Th>Company</Th>
            <Th>Period</Th>
            <Th>Status</Th>
            <Th className="text-right">Total</Th>
            <Th className="text-right">Paid</Th>
            <Th>Due</Th>
          </tr>
        </thead>
        <tbody>
          {invoices.length ? (
            invoices.map((i) => (
              <tr key={i.id} className="hover:bg-paper/40">
                <Td>
                  <Link href={`/admin/invoices/${i.id}`} className="font-mono text-xs font-semibold text-sindoor hover:underline">
                    {i.number}
                  </Link>
                  {i.kind === "CREDIT_NOTE" && <span className="ml-1 text-[10px] font-bold uppercase text-ink-mute">credit note</span>}
                </Td>
                <Td>{i.company?.name ?? i.billingName}</Td>
                <Td className="text-xs">
                  {formatDay(isoDate(i.periodStart))} – {formatDay(isoDate(i.periodEnd))}
                </Td>
                <Td>
                  <Badge tone={INVOICE_STATUS[i.status].tone}>{INVOICE_STATUS[i.status].label}</Badge>
                </Td>
                <Td className="text-right tabular-nums">{rs(i.total)}</Td>
                <Td className="text-right tabular-nums">{i.kind === "INVOICE" ? rs(i.paidAmount) : "—"}</Td>
                <Td className="text-xs">{i.dueDate ? formatDay(isoDate(i.dueDate)) : "—"}</Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={7}>No invoices yet.</EmptyRow>
          )}
        </tbody>
      </Table>
    </div>
  );
}
