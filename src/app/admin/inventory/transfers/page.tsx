import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth";
import { formatStamp } from "@/lib/dates";
import { listTransfers, stockOnHand } from "@/server/inventory";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { pickKitchen } from "@/components/admin/ops/scope";
import { InventoryTabs } from "../_components/InventoryTabs";
import { KitchenSwitch } from "../_components/KitchenSwitch";
import { TransferForm } from "./TransferForm";

export const metadata = { title: "Stock transfers" };

export default async function TransfersPage({ searchParams }: { searchParams: Promise<{ kitchen?: string }> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const { kitchens, kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return null;
  const editable = can(user, "inventory.edit");
  const others = kitchens.filter((k) => k.id !== kitchen.id);
  const [transfers, ingredients, onHand, locations] = await Promise.all([
    listTransfers(user, { kitchenId: kitchen.id }),
    db.ingredient.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, purchaseUnit: true } }),
    stockOnHand(kitchen.id),
    db.inventoryLocation.findMany({ where: { kitchenId: { in: others.map((k) => k.id) }, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, kitchenId: true } }),
  ]);
  const inStock = ingredients.map((i) => ({ ...i, onHand: onHand.get(i.id) ?? 0 })).filter((i) => i.onHand > 0);
  return (
    <div>
      <PageHeader title="Stock transfers" description="Kitchen-to-kitchen moves post TRANSFER_OUT here and TRANSFER_IN there in one step; lots keep their cost and expiry." />
      <KitchenSwitch kitchens={kitchens} current={kitchen.id} />
      <InventoryTabs current="transfers" qs={`kitchen=${kitchen.id}`} />
      <div className="grid gap-5 xl:grid-cols-[1fr_440px]">
        <Table>
          <thead><tr><Th>Transfer</Th><Th>Route</Th><Th>Lines</Th><Th>Status</Th></tr></thead>
          <tbody>
            {transfers.map((t) => (
              <tr key={t.id}>
                <Td><span className="font-mono font-semibold">{t.number}</span><div className="text-xs text-ink-mute">{formatStamp(t.createdAt)}</div></Td>
                <Td className="text-sm">{t.fromKitchen.name} → {t.toKitchen.name}{t.note && <div className="text-xs text-ink-mute">{t.note}</div>}</Td>
                <Td className="text-xs">{t.lines.map((l) => `${l.ingredient.name} ${l.quantity} ${l.ingredient.unit.toLowerCase()}`).join(", ")}</Td>
                <Td><Badge tone={t.fromKitchenId === kitchen.id ? "warn" : "good"}>{t.fromKitchenId === kitchen.id ? "sent" : "received"}</Badge></Td>
              </tr>
            ))}
            {!transfers.length && <EmptyRow colSpan={4}>No transfers for this kitchen yet.</EmptyRow>}
          </tbody>
        </Table>
        {editable && (
          <Panel title="New transfer">
            <TransferForm fromKitchen={kitchen} kitchens={others} ingredients={inStock} locations={locations} />
          </Panel>
        )}
      </div>
    </div>
  );
}
