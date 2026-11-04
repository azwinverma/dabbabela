import { requirePermission } from "@/lib/auth";
import { addDays, isValidISODate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { usageVariance } from "@/server/inventory";
import { PageHeader, Table, Th, Td, EmptyRow, StatCard } from "@/components/admin/ui";
import { InvTabs } from "@/components/admin/ops/InvTabs";
import { pickKitchen } from "@/components/admin/ops/scope";

export const metadata = { title: "Usage variance" };

export default async function VariancePage({ searchParams }: { searchParams: Promise<{ kitchen?: string; from?: string; to?: string }> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const { kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return null;
  const to = sp.to && isValidISODate(sp.to) ? sp.to : todayKTM();
  const from = sp.from && isValidISODate(sp.from) ? sp.from : addDays(to, -6);
  const rows = await usageVariance(kitchen.id, from, to);
  const cost = rows.reduce((a, r) => a + r.varianceCost, 0);
  const waste = rows.reduce((a, r) => a + r.waste, 0);
  return (
    <div>
      <PageHeader title="Theoretical vs actual usage" description="Theoretical = finished batches' cooked portions × recipe (with trim waste). Actual = usage + waste movements in the ledger. A large gap means unrecorded waste, over-portioning, or a recipe that needs re-weighing." />
      <InvTabs current="variance" qs={`kitchen=${kitchen.id}`} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="kitchen" value={kitchen.id} />
        <label className="text-xs font-semibold text-ink-mute">From<input type="date" name="from" defaultValue={from} className="field mt-1" /></label>
        <label className="text-xs font-semibold text-ink-mute">To<input type="date" name="to" defaultValue={to} className="field mt-1" /></label>
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Show</button>
      </form>
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <StatCard label="Variance at cost" value={rs(cost)} tone={cost > 0 ? "warn" : "good"} sub="positive = used more than recipes say" />
        <StatCard label="Ingredients compared" value={rows.length} sub={`waste lines: ${Math.round(waste * 100) / 100} units`} />
      </div>
      <Table>
        <thead><tr><Th>Ingredient</Th><Th className="text-right">Theoretical</Th><Th className="text-right">Usage</Th><Th className="text-right">Waste</Th><Th className="text-right">Variance</Th><Th className="text-right">At cost</Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ingredientId}>
              <Td className="font-medium">{r.name}</Td>
              <Td className="text-right tabular-nums">{r.theoretical} {r.unit.toLowerCase()}</Td>
              <Td className="text-right tabular-nums">{r.usage}</Td>
              <Td className="text-right tabular-nums">{r.waste}</Td>
              <Td className={`text-right font-semibold tabular-nums ${Math.abs(r.variancePct ?? 0) > 10 ? "text-sindoor" : ""}`}>{r.variance > 0 ? "+" : ""}{r.variance}{r.variancePct != null ? ` (${r.variancePct}%)` : ""}</Td>
              <Td className="text-right tabular-nums">{rs(r.varianceCost)}</Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow colSpan={6}>No finished batches or usage in this range.</EmptyRow>}
        </tbody>
      </Table>
    </div>
  );
}
