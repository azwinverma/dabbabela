import { requireCompanyAdmin } from "@/lib/auth";
import { rs } from "@/lib/money";
import { todayKTM } from "@/lib/dates";
import { Table, Th, Td, EmptyRow, Panel } from "@/components/admin/ui";
import { teamBudgets } from "@/server/team";
import { TeamBudgetForm } from "../TeamForms";

export const metadata = { title: "Budgets" };

export default async function TeamBudgets({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const { company } = await requireCompanyAdmin();
  const { ym: q } = await searchParams;
  const ym = q && /^\d{4}-(0[1-9]|1[0-2])$/.test(q) ? q : todayKTM().slice(0, 7);
  const rows = await teamBudgets(company.id, ym);
  const totalBudget = rows.reduce((a, r) => a + (r.budget ?? 0), 0);
  const totalSpent = rows.reduce((a, r) => a + r.spent, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Spending vs budget · {ym}</h1>
          <p className="text-sm text-ink-mute">
            Set a monthly cap per department. The company share of each person&apos;s lunch stops at their department&apos;s budget — beyond it, team orders are refused (or the employee pays the difference, if you allow it when ordering).
          </p>
        </div>
        <form className="flex gap-2">
          <input type="month" name="ym" defaultValue={ym} className="field w-40" aria-label="Month" />
          <button className="h-[38px] rounded-lg bg-ink px-3 text-sm font-semibold text-paper">Show</button>
        </form>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Department</Th>
            <Th className="text-right">People</Th>
            <Th className="text-right">Company spend</Th>
            <Th className="text-right">Left</Th>
            <Th>Budget</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r) => (
              <tr key={r.department} className={r.over ? "bg-sindoor-light/40" : ""}>
                <Td className="font-semibold">{r.department || <span className="text-ink-mute">No department</span>}</Td>
                <Td className="text-right tabular-nums">{r.members}</Td>
                <Td className="text-right tabular-nums">
                  {rs(r.spent)}
                  {r.budget ? <span className="block text-[11px] text-ink-mute">{Math.round((r.spent / r.budget) * 100)}% used</span> : null}
                </Td>
                <Td className={`text-right tabular-nums ${r.over ? "font-bold text-sindoor" : ""}`}>{r.remaining == null ? "—" : rs(r.remaining)}</Td>
                <Td>{r.department ? <TeamBudgetForm month={ym} department={r.department} amount={r.budget} /> : <span className="text-xs text-ink-mute">Set departments on the People page</span>}</Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={5}>No departments yet — set them on the People page.</EmptyRow>
          )}
          {rows.length > 0 && (
            <tr className="font-semibold">
              <Td>Total</Td>
              <Td />
              <Td className="text-right tabular-nums">{rs(totalSpent)}</Td>
              <Td />
              <Td>{totalBudget ? `${rs(totalBudget)} budgeted` : ""}</Td>
            </tr>
          )}
        </tbody>
      </Table>
      <Panel title="Add a budget">
        <TeamBudgetForm month={ym} departments={rows.map((r) => r.department).filter(Boolean)} />
      </Panel>
    </div>
  );
}
