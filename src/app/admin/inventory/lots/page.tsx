import Link from "next/link";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth";
import { addDays, dateOnly, formatDay, isoDate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { lotsFor } from "@/server/inventory";
import { PageHeader, Table, Th, Td, EmptyRow, StatCard } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { pickKitchen } from "@/components/admin/ops/scope";
import { InventoryTabs } from "../_components/InventoryTabs";
import { KitchenSwitch } from "../_components/KitchenSwitch";
import { moveLotAction } from "../actions";

export const metadata = { title: "Lots & expiry" };

export default async function LotsPage({ searchParams }: { searchParams: Promise<{ kitchen?: string; days?: string; empty?: string }> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const { kitchens, kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return null;
  const days = sp.days ? Math.max(0, parseInt(sp.days, 10) || 0) : undefined;
  const [lots, locations] = await Promise.all([
    lotsFor(kitchen.id, { expiringWithinDays: days, includeEmpty: !!sp.empty }),
    db.inventoryLocation.findMany({ where: { kitchenId: kitchen.id, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const today = dateOnly(todayKTM());
  const soon = dateOnly(addDays(todayKTM(), 3));
  const value = lots.reduce((a, l) => a + l.remainingQty * l.unitCost, 0);
  const expired = lots.filter((l) => l.expiresOn && l.expiresOn < today && l.remainingQty > 0);
  const editable = can(user, "inventory.edit");
  const qs = `kitchen=${kitchen.id}`;
  return (
    <div>
      <PageHeader title="Lots & expiry" description="Every receipt opens a lot with its cost and expiry. Production and manual usage take the earliest expiry first." />
      <KitchenSwitch kitchens={kitchens} current={kitchen.id} extra={{ days: sp.days }} />
      <InventoryTabs current="lots" qs={qs} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Lot value" value={rs(Math.round(value))} sub={`${lots.length} lot(s) shown`} />
        <StatCard label="Expired with stock" value={expired.length} tone={expired.length ? "warn" : "good"} sub="write off as waste" />
        <StatCard label="Expiring ≤ 3 days" value={lots.filter((l) => l.expiresOn && l.expiresOn >= today && l.expiresOn <= soon).length} href={`/admin/inventory/lots?${qs}&days=3`} />
      </div>
      <form className="mb-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="kitchen" value={kitchen.id} />
        <select name="days" defaultValue={sp.days ?? ""} className="field w-48" aria-label="Expiry window">
          <option value="">All open lots</option>
          <option value="0">Expired / today</option>
          <option value="3">Expiring in 3 days</option>
          <option value="7">Expiring in 7 days</option>
          <option value="30">Expiring in 30 days</option>
        </select>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="empty" value="1" defaultChecked={!!sp.empty} /> include used-up lots</label>
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Filter</button>
      </form>
      <Table>
        <thead><tr><Th>Ingredient</Th><Th>Lot</Th><Th className="text-right">Left / received</Th><Th className="text-right">Unit cost</Th><Th className="text-right">Value</Th><Th>Expires</Th><Th>Location</Th></tr></thead>
        <tbody>
          {lots.map((l) => {
            const isExpired = l.expiresOn && l.expiresOn < today;
            return (
              <tr key={l.id} className={l.remainingQty <= 0 ? "opacity-50" : ""}>
                <Td><Link href={`/admin/inventory/ingredients/${l.ingredientId}?${qs}`} className="font-semibold hover:text-sindoor">{l.ingredient.name}</Link></Td>
                <Td className="font-mono text-xs">{l.code}<div className="text-ink-mute">{formatDay(isoDate(l.receivedAt))}</div></Td>
                <Td className="text-right tabular-nums">{l.remainingQty} / {l.receivedQty} {l.ingredient.unit.toLowerCase()}</Td>
                <Td className="text-right tabular-nums">{rs(l.unitCost)}</Td>
                <Td className="text-right tabular-nums">{rs(Math.round(l.remainingQty * l.unitCost))}</Td>
                <Td>{l.expiresOn ? <Badge tone={isExpired ? "bad" : l.expiresOn <= soon ? "warn" : "neutral"}>{formatDay(isoDate(l.expiresOn))}</Badge> : <span className="text-xs text-ink-mute">—</span>}</Td>
                <Td>
                  {editable && l.remainingQty > 0 && locations.length > 0 ? (
                    <ActionForm action={moveLotAction.bind(null, l.id)} className="flex gap-1" showMessage={false}>
                      <select name="locationId" defaultValue={l.locationId ?? ""} className="field w-36 py-1 text-xs" aria-label="Location">
                        <option value="">—</option>
                        {locations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                      <SubmitButton size="sm" variant="outline">Move</SubmitButton>
                    </ActionForm>
                  ) : (
                    <span className="text-xs">{l.location?.name ?? "—"}</span>
                  )}
                </Td>
              </tr>
            );
          })}
          {!lots.length && <EmptyRow colSpan={7}>No lots match. Receiving a purchase order or recording a receipt opens one.</EmptyRow>}
        </tbody>
      </Table>
    </div>
  );
}
