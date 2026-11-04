import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { rs } from "@/lib/money";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { testArea, toggleZone } from "./actions";

export default async function ZonesPage() {
  await requirePermission("rules.view");
  const [zones, uncovered] = await Promise.all([
    db.deliveryZone.findMany({ orderBy: [{ city: "asc" }, { sortOrder: "asc" }], include: { kitchen: { select: { name: true } }, _count: { select: { addresses: true, orders: true } } } }),
    db.address.groupBy({ by: ["area"], where: { zoneId: null, archivedAt: null }, _count: true, orderBy: { _count: { area: "desc" } }, take: 10 }),
  ]);
  return (
    <>
      <PageHeader title="Delivery zones" description="Coverage is matched on the locality / ward a customer types — no GPS promises. Fees are per delivery day." actions={<Link href="/admin/zones/new" className={buttonClass("primary", "sm")}>New zone</Link>} />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Does an area match?">
          <ActionForm action={testArea} className="grid gap-2 sm:grid-cols-[1fr_90px_1fr_auto] sm:items-end">
            <Input name="area" label="Locality" placeholder="Baneshwor" />
            <Input name="ward" type="number" label="Ward" />
            <Input name="municipality" label="Municipality" placeholder="KMC" />
            <SubmitButton size="sm" variant="dark">Test</SubmitButton>
          </ActionForm>
        </Panel>
        <Panel title="Customers waiting for coverage">
          {uncovered.length === 0 ? (
            <p className="text-sm text-ink-mute">No saved addresses outside the zones.</p>
          ) : (
            <ul className="flex flex-wrap gap-2 text-sm">
              {uncovered.map((u) => (
                <li key={u.area} className="rounded-full border border-ink-line px-3 py-1">
                  {u.area} <b>{u._count}</b>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Zone</Th>
            <Th>Kitchen</Th>
            <Th>Localities</Th>
            <Th className="text-right">Fee</Th>
            <Th className="text-right">Free above</Th>
            <Th className="text-right">Min order</Th>
            <Th>Use</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {zones.length === 0 && <EmptyRow colSpan={8}>No zones yet.</EmptyRow>}
          {zones.map((z) => (
            <tr key={z.id} className={z.isActive ? "" : "opacity-60"}>
              <Td>
                <Link href={`/admin/zones/${z.id}`} className="font-semibold hover:text-sindoor">
                  {z.name}
                </Link>
                <div className="text-xs text-ink-mute">
                  {z.city} {!z.isActive && <Badge>paused</Badge>}
                </div>
              </Td>
              <Td className="text-xs">{z.kitchen.name}</Td>
              <Td className="max-w-sm text-xs text-ink-mute">{z.areas.join(", ")}</Td>
              <Td className="text-right tabular-nums">{rs(z.fee)}</Td>
              <Td className="text-right tabular-nums text-ink-mute">{z.freeAbove != null ? rs(z.freeAbove) : "global"}</Td>
              <Td className="text-right tabular-nums text-ink-mute">{z.minOrder ? rs(z.minOrder) : "—"}</Td>
              <Td className="text-xs text-ink-mute">
                {z._count.addresses} addr · {z._count.orders} orders
              </Td>
              <Td className="text-right">
                <ConfirmAction action={toggleZone.bind(null, z.id)} label={z.isActive ? "Pause" : "Activate"} variant="ghost" />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
