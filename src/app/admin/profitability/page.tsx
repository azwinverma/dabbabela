import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { rs } from "@/lib/money";
import { addDays, formatDay, formatStamp, monthRange, todayKTM } from "@/lib/dates";
import { PageHeader, Panel, Table, Th, Td, Callout } from "@/components/admin/ui";
import { Kpi, MaybeMoney } from "@/components/admin/finance/kit";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { kitchensFor } from "@/components/admin/ops/scope";
import { parseFilters, qs } from "@/server/analytics/filters";
import { profitAndLoss } from "@/server/finance/profitability";
import { label } from "../expenses/_shared";
import { closePeriodAction, reopenPeriodAction } from "./actions";

export const metadata = { title: "Profitability" };
type SP = Record<string, string | undefined>;

export default async function ProfitabilityPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("analytics.view");
  const sp = await searchParams;
  // ?month=YYYY-MM is a shortcut for that whole month; default = the current month to date.
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? monthRange(sp.month) : null;
  const cur = monthRange();
  const f = parseFilters({ ...sp, from: month?.start ?? sp.from ?? cur.start, to: month?.end ?? sp.to ?? todayKTM() }, user);
  const [p, kitchens] = await Promise.all([profitAndLoss(user, f), kitchensFor(user)]);
  const canClose = can(user, "settlements.approve") && can(user, "expenses.approve");
  const isOwner = ["OWNER", "SUPER_ADMIN"].includes(user.role);
  const lastMonth = monthRange(addDays(cur.start, -1).slice(0, 7));

  return (
    <div>
      <PageHeader
        title="Profitability"
        description={`${formatDay(f.from, "long")} → ${formatDay(f.to, "long")} · ${f.kitchenIds?.length === 1 ? (kitchens.find((k) => k.id === f.kitchenIds![0])?.name ?? "1 kitchen") : "all kitchens in scope"}`}
        actions={
          <Link className="text-sm font-semibold text-sindoor underline" href={`/admin/analytics?${qs(f, { tab: "profit" })}`}>
            Same view in analytics
          </Link>
        }
      />
      <form className="mb-5 flex flex-wrap items-end gap-2">
        <label className={label}>
          From
          <input type="date" name="from" defaultValue={f.from} className="field mt-1 w-40" />
        </label>
        <label className={label}>
          To
          <input type="date" name="to" defaultValue={f.to} className="field mt-1 w-40" />
        </label>
        <label className={label}>
          Kitchen
          <select name="kitchen" defaultValue={f.kitchenIds?.length === 1 ? f.kitchenIds[0] : ""} className="field mt-1 w-44">
            {!user.kitchenIds && <option value="">All kitchens</option>}
            {kitchens.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Apply</button>
        <span className="flex flex-wrap gap-1 text-xs">
          <a href={`?month=${cur.ym}`} className="rounded-full border border-ink-line bg-white px-2.5 py-1 font-semibold text-ink-soft hover:border-ink">
            This month
          </a>
          <a href={`?month=${lastMonth.ym}`} className="rounded-full border border-ink-line bg-white px-2.5 py-1 font-semibold text-ink-soft hover:border-ink">
            Last month
          </a>
        </span>
      </form>

      <Callout tone={p.bottomLine.final ? "good" : "warn"} className="mb-4" title={p.bottomLine.final ? "Every month in this range is closed" : "Operating estimate — not final accounting profit"}>
        Estimated figures come from order snapshots (recipe cost, packaging, route cost, fee rates). Recorded figures come from the expense ledger, stock movements and imported gateway statements. Net profit is shown only when every month in the range is closed.
        {f.kitchenIds && " Company-wide expenses (no kitchen) are excluded when a kitchen is picked."}
      </Callout>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Recognised revenue" value={rs(p.revenue)} formula="Delivered meals in the range, net of VAT and refunds (analytics 'recognised')." />
        <Kpi label="Estimated profit" value={rs(p.estimatedProfit)} formula="Revenue − estimated cost lines (lines with no estimate count as nothing; overheads have no estimate)." />
        <Kpi label="Recorded profit" value={rs(p.recordedProfit)} formula="Revenue − recorded cost lines only (expense ledger, stock usage, statement fees)." />
        <Kpi label={p.bottomLine.label} value={rs(p.bottomLine.value)} tone={p.bottomLine.final ? "good" : "warn"} formula="Revenue − for each line the recorded figure when present, otherwise the estimate." />
      </div>

      <Table>
        <thead>
          <tr>
            <Th>Line</Th>
            <Th className="text-right">Estimated</Th>
            <Th className="text-right">Recorded</Th>
            <Th className="text-right">Difference</Th>
            <Th>Note</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td className="font-semibold">Recognised revenue</Td>
            <Td className="text-right font-semibold tabular-nums">{rs(p.revenue)}</Td>
            <Td className="text-right font-semibold tabular-nums">{rs(p.revenue)}</Td>
            <Td />
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
              <Td className="text-right tabular-nums text-ink-mute">{l.estimated != null && l.actual != null ? rs(l.estimated - l.actual) : "—"}</Td>
              <Td className="text-xs text-ink-mute">{l.note}</Td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink-line">
            <Td className="font-semibold">Total costs</Td>
            <Td className="text-right font-semibold tabular-nums">
              <MaybeMoney value={p.estimatedCosts == null ? null : -p.estimatedCosts} fmt={rs} />
            </Td>
            <Td className="text-right font-semibold tabular-nums">
              <MaybeMoney value={p.recordedCosts == null ? null : -p.recordedCosts} fmt={rs} />
            </Td>
            <Td />
            <Td className="text-xs text-ink-mute">{p.coverage} of {p.lines.length} cost lines have data</Td>
          </tr>
          <tr className="border-t border-ink-line/50">
            <Td className="font-semibold">{p.bottomLine.label}</Td>
            <Td className="text-right tabular-nums">{rs(p.estimatedProfit)}</Td>
            <Td className="text-right tabular-nums">{rs(p.recordedProfit)}</Td>
            <Td className="text-right font-bold tabular-nums">{rs(p.bottomLine.value)}</Td>
            <Td className="text-xs text-ink-mute">Best figure per line (recorded, else estimate)</Td>
          </tr>
        </tbody>
      </Table>

      <Panel title="Accounting periods" className="mt-6" bodyClass="p-0">
        <Table className="rounded-none border-0 shadow-none">
          <thead>
            <tr>
              <Th>Month</Th>
              <Th className="text-right">Expenses recorded</Th>
              <Th className="text-right">Drafts</Th>
              <Th className="text-right">Settlements (open)</Th>
              <Th className="text-right">Statement lines</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {p.periods.map((m) => {
              const ended = monthRange(m.month).end < todayKTM();
              return (
                <tr key={m.month} className="align-top">
                  <Td className="font-semibold">{m.month}</Td>
                  <Td className="text-right tabular-nums">{m.expenses}</Td>
                  <Td className={`text-right tabular-nums ${m.drafts ? "font-semibold text-besar-dark" : ""}`}>{m.drafts}</Td>
                  <Td className="text-right tabular-nums">
                    {m.settlements} {m.openSettlements ? <span className="font-semibold text-besar-dark">({m.openSettlements})</span> : null}
                  </Td>
                  <Td className="text-right tabular-nums">{m.statementLines}</Td>
                  <Td>{m.closedAt ? <span className="text-saag">Closed {formatStamp(m.closedAt)}</span> : ended ? "Open" : "In progress"}</Td>
                  <Td>
                    {!m.closedAt && canClose && ended && (
                      <ActionForm action={closePeriodAction} className="flex flex-wrap items-start gap-1">
                        <input type="hidden" name="month" value={m.month} />
                        <input name="note" placeholder="Note (optional)" aria-label="Note" className="field h-8 w-40 py-1" />
                        <SubmitButton size="sm" variant="dark" pendingText="…" confirm={`Close ${m.month}? Nothing dated in it can change afterwards.`}>
                          Close month
                        </SubmitButton>
                      </ActionForm>
                    )}
                    {m.closedAt && canClose && isOwner && (
                      <ActionForm action={reopenPeriodAction} className="flex flex-wrap items-start gap-1">
                        <input type="hidden" name="month" value={m.month} />
                        <input name="reason" required placeholder="Reason to re-open" aria-label="Reason" className="field h-8 w-40 py-1" />
                        <SubmitButton size="sm" variant="outline" pendingText="…" confirm={`Re-open ${m.month}?`}>
                          Re-open
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>
      <p className="mt-2 text-xs text-ink-mute">Closing a month needs every draft expense approved or voided and every saved settlement closed. Re-opening is owner-only and audited.</p>
    </div>
  );
}
