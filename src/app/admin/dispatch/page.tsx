import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { dateOnly } from "@/lib/dates";
import { rs } from "@/lib/money";
import { manifest, routeCash } from "@/server/dispatch";
import { PageHeader, Panel, StatCard, OrderBadge } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { DayPicker } from "@/components/admin/ops/DayPicker";
import { ReasonForm } from "@/components/admin/ops/ReasonForm";
import { pickDate, pickKitchen, piiFor } from "@/components/admin/ops/scope";
import { assignAction, completeRouteAction, handInAction, moveAction, resolveFailedAction, riderAction, startRouteAction, unassignAction } from "./actions";

export const metadata = { title: "Dispatch" };

export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ kitchen?: string; date?: string; slot?: string }> }) {
  const user = await requirePermission("dispatch.view");
  const sp = await searchParams;
  const { kitchens, kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return <PageHeader title="Dispatch" description="Add a kitchen first." />;
  const date = pickDate(sp.date);
  const pii = piiFor(user);
  const [groups, slots, zones, riders, routes, failed] = await Promise.all([
    manifest(kitchen.id, date, sp.slot || null),
    db.deliverySlot.findMany({ where: { kitchenId: kitchen.id, isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.deliveryZone.findMany({ where: { kitchenId: kitchen.id, isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.user.findMany({ where: { role: "DELIVERY_AGENT", isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, phoneNumber: true } }),
    db.deliveryRoute.findMany({
      where: { kitchenId: kitchen.id, date: dateOnly(date) },
      include: { rider: { select: { name: true, phoneNumber: true } }, slot: { select: { label: true } }, assignments: { orderBy: { sequence: "asc" }, include: { order: { include: { items: { select: { quantity: true } }, payment: { select: { method: true } } } } } } },
      orderBy: { createdAt: "asc" },
    }),
    db.order.findMany({ where: { kitchenId: kitchen.id, deliveryDate: dateOnly(date), status: "FAILED_DELIVERY" }, include: { deliveryEvents: { orderBy: { createdAt: "desc" }, take: 1 } } }),
  ]);
  const cash = new Map(await Promise.all(routes.map(async (r) => [r.id, await routeCash(r.id)] as const)));
  const all = groups.flatMap((g) => g.stops.flatMap((s) => s.orders));
  const unassigned = all.filter((o) => !o.assignment && !["DELIVERED"].includes(o.status));

  return (
    <div>
      <PageHeader title="Dispatch" description="Group orders by hand-off point, build routes, send riders out, and reconcile the cash they bring back. Routes are plain sequences — no optimisation is claimed." />
      <DayPicker path="/admin/dispatch" date={date} kitchenId={kitchen.id} kitchens={kitchens} extra={{ slot: sp.slot }}>
        <label className="text-xs font-semibold text-ink-mute">
          Slot
          <select name="slot" defaultValue={sp.slot ?? ""} className="field mt-1 w-36">
            <option value="">All</option>
            {slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      </DayPicker>
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label="Orders" value={all.length} sub={`${groups.reduce((a, g) => a + g.stops.length, 0)} hand-off points`} />
        <StatCard label="Not on a route" value={unassigned.length} tone={unassigned.length ? "warn" : "good"} />
        <StatCard label="Out now" value={all.filter((o) => o.status === "OUT_FOR_DELIVERY").length} tone="brand" />
        <StatCard label="Failed" value={failed.length} tone={failed.length ? "warn" : "default"} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_440px]">
        <Panel title="Manifest">
          <ActionForm action={assignAction}>
            <input type="hidden" name="kitchenId" value={kitchen.id} />
            <input type="hidden" name="date" value={date} />
            <div className="sticky top-0 z-10 -mx-4 -mt-4 mb-4 flex flex-wrap items-end gap-2 border-b border-ink-line/60 bg-paper-card px-4 py-3">
              <select name="routeId" className="field w-44" defaultValue="" aria-label="Route">
                <option value="">+ New route…</option>
                {routes.filter((r) => r.status !== "DONE").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <input name="name" placeholder="New route name" className="field w-40" />
              <select name="riderId" className="field w-36" defaultValue="" aria-label="Rider"><option value="">Rider…</option>{riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
              <select name="slotId" className="field w-32" defaultValue={sp.slot ?? ""} aria-label="Slot"><option value="">Any slot</option>{slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
              <select name="zoneId" className="field w-40" defaultValue="" aria-label="Zone"><option value="">Any zone</option>{zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
              <SubmitButton size="sm" variant="dark">Assign ticked</SubmitButton>
            </div>
            {groups.map((g) => (
              <section key={`${g.slot}-${g.zone}`} className="mb-5 last:mb-0">
                <h3 className="mb-2 flex items-baseline justify-between font-display text-sm font-bold">
                  <span>{g.slot} · {g.zone}</span>
                  <span className="text-xs font-normal text-ink-mute">{g.stops.length} stops · {g.stops.reduce((a, s) => a + s.meals, 0)} meals</span>
                </h3>
                <ul className="space-y-2">
                  {g.stops.map((st) => (
                    <li key={st.key} className="rounded-lg border border-ink-line p-3">
                      <div className="flex justify-between gap-2">
                        <div>
                          <p className="font-semibold">{st.placeName ?? st.orders[0].addressLine}</p>
                          <p className="text-xs text-ink-mute">{st.area}{st.landmark ? ` · near ${st.landmark}` : ""}</p>
                        </div>
                        <div className="text-right text-xs">
                          <b>{st.meals} meals</b>
                          {st.cash > 0 && <div className="text-besar-dark">cash {rs(st.cash)}</div>}
                        </div>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {st.orders.map((o) => (
                          <li key={o.id} className="flex flex-wrap items-center gap-2 text-sm">
                            {!o.assignment && o.status !== "DELIVERED" ? <input type="checkbox" name="ids" value={o.id} className="h-4 w-4 accent-sindoor" aria-label={`Select ${o.number}`} /> : <span className="w-4" />}
                            <span className="font-mono text-xs">#{o.code}</span>
                            <span>{o.contactName}</span>
                            <span className="text-xs text-ink-mute">{pii.phone(o.contactPhone)}</span>
                            <OrderBadge status={o.status} />
                            {o.assignment && <Badge tone="info">{o.assignment.route.name}</Badge>}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {!groups.length && <p className="py-8 text-center text-sm text-ink-mute">No orders to dispatch for this day.</p>}
          </ActionForm>
        </Panel>

        <div className="space-y-5">
          {routes.map((r) => {
            const c = cash.get(r.id)!;
            return (
              <Panel
                key={r.id}
                title={
                  <span className="flex items-center gap-2">
                    {r.name} <Badge tone={r.status === "DONE" ? "good" : r.status === "OUT" ? "brand" : "neutral"}>{r.status.toLowerCase()}</Badge>
                  </span>
                }
                actions={<Link href={`/admin/dispatch/manifest?route=${r.id}`} className="text-xs font-semibold text-akash underline">Print</Link>}
              >
                <p className="mb-2 text-xs text-ink-mute">{r.slot?.label ?? "any slot"} · {r.assignments.length} stops · {r.assignments.reduce((a, x) => a + x.order.items.reduce((b, i) => b + i.quantity, 0), 0)} meals</p>
                <ActionForm action={riderAction.bind(null, r.id)} className="mb-3 flex gap-2" showMessage={false}>
                  <select name="riderId" defaultValue={r.riderId ?? ""} className="field" aria-label="Rider"><option value="">No rider</option>{riders.map((x) => <option key={x.id} value={x.id}>{x.name}{x.phoneNumber ? ` · ${x.phoneNumber}` : ""}</option>)}</select>
                  <SubmitButton size="sm" variant="outline">Set</SubmitButton>
                </ActionForm>
                <ol className="space-y-1">
                  {r.assignments.map((a, i) => (
                    <li key={a.id} className="flex items-center gap-2 rounded bg-paper px-2 py-1 text-sm">
                      <span className="w-5 text-right text-xs text-ink-mute">{i + 1}</span>
                      <span className="flex-1 truncate">{a.order.placeName ?? a.order.addressLine} · <span className="font-mono text-xs">#{a.order.code}</span></span>
                      <OrderBadge status={a.order.status} />
                      {r.status !== "DONE" && (
                        <span className="flex gap-0.5">
                          <ConfirmAction action={moveAction.bind(null, r.id, a.orderId, -1)} label="↑" variant="ghost" className="h-7 px-1.5" />
                          <ConfirmAction action={moveAction.bind(null, r.id, a.orderId, 1)} label="↓" variant="ghost" className="h-7 px-1.5" />
                          {a.order.status !== "OUT_FOR_DELIVERY" && a.order.status !== "DELIVERED" && <ConfirmAction action={unassignAction.bind(null, a.orderId)} label="×" variant="ghost" className="h-7 px-1.5" />}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.status === "PLANNED" && <ConfirmAction action={startRouteAction.bind(null, r.id)} label="Send out" variant="primary" confirm="Mark packed orders on this route out for delivery? Customers get their hand-off code." />}
                  {r.status === "OUT" && <ConfirmAction action={completeRouteAction.bind(null, r.id)} label="Complete route" variant="dark" />}
                </div>
                <div className="mt-3 rounded-lg border border-ink-line p-3 text-sm">
                  <p className="label">Cash custody</p>
                  <p>Expected {rs(c.expected)} · collected <b>{rs(c.collected)}</b>{c.handedIn != null && <> · handed in <b>{rs(c.handedIn)}</b> <Badge tone={c.variance === 0 ? "good" : "bad"}>{c.variance === 0 ? "matches" : `variance ${rs(c.variance!)}`}</Badge></>}</p>
                  {(c.expected > 0 || c.collected > 0) && (
                    <ActionForm action={handInAction.bind(null, r.id)} className="mt-2 flex flex-wrap gap-2">
                      <input name="amount" inputMode="decimal" placeholder="Cash counted (Rs)" className="field w-36" required />
                      <input name="note" placeholder="Note if it doesn't match" className="field w-44" />
                      <SubmitButton size="sm" variant="outline">Record hand-in</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </Panel>
            );
          })}
          {!routes.length && <p className="rounded-xl border border-dashed border-ink-line p-6 text-center text-sm text-ink-mute">No routes yet. Tick orders in the manifest and assign them to a new route.</p>}

          {failed.length > 0 && (
            <Panel title="Failed deliveries">
              <ul className="space-y-4">
                {failed.map((o) => (
                  <li key={o.id} className="text-sm">
                    <Link href={`/admin/orders/${o.id}`} className="font-semibold hover:text-sindoor">{o.number}</Link> · {o.contactName} · {pii.phone(o.contactPhone)}
                    <p className="text-xs text-sindoor">{o.deliveryEvents[0]?.note}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <ReasonForm action={resolveFailedAction.bind(null, o.id, "RETRY")} label="Retry" placeholder="What changed?" />
                      <ReasonForm action={resolveFailedAction.bind(null, o.id, "CANCEL")} label="Cancel + credit" variant="danger" placeholder="Reason" confirm="Cancel and credit the customer?" />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
