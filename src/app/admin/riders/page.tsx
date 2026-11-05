import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { addDays, isValidISODate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { deliveryPerformance, listRiders, type PerfRow } from "@/server/dispatch";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, StatCard } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { riderAvailabilityAction } from "./actions";

export const metadata = { title: "Riders" };

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);

function PerfTable({ rows, first }: { rows: PerfRow[]; first: string }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>{first}</Th>
          <Th className="text-right">Delivered</Th>
          <Th className="text-right">On time</Th>
          <Th className="text-right">Failed</Th>
          <Th className="text-right">Per day</Th>
          <Th className="text-right">Cash handled</Th>
          <Th className="text-right">Route cost</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && <EmptyRow colSpan={7}>No delivery events in this period.</EmptyRow>}
        {rows.map((r) => (
          <tr key={r.key}>
            <Td className="font-semibold">{r.label}</Td>
            <Td className="text-right tabular-nums">{r.delivered}</Td>
            <Td className="text-right tabular-nums" title={`${r.onTime} of ${r.withSlot} with a slot`}>{pct(r.onTimeRate)}</Td>
            <Td className="text-right tabular-nums" title={`${r.failed} failed attempt(s)`}>{r.failed} · {pct(r.failedRate)}</Td>
            <Td className="text-right tabular-nums">{r.perDay == null ? "—" : r.perDay.toFixed(1)}</Td>
            <Td className="text-right tabular-nums">{rs(r.cash)}</Td>
            <Td className="text-right tabular-nums text-ink-mute">{r.routes ? `${rs(r.routeCost)} / ${r.routes} route(s)` : "—"}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default async function RidersPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requirePermission("dispatch.view");
  const sp = await searchParams;
  const today = todayKTM();
  const to = sp.to && isValidISODate(sp.to) ? sp.to : today;
  const from = sp.from && isValidISODate(sp.from) && sp.from <= to ? sp.from : addDays(to, -29);
  const canEdit = can(user, "dispatch.edit");
  const [riders, perf, kitchens, zones] = await Promise.all([
    listRiders(user),
    deliveryPerformance({ from, to, kitchenIds: user.kitchenIds }),
    db.kitchen.findMany({ select: { id: true, name: true } }),
    db.deliveryZone.findMany({ select: { id: true, name: true } }),
  ]);
  const kName = new Map(kitchens.map((k) => [k.id, k.name]));
  const zName = new Map(zones.map((z) => [z.id, z.name]));

  return (
    <>
      <PageHeader
        title="Riders"
        description="Rider profiles (vehicle, work phone, kitchen, zones, availability) and delivery performance from the hand-off records. Rider logins are created under Staff with the Delivery rider role. No live location tracking."
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label="Riders" value={riders.length} sub={`${riders.filter((r) => r.riderProfile).length} with a profile`} />
        <StatCard label="Available" value={riders.filter((r) => r.isActive && (r.riderProfile?.isAvailable ?? true)).length} tone="good" />
        <StatCard label="On-time rate" value={pct(perf.total.onTimeRate)} sub={`${perf.total.delivered} delivered · ${from} → ${to}`} tone="brand" />
        <StatCard label="Failed rate" value={pct(perf.total.failedRate)} sub={`${perf.total.failed} failed attempt(s)`} tone={perf.total.failed ? "warn" : "default"} />
      </div>

      <Table className="mb-6">
        <thead>
          <tr>
            <Th>Rider</Th>
            <Th>Work phone</Th>
            <Th>Vehicle</Th>
            <Th>Kitchen</Th>
            <Th>Zones</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {riders.length === 0 && <EmptyRow colSpan={7}>No delivery riders yet. Add a staff login with the Delivery rider role first.</EmptyRow>}
          {riders.map((r) => {
            const p = r.riderProfile;
            const available = p?.isAvailable ?? true;
            return (
              <tr key={r.id} className={r.isActive ? "" : "opacity-60"}>
                <Td>
                  <Link href={`/admin/riders/${r.id}`} className="font-semibold hover:text-sindoor">{r.name}</Link>
                  <div className="text-xs text-ink-mute">{r.email}</div>
                </Td>
                <Td className="text-xs">{p?.phone || r.phoneNumber || "—"}</Td>
                <Td className="text-xs">{p?.vehicle ?? "—"}</Td>
                <Td className="text-xs">{r.kitchenId ? kName.get(r.kitchenId) ?? "?" : "Any kitchen"}</Td>
                <Td className="max-w-xs text-xs text-ink-mute">{p?.zoneIds.length ? p.zoneIds.map((id) => zName.get(id) ?? "?").join(", ") : "—"}</Td>
                <Td>
                  {!r.isActive ? <Badge>login disabled</Badge> : !p ? <Badge tone="warn">no profile</Badge> : <Badge tone={available ? "good" : "neutral"}>{available ? "available" : "unavailable"}</Badge>}
                </Td>
                <Td className="text-right">
                  {canEdit && p && r.isActive && <ConfirmAction action={riderAvailabilityAction.bind(null, r.id, !available)} label={available ? "Mark unavailable" : "Mark available"} variant="ghost" />}
                  {canEdit && !p && <Link href={`/admin/riders/${r.id}`} className="text-xs font-semibold text-akash underline">Set up profile</Link>}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <Panel
        title="Delivery performance"
        actions={
          <form className="flex flex-wrap items-end gap-2 text-xs">
            <label className="font-semibold text-ink-mute">From <input type="date" name="from" defaultValue={from} className="field mt-1 w-36" /></label>
            <label className="font-semibold text-ink-mute">To <input type="date" name="to" defaultValue={to} className="field mt-1 w-36" /></label>
            <button className="h-[38px] rounded-lg bg-ink px-3 text-sm font-semibold text-paper">Go</button>
          </form>
        }
      >
        <p className="mb-3 text-xs text-ink-mute">
          From delivery events for orders due in the period. On time = delivered at or before the slot&apos;s end (Kathmandu time) on the delivery day. Failed rate = failed attempts ÷ (delivered + failed). Per day = deliveries ÷ days with a delivery. Cash = cash recorded as collected. Rider = whoever recorded the event.
        </p>
        <h3 className="mb-2 font-display text-sm font-bold">By rider</h3>
        <PerfTable rows={perf.riders} first="Rider" />
        <h3 className="mb-2 mt-5 font-display text-sm font-bold">By zone</h3>
        <PerfTable rows={perf.zones} first="Zone" />
      </Panel>
    </>
  );
}
