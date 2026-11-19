import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { dateOnly, todayKTM } from "@/lib/dates";
import { LIVE_STATUSES } from "@/server/transitions";
import { dayCapacity } from "@/server/capacity";
import { kitchenScopeOf } from "@/server/kitchen";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input } from "@/components/ui/Fields";
import { saveKitchen } from "./actions";
import { StatusBadge } from "./StatusBadge";

export default async function KitchensPage() {
  const user = await requirePermission("rules.view");
  const scope = kitchenScopeOf(user);
  const today = todayKTM();
  const kitchens = await db.kitchen.findMany({
    where: scope ? { id: { in: scope } } : {},
    orderBy: { createdAt: "asc" },
    include: { slots: { orderBy: { sortOrder: "asc" } }, _count: { select: { zones: true, staffScopes: true } } },
  });
  const ids = kitchens.map((k) => k.id);
  const [items, upcoming, managers] = await Promise.all([
    db.orderItem.findMany({ where: { order: { kitchenId: { in: ids }, deliveryDate: dateOnly(today), status: { in: LIVE_STATUSES } } }, select: { quantity: true, order: { select: { kitchenId: true } } } }),
    db.order.groupBy({ by: ["kitchenId"], where: { kitchenId: { in: ids }, deliveryDate: { gte: dateOnly(today) }, status: { in: ["PENDING_PAYMENT", "SCHEDULED", "CONFIRMED", "PREPARING"] } }, _count: { _all: true } }),
    db.user.findMany({ where: { id: { in: kitchens.map((k) => k.managerId).filter(Boolean) as string[] } }, select: { id: true, name: true } }),
  ]);
  const caps = new Map(await Promise.all(kitchens.map(async (k) => [k.id, await dayCapacity(k.id, today)] as const)));
  const perKitchen = new Map<string, number>();
  for (const i of items) perKitchen.set(i.order.kitchenId, (perKitchen.get(i.order.kitchenId) ?? 0) + i.quantity);
  const upcomingBy = new Map(upcoming.map((u) => [u.kitchenId, u._count._all]));
  const managerName = new Map(managers.map((m) => [m.id, m.name]));
  return (
    <>
      <PageHeader title="Kitchens & delivery windows" description="Each delivery zone belongs to one kitchen. Capacity and kitchen status are checked when orders are placed, so a full, paused or shut-down kitchen can't be oversold." />
      <Table className="mb-6">
        <thead>
          <tr>
            <Th>Kitchen</Th>
            <Th>Status</Th>
            <Th>Manager</Th>
            <Th>Hours</Th>
            <Th className="text-right">Today</Th>
            <Th className="text-right">Upcoming orders</Th>
            <Th>Windows</Th>
            <Th>Zones</Th>
          </tr>
        </thead>
        <tbody>
          {kitchens.length === 0 && <EmptyRow colSpan={8}>No kitchens yet.</EmptyRow>}
          {kitchens.map((k) => (
            <tr key={k.id}>
              <Td>
                <Link href={`/admin/kitchens/${k.id}`} className="font-semibold hover:text-sindoor">
                  {k.name}
                </Link>
                <div className="text-xs text-ink-mute">
                  {k.code} · {k.city}
                </div>
              </Td>
              <Td>
                <StatusBadge status={k.status} isActive={k.isActive} />
                {k.statusNote && <div className="mt-0.5 max-w-[14rem] truncate text-xs text-ink-mute" title={k.statusNote}>{k.statusNote}</div>}
              </Td>
              <Td className="text-sm">{k.managerId ? managerName.get(k.managerId) ?? "—" : <span className="text-ink-mute">none</span>}</Td>
              <Td className="text-xs">
                {k.openTime && k.closeTime ? `${k.openTime}–${k.closeTime}` : "—"}
                <div className="text-ink-mute">{k.workingDays.length ? k.workingDays.join(" ") : "every service day"}</div>
              </Td>
              <Td className="text-right tabular-nums">
                {perKitchen.get(k.id) ?? 0} / {caps.get(k.id) ?? k.dailyCapacity}
              </Td>
              <Td className="text-right tabular-nums">{upcomingBy.get(k.id) ?? 0}</Td>
              <Td className="text-xs">{k.slots.map((s) => `${s.label} (${s.capacity})`).join(" · ") || "—"}</Td>
              <Td>{k._count.zones}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {can(user, "rules.edit") && !scope && (
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
      )}
    </>
  );
}
