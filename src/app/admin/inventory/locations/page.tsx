import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth";
import { rs } from "@/lib/money";
import { listLocations } from "@/server/inventory";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { pickKitchen } from "@/components/admin/ops/scope";
import { InventoryTabs } from "../_components/InventoryTabs";
import { KitchenSwitch } from "../_components/KitchenSwitch";
import { saveLocationAction } from "../actions";

export const metadata = { title: "Stock locations" };

export default async function LocationsPage({ searchParams }: { searchParams: Promise<{ kitchen?: string }> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const { kitchens, kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return null;
  const editable = can(user, "inventory.edit");
  const { locations, unassigned } = await listLocations(user, kitchen.id, { includeInactive: true });
  return (
    <div>
      <PageHeader title="Stock locations" description={`Where stock sits inside ${kitchen.name} (dry store, chiller, freezer). Receipts and lots can be assigned a location.`} />
      <KitchenSwitch kitchens={kitchens} current={kitchen.id} />
      <InventoryTabs current="locations" qs={`kitchen=${kitchen.id}`} />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <Table>
          <thead><tr><Th>Location</Th><Th className="text-right">Open lots</Th><Th className="text-right">Value</Th>{editable && <Th>Edit</Th>}</tr></thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id} className={l.isActive ? "" : "opacity-50"}>
                <Td className="font-semibold">{l.name}{!l.isActive && <span className="ml-1 text-xs text-ink-mute">archived</span>}</Td>
                <Td className="text-right tabular-nums">{l.lots}</Td>
                <Td className="text-right tabular-nums">{rs(l.value)}</Td>
                {editable && (
                  <Td>
                    <ActionForm action={saveLocationAction.bind(null, l.id)} className="flex items-center gap-1.5" showMessage={false}>
                      <input type="hidden" name="kitchenId" value={kitchen.id} />
                      <input name="name" defaultValue={l.name} className="field w-40 py-1" aria-label="Name" />
                      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isActive" defaultChecked={l.isActive} /> active</label>
                      <SubmitButton size="sm" variant="outline">Save</SubmitButton>
                    </ActionForm>
                  </Td>
                )}
              </tr>
            ))}
            <tr>
              <Td className="text-ink-mute">No location</Td>
              <Td className="text-right tabular-nums text-ink-mute">{unassigned.lots}</Td>
              <Td className="text-right tabular-nums text-ink-mute">{rs(unassigned.value)}</Td>
              {editable && <Td />}
            </tr>
            {!locations.length && <EmptyRow colSpan={editable ? 4 : 3}>No locations yet — everything is in one place.</EmptyRow>}
          </tbody>
        </Table>
        {editable && (
          <Panel title="Add location">
            <ActionForm action={saveLocationAction.bind(null, null)} className="space-y-2" resetOnSuccess>
              <input type="hidden" name="kitchenId" value={kitchen.id} />
              <input name="name" required minLength={2} placeholder="e.g. Walk-in chiller" className="field" />
              <SubmitButton size="sm" variant="dark">Add</SubmitButton>
            </ActionForm>
          </Panel>
        )}
      </div>
    </div>
  );
}
