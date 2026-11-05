import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatDay, isoDate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { expiringStock, stockList } from "@/server/inventory";
import { PageHeader, Panel, StatCard, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { pickKitchen } from "@/components/admin/ops/scope";
import { InventoryTabs } from "./_components/InventoryTabs";
import { KitchenSwitch } from "./_components/KitchenSwitch";
import { MovementForm } from "./MovementForm";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ kitchen?: string; low?: string; category?: string }> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const { kitchens, kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return <PageHeader title="Inventory" description="Add a kitchen first (or ask for a kitchen in your scope)." />;
  const [stock, expiring, locations] = await Promise.all([stockList(kitchen.id), expiringStock(kitchen.id, 3), db.inventoryLocation.findMany({ where: { kitchenId: kitchen.id, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const low = stock.filter((s) => s.low);
  const short = stock.filter((s) => s.short);
  const categories = [...new Set(stock.map((s) => s.category).filter(Boolean) as string[])].sort();
  const shown = stock.filter((s) => (!sp.low || s.low) && (!sp.category || s.category === sp.category));
  const qs = `kitchen=${kitchen.id}`;
  return (
    <div>
      <PageHeader title="Inventory" description={`Stock on hand at ${kitchen.name} = sum of the movement ledger. Corrections are new movements, never edits.`} />
      <KitchenSwitch kitchens={kitchens} current={kitchen.id} />
      <InventoryTabs current="stock" qs={qs} />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label="Stock value" value={rs(stock.reduce((a, s) => a + s.value, 0))} sub="lot cost; unlotted stock at latest price" />
        <StatCard label="At reorder point" value={low.length} tone={low.length ? "warn" : "good"} href={`/admin/inventory?${qs}&low=1`} />
        <StatCard label="Expiring ≤ 3 days" value={expiring.length} tone={expiring.length ? "warn" : "default"} href={`/admin/inventory/lots?${qs}&days=3`} />
        <StatCard label="Recorded shortages" value={short.length} tone={short.length ? "warn" : "good"} sub="used more than was in stock" href={`/admin/inventory/health?${qs}`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {categories.length > 0 && (
            <form className="flex flex-wrap gap-2">
              <input type="hidden" name="kitchen" value={kitchen.id} />
              <select name="category" defaultValue={sp.category ?? ""} className="field w-48" aria-label="Category">
                <option value="">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button className="rounded-lg border border-ink-line px-3 text-sm font-semibold">Filter</button>
            </form>
          )}
          <Table>
            <thead>
              <tr>
                <Th>Ingredient</Th>
                <Th className="text-right">On hand</Th>
                <Th className="text-right">Reorder at</Th>
                <Th className="text-right">Cost / unit</Th>
                <Th className="text-right">Value</Th>
                <Th>Supplier</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className={s.low || s.short ? "bg-besar-light/50" : ""}>
                  <Td>
                    <Link href={`/admin/inventory/ingredients/${s.id}?${qs}`} className="font-semibold hover:text-sindoor">{s.name}</Link>
                    {s.category && <span className="ml-1 text-xs text-ink-mute">{s.category}</span>}
                    {s.short ? <Badge tone="bad" className="ml-2">shortage</Badge> : s.low && <Badge tone="warn" className="ml-2">reorder</Badge>}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {s.onHand} {s.unit.toLowerCase()}
                    {s.purchase && <div className="text-xs text-ink-mute">{s.purchase.qty} {s.purchase.unit === "PACK" ? "sack" : s.purchase.unit.toLowerCase()}</div>}
                  </Td>
                  <Td className="text-right tabular-nums text-ink-mute">{s.reorderPoint ?? s.safetyStock}</Td>
                  <Td className="text-right tabular-nums">{rs(s.costPerUnit)}</Td>
                  <Td className="text-right tabular-nums">{rs(s.value)}</Td>
                  <Td className="text-xs">{s.supplier?.name ?? "—"}</Td>
                </tr>
              ))}
              {!shown.length && <EmptyRow colSpan={6}>{sp.low ? "Nothing at its reorder point." : "No ingredients yet."}</EmptyRow>}
            </tbody>
          </Table>
          {expiring.length > 0 && (
            <Panel title="Expiring lots">
              <ul className="space-y-1 text-sm">
                {expiring.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span>{e.ingredient.name} <span className="text-xs text-ink-mute">(lot {e.code}, {e.remainingQty} {e.ingredient.unit.toLowerCase()}{e.location ? `, ${e.location.name}` : ""})</span></span>
                    <Badge tone={e.expired ? "bad" : "warn"}>{e.expired ? "expired" : "expires"} {formatDay(isoDate(e.expiresOn!))}</Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
        <Panel title="Record a movement">
          <MovementForm kitchenId={kitchen.id} ingredients={stock.map((s) => ({ id: s.id, name: s.name, unit: s.unit, purchaseUnit: s.purchaseUnit }))} locations={locations} today={todayKTM()} />
        </Panel>
      </div>
    </div>
  );
}
