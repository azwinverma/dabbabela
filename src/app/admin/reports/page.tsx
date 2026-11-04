import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { dateOnly, formatDay } from "@/lib/dates";
import { METHOD_LABEL } from "@/lib/labels";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { readRange, RangeForm, pct } from "@/components/admin/finance/kit";
import { PrintButton } from "@/components/admin/finance/PrintButton";
import { collections, dailySeries, marketingSpend, popularBoxes, salesSummary, KPI_FORMULAS } from "@/server/reports";
import { REVENUE_STATUSES } from "@/server/transitions";
import { SpendForm } from "./SpendForm";

export const metadata = { title: "Reports" };

const EXPORTS: { type: string; label: string; perm: Parameters<typeof can>[1] }[] = [
  { type: "orders", label: "Orders", perm: "reports.export" },
  { type: "order-items", label: "Order items", perm: "reports.export" },
  { type: "dish-sales", label: "Dish sales", perm: "reports.export" },
  { type: "subscriptions", label: "Meal plans", perm: "reports.export" },
  { type: "payments", label: "Payments", perm: "payments.view" },
  { type: "refunds", label: "Refunds", perm: "refunds.view" },
  { type: "ledger", label: "Credit ledger", perm: "refunds.view" },
  { type: "invoices", label: "Invoices", perm: "invoices.view" },
  { type: "customers", label: "Customers", perm: "customers.view" },
  { type: "stock", label: "Stock movements", perm: "inventory.export" },
];

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("reports.view");
  const sp = await searchParams;
  const { from, to } = readRange(sp, 30);
  const r = { from, to };
  const money = can(user, "analytics.view");
  const where = { deliveryDate: { gte: dateOnly(from), lte: dateOnly(to) }, status: { in: REVENUE_STATUSES } };
  const [sales, cash, boxes, series, byZone, byCompany, byKitchen, bySource, spend] = await Promise.all([
    salesSummary(r),
    money ? collections(r) : null,
    popularBoxes(r, 30),
    dailySeries(r),
    db.order.groupBy({ by: ["zoneId"], where, _sum: { total: true }, _count: true }),
    db.order.groupBy({ by: ["companyId"], where: { ...where, companyId: { not: null } }, _sum: { total: true, companyShare: true }, _count: true }),
    db.order.groupBy({ by: ["kitchenId"], where, _sum: { total: true, costTotal: true }, _count: true }),
    db.order.groupBy({ by: ["source"], where, _sum: { total: true }, _count: true }),
    money ? marketingSpend() : Promise.resolve({} as Record<string, number>),
  ]);
  const [zones, companies, kitchens] = await Promise.all([
    db.deliveryZone.findMany({ select: { id: true, name: true } }),
    db.company.findMany({ where: { id: { in: byCompany.map((c) => c.companyId!) } }, select: { id: true, name: true } }),
    db.kitchen.findMany({ select: { id: true, name: true } }),
  ]);
  const qs = `from=${from}&to=${to}`;

  return (
    <div>
      <PageHeader title="Reports & exports" description={`${formatDay(from, "long")} → ${formatDay(to, "long")}, by delivery date. Cancelled and skipped orders are excluded.`} actions={<PrintButton />} />
      <RangeForm from={from} to={to} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Summary">
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-ink-mute">Orders</dt>
            <dd className="text-right font-semibold tabular-nums">{sales.orders}</dd>
            {money && (
              <>
                <dt className="text-ink-mute" title={KPI_FORMULAS.gross}>Gross sales</dt>
                <dd className="text-right font-semibold tabular-nums">{rs(sales.gross)}</dd>
                <dt className="text-ink-mute">Discounts</dt>
                <dd className="text-right tabular-nums">− {rs(sales.discounts)}</dd>
                <dt className="text-ink-mute">Refunds / credit</dt>
                <dd className="text-right tabular-nums">− {rs(sales.refunds)}</dd>
                <dt className="font-semibold" title={KPI_FORMULAS.net}>Net sales</dt>
                <dd className="text-right font-bold tabular-nums">{rs(sales.net)}</dd>
                <dt className="text-ink-mute">VAT inside net</dt>
                <dd className="text-right tabular-nums">{rs(sales.vat)}</dd>
                <dt className="text-ink-mute">Employer-paid share</dt>
                <dd className="text-right tabular-nums">{rs(sales.companyShare)}</dd>
                <dt className="text-ink-mute" title={KPI_FORMULAS.expectedCost}>Expected food cost</dt>
                <dd className="text-right tabular-nums">{rs(sales.expectedCost)}</dd>
                <dt className="font-semibold" title={KPI_FORMULAS.margin}>Contribution margin</dt>
                <dd className="text-right font-bold tabular-nums">
                  {rs(sales.margin)} <span className="text-xs font-normal text-ink-mute">{sales.net ? pct(sales.margin / sales.net) : ""}</span>
                </dd>
              </>
            )}
          </dl>
        </Panel>
        {money && cash && (
          <Panel title="Collections by method (by date paid)">
            <Table className="shadow-none">
              <thead>
                <tr>
                  <Th>Method</Th>
                  <Th className="text-right">Payments</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {cash.byMethod.length ? (
                  cash.byMethod.map((m) => (
                    <tr key={m.method}>
                      <Td>{METHOD_LABEL[m.method]}</Td>
                      <Td className="text-right tabular-nums">{m.count}</Td>
                      <Td className="text-right tabular-nums">{rs(m.amount)}</Td>
                    </tr>
                  ))
                ) : (
                  <EmptyRow colSpan={3}>No payments collected in this range.</EmptyRow>
                )}
              </tbody>
            </Table>
          </Panel>
        )}

        <Panel title="By dabba" className="lg:col-span-2" bodyClass="p-0">
          <Table className="rounded-none border-0 shadow-none">
            <thead>
              <tr>
                <Th>Dabba</Th>
                <Th className="text-right">Sold</Th>
                {money && <Th className="text-right">Revenue</Th>}
              </tr>
            </thead>
            <tbody>
              {boxes.length ? (
                boxes.map((b) => (
                  <tr key={b.name}>
                    <Td>{b.name}</Td>
                    <Td className="text-right tabular-nums">{b.qty}</Td>
                    {money && <Td className="text-right tabular-nums">{rs(b.revenue)}</Td>}
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={3} />
              )}
            </tbody>
          </Table>
        </Panel>

        {[
          { title: "By delivery zone", rows: byZone.map((z) => ({ k: zones.find((x) => x.id === z.zoneId)?.name ?? "No zone", n: z._count, v: z._sum.total ?? 0 })) },
          { title: "By kitchen", rows: byKitchen.map((z) => ({ k: kitchens.find((x) => x.id === z.kitchenId)?.name ?? "—", n: z._count, v: z._sum.total ?? 0 })) },
          { title: "By company (employer share)", rows: byCompany.map((z) => ({ k: companies.find((x) => x.id === z.companyId)?.name ?? "—", n: z._count, v: z._sum.companyShare ?? 0 })) },
          { title: "By channel", rows: bySource.map((z) => ({ k: z.source.toLowerCase(), n: z._count, v: z._sum.total ?? 0 })) },
        ].map((t) => (
          <Panel key={t.title} title={t.title} bodyClass="p-0">
            <Table className="rounded-none border-0 shadow-none">
              <tbody>
                {t.rows.length ? (
                  t.rows
                    .sort((a, b) => b.v - a.v)
                    .map((row) => (
                      <tr key={row.k}>
                        <Td className="capitalize">{row.k}</Td>
                        <Td className="text-right tabular-nums">{row.n} orders</Td>
                        {money && <Td className="text-right tabular-nums">{rs(row.v)}</Td>}
                      </tr>
                    ))
                ) : (
                  <EmptyRow colSpan={3} />
                )}
              </tbody>
            </Table>
          </Panel>
        ))}

        <Panel title="Daily" className="lg:col-span-2" bodyClass="p-0">
          <Table className="rounded-none border-0 shadow-none">
            <thead>
              <tr>
                <Th>Date</Th>
                <Th className="text-right">Orders</Th>
                {money && <Th className="text-right">Sales</Th>}
              </tr>
            </thead>
            <tbody>
              {series.map((d) => (
                <tr key={d.date}>
                  <Td>{formatDay(d.date)}</Td>
                  <Td className="text-right tabular-nums">{d.orders}</Td>
                  {money && <Td className="text-right tabular-nums">{rs(d.total)}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <Panel title="CSV exports" className="print:hidden">
          <p className="mb-3 text-xs text-ink-mute">For the selected dates. Phone numbers and emails are only included if your role may see customer contact details. Amounts are in rupees.</p>
          <div className="flex flex-wrap gap-2">
            {EXPORTS.filter((e) => can(user, e.perm)).map((e) => (
              <Link key={e.type} href={`/api/admin/export/${e.type}?${qs}`} prefetch={false} className="rounded-lg border border-ink-line bg-white px-3 py-1.5 text-sm font-semibold hover:border-ink">
                ↓ {e.label}
              </Link>
            ))}
          </div>
        </Panel>

        {money && (
          <Panel title="Marketing spend (for CAC)" className="print:hidden">
            <div id="spend" />
            <SpendForm ym={to.slice(0, 7)} />
            {Object.keys(spend).length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {Object.entries(spend)
                  .sort((a, b) => b[0].localeCompare(a[0]))
                  .slice(0, 12)
                  .map(([m, v]) => (
                    <li key={m} className="flex justify-between border-b border-ink-line/40 py-1">
                      <span>{m}</span>
                      <span className="tabular-nums">{rs(v)}</span>
                    </li>
                  ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
