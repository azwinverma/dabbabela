import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { formatDay, isoDate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { expiringStock, stockList } from "@/server/inventory";
import { PageHeader, Panel, StatCard, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { pickKitchen } from "@/components/admin/ops/scope";
import { InvTabs } from "@/components/admin/ops/InvTabs";
import { MovementForm } from "./MovementForm";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ kitchen?: string; low?: string }> }) {
  const user = await requirePermission("inventory");
  const sp = await searchParams;
  const { kitchens, kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return <PageHeader title="Inventory" description="Add a kitchen first." />;
  const [stock, expiring] = await Promise.all([stockList(kitchen.id), expiringStock(kitchen.id, 3)]);
  const low = stock.filter((s) => s.low);
  const shown = sp.low ? low : stock;
  const qs = `kitchen=${kitchen.id}`;
  return (
    <div>
      <PageHeader title="Inventory" description={`Stock on hand at ${kitchen.name} = sum of the movement ledger. Corrections are new movements, never edits.`} />
      {kitchens.length > 1 && (
        <form className="mb-3 flex gap-2">
          <select name="kitchen" defaultValue={kitchen.id} className="field w-52">{kitchens.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select>
          <button className="rounded-lg bg-ink px-3 text-sm font-semibold text-paper">Switch</button>
        </form>
      )}
      <InvTabs current="stock" qs={qs} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Stock value" value={rs(stock.reduce((a, s) => a + s.value, 0))} sub="at latest purchase price" />
        <StatCard label="Below safety stock" value={low.length} tone={low.length ? "warn" : "good"} href={`/admin/inventory?${qs}&low=1`} />
        <StatCard label="Expiring ≤ 3 days" value={expiring.length} tone={expiring.length ? "warn" : "default"} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Table>
            <thead>
              <tr>
                <Th>Ingredient</Th>
                <Th className="text-right">On hand</Th>
                <Th className="text-right">Safety</Th>
                <Th className="text-right">Cost / unit</Th>
                <Th className="text-right">Value</Th>
                <Th>Supplier</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className={s.low ? "bg-besar-light/50" : ""}>
                  <Td>
                    <Link href={`/admin/inventory/ingredients/${s.id}?${qs}`} className="font-semibold hover:text-sindoor">{s.name}</Link>
                    {s.low && <Badge tone="warn" className="ml-2">reorder</Badge>}
                  </Td>
                  <Td className="text-right tabular-nums">{s.onHand} {s.unit.toLowerCase()}</Td>
                  <Td className="text-right tabular-nums text-ink-mute">{s.safetyStock}</Td>
                  <Td className="text-right tabular-nums">{rs(s.costPerUnit)}</Td>
                  <Td className="text-right tabular-nums">{rs(s.value)}</Td>
                  <Td className="text-xs">{s.supplier?.name ?? "—"}</Td>
                </tr>
              ))}
              {!shown.length && <EmptyRow colSpan={6}>{sp.low ? "Nothing below safety stock." : "No ingredients yet."}</EmptyRow>}
            </tbody>
          </Table>
          {expiring.length > 0 && (
            <Panel title="Expiring stock">
              <ul className="space-y-1 text-sm">
                {expiring.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span>{e.ingredient.name} <span className="text-xs text-ink-mute">({e.reference ?? "receipt"}, {e.quantity} {e.ingredient.unit.toLowerCase()})</span></span>
                    <Badge tone={e.expired ? "bad" : "warn"}>{e.expired ? "expired" : "expires"} {formatDay(isoDate(e.expiresOn!))}</Badge>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
        <Panel title="Record a movement">
          <MovementForm kitchenId={kitchen.id} ingredients={stock.map((s) => ({ id: s.id, name: s.name, unit: s.unit }))} today={todayKTM()} />
        </Panel>
      </div>
    </div>
  );
}
