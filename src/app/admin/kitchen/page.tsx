import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { dateOnly, formatStamp, ktmNow } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { DIET_LABEL } from "@/lib/labels";
import { forecast, kitchenOrders } from "@/server/kitchen";
import { PageHeader, Panel, StatCard, Table, Th, Td, EmptyRow, OrderBadge } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { DayPicker } from "@/components/admin/ops/DayPicker";
import { pickDate, pickKitchen } from "@/components/admin/ops/scope";
import { advanceBatchAction, lockDayAction, packingAction, planBatchesAction, startOrdersAction } from "./actions";

export const metadata = { title: "Kitchen" };

type SP = { kitchen?: string; date?: string; buffer?: string };

export default async function KitchenPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("kitchen");
  const sp = await searchParams;
  const { kitchens, kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return <PageHeader title="Kitchen" description="No active kitchen yet — add one under Kitchens & slots." />;
  const date = pickDate(sp.date);
  const buffer = Math.max(0, Math.min(30, parseInt(sp.buffer ?? "5", 10) || 0));
  const [settings, lock, f, orders, batches] = await Promise.all([
    getSettings(),
    db.dayLock.findUnique({ where: { kitchenId_date: { kitchenId: kitchen.id, date: dateOnly(date) } } }),
    forecast(kitchen.id, date, buffer),
    kitchenOrders(kitchen.id, date),
    db.productionBatch.findMany({ where: { kitchenId: kitchen.id, date: dateOnly(date) }, include: { menuItem: { select: { name: true } } }, orderBy: [{ station: "asc" }, { plannedPortions: "desc" }] }),
  ]);
  const now = ktmNow();
  const afterCutoff = date < now.date || (date === now.date && now.time >= settings.orderCutoff);
  const qs = `kitchen=${kitchen.id}&date=${date}`;
  const toStart = orders.filter((o) => o.status === "SCHEDULED" || o.status === "CONFIRMED");
  const stations = [...new Set(f.dishes.map((d) => d.station))];

  return (
    <div>
      <PageHeader
        title="Kitchen"
        description="Lock the day after the cut-off, cook in batches, pack with checks. Numbers come from locked order snapshots."
        actions={
          <>
            <Link className="rounded-lg border border-ink-line bg-white px-3 py-2 text-sm font-semibold hover:border-ink" href={`/admin/kitchen/prep?${qs}&buffer=${buffer}`}>Prep sheets</Link>
            <Link className="rounded-lg border border-ink-line bg-white px-3 py-2 text-sm font-semibold hover:border-ink" href={`/admin/kitchen/tickets?${qs}`}>Tickets (KOT)</Link>
            <Link className="rounded-lg border border-ink-line bg-white px-3 py-2 text-sm font-semibold hover:border-ink" href={`/admin/kitchen/labels?${qs}`}>Labels</Link>
            <Link className="rounded-lg border border-ink-line bg-white px-3 py-2 text-sm font-semibold hover:border-ink" href={`/admin/kitchen/requirements?${qs}&buffer=${buffer}`}>Ingredients</Link>
            <Link className="rounded-lg border border-ink-line bg-white px-3 py-2 text-sm font-semibold hover:border-ink" href={`/admin/kitchen/qc?${qs}`}>QC log</Link>
          </>
        }
      />
      <DayPicker path="/admin/kitchen" date={date} kitchenId={kitchen.id} kitchens={kitchens} extra={{ buffer: String(buffer) }} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Meals to cook" value={f.meals} sub={`${f.orders} orders`} tone="brand" />
        <StatCard label="Awaiting payment" value={f.pendingPayment} sub="not counted yet" tone={f.pendingPayment ? "warn" : "default"} />
        <StatCard label="Allergy flags" value={f.allergenFlagged} sub="orders with a customer note" tone={f.allergenFlagged ? "warn" : "default"} />
        <StatCard label="Packed" value={orders.filter((o) => ["PACKED", "OUT_FOR_DELIVERY", "DELIVERED"].includes(o.status)).length} sub={`of ${orders.length}`} tone="good" />
        <div className="rounded-xl border border-ink-line/80 bg-white p-4 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-mute">Day lock</p>
          {lock ? (
            <p className="mt-1.5 text-sm font-semibold text-saag-dark">Locked {formatStamp(lock.lockedAt)} · {lock.orderCount} orders</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-ink-mute">{afterCutoff ? "Cut-off passed — lock to confirm orders." : `Cut-off ${settings.orderCutoff}. Locking early stops customer changes.`}</p>
              {can(user.role, "kitchen.lock") && (
                <ActionForm action={lockDayAction} className="mt-2">
                  <input type="hidden" name="kitchenId" value={kitchen.id} />
                  <input type="hidden" name="date" value={date} />
                  <SubmitButton size="sm" variant={afterCutoff ? "primary" : "outline"} confirm={afterCutoff ? undefined : "The cut-off hasn't passed. Lock anyway? Customers won't be able to change orders for this day."}>
                    Lock day
                  </SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Panel
            title="Production batches"
            actions={
              <ActionForm action={planBatchesAction} className="flex items-center gap-2" showMessage={false}>
                <input type="hidden" name="kitchenId" value={kitchen.id} />
                <input type="hidden" name="date" value={date} />
                <label className="text-xs text-ink-mute">
                  Buffer % <input name="buffer" type="number" min={0} max={30} defaultValue={buffer} className="field ml-1 inline w-16 py-1" />
                </label>
                <SubmitButton size="sm" variant="dark">{batches.length ? "Refresh plan" : "Plan batches"}</SubmitButton>
              </ActionForm>
            }
            bodyClass="p-0"
          >
            <Table className="rounded-none border-0 shadow-none">
              <thead>
                <tr>
                  <Th>Dish</Th>
                  <Th>Station</Th>
                  <Th className="text-right">Plan + buffer</Th>
                  <Th>Status</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <Td className="font-semibold">{b.menuItem.name}</Td>
                    <Td className="text-xs">{b.station}</Td>
                    <Td className="text-right tabular-nums">
                      {b.plannedPortions} + {b.bufferPortions}
                      {b.actualPortions != null && <div className="text-xs text-ink-mute">cooked {b.actualPortions}{b.wastePortions ? ` · waste ${b.wastePortions}` : ""}</div>}
                    </Td>
                    <Td>
                      <Badge tone={b.status === "DONE" ? "good" : b.status === "COOKING" ? "brand" : b.status === "CANCELLED" ? "bad" : "neutral"}>{b.status.toLowerCase()}</Badge>
                      {b.stockPosted && <div className="mt-0.5 text-[11px] text-ink-mute">stock posted</div>}
                    </Td>
                    <Td>
                      {b.status === "PLANNED" && (
                        <ActionForm action={advanceBatchAction.bind(null, b.id, "COOKING")} showMessage={false} className="flex gap-1">
                          <input name="assignedTo" placeholder="Cook" className="field w-24 py-1" />
                          <SubmitButton size="sm" variant="outline">Start</SubmitButton>
                        </ActionForm>
                      )}
                      {b.status === "COOKING" && (
                        <ActionForm action={advanceBatchAction.bind(null, b.id, "DONE")} className="flex flex-wrap items-center gap-1">
                          <input name="actual" type="number" min={0} defaultValue={b.plannedPortions + b.bufferPortions} className="field w-20 py-1" aria-label="Portions cooked" />
                          <input name="waste" type="number" min={0} defaultValue={0} className="field w-16 py-1" aria-label="Portions wasted" />
                          <SubmitButton size="sm" variant="dark">Done</SubmitButton>
                        </ActionForm>
                      )}
                    </Td>
                  </tr>
                ))}
                {!batches.length && <EmptyRow colSpan={5}>{f.meals ? "Plan batches to start cooking." : "No meals for this day yet."}</EmptyRow>}
              </tbody>
            </Table>
            <p className="px-4 py-2 text-xs text-ink-mute">“Done” records cooked and wasted portions and deducts ingredients from stock once, using the recipe version in force.</p>
          </Panel>

          <Panel
            title={`Packing board (${orders.length})`}
            actions={
              toStart.length > 0 && (
                <ActionForm action={startOrdersAction} showMessage={false}>
                  {toStart.map((o) => (
                    <input key={o.id} type="hidden" name="ids" value={o.id} />
                  ))}
                  <SubmitButton size="sm" variant="outline">Start all {toStart.length}</SubmitButton>
                </ActionForm>
              )
            }
          >
            <ul className="grid gap-3 md:grid-cols-2">
              {orders.map((o) => {
                const lastCheck = o.packing[0];
                return (
                  <li key={o.id} className="rounded-xl border-2 border-ink-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-lg font-bold">#{o.code}</p>
                        <p className="text-sm font-semibold">{o.user.name}{o.placeName ? ` · ${o.placeName}` : ""}</p>
                        <p className="text-xs text-ink-mute">{o.slotLabel ?? "any slot"} · {o.area}</p>
                      </div>
                      <OrderBadge status={o.status} />
                    </div>
                    <ul className="mt-2 text-sm">
                      {o.items.map((i) => (
                        <li key={i.id}>
                          {i.quantity}× {i.name} <span className="text-xs text-ink-mute">({DIET_LABEL[i.diet].short})</span>
                          {i.customizations.map((c) => (
                            <span key={c.id} className="block text-xs text-akash">↳ {c.label}</span>
                          ))}
                        </li>
                      ))}
                    </ul>
                    {o.allergenNote && <p className="mt-2 rounded bg-sindoor px-2 py-1 text-sm font-bold text-white">⚠ {o.allergenNote}</p>}
                    {["SCHEDULED", "CONFIRMED", "PREPARING"].includes(o.status) && (
                      <ActionForm action={packingAction.bind(null, o.id)} className="mt-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            ["itemsOk", "Items match"],
                            ["labelOk", "Label on"],
                            ["allergenOk", "Allergens checked"],
                            ["sealedOk", "Sealed"],
                          ].map(([n, l]) => (
                            <label key={n} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-ink-line px-2 text-sm font-medium">
                              <input type="checkbox" name={n} className="h-5 w-5 accent-saag" /> {l}
                            </label>
                          ))}
                        </div>
                        <SubmitButton className="w-full" size="md" variant="dark">Packed ✓</SubmitButton>
                        {lastCheck && !(lastCheck.itemsOk && lastCheck.labelOk && lastCheck.allergenOk && lastCheck.sealedOk) && <p className="text-xs font-semibold text-sindoor">Last check failed {formatStamp(lastCheck.createdAt)}</p>}
                      </ActionForm>
                    )}
                  </li>
                );
              })}
              {!orders.length && <li className="py-8 text-center text-sm text-ink-mute md:col-span-2">No confirmed orders for this day.</li>}
            </ul>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Dabbas">
            <ul className="space-y-1.5 text-sm">
              {f.boxes.map((b) => (
                <li key={b.name} className="flex justify-between gap-2">
                  <span>{b.name}</span>
                  <b className="tabular-nums">{b.meals}</b>
                </li>
              ))}
              {!f.boxes.length && <li className="text-ink-mute">Nothing booked.</li>}
            </ul>
          </Panel>
          <Panel title={`Portions by station (+${buffer}%)`}>
            {stations.map((st) => (
              <div key={st} className="mb-3 last:mb-0">
                <p className="label">{st}</p>
                <ul className="space-y-1 text-sm">
                  {f.dishes
                    .filter((d) => d.station === st)
                    .map((d) => (
                      <li key={d.menuItemId} className="flex justify-between gap-2">
                        <span>{d.name}</span>
                        <span className="tabular-nums">
                          <b>{d.total}</b> <span className="text-xs text-ink-mute">({d.portions}+{d.buffer})</span>
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
            {!stations.length && <p className="text-sm text-ink-mute">No dishes yet.</p>}
          </Panel>
          <Panel title="Diet & allergens">
            <div className="flex flex-wrap gap-1.5">
              {f.diets.map((d) => (
                <Badge key={d.diet} tone={DIET_LABEL[d.diet].veg ? "good" : "warn"}>
                  {DIET_LABEL[d.diet].label}: {d.meals}
                </Badge>
              ))}
            </div>
            <p className="label mt-3">Meals containing</p>
            <div className="flex flex-wrap gap-1.5">
              {f.allergens.map((a) => (
                <Badge key={a.code} tone="bad">
                  {a.code.toLowerCase().replace("_", " ")}: {a.meals}
                </Badge>
              ))}
              {!f.allergens.length && <span className="text-sm text-ink-mute">None listed.</span>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
