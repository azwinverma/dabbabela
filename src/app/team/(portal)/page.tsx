import Link from "next/link";
import { requireCompanyAdmin } from "@/lib/auth";
import { rs } from "@/lib/money";
import { todayKTM } from "@/lib/dates";
import { Panel } from "@/components/admin/ui";
import { Kpi, Empty } from "@/components/admin/finance/kit";
import { teamOverview, teamFeedback, roster } from "@/server/team";
import { companyOutstanding } from "@/server/corporate";

export const metadata = { title: "Overview" };

export default async function TeamHome({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const { company } = await requireCompanyAdmin();
  const { ym: q } = await searchParams;
  const ym = q && /^\d{4}-\d{2}$/.test(q) ? q : todayKTM().slice(0, 7);
  const [o, fb, pending, owed] = await Promise.all([teamOverview(company.id, ym), teamFeedback(company.id), roster(company.id, { status: "PENDING" }), companyOutstanding(company.id)]);
  const mode = company.billingMode === "SPLIT" ? `Company pays ${company.subsidyPct}%${company.subsidyCap ? ` (up to ${rs(company.subsidyCap)} a meal)` : ""}` : company.billingMode === "COMPANY_PAID" ? "Company pays for every lunch" : "Staff pay for their own lunch";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Team lunches · {ym}</h1>
          <p className="text-sm text-ink-mute">
            {mode}
            {company.monthlyAllowance ? ` · allowance ${rs(company.monthlyAllowance)} per person per month` : ""}
            {company.discountPct ? ` · ${company.discountPct}% team discount` : ""}. Join code for staff: <span className="font-mono font-semibold">{company.joinCode}</span>
          </p>
        </div>
        <form className="flex gap-2">
          <input type="month" name="ym" defaultValue={ym} className="field w-40" aria-label="Month" />
          <button className="h-[38px] rounded-lg bg-ink px-3 text-sm font-semibold text-paper">Show</button>
        </form>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Lunches delivered or booked" value={o.meals} sub={`${o.orders} orders by ${o.eaters} people`} />
        <Kpi label="Company spend" value={rs(o.companySpend)} />
        <Kpi label="Paid by staff" value={rs(o.employeeSpend)} />
        <Kpi label="Allowance used" value={o.allowancePool != null ? `${Math.round((o.allowanceUsed / Math.max(1, o.allowancePool)) * 100)}%` : "No cap"} sub={o.allowancePool != null ? `${rs(o.allowanceUsed)} of ${rs(o.allowancePool)}` : undefined} />
        <Kpi label="Active people" value={o.members} tone={o.pending ? "warn" : "default"} sub={o.pending ? `${o.pending} waiting for you` : undefined} />
        <Kpi label="Owed to Dabba Bela" value={rs(owed)} sub={company.creditLimit != null ? `Credit limit ${rs(company.creditLimit)}` : undefined} />
        <Kpi label="Average rating" value={fb.avg != null ? `${fb.avg.toFixed(1)} / 5` : "—"} sub={`${fb.count} ratings from your team`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Waiting for approval" actions={<Link href="/team/roster?status=PENDING" className="text-sm font-semibold text-sindoor">Review →</Link>}>
          {pending.length ? (
            <ul className="divide-y divide-ink-line/50 text-sm">
              {pending.slice(0, 8).map((m) => (
                <li key={m.id} className="py-1.5">
                  {m.user.name} <span className="text-xs text-ink-mute">{m.user.email}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">Nobody. New staff who join with the code appear here{company.requireApproval ? "" : " (approval is off — they join straight away)"}.</p>
          )}
        </Panel>
        <Panel title="Recent feedback">
          {fb.rows.length ? (
            <ul className="space-y-2 text-sm">
              {fb.rows.slice(0, 6).map((f) => (
                <li key={f.id}>
                  <span className="font-semibold">{"★".repeat(f.rating)}</span>
                  <span className="text-ink-line">{"★".repeat(5 - f.rating)}</span> <span className="text-xs text-ink-mute">{f.order.items.map((i) => i.name).join(", ")}</span>
                  {f.comment && <p className="text-ink-soft">“{f.comment}”</p>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Your team hasn&apos;t rated a lunch yet.</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}
