import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { rs } from "@/lib/money";
import { addDays, formatDay, todayKTM } from "@/lib/dates";
import { SUB_STATUS } from "@/lib/labels";
import { PageHeader, Panel, Tabs, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Kpi, Growth, MaybeMoney, pct, Empty } from "@/components/admin/finance/kit";
import { LinkBars, LinkRank } from "@/components/admin/charts";
import { piiFor } from "@/components/admin/ops/scope";
import { parseFilters, qs, isFiltered, type AnalyticsFilters } from "@/server/analytics/filters";
import { METRICS as M } from "@/server/analytics/metrics";
import * as rev from "@/server/analytics/revenue";
import * as ops from "@/server/analytics/orders";
import * as subs from "@/server/analytics/subscriptions";
import * as cust from "@/server/analytics/customers";
import { AnalyticsFilterBar, filterOptions } from "./_components/FilterBar";

export const metadata = { title: "Analytics" };

type SP = Record<string, string | undefined>;
const TABS = [
  { key: "revenue", label: "Revenue" },
  { key: "operations", label: "Orders & plans" },
  { key: "customers", label: "Customers" },
  { key: "profit", label: "Profitability" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const drill = (f: AnalyticsFilters, basis: string, extra: Record<string, string | undefined> = {}) => `/admin/analytics/transactions?${qs(f, { basis, ...extra })}`;
const H = ({ children }: { children: React.ReactNode }) => <h2 className="mb-2 mt-6 font-display text-sm font-bold uppercase tracking-wide text-ink-mute first:mt-0">{children}</h2>;
const grid4 = "mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("analytics.view");
  const sp = await searchParams;
  const f = parseFilters(sp, user);
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "revenue";
  const opts = await filterOptions(user);
  const canExport = can(user, "analytics.export");

  return (
    <div>
      <PageHeader
        title="Analytics"
        description={`${formatDay(f.from, "long")} → ${formatDay(f.to, "long")} · ${f.kitchenIds ? (f.kitchenIds.length === 1 ? (opts.kitchens.find((k) => k.id === f.kitchenIds![0])?.name ?? "1 kitchen") : `${f.kitchenIds.length} kitchens`) : "all kitchens"} · every number links to its records`}
        actions={
          canExport ? (
            <span className="flex flex-wrap gap-2 text-sm">
              <a className="font-semibold text-sindoor underline" href={`/admin/analytics/export?${qs(f, { basis: "recognised" })}`}>
                Export delivered orders (CSV)
              </a>
            </span>
          ) : null
        }
      />
      <AnalyticsFilterBar f={f} opts={opts} action="/admin/analytics" hidden={{ tab }} />
      <Tabs current={tab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/admin/analytics?${qs(f, { tab: t.key })}` }))} />
      {tab === "revenue" && <RevenueTab f={f} bucket={(rev.BUCKETS as string[]).includes(sp.bucket ?? "") ? (sp.bucket as rev.Bucket) : undefined} series={sp.series} />}
      {tab === "operations" && <OperationsTab f={f} />}
      {tab === "customers" && <CustomersTab f={f} pii={piiFor(user)} />}
      {tab === "profit" && <ProfitTab f={f} />}
    </div>
  );
}

async function RevenueTab({ f, bucket: b, series }: { f: AnalyticsFilters; bucket?: rev.Bucket; series?: string }) {
  const days = Math.round((Date.parse(f.to) - Date.parse(f.from)) / 86_400_000) + 1;
  const bucket: rev.Bucket = b ?? (days > 120 ? "month" : days > 45 ? "week" : "day");
  const s = series === "bookings" || series === "cash" ? series : "recognised";
  const [periods, book, cash, rec, up, def, canc, booked, recv, trend, plan, planBook, cat, method, kitchen, zone, company, channel] = await Promise.all([
    rev.periodTiles(f),
    rev.bookings(f),
    rev.cash(f),
    rev.recognised(f),
    rev.upcoming(f),
    rev.deferred(f),
    rev.cancelled(f),
    rev.bookedByDelivery(f),
    rev.receivables(f),
    rev.trendSeries(f, bucket),
    rev.byPlan(f),
    rev.planBookingsByPlan(f),
    rev.byCategory(f),
    rev.cashByMethod(f),
    rev.byKitchen(f),
    rev.byZone(f),
    rev.byCompany(f),
    rev.byChannel(f),
  ]);
  const seriesBasis = { recognised: "recognised", bookings: "bookings", cash: "cash" }[s];
  const row = (basis: string, key: string) => (r: rev.BreakdownRow) => ({ label: r.label, value: r.value, sub: `${r.count}`, href: drill(f, basis, { [key]: r.key }) });

  return (
    <>
      <H>Periods (same filters, ignoring the date range)</H>
      <div className="mb-4 overflow-x-auto rounded-xl border border-ink-line/80 bg-white shadow-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-mute">
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2" title={M.bookings.definition}>Bookings</th>
              <th className="px-3 py-2" title={M.recognised.definition}>Recognised</th>
              <th className="px-3 py-2" title={M.netCash.definition}>Net cash</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const pf = { ...f, from: p.from, to: p.to };
              return (
                <tr key={p.key} className="border-t border-ink-line/50">
                  <td className="px-3 py-2">
                    <Link className="font-semibold hover:underline" href={`/admin/analytics?${qs(pf)}`}>
                      {p.label}
                    </Link>
                    <span className="ml-1 text-xs text-ink-mute">vs {p.prevFrom === p.prevTo ? formatDay(p.prevFrom) : `${formatDay(p.prevFrom)} – ${formatDay(p.prevTo)}`}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    <Link className="hover:underline" href={drill(pf, "bookings")}>{rs(p.bookings)}</Link> <span className="text-xs"><Growth value={p.bookingsGrowth} /></span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    <Link className="hover:underline" href={drill(pf, "recognised")}>{rs(p.recognised)}</Link> <span className="text-xs"><Growth value={p.recognisedGrowth} /></span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    <Link className="hover:underline" href={drill(pf, "cash")}>{rs(p.cash)}</Link> <span className="text-xs"><Growth value={p.cashGrowth} /></span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <H>Four revenue bases — different questions, never add them up</H>
      <div className={grid4}>
        <Kpi label="Bookings" value={rs(book.total)} formula={M.bookings.definition} href={drill(f, "bookings")} sub={<><Link className="underline" href={drill(f, "bookings")}>{rs(book.single)} single ({book.singleCount})</Link> · <Link className="underline" href={drill(f, "plans")}>{rs(book.plans)} plans ({book.planCount})</Link></>} />
        <Kpi label="Net cash" value={rs(cash.net)} formula={`${M.netCash.definition} ${M.cashIn.definition} ${M.refundsOut.definition}`} href={drill(f, "cash")} sub={<><Link className="underline" href={drill(f, "cash")}>{rs(cash.collected)} in</Link> · <Link className="underline" href={drill(f, "refunds")}>− {rs(cash.refunds)} refunds</Link></>} />
        <Kpi label="Recognised revenue" value={rs(rec.value)} formula={M.recognised.definition} href={drill(f, "recognised")} tone="good" sub={`${rec.count} delivered · AOV ${rec.aov == null ? "—" : rs(rec.aov)} · VAT ${rs(rec.vat)}`} />
        <Kpi label="Deferred revenue (now)" value={rs(def.total)} formula={`${M.deferred.definition} ${M.deferredPlans.definition}`} href={drill(f, "deferred")} sub={<>{rs(def.plans)} prepaid plans ({def.planMeals} meals) · {rs(def.single)} single · {def.walletBalance == null ? "wallet n/a with filters" : `${rs(def.walletBalance)} wallet`}</>} />
      </div>
      <div className={grid4}>
        <Kpi label="Scheduled revenue" value={rs(up.value)} formula={M.upcoming.definition} href={drill(f, "upcoming")} sub={`${up.count} orders still to deliver`} />
        <Kpi label="Cancelled order value" value={rs(canc.value)} formula={M.cancelled.definition} href={drill(f, "cancelled")} sub={`${canc.count} orders`} tone={canc.count ? "warn" : "default"} />
        <Kpi label="Booked by delivery date" value={rs(booked.gross)} formula={M.bookedByDelivery.definition} href={drill(f, "booked")} sub={`was “gross sales” · net of discounts & refunds ${rs(booked.net)}`} />
        <Kpi
          label="Receivables"
          value={rs(recv.pending + (recv.invoicesOutstanding ?? 0))}
          formula={`${M.receivablesPending.definition} ${M.receivablesInvoices.definition}`}
          href={drill(f, "receivables")}
          sub={<>{rs(recv.pending)} awaiting ({recv.pendingCount}) · {recv.invoicesOutstanding == null ? "invoices n/a with filters" : `${rs(recv.invoicesOutstanding)} invoices`}</>}
          tone={recv.pendingCount ? "warn" : "default"}
        />
      </div>
      {cash.walletCount > 0 && (
        <p className="mb-4 text-xs text-ink-mute" title={M.walletSpend.definition}>
          Also {rs(cash.walletSpend)} paid from wallet credit ({cash.walletCount} payments) — not new cash, so not in “cash collected”.
        </p>
      )}

      <Panel
        title={`Trend · ${s === "recognised" ? "recognised revenue" : s === "bookings" ? "bookings" : "net cash"} by ${bucket}`}
        className="mb-4"
        actions={
          <span className="flex flex-wrap gap-1 text-xs">
            {(["recognised", "bookings", "cash"] as const).map((x) => (
              <Link key={x} href={`/admin/analytics?${qs(f, { tab: "revenue", bucket, series: x })}`} className={`rounded-full border px-2 py-0.5 font-semibold ${x === s ? "border-ink bg-ink text-paper" : "border-ink-line text-ink-soft"}`}>
                {x === "cash" ? "net cash" : x}
              </Link>
            ))}
            <span className="mx-1 text-ink-line">|</span>
            {rev.BUCKETS.map((x) => (
              <Link key={x} href={`/admin/analytics?${qs(f, { tab: "revenue", bucket: x, series: s })}`} className={`rounded-full border px-2 py-0.5 font-semibold ${x === bucket ? "border-ink bg-ink text-paper" : "border-ink-line text-ink-soft"}`}>
                {x}
              </Link>
            ))}
          </span>
        }
      >
        {trend.some((t) => t[s as "recognised" | "bookings" | "cash"]) ? (
          <LinkBars
            ariaLabel="Revenue trend"
            format={(n) => rs(n)}
            data={trend.map((t) => ({ label: bucket === "month" ? t.key.slice(0, 7) : t.key.slice(5), value: t[s as "recognised" | "bookings" | "cash"], href: drill({ ...f, from: t.from, to: t.to }, seriesBasis) }))}
          />
        ) : (
          <Empty>No data recorded in this range.</Empty>
        )}
        <p className="mt-2 text-[11px] text-ink-mute">Click a bar to see its records. Weeks start Sunday.</p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Recognised revenue by plan">
          <LinkRank rows={plan.map(row("recognised", "plan"))} format={(n) => rs(n)} />
        </Panel>
        <Panel title="Meal-plan bookings by plan (counted once, at purchase)">
          <LinkRank rows={planBook.map(row("plans", "plan"))} format={(n) => rs(n)} tone="saag" />
        </Panel>
        <Panel title="Delivered line value by category">
          <LinkRank rows={cat.map((r) => ({ label: r.label, value: r.value, sub: `${r.count} dabbas`, href: drill(f, "recognised", { category: r.key }) }))} format={(n) => rs(n)} />
          <p className="mt-2 text-[11px] text-ink-mute">Σ line totals before order-level discounts, incl. VAT — so it won’t equal recognised revenue.</p>
        </Panel>
        <Panel title="Collected by payment method">
          <LinkRank rows={method.map((r) => ({ label: r.label, value: r.value, sub: `${r.count}`, href: drill(f, "cash", { method: r.key }) }))} format={(n) => rs(n)} tone="akash" />
        </Panel>
        <Panel title="Recognised revenue by kitchen">
          <LinkRank rows={kitchen.map(row("recognised", "kitchen"))} format={(n) => rs(n)} />
        </Panel>
        <Panel title="Recognised revenue by zone">
          <LinkRank rows={zone.map(row("recognised", "zone"))} format={(n) => rs(n)} />
        </Panel>
        <Panel title="Recognised revenue by company">
          <LinkRank rows={company.map(row("recognised", "company"))} format={(n) => rs(n)} />
        </Panel>
        <Panel title="Recognised revenue by acquisition channel">
          {channel.captured ? (
            <LinkRank rows={channel.rows.map(row("recognised", "channel"))} format={(n) => rs(n)} />
          ) : (
            <Empty>Acquisition channel isn’t captured yet (arrives with CRM attribution). Nothing is guessed.</Empty>
          )}
        </Panel>
      </div>
    </>
  );
}

async function OperationsTab({ f }: { f: AnalyticsFilters }) {
  const today = todayKTM();
  const tomorrow = addDays(today, 1);
  const [status, delayed, over, short, planStatus, run, renewals, churn, reasons, meals] = await Promise.all([
    ops.statusCounts(f),
    ops.delayedCount(f),
    ops.overCapacity(f, today, 7),
    ops.shortIngredients(f, tomorrow),
    subs.planStatusCounts(f),
    subs.runRate(f, today),
    subs.renewalsDue(f, today),
    subs.churn(f),
    subs.cancelReasons(f),
    subs.expectedMeals(f, today),
  ]);
  const shortCount = short.reduce((a, k) => a + k.short.length, 0);
  return (
    <>
      <H>Order pipeline (delivery date in range)</H>
      <div className={grid4}>
        <Kpi label="Delayed now" value={delayed} formula={M.delayed.definition} href={drill(f, "delayed")} tone={delayed ? "bad" : "default"} />
        <Kpi label="Over capacity (7 days)" value={over.length} formula={M.overCapacity.definition} tone={over.length ? "bad" : "default"} sub={over.length ? over.map((o) => `${o.kitchen} ${formatDay(o.date)} ${o.meals}/${o.capacity}`).join(" · ") : "Every kitchen-day within capacity"} />
        <Kpi label="Short ingredients (tomorrow)" value={shortCount} formula={M.shortIngredients.definition} tone={shortCount ? "warn" : "default"} sub={short.length ? short.map((k) => `${k.kitchen}: ${k.short.slice(0, 3).map((s) => s.name).join(", ") || "—"}${k.missingRecipe ? ` · ${k.missingRecipe} dish(es) without recipe` : ""}`).join(" · ") : "Nothing short for tomorrow"} />
        <Kpi label="Awaiting payment" value={status.find((x) => x.status === "PENDING_PAYMENT")?.count ?? 0} href={drill({ ...f, orderStatus: "PENDING_PAYMENT" }, "status")} formula="Orders with delivery date in range still awaiting online payment." />
      </div>
      <Table className="mb-6">
        <thead>
          <tr>
            <Th>Status</Th>
            <Th className="text-right">Orders</Th>
            <Th className="text-right">Order value</Th>
          </tr>
        </thead>
        <tbody>
          {status.map((x) => (
            <tr key={x.status} className="border-t border-ink-line/50">
              <Td>
                <Link className="font-medium hover:underline" href={drill({ ...f, orderStatus: x.status }, "status")}>
                  {x.label}
                </Link>
              </Td>
              <Td className="text-right tabular-nums">{x.count}</Td>
              <Td className="text-right tabular-nums">{rs(x.value)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>

      <H>Meal plans</H>
      <div className={grid4}>
        <Kpi label="Plan run-rate (30 days)" value={rs(run.total)} formula={M.runRate.definition} href={drill(f, "runrate")} sub={`${rs(run.plans)} from ${run.planCount} plans${run.contracts == null ? " · contracts n/a with filters" : ` + ${rs(run.contracts)} from ${run.contractCount} contracts`}`} />
        <Kpi label="Renewals due (7 days)" value={renewals} formula={M.renewalsDue.definition} href={drill(f, "renewals")} tone={renewals ? "warn" : "default"} />
        <Kpi label="Plan churn" value={pct(churn.rate, 1)} formula={M.churn.definition} sub={`${churn.cancelled} cancelled / ${churn.activeAtStart} active at start`} />
        <Kpi label="Plan meals next 7 days" value={meals.week} formula={M.expectedMeals.definition} sub={meals.perDay.map((d) => `${formatDay(d.date).split(" ")[0]} ${d.meals}`).join(" · ")} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Plans by status (now)">
          <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
            {(["ACTIVE", "PAUSED", "PENDING_PAYMENT", "COMPLETED", "CANCELLED"] as const).map((st) => (
              <li key={st} className="rounded-lg border border-ink-line/70 px-3 py-2">
                <p className="text-xs text-ink-mute">{SUB_STATUS[st].label}</p>
                <p className="font-display text-lg font-bold tabular-nums">{planStatus[({ ACTIVE: "active", PAUSED: "paused", PENDING_PAYMENT: "pending", COMPLETED: "completed", CANCELLED: "cancelled" } as const)[st]]}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Cancellation reasons (plans cancelled in range)">
          <LinkRank rows={reasons.map((r) => ({ label: r.reason, value: r.count }))} empty="No plans cancelled in this range." tone="sindoor" />
        </Panel>
        <Panel title="Expected plan meals per day" className="lg:col-span-2">
          <LinkBars ariaLabel="Expected plan meals" data={meals.perDay.map((d) => ({ label: formatDay(d.date), value: d.meals, href: drill({ ...f, from: d.date, to: d.date, planId: f.planId }, "upcoming") }))} color="#3B6245" format={(n) => `${n} meals`} height={120} />
        </Panel>
      </div>
    </>
  );
}

async function CustomersTab({ f, pii }: { f: AnalyticsFilters; pii: ReturnType<typeof piiFor> }) {
  const [stats, life, top, diets, rating, tickets] = await Promise.all([cust.customerStats(f), cust.ltv(f), cust.topCustomers(f), cust.dietMix(f), cust.ratings(f), cust.complaints(f)]);
  return (
    <>
      <div className={grid4}>
        <Kpi label="Active customers" value={stats.active} formula={M.activeCustomers.definition} href={drill(f, "recognised")} sub={`${stats.deliveredOrders} delivered orders`} />
        <Kpi label="New customers" value={stats.newCustomers} formula={M.newCustomers.definition} />
        <Kpi label="Returning customers" value={stats.returning} formula={M.returningCustomers.definition} sub={stats.active ? `${pct(stats.returning / stats.active)} of active` : undefined} />
        <Kpi label="Orders per customer" value={stats.frequency == null ? "—" : stats.frequency.toFixed(1)} formula={M.frequency.definition} />
        <Kpi label="Historical LTV" value={life.average == null ? "—" : rs(life.average)} formula={M.ltv.definition} sub={`${life.customers} customers · ${rs(life.total)} all time`} />
        <Kpi label="Average rating" value={rating.average == null ? "—" : `${rating.average.toFixed(1)} / 5`} formula={M.rating.definition} sub={`${rating.count} ratings`} />
        <Kpi label="Complaints" value={tickets.total} formula={M.complaints.definition} tone={tickets.total ? "warn" : "default"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top customers (recognised revenue in range)" bodyClass="p-0">
          <Table className="rounded-none border-0 shadow-none">
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th className="text-right">Delivered</Th>
                <Th className="text-right">Recognised</Th>
              </tr>
            </thead>
            <tbody>
              {top.length ? (
                top.map((c) => (
                  <tr key={c.userId} className="border-t border-ink-line/50">
                    <Td>
                      <span className="font-medium">{c.name}</span>
                      {c.email && <span className="block text-xs text-ink-mute">{pii.email(c.email)}</span>}
                    </Td>
                    <Td className="text-right tabular-nums">{c.orders}</Td>
                    <Td className="text-right tabular-nums">{rs(c.value)}</Td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={3}>No delivered orders in this range.</EmptyRow>
              )}
            </tbody>
          </Table>
        </Panel>
        <Panel title="Diet preference of active customers">
          <LinkRank rows={diets.map((d) => ({ label: { ANY: "No preference", VEG: "Vegetarian", EGG_OK: "Vegetarian + egg", VEGAN: "Vegan" }[d.diet], value: d.count }))} format={(n) => `${n} customers`} tone="saag" empty="No active customers in this range." />
          <p className="mt-2 text-[11px] text-ink-mute">From the preference customers set on their own profile.</p>
        </Panel>
        <Panel title="Complaints by category">
          <LinkRank rows={tickets.byCategory.map((c) => ({ label: c.category, value: c.count }))} tone="sindoor" empty="No tickets opened in this range." />
        </Panel>
        <Panel title="Complaint trend (tickets per week)">
          {tickets.weekly.length ? <LinkBars ariaLabel="Tickets per week" data={tickets.weekly.map((w) => ({ label: w.week.slice(5), value: w.count }))} color="#B47F1E" height={120} /> : <Empty>No tickets opened in this range.</Empty>}
        </Panel>
      </div>
    </>
  );
}

async function ProfitTab({ f }: { f: AnalyticsFilters }) {
  const p = await rev.profitability(f);
  return (
    <>
      <div className="mb-4 rounded-xl border border-besar/50 bg-besar-light p-3 text-sm">
        <strong>Operating estimate — not final accounting profit.</strong> Estimated figures come from order snapshots; “recorded” figures come from the expense ledger, stock movements and gateway statements.
        {p.closedMonths < p.months ? ` ${p.months - p.closedMonths} of ${p.months} month(s) in this range are not closed.` : " Every month in this range is closed."}
        {isFiltered(f) && " Expenses follow the kitchen filter only (other filters don’t apply to expenses)."}
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Line</Th>
            <Th className="text-right">Estimated</Th>
            <Th className="text-right">Recorded (actual)</Th>
            <Th>Note</Th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-ink-line/50">
            <Td className="font-semibold">
              <Link className="hover:underline" href={drill(f, "recognised")} title={M.recognised.definition}>
                Recognised revenue
              </Link>
            </Td>
            <Td className="text-right font-semibold tabular-nums">{rs(p.revenue)}</Td>
            <Td className="text-right tabular-nums">{rs(p.revenue)}</Td>
            <Td className="text-xs text-ink-mute">Delivered meals, net of VAT and refunds</Td>
          </tr>
          {p.lines.map((l) => (
            <tr key={l.key} className="border-t border-ink-line/50">
              <Td>{l.label}</Td>
              <Td className="text-right tabular-nums">
                <MaybeMoney value={l.estimated == null ? null : -l.estimated} fmt={rs} none={l.key === "overheads" ? "Not estimated" : "No data recorded"} />
              </Td>
              <Td className="text-right tabular-nums">
                <MaybeMoney value={l.actual == null ? null : -l.actual} fmt={rs} />
              </Td>
              <Td className="text-xs text-ink-mute">{l.note}</Td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink-line">
            <Td className="font-semibold" title="Recognised revenue − estimated food, packaging, delivery and gateway costs (lines with no data count as nothing).">
              Contribution (estimated)
            </Td>
            <Td className="text-right font-bold tabular-nums">{rs(p.contribution)}</Td>
            <Td />
            <Td className="text-xs text-ink-mute">Before overheads</Td>
          </tr>
          <tr className="border-t border-ink-line/50">
            <Td className="font-semibold" title="Recognised revenue − for each line the recorded figure when present, otherwise the estimate.">
              Operating estimate
            </Td>
            <Td />
            <Td className="text-right font-bold tabular-nums">{rs(p.operating)}</Td>
            <Td className="text-xs text-ink-mute">{p.coverage} of {p.lines.length} cost lines have data</Td>
          </tr>
        </tbody>
      </Table>
    </>
  );
}
