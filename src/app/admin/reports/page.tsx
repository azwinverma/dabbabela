import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { rs } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Kpi } from "@/components/admin/finance/kit";
import { PrintButton } from "@/components/admin/finance/PrintButton";
import { kitchensFor } from "@/components/admin/ops/scope";
import { filterParams, parseFilters } from "@/server/analytics/filters";
import { METRICS as M } from "@/server/analytics/metrics";
import * as rev from "@/server/analytics/revenue";
import { KPI_FORMULAS } from "@/server/reports";
import { catalogue } from "@/server/reports-center";

export const metadata = { title: "Reports" };

/** Older flat CSV exports (kept for continuity; the reports below export CSV + Excel with totals). */
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
  const f = parseFilters(sp, user, 30);
  const money = can(user, "analytics.view");
  const [booked, recognised, cash, kitchens] = await Promise.all([
    rev.bookedByDelivery(f),
    money ? rev.recognised(f) : null,
    money ? rev.cash(f) : null,
    kitchensFor(user),
  ]);
  const keep = filterParams(f);
  const q = new URLSearchParams({ from: f.from, to: f.to, ...(keep.kitchen ? { kitchen: keep.kitchen } : {}) }).toString();
  const groups = catalogue(user);

  return (
    <div>
      <PageHeader
        title="Reports & exports"
        description={`${formatDay(f.from, "long")} → ${formatDay(f.to, "long")}${f.kitchenIds ? ` · ${f.kitchenIds.length === 1 ? (kitchens.find((k) => k.id === f.kitchenIds![0])?.name ?? "1 kitchen") : `${f.kitchenIds.length} kitchens`}` : " · all kitchens"}. Every figure uses the Analytics definitions.`}
        actions={<PrintButton />}
      />
      <form action="/admin/reports" method="get" className="mb-5 flex flex-wrap items-end gap-2 rounded-xl border border-ink-line/80 bg-white p-3 shadow-card print:hidden">
        <label className="text-xs font-semibold text-ink-soft">
          From
          <input type="date" name="from" defaultValue={f.from} className="field mt-1 w-40" />
        </label>
        <label className="text-xs font-semibold text-ink-soft">
          To
          <input type="date" name="to" defaultValue={f.to} className="field mt-1 w-40" />
        </label>
        {kitchens.length > 1 && (
          <label className="text-xs font-semibold text-ink-soft">
            Kitchen
            <select name="kitchen" defaultValue={keep.kitchen ?? ""} className="field mt-1 w-44">
              <option value="">All my kitchens</option>
              {kitchens.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper hover:bg-ink-soft">Apply</button>
      </form>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Orders (by delivery date)" value={booked.count.toLocaleString("en-IN")} sub="Scheduled → Delivered" formula={M.bookedByDelivery.definition} />
        {money && recognised && cash && (
          <>
            <Kpi label={M.bookedByDelivery.label} value={rs(booked.gross)} sub={`− ${rs(booked.discounts)} discounts · − ${rs(booked.refunds)} refunds = ${rs(booked.net)} booked net`} formula={`${M.bookedByDelivery.definition} Booked net: ${KPI_FORMULAS.net}`} />
            <Kpi label={M.recognised.label} value={rs(recognised.value)} sub={`${recognised.count} delivered · adjustments ${rs(recognised.adjustments)}`} formula={`${M.recognised.definition} Adjustments: ${M.recognisedAdjustments.definition}`} />
            <Kpi label={M.netCash.label} value={rs(cash.net)} sub={`${rs(cash.collected)} collected − ${rs(cash.refunds)} refunded`} formula={`${M.netCash.definition} ${M.cashIn.definition}`} />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((g) => (
          <Panel key={g.group} title={g.group}>
            <ul className="divide-y divide-ink-line/50">
              {g.reports.map((r) => (
                <li key={r.key} className="py-2">
                  <Link href={`/admin/reports/${r.key}${r.snapshot ? (keep.kitchen ? `?kitchen=${keep.kitchen}` : "") : `?${q}`}`} className="font-semibold text-ink hover:underline">
                    {r.title}
                  </Link>
                  <p className="text-xs text-ink-mute">{r.description}</p>
                </li>
              ))}
            </ul>
          </Panel>
        ))}

        <Panel title="Quick CSV exports" className="print:hidden">
          <p className="mb-3 text-xs text-ink-mute">Flat record dumps for the selected dates (your kitchens only). Phone numbers and emails are only included if your role may see customer contact details. Amounts are in rupees. Each report above also exports CSV and Excel with its totals.</p>
          <div className="flex flex-wrap gap-2">
            {EXPORTS.filter((e) => can(user, e.perm)).map((e) => (
              <a key={e.type} href={`/api/admin/export/${e.type}?${q}`} className="rounded-lg border border-ink-line bg-white px-3 py-1.5 text-sm font-semibold hover:border-ink" download>
                ↓ {e.label}
              </a>
            ))}
          </div>
        </Panel>

        {can(user, "marketing.view") && (
          <Panel title="Marketing spend (for CAC)" className="print:hidden">
            <div id="spend" />
            <p className="text-sm text-ink-soft">
              CAC now uses the spend recorded on each campaign (Σ campaign spend dated in the month). Enter spend on{" "}
              <Link href="/admin/campaigns" className="font-semibold text-sindoor underline">
                Marketing → Campaigns
              </Link>
              ; see per-campaign ROAS and CAC in the <Link href={`/admin/reports/campaign-performance?${q}`} className="font-semibold underline">campaign performance report</Link>.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}
