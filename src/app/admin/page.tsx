import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { addDays, formatDay, todayKTM } from "@/lib/dates";
import { PageHeader, Panel, BarChart, RankBars } from "@/components/admin/ui";
import { Kpi, pct, readRange, RangeForm, Empty } from "@/components/admin/finance/kit";
import {
  KPI_FORMULAS as F,
  actualFoodCost,
  alerts,
  cac,
  cohorts,
  collections,
  customerMetrics,
  dailySeries,
  deliveryMetrics,
  mealsDue,
  popularBoxes,
  popularDishes,
  salesSummary,
  wasteRate,
} from "@/server/reports";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("dashboard");
  const sp = await searchParams;
  const { from, to } = readRange(sp, 30);
  const kitchens = await db.kitchen.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  const kitchenId = sp.kitchen && kitchens.some((k) => k.id === sp.kitchen) ? sp.kitchen : (user.kitchenId ?? null);
  const r = { from, to, kitchenId };
  const money = can(user.role, "dashboard.finance");
  const today = todayKTM();

  const [sales, cash, cust, cost, waste, delivery, boxes, dishes, series, today_, tomorrow, al, coh, acq] = await Promise.all([
    salesSummary(r),
    money ? collections(r) : null,
    customerMetrics(r),
    money ? actualFoodCost(r) : null,
    wasteRate(r),
    deliveryMetrics(r),
    popularBoxes(r),
    popularDishes(r),
    dailySeries(r),
    mealsDue(today, kitchenId),
    mealsDue(addDays(today, 1), kitchenId),
    alerts(),
    cohorts(6),
    money ? cac(to.slice(0, 7)) : null,
  ]);

  const alertRows = [
    al.transfers && { n: al.transfers, text: "bank transfers waiting for verification", href: "/admin/payments?view=verify", show: can(user.role, "payments.view") },
    al.stuckPending && { n: al.stuckPending, text: "orders stuck awaiting payment for 2h+", href: "/admin/payments?status=PENDING", show: can(user.role, "payments.view") },
    al.lowStock && { n: al.lowStock, text: "ingredients below safety stock", href: "/admin/inventory", show: can(user.role, "inventory") },
    al.failedJobs && { n: al.failedJobs, text: "scheduled jobs failed in the last 24h", href: "/admin/audit", show: true },
    al.failedMessages && { n: al.failedMessages, text: "emails/SMS failed after retries", href: "/admin/notifications", show: true },
    al.openTickets && { n: al.openTickets, text: "open support tickets", href: "/admin/support", show: can(user.role, "support") },
  ].filter((x): x is { n: number; text: string; href: string; show: boolean } => Boolean(x) && Boolean((x as { show: boolean }).show));

  const capTone = (m: { meals: number; capacity: number }) => (m.capacity && m.meals / m.capacity > 0.9 ? "warn" : "default");

  return (
    <div>
      <PageHeader
        title={`Namaste, ${user.name.split(" ")[0]}`}
        description={`${formatDay(from, "long")} → ${formatDay(to, "long")} · by delivery date${kitchenId ? ` · ${kitchens.find((k) => k.id === kitchenId)?.name}` : " · all kitchens"}`}
        actions={can(user.role, "reports") ? <Link href={`/admin/reports?from=${from}&to=${to}`} className="text-sm font-semibold text-sindoor underline">Full reports →</Link> : null}
      />
      <RangeForm from={from} to={to}>
        {kitchens.length > 1 && (
          <label className="text-xs font-semibold text-ink-soft">
            Kitchen
            <select name="kitchen" defaultValue={kitchenId ?? ""} className="field mt-1 w-44">
              <option value="">All kitchens</option>
              {kitchens.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </RangeForm>

      {alertRows.length > 0 && (
        <div className="mb-5 rounded-xl border border-besar/50 bg-besar-light p-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-besar-dark">Needs attention</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {alertRows.map((a) => (
              <li key={a.text}>
                <Link href={a.href} className="font-semibold hover:underline">
                  <span className="tabular-nums">{a.n}</span> {a.text}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Meals due today" value={`${today_.meals} / ${today_.capacity}`} formula={F.meals} sub={formatDay(today)} tone={capTone(today_)} />
        <Kpi label="Meals due tomorrow" value={`${tomorrow.meals} / ${tomorrow.capacity}`} formula={F.meals} sub={formatDay(addDays(today, 1))} tone={capTone(tomorrow)} />
        <Kpi label="Active meal plans" value={cust.activePlans} formula={F.activePlans} />
        <Kpi label="Open support tickets" value={al.openTickets} formula={F.tickets} tone={al.openTickets ? "warn" : "default"} />
      </div>

      {money && cash && cost && (
        <>
          <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-ink-mute">Money</h2>
          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Gross sales" value={rs(sales.gross)} formula={F.gross} sub={`${sales.orders} orders`} />
            <Kpi label="Net sales" value={rs(sales.net)} formula={F.net} sub={`− ${rs(sales.discounts)} discounts · − ${rs(sales.refunds)} refunds`} />
            <Kpi label="Collected" value={rs(cash.collected)} formula={F.collections} sub={`${cash.paymentsCount} payments`} />
            <Kpi label="Unpaid / failed" value={rs(cash.pendingAmount)} formula={F.unpaid} sub={`${cash.pendingCount} pending · ${cash.failedCount} failed`} tone={cash.pendingCount ? "warn" : "default"} />
            <Kpi label="VAT on sales" value={rs(sales.vat)} formula={F.vat} />
            <Kpi label="Expected food cost" value={rs(sales.expectedCost)} formula={F.expectedCost} sub={sales.net ? `${pct(sales.expectedCost / sales.net)} of net` : undefined} />
            <Kpi label="Actual stock used" value={cost.movements ? rs(cost.total) : "—"} formula={F.actualCost} sub={cost.movements ? `${rs(cost.waste)} of it waste` : "No usage recorded yet"} />
            <Kpi label="Contribution margin" value={rs(sales.margin)} formula={F.margin} tone={sales.margin < 0 ? "bad" : "good"} sub={sales.net ? pct(sales.margin / sales.net) : undefined} />
          </div>
        </>
      )}

      <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-ink-mute">Customers & operations</h2>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Repeat customers" value={pct(cust.repeatRate)} formula={F.repeat} sub={`${cust.repeatCustomers} of ${cust.customers}`} />
        <Kpi label="Plan churn" value={pct(cust.churn, 1)} formula={F.churn} sub={`${cust.plansCancelled} cancelled / ${cust.plansActiveAtStart} active at start`} />
        <Kpi label="On-time delivery" value={pct(delivery.onTimeRate)} formula={F.onTime} sub={`${delivery.onTime} of ${delivery.withSlot} · ${delivery.failed} failed`} tone={delivery.failed ? "warn" : "default"} />
        <Kpi label="Kitchen waste" value={pct(waste.rate, 1)} formula={F.waste} sub={waste.batches ? `${waste.waste} of ${waste.cooked} portions` : "No batches closed yet"} />
        {money && acq && <Kpi label={`CAC · ${acq.ym}`} value={acq.cac != null ? rs(acq.cac) : "—"} formula={F.cac} sub={acq.spend == null ? <Link className="underline" href="/admin/reports#spend">Enter marketing spend</Link> : `${rs(acq.spend)} ÷ ${acq.newCustomers} new`} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={money ? "Sales by day" : "Orders by day"} className="lg:col-span-2">
          {series.some((d) => d.orders) ? (
            <BarChart data={series.map((d) => ({ label: d.date.slice(5), value: money ? d.total : d.orders }))} format={money ? (n) => rs(n) : String} color="#8B2923" />
          ) : (
            <Empty>No orders in this range yet.</Empty>
          )}
        </Panel>
        <Panel title="Top dabbas">
          <RankBars rows={boxes.map((b) => ({ label: b.name, value: b.qty, sub: money ? rs(b.revenue) : undefined }))} />
        </Panel>
        <Panel title="Most-cooked dishes" className="lg:col-span-1">
          <RankBars rows={dishes.map((d) => ({ label: d.name, value: d.portions }))} format={(n) => `${n} portions`} />
        </Panel>
        <Panel title="Retention by first-order month" className="lg:col-span-2" bodyClass="p-0">
          {coh.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-ink-mute">
                    <th className="px-3 py-2">Cohort</th>
                    <th className="px-3 py-2">Customers</th>
                    {coh[0].cells.map((_, i) => (
                      <th key={i} className="px-2 py-2 text-center">
                        M{i}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coh.map((c) => (
                    <tr key={c.cohort} className="border-t border-ink-line/50">
                      <td className="px-3 py-1.5 font-semibold">{c.cohort}</td>
                      <td className="px-3 py-1.5 tabular-nums">{c.size}</td>
                      {c.cells.map((v, i) => (
                        <td key={i} className="px-1 py-1 text-center tabular-nums">
                          {v == null ? (
                            <span className="text-ink-line">·</span>
                          ) : (
                            <span className="inline-block min-w-10 rounded px-1 py-0.5" style={{ background: `rgba(59,98,69,${0.12 + v * 0.75})`, color: v > 0.5 ? "#fff" : "#27221D" }}>
                              {Math.round(v * 100)}%
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 py-2 text-[11px] text-ink-mute">M0 = the month of the first order (always 100%). Each later column is the share of that cohort who ordered again that month.</p>
            </div>
          ) : (
            <div className="p-4">
              <Empty>Cohorts appear after customers start ordering.</Empty>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
