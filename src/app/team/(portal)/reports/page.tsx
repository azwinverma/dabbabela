import { requireCompanyAdmin } from "@/lib/auth";
import { rs } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { ORDER_STATUS } from "@/lib/labels";
import { Table, Th, Td, EmptyRow, Panel } from "@/components/admin/ui";
import { readRange, RangeForm } from "@/components/admin/finance/kit";
import { teamReport } from "@/server/team";

export const metadata = { title: "Reports" };

export default async function TeamReports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { company } = await requireCompanyAdmin();
  const { from, to } = readRange(await searchParams, 30);
  const rows = await teamReport(company.id, from, to);
  const live = rows.filter((r) => !["CANCELLED", "SKIPPED"].includes(r.status));
  const group = (k: "department" | "costCenter") => {
    const m = new Map<string, { meals: number; company: number; staff: number }>();
    for (const r of live) {
      const key = r[k] || "—";
      const g = m.get(key) ?? { meals: 0, company: 0, staff: 0 };
      g.meals += r.meals;
      g.company += r.companyShare;
      g.staff += r.employeeShare;
      m.set(key, g);
    }
    return [...m.entries()].sort((a, b) => b[1].company - a[1].company);
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-2xl font-bold">Lunch & attendance report</h1>
        <a href={`/team/reports/csv?from=${from}&to=${to}`} className="rounded-lg border-2 border-ink px-3 py-1.5 text-sm font-semibold hover:bg-ink hover:text-paper">
          ↓ Download CSV
        </a>
      </div>
      <RangeForm from={from} to={to} />
      <div className="grid gap-4 lg:grid-cols-2">
        {(["department", "costCenter"] as const).map((k) => (
          <Panel key={k} title={k === "department" ? "By department" : "By cost centre"} bodyClass="p-0">
            <Table className="rounded-none border-0 shadow-none">
              <thead>
                <tr>
                  <Th>{k === "department" ? "Department" : "Cost centre"}</Th>
                  <Th className="text-right">Meals</Th>
                  <Th className="text-right">Company</Th>
                  <Th className="text-right">Staff</Th>
                </tr>
              </thead>
              <tbody>
                {group(k).map(([key, g]) => (
                  <tr key={key}>
                    <Td>{key}</Td>
                    <Td className="text-right tabular-nums">{g.meals}</Td>
                    <Td className="text-right tabular-nums">{rs(g.company)}</Td>
                    <Td className="text-right tabular-nums">{rs(g.staff)}</Td>
                  </tr>
                ))}
                {!live.length && <EmptyRow colSpan={4} />}
              </tbody>
            </Table>
          </Panel>
        ))}
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Person</Th>
            <Th>Department</Th>
            <Th>Lunch</Th>
            <Th>Status</Th>
            <Th className="text-right">Company</Th>
            <Th className="text-right">Staff</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r) => (
              <tr key={r.number}>
                <Td className="whitespace-nowrap text-xs">{formatDay(r.date)}</Td>
                <Td>{r.name}</Td>
                <Td className="text-xs">{r.department || "—"}</Td>
                <Td className="text-xs">{r.items}</Td>
                <Td className="text-xs">{ORDER_STATUS[r.status].label}</Td>
                <Td className="text-right tabular-nums">{rs(r.companyShare)}</Td>
                <Td className="text-right tabular-nums">{rs(r.employeeShare)}</Td>
              </tr>
            ))
          ) : (
            <EmptyRow colSpan={7}>No lunches in this period.</EmptyRow>
          )}
        </tbody>
      </Table>
    </div>
  );
}
