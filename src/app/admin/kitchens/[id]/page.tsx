import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { dateOnly, formatDay, isoDate, todayKTM } from "@/lib/dates";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Checkbox } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { deleteCapacity, saveCapacity, saveKitchen, saveSlot } from "../actions";

export default async function KitchenPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("rules");
  const { id } = await params;
  const k = await db.kitchen.findUnique({
    where: { id },
    include: { slots: { orderBy: { sortOrder: "asc" } }, capacities: { where: { date: { gte: dateOnly(todayKTM()) } }, orderBy: { date: "asc" } }, zones: { orderBy: { sortOrder: "asc" } } },
  });
  if (!k) notFound();
  return (
    <>
      <PageHeader title={k.name} back={{ href: "/admin/kitchens", label: "Kitchens" }} description={`${k.code} · ${k.city}`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Kitchen">
          <ActionForm action={saveKitchen.bind(null, k.id)} className="grid gap-3 sm:grid-cols-2">
            <>
              <>
                <Input name="name" label="Name" defaultValue={k.name} />
                <Input name="code" label="Code" defaultValue={k.code} />
                <Input name="city" label="City" defaultValue={k.city} />
                <Input name="phone" label="Phone" defaultValue={k.phone ?? ""} />
                <Input name="address" label="Address" defaultValue={k.address ?? ""} className="sm:col-span-2" />
                <Input name="dailyCapacity" type="number" min={0} label="Default daily capacity (meals)" defaultValue={k.dailyCapacity} />
                <Checkbox name="isActive" label="Open" defaultChecked={k.isActive} className="pt-6" />
                <SubmitButton size="sm">Save kitchen</SubmitButton>
              </>
            </>
          </ActionForm>
          <p className="mt-4 text-xs text-ink-mute">
            Zones: {k.zones.map((z) => <Link key={z.id} href={`/admin/zones/${z.id}`} className="mr-2 font-medium text-ink hover:text-sindoor">{z.name}</Link>)}
          </p>
        </Panel>
        <Panel title="Capacity overrides (festivals, short staff)">
          <ActionForm action={saveCapacity.bind(null, k.id)} resetOnSuccess className="mb-4 grid gap-2 sm:grid-cols-[150px_120px_1fr_auto] sm:items-end">
            <Input name="date" type="date" label="Date" />
            <Input name="maxMeals" type="number" min={0} label="Max meals" />
            <Input name="note" label="Why" placeholder="Tihar — half staff" />
            <SubmitButton size="sm">Set</SubmitButton>
          </ActionForm>
          <ul className="space-y-1.5 text-sm">
            {k.capacities.length === 0 && <li className="text-ink-mute">No overrides — every day uses {k.dailyCapacity} meals.</li>}
            {k.capacities.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg border border-ink-line/60 px-3 py-1.5">
                <span>
                  <b>{formatDay(isoDate(c.date))}</b> — {c.maxMeals} meals {c.note && <span className="text-xs text-ink-mute">· {c.note}</span>}
                </span>
                <ConfirmAction action={deleteCapacity.bind(null, c.id)} label="Clear" variant="ghost" />
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <Panel title="Delivery windows" className="mt-6" bodyClass="p-0">
        <Table className="rounded-none border-0 shadow-none">
          <thead>
            <tr>
              <Th>Label</Th>
              <Th>Start</Th>
              <Th>End</Th>
              <Th>Orders / day</Th>
              <Th>Order</Th>
              <Th>Active</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {k.slots.length === 0 && <EmptyRow colSpan={7}>No windows yet.</EmptyRow>}
            {[...k.slots, null].map((s) => (
              <tr key={s?.id ?? "new"}>
                <Td colSpan={7} className="p-0">
                  <ActionForm action={saveSlot.bind(null, k.id, s?.id ?? null)} resetOnSuccess={!s} showMessage className="grid grid-cols-2 items-end gap-2 px-3 py-2 md:grid-cols-[1.4fr_1fr_1fr_1fr_80px_80px_auto]">
                    <Input name="label" defaultValue={s?.label ?? ""} placeholder={s ? "" : "New window, e.g. 12:30 – 1:00"} aria-label="Label" />
                    <Input name="startTime" type="time" defaultValue={s?.startTime ?? ""} aria-label="Start" />
                    <Input name="endTime" type="time" defaultValue={s?.endTime ?? ""} aria-label="End" />
                    <Input name="capacity" type="number" min={0} defaultValue={s?.capacity ?? 80} aria-label="Capacity" />
                    <Input name="sortOrder" type="number" defaultValue={s?.sortOrder ?? k.slots.length + 1} aria-label="Order" />
                    <Checkbox name="isActive" label="" defaultChecked={s?.isActive ?? true} aria-label="Active" className="pb-2" />
                    <SubmitButton size="sm" variant={s ? "outline" : "primary"}>{s ? "Save" : "Add"}</SubmitButton>
                  </ActionForm>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}
