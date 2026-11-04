import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { dateOnly, todayKTM } from "@/lib/dates";
import { LIVE_STATUSES } from "@/server/transitions";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input } from "@/components/ui/Fields";
import { saveKitchen } from "./actions";

export default async function KitchensPage() {
  await requirePermission("rules");
  const today = dateOnly(todayKTM());
  const kitchens = await db.kitchen.findMany({ orderBy: { createdAt: "asc" }, include: { slots: { orderBy: { sortOrder: "asc" } }, _count: { select: { zones: true } } } });
  const booked = await db.orderItem.groupBy({ by: ["orderId"], where: { order: { deliveryDate: today, status: { in: LIVE_STATUSES } } }, _sum: { quantity: true } });
  const orders = await db.order.findMany({ where: { id: { in: booked.map((b) => b.orderId) } }, select: { id: true, kitchenId: true } });
  const perKitchen = new Map<string, number>();
  for (const b of booked) {
    const k = orders.find((o) => o.id === b.orderId)?.kitchenId;
    if (k) perKitchen.set(k, (perKitchen.get(k) ?? 0) + (b._sum.quantity ?? 0));
  }
  return (
    <>
      <PageHeader title="Kitchens & delivery windows" description="Each delivery zone belongs to one kitchen. Capacity is checked when orders are placed, so a full day or window can't be oversold." />
      <Table className="mb-6">
        <thead>
          <tr>
            <Th>Kitchen</Th>
            <Th>City</Th>
            <Th className="text-right">Daily capacity</Th>
            <Th className="text-right">Booked today</Th>
            <Th>Windows</Th>
            <Th>Zones</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {kitchens.length === 0 && <EmptyRow colSpan={7}>No kitchens yet.</EmptyRow>}
          {kitchens.map((k) => (
            <tr key={k.id}>
              <Td>
                <Link href={`/admin/kitchens/${k.id}`} className="font-semibold hover:text-sindoor">
                  {k.name}
                </Link>
                <div className="text-xs text-ink-mute">{k.code}</div>
              </Td>
              <Td>{k.city}</Td>
              <Td className="text-right tabular-nums">{k.dailyCapacity}</Td>
              <Td className="text-right tabular-nums">{perKitchen.get(k.id) ?? 0}</Td>
              <Td className="text-xs">{k.slots.map((s) => `${s.label} (${s.capacity})`).join(" · ") || "—"}</Td>
              <Td>{k._count.zones}</Td>
              <Td>
                <Badge tone={k.isActive ? "good" : "neutral"}>{k.isActive ? "open" : "closed"}</Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Panel title="Add a kitchen" className="max-w-3xl">
        <ActionForm action={saveKitchen.bind(null, null)} className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <Input name="name" label="Name" placeholder="Biratnagar kitchen" />
          <Input name="code" label="Code" placeholder="BRT-1" />
          <Input name="city" label="City" placeholder="Biratnagar" />
          <Input name="dailyCapacity" type="number" label="Daily capacity (meals)" defaultValue={200} />
          <input type="hidden" name="isActive" value="on" />
          <SubmitButton size="sm">Add kitchen</SubmitButton>
        </ActionForm>
      </Panel>
    </>
  );
}
