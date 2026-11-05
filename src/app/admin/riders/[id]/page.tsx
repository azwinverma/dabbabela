import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDay, isoDate } from "@/lib/dates";
import { rs } from "@/lib/money";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Select, Checkbox } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { deleteRiderAction, saveRiderAction } from "../actions";

export const metadata = { title: "Rider" };

export default async function RiderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("dispatch.view");
  const { id } = await params;
  const rider = await db.user.findUnique({ where: { id }, include: { riderProfile: true } });
  if (!rider || rider.role !== "DELIVERY_AGENT" || rider.deletedAt) notFound();
  const scope = user.kitchenIds;
  if (scope && rider.kitchenId && !scope.includes(rider.kitchenId)) notFound();
  const canEdit = can(user, "dispatch.edit");
  const [kitchens, zones, routes] = await Promise.all([
    db.kitchen.findMany({ where: scope ? { id: { in: scope } } : {}, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.deliveryZone.findMany({ where: { isActive: true, ...(scope ? { kitchenId: { in: scope } } : {}) }, orderBy: [{ kitchenId: "asc" }, { sortOrder: "asc" }], include: { kitchen: { select: { name: true } } } }),
    db.deliveryRoute.findMany({ where: { riderId: id, ...(scope ? { kitchenId: { in: scope } } : {}) }, orderBy: { date: "desc" }, take: 15, include: { _count: { select: { assignments: true } } } }),
  ]);
  const p = rider.riderProfile;

  return (
    <>
      <PageHeader title={rider.name} description={`${rider.email}${rider.isActive ? "" : " · login disabled"}`} back={{ href: "/admin/riders", label: "Riders" }} />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Panel title={p ? "Profile" : "Set up rider profile"}>
          {canEdit ? (
            <ActionForm action={saveRiderAction.bind(null, rider.id)}>
              <div className="grid gap-4 md:grid-cols-2">
                <Input name="vehicle" label="Vehicle" defaultValue={p?.vehicle ?? ""} placeholder="Scooter · Ba 12 Pa 3456" />
                <Input name="phone" label="Work phone" defaultValue={p?.phone ?? ""} placeholder={rider.phoneNumber ?? "98XXXXXXXX"} />
                <Select name="kitchenId" label="Kitchen" defaultValue={rider.kitchenId ?? ""} placeholder={scope ? undefined : "Any kitchen"} options={kitchens.map((k) => ({ value: k.id, label: k.name }))} />
                <Checkbox name="isAvailable" label="Available for routes" defaultChecked={p?.isAvailable ?? true} hint="Unavailable riders aren't offered for new routes" />
              </div>
              <p className="label mt-5">Zones usually covered</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {zones.map((z) => (
                  <Checkbox key={z.id} name="zoneIds" value={z.id} label={`${z.name} · ${z.kitchen.name}`} defaultChecked={p?.zoneIds.includes(z.id)} />
                ))}
                {!zones.length && <p className="text-sm text-ink-mute">No active zones.</p>}
              </div>
              <Textarea name="notes" label="Notes (staff only)" rows={3} className="mt-5" defaultValue={rider.internalNote ?? ""} />
              <div className="mt-5 flex flex-wrap gap-2">
                <SubmitButton>{p ? "Save rider" : "Create profile"}</SubmitButton>
                {p && <ConfirmAction action={deleteRiderAction.bind(null, rider.id)} label="Remove profile" variant="ghost" confirm="Remove this rider profile? The login stays; manage it under Staff." />}
              </div>
            </ActionForm>
          ) : (
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="label">Vehicle</dt><dd>{p?.vehicle ?? "—"}</dd></div>
              <div><dt className="label">Work phone</dt><dd>{p?.phone ?? "—"}</dd></div>
              <div><dt className="label">Available</dt><dd>{p ? (p.isAvailable ? "Yes" : "No") : "No profile"}</dd></div>
            </dl>
          )}
        </Panel>
        <Panel title="Recent routes">
          <Table>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th>Route</Th>
                <Th className="text-right">Stops</Th>
                <Th className="text-right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {routes.length === 0 && <EmptyRow colSpan={4}>No routes yet.</EmptyRow>}
              {routes.map((r) => (
                <tr key={r.id}>
                  <Td className="text-xs">
                    <Link href={`/admin/dispatch?kitchen=${r.kitchenId}&date=${isoDate(r.date)}`} className="hover:text-sindoor">{formatDay(isoDate(r.date))}</Link>
                  </Td>
                  <Td className="text-xs">{r.name} <Badge tone={r.status === "DONE" ? "good" : r.status === "OUT" ? "brand" : "neutral"}>{r.status.toLowerCase()}</Badge></Td>
                  <Td className="text-right tabular-nums">{r._count.assignments}</Td>
                  <Td className="text-right tabular-nums text-ink-mute">{r.cost != null ? rs(r.cost) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
    </>
  );
}
