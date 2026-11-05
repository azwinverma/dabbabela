import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { addDays, formatDay, todayKTM } from "@/lib/dates";
import { PageHeader, Panel, RankBars } from "@/components/admin/ui";
import { Kpi, pct, Empty, Growth } from "@/components/admin/finance/kit";
import { LinkBars } from "@/components/admin/charts";
import { KPI_FORMULAS as F, actualFoodCost, alerts, cac, cohorts, customerMetrics, deliveryMetrics, mealsDue, popularBoxes, popularDishes, wasteRate } from "@/server/reports";
import { parseFilters, qs, type AnalyticsFilters } from "@/server/analytics/filters";
import { METRICS as M } from "@/server/analytics/metrics";
import { bookedByDelivery, bookings, cash, deferred, periodTiles, receivables, recognised, trendSeries } from "@/server/analytics/revenue";
import { delayedCount } from "@/server/analytics/orders";
import { churn, planStatusCounts, runRate } from "@/server/analytics/subscriptions";
import { AnalyticsFilterBar, filterOptions } from "./analytics/_components/FilterBar";

export const metadata = { title: "Dashboard" };

const drill = (f: AnalyticsFilters, basis: string, extra: Record<string, string | undefined> = {}) => `/admin/analytics/transactions?${qs(f, { basis, ...extra })}`;

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("dashboard.view");
  const sp = await searchParams;
  const f = parseFilters(sp, user);
  const opts = await filterOptions(user);
  const money = can(user, "analytics.view");
  const today = todayKTM();
  const r = { from: f.from, to: f.to, kitchenIds: f.kitchenIds };

  const [cust, waste, delivery, boxes, dishes, today_, tomorrow, al, coh, plans, ch, delayed, openAlerts] = await Promise.all([
    customerMetrics(r),
    wasteRate(r),
    deliveryMetrics(r),
    popularBoxes(r),
    popularDishes(r),
    mealsDue(today, f.kitchenIds ?? undefined),
    mealsDue(addDays(today, 1), f.kitchenIds ?? undefined),
    alerts(),
    cohorts(6, f.kitchenIds),
    planStatusCounts(f),
    churn(f),
    delayedCount(f),
    // WP-16 hand-off: open Alert rows (empty until the alerts center lands).
    db.alert.groupBy({ by: ["severity"], where: { status: { not: "RESOLVED" } }, _count: { _all: true } }),
  ]);
  const [book, cashR, rec, def, booked, recv, cost, periods, run, series, acq] = money
    ? await Promise.all([
        bookings(f),
        cash(f),
        recognised(f),
        deferred(f),
        bookedByDelivery(f),
        receivables(f),
        actualFoodCost(r),
        periodTiles(f, today),
        runRate(f, today),
        trendSeries(f, "day"),
        cac(f.to.slice(0, 7)),
      ])
    : [];
  const expectedCost = money ? await db.order.aggregate({ where: { AND: [{ status: "DELIVERED", deliveryDate: { gte: new Date(`${f.from}T00:00:00Z`), lte: new Date(`${f.to}T00:00:00Z`) } }, f.kitchenIds ? { kitchenId: { in: f.kitchenIds } } : {}] }, _sum: { costTotal: true } }) : null;
  const expected = expectedCost?._sum.costTotal ?? 0;
  const ordersByDay = money ? null : await trendSeries(f, "day");

  const alertRows = [
    al.transfers && { n: al.transfers, text: "bank transfers waiting for verification", href: "/admin/payments?view=verify", show: can(user, "payments.view") },
    al.stuckPending && { n: al.stuckPending, text: "orders stuck awaiting payment for 2h+", href: "/admin/payments?status=PENDING", show: can(user, "payments.view") },
    al.lowStock && { n: al.lowStock, text: "ingredients below safety stock", href: "/admin/inventory", show: can(user, "inventory.view") },
    delayed && { n: delayed, text: "orders delayed past their slot", href: money ? drill(f, "delayed") : "/admin/dispatch", show: money || can(user, "dispatch.view") },
    al.failedJobs && { n: al.failedJobs, text: "scheduled jobs failed in the last 24h", href: "/admin/audit", show: true },
    al.failedMessages && { n: al.failedMessages, text: "emails/SMS failed after retries", href: "/admin/notifications", show: true },
    al.openTickets && { n: al.openTickets, text: "open support tickets", href: "/admin/support", show: can(user, "support.view") },
    ...openAlerts.map((a) => ({ n: a._count._all, text: `open ${a.severity.toLowerCase()} alerts`, href: "/admin/alerts", show: can(user, "alerts.view") })),
  ].filter((x): x is { n: number; text: string; href: string; show: boolean } => Boolean(x) && Boolean((x as { show: boolean }).show));

  const capTone = (m: { meals: number; capacity: number }) => (m.capacity && m.meals / m.capacity > 0.9 ? "warn" : "default");
  const kitchenLabel = f.kitchenIds ? (f.kitchenIds.length === 1 ? (opts.kitchens.find((k) => k.id === f.kitchenIds![0])?.name ?? "1 kitchen") : `${f.kitchenIds.length} kitchens`) : "all kitchens";

  return (
    <div>
      <PageHeader
        title={`Namaste, ${user.name.split(" ")[0]}`}
        description={`${formatDay(f.from, "long")} → ${formatDay(f.to, "long")} · ${kitchenLabel}`}
        actions={
          <span className="flex gap-4">
            {money && (
              <Link href={`/admin/analytics?${qs(f)}`} className="text-sm font-semibold text-sindoor underline">
                Analytics →
              </Link>
            )}
            {can(user, "reports.view") && (
              <Link href={`/admin/reports?from=${f.from}&to=${f.to}`} className="text-sm font-semibold text-sindoor underline">
                Full reports →
              </Link>
            )}
          </span>
        }
      />
      <AnalyticsFilterBar f={f} opts={opts} action="/admin" compact />

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
        <Kpi label="Active meal plans" value={plans.active} formula={F.activePlans} sub={`${plans.paused} paused`} />
        <Kpi label="Open support tickets" value={al.openTickets} formula={F.tickets} tone={al.openTickets ? "warn" : "default"} />
      </div>

      {money && book && cashR && rec && def && booked && recv && cost && periods && run && (
        <>
          <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-ink-mute">Money</h2>
          <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Recognised revenue" value={rs(rec.value)} formula={M.recognised.definition} href={drill(f, "recognised")} tone="good" sub={`${rec.count} delivered · AOV ${rec.aov == null ? "—" : rs(rec.aov)}`} />
            <Kpi label="Bookings" value={rs(book.total)} formula={M.bookings.definition} href={drill(f, "bookings")} sub={`${rs(book.single)} single · ${rs(book.plans)} plans (once, at purchase)`} />
            <Kpi label="Net cash" value={rs(cashR.net)} formula={`${M.netCash.definition} ${M.cashIn.definition}`} href={drill(f, "cash")} sub={`${rs(cashR.collected)} in · − ${rs(cashR.refunds)} refunds`} />
            <Kpi label="Deferred revenue (now)" value={rs(def.total)} formula={M.deferred.definition} href={drill(f, "deferred")} sub={`${rs(def.plans)} prepaid plans · ${def.walletBalance == null ? "wallet n/a" : `${rs(def.walletBalance)} wallet`}`} />
            <Kpi label="Booked by delivery date" value={rs(booked.gross)} formula={F.gross} href={drill(f, "booked")} sub={`was “gross sales” · ${rs(booked.net)} after discounts & refunds`} />
            <Kpi label="Awaiting payment" value={rs(recv.pending)} formula={M.receivablesPending.definition} href={drill(f, "receivables")} sub={`${recv.pendingCount} pending${recv.invoicesOutstanding == null ? "" : ` · ${rs(recv.invoicesOutstanding)} invoices outstanding`}`} tone={recv.pendingCount ? "warn" : "default"} />
            <Kpi label="Plan run-rate (30 days)" value={rs(run.total)} formula={M.runRate.definition} href={drill(f, "runrate")} sub={`${run.planCount} plans${run.contractCount ? ` · ${run.contractCount} contracts` : ""}`} />
            <Kpi label="VAT on delivered" value={rs(rec.vat)} formula={M.recognisedVat.definition} />
            <Kpi label="Expected food cost" value={rs(expected)} formula={M.foodCostEst.definition} sub={rec.value ? `${pct(expected / rec.value)} of recognised` : undefined} />
            <Kpi label="Actual stock used" value={cost.movements ? rs(cost.total) : "—"} formula={F.actualCost} sub={cost.movements ? `${rs(cost.waste)} of it waste` : "No usage recorded yet"} />
            <Kpi label="Contribution (estimated)" value={rs(rec.value - expected)} formula="Recognised revenue − expected food cost. Before packaging, delivery, fees and overheads — see Analytics → Profitability." tone={rec.value - expected < 0 ? "bad" : "default"} sub={rec.value ? pct((rec.value - expected) / rec.value) : undefined} />
            {acq && <Kpi label={`CAC · ${acq.ym}`} value={acq.cac != null ? rs(acq.cac) : "—"} formula={F.cac} sub={acq.spend == null ? <Link className="underline" href="/admin/reports#spend">Enter marketing spend</Link> : `${rs(acq.spend)} ÷ ${acq.newCustomers} new`} />}
          </div>
          <div className="mb-5 flex flex-wrap gap-2 text-xs">
            {periods.map((p) => (
              <Link key={p.key} href={`/admin?${qs({ ...f, from: p.from, to: p.to })}`} className="rounded-lg border border-ink-line/80 bg-white px-3 py-2 hover:border-ink" title={M.recognised.definition}>
                <span className="font-semibold">{p.label}</span> <span className="tabular-nums">{rs(p.recognised)}</span> <Growth value={p.recognisedGrowth} />
              </Link>
            ))}
          </div>
        </>
      )}

      <h2 className="mb-2 font-display text-sm font-bold uppercase tracking-wide text-ink-mute">Customers & operations</h2>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Repeat customers" value={pct(cust.repeatRate)} formula={F.repeat} sub={`${cust.repeatCustomers} of ${cust.customers}`} />
        <Kpi label="Plan churn" value={pct(ch.rate, 1)} formula={M.churn.definition} sub={`${ch.cancelled} cancelled / ${ch.activeAtStart} active at start`} />
        <Kpi label="On-time delivery" value={pct(delivery.onTimeRate)} formula={F.onTime} sub={`${delivery.onTime} of ${delivery.withSlot} · ${delivery.failed} failed`} tone={delivery.failed ? "warn" : "default"} />
        <Kpi label="Kitchen waste" value={pct(waste.rate, 1)} formula={F.waste} sub={waste.batches ? `${waste.waste} of ${waste.cooked} portions` : "No batches closed yet"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={money ? "Recognised revenue by delivery day" : "Delivered orders by day"} className="lg:col-span-2">
          {(series ?? ordersByDay ?? []).some((d) => d.delivered) ? (
            <LinkBars
              ariaLabel="Daily trend"
              data={(series ?? ordersByDay ?? []).map((d) => ({ label: d.key.slice(5), value: money ? d.recognised : d.delivered, href: money ? drill({ ...f, from: d.from, to: d.to }, "recognised") : undefined }))}
              format={money ? (n) => rs(n) : (n) => `${n} orders`}
            />
          ) : (
            <Empty>No delivered orders in this range yet.</Empty>
          )}
        </Panel>
        <Panel title="Top dabbas">
          <RankBars rows={boxes.map((b) => ({ label: b.name, value: b.qty, sub: money ? rs(b.revenue) : undefined }))} />
        </Panel>
        <Panel title="Most-cooked dishes" className="lg:col-span-1">
          <RankBars rows={dishes.map((d) => ({ label: d.name, value: d.portions }))} format={(n) => `${n} portions`} />
        </Panel>
        <Panel title="Retention by first delivered month" className="lg:col-span-2" bodyClass="p-0">
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
              <p className="px-3 py-2 text-[11px] text-ink-mute">M0 = the month of the first delivered order (always 100%). Each later column is the share of that cohort with a delivered order that month.</p>
            </div>
          ) : (
            <div className="p-4">
              <Empty>Cohorts appear after the first meals are delivered.</Empty>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
