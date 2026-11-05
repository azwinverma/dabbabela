import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { rs } from "@/lib/money";
import { recipeForProduction } from "@/server/inventory";
import { PageHeader, Table, Th, Td, EmptyRow, StatCard } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { pickKitchen } from "@/components/admin/ops/scope";
import { InventoryTabs } from "../_components/InventoryTabs";

export const metadata = { title: "Recipe scaling" };

export default async function ScalePage({ searchParams }: { searchParams: Promise<{ kitchen?: string; dish?: string; portions?: string }> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const { kitchen } = await pickKitchen(user, sp.kitchen);
  const portions = Math.min(10_000, Math.max(1, parseInt(sp.portions ?? "100", 10) || 100));
  const dishes = await db.menuItem.findMany({ where: { recipe: { currentVersionId: { not: null } } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const plan = sp.dish ? await recipeForProduction(sp.dish, portions, kitchen?.id) : null;
  const qs = kitchen ? `kitchen=${kitchen.id}` : "";
  const unitLabel = (u: string) => (u === "PACK" ? "sack" : u.toLowerCase());
  return (
    <div>
      <PageHeader title="Recipe scaling" description="Scale a dish's current recipe to a production volume: gross quantities include trim waste, checked against stock on hand." />
      <InventoryTabs current="scale" qs={qs} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        {kitchen && <input type="hidden" name="kitchen" value={kitchen.id} />}
        <select name="dish" defaultValue={sp.dish ?? ""} className="field w-64" aria-label="Dish" required>
          <option value="">Pick a dish…</option>
          {dishes.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="text-xs font-semibold text-ink-mute">Portions<input name="portions" type="number" min={1} max={10000} defaultValue={portions} className="field mt-1 w-28" /></label>
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Scale</button>
      </form>
      {sp.dish && !plan && <p className="text-sm text-ink-mute">That dish has no current recipe.</p>}
      {plan && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <StatCard label="Dish" value={plan.dish} sub={`recipe yields ${plan.yieldPortions} portions`} />
            <StatCard label="Ingredient cost" value={rs(plan.lines.reduce((a, l) => a + l.cost, 0))} sub={`${rs(Math.round(plan.lines.reduce((a, l) => a + l.cost, 0) / portions))} per portion`} />
            <StatCard label="Short in stock" value={plan.lines.filter((l) => l.short > 0).length} tone={plan.lines.some((l) => l.short > 0) ? "warn" : "good"} sub={kitchen?.name} />
          </div>
          <Table>
            <thead><tr><Th>Ingredient</Th><Th className="text-right">Net</Th><Th className="text-right">Waste %</Th><Th className="text-right">Gross (to issue)</Th><Th className="text-right">On hand</Th><Th className="text-right">Cost</Th></tr></thead>
            <tbody>
              {plan.lines.map((l) => (
                <tr key={l.ingredientId}>
                  <Td className="font-medium">{l.name}{l.short > 0 && <Badge tone="warn" className="ml-2">short {l.short}</Badge>}</Td>
                  <Td className="text-right tabular-nums">{l.net} {l.unit.toLowerCase()}</Td>
                  <Td className="text-right tabular-nums text-ink-mute">{l.wastePct}</Td>
                  <Td className="text-right tabular-nums font-semibold">{l.gross} {l.unit.toLowerCase()}{l.purchase && <div className="text-xs font-normal text-ink-mute">{l.purchase.qty} {unitLabel(l.purchase.unit)}</div>}</Td>
                  <Td className="text-right tabular-nums">{l.onHand}</Td>
                  <Td className="text-right tabular-nums">{rs(l.cost)}</Td>
                </tr>
              ))}
              {!plan.lines.length && <EmptyRow colSpan={6}>The recipe has no ingredients yet.</EmptyRow>}
            </tbody>
          </Table>
        </>
      )}
    </div>
  );
}
