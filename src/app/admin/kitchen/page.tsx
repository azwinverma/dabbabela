import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDay, formatStamp } from "@/lib/dates";
import { DIET_LABEL } from "@/lib/labels";
import { mealsAhead, productionDashboard } from "@/server/kitchen";
import { Callout, PageHeader, Panel, StatCard, Table, Th, Td, EmptyRow, OrderBadge } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { DayPicker } from "@/components/admin/ops/DayPicker";
import { pickDate, pickKitchen } from "@/components/admin/ops/scope";
import { advanceBatchAction, kitchenStatusAction, lockDayAction, packingAction, planBatchesAction, startOrdersAction } from "./actions";

export const metadata = { title: "Kitchen" };

type SP = { kitchen?: string; date?: string; buffer?: string };

const ISSUE_TONE = { critical: "bad", warning: "warn", info: "info" } as const;

export default async function KitchenPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("kitchen.view");
  const sp = await searchParams;
  const { kitchens, kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return <PageHeader title="Kitchen" description="No active kitchen yet — add one under Kitchens & slots." />;
  const date = pickDate(sp.date);
  const buffer = Math.max(0, Math.min(30, parseInt(sp.buffer ?? "5", 10) || 0));
  const [d, ahead] = await Promise.all([productionDashboard(kitchen.id, date, { bufferPct: buffer }), mealsAhead(kitchen.id, date, 7)]);
  const f = d.forecast;
  const orders = d.orders;
  const lock = d.lock;
  const qs = `kitchen=${kitchen.id}&date=${date}`;
  const toStart = orders.filter((o) => o.status === "SCHEDULED" || o.status === "CONFIRMED");
  const stations = [...new Set(d.dishes.map((x) => x.station))];
  const canPause = can(user, "kitchen.approve") || can(user, "rules.edit");
  const chip = "rounded-lg border border-ink-line bg-white px-3 py-2 text-sm font-semibold hover:border-ink";

  return (
    <div>
      <PageHeader
        title="Kitchen"
        description="Production dashboard: lock the day after the cut-off, cook in batches, pack with checks. Numbers come from locked order snapshots."
        actions={
          <>
            <Link className={chip} href={`/admin/kitchen/prep?${qs}&buffer=${buffer}`}>Prep sheets</Link>
            <Link className={chip} href={`/admin/kitchen/tickets?${qs}`}>Tickets (KOT)</Link>
            <Link className={chip} href={`/admin/kitchen/labels?${qs}`}>Labels</Link>
            <Link className={chip} href={`/admin/kitchen/requirements?${qs}&buffer=${buffer}`}>Ingredients</Link>
            <Link className={chip} href={`/admin/kitchen/qc?${qs}`}>QC log</Link>
          </>
        }
      />
      <DayPicker path="/admin/kitchen" date={date} kitchenId={kitchen.id} kitchens={kitchens} extra={{ buffer: String(buffer) }} />

      {d.kitchen.status !== "OPEN" && (
        <Callout tone={d.kitchen.status === "CLOSED" ? "bad" : "warn"} title={d.kitchen.status === "CLOSED" ? "Kitchen shut down — no new orders" : "New orders paused"} className="mb-4">
          {d.kitchen.statusNote} Existing orders below still need cooking.
          {canPause && d.kitchen.status === "PAUSED" && (
            <ActionForm action={kitchenStatusAction} className="mt-2">
              <input type="hidden" name="kitchenId" value={kitchen.id} />
              <input type="hidden" name="status" value="OPEN" />
              <SubmitButton size="sm" variant="outline">Resume taking orders</SubmitButton>
            </ActionForm>
          )}
        </Callout>
      )}

      {/* forecast strip */}
      <ul className="no-print mb-4 grid grid-cols-7 gap-1 text-center text-xs">
        {ahead.map((a) => (
          <li key={a.date}>
            <Link href={`/admin/kitchen?kitchen=${kitchen.id}&date=${a.date}&buffer=${buffer}`} className={`block rounded-lg border px-1 py-1.5 hover:border-ink ${a.date === date ? "border-ink bg-ink text-paper" : "border-ink-line/60 bg-white"}`}>
              <span className="font-semibold">{formatDay(a.date)}</span>
              <span className="block text-sm font-bold tabular-nums">{a.meals}</span>
              {a.pending > 0 && <span className="block opacity-70">+{a.pending} unpaid</span>}
            </Link>
          </li>
        ))}
      </ul>

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard label="Meals due" value={f.meals} sub={`${f.orders} orders · ${f.pendingPayment} awaiting payment`} tone="brand" />
        <StatCard label="Capacity" value={`${d.capacity.booked} / ${d.capacity.limit}`} sub={`${d.capacity.left} meals left`} tone={d.capacity.booked > d.capacity.limit ? "warn" : "default"} />
        <StatCard label="Preparation" value={`${d.progress.pct}%`} sub={`${d.progress.done}/${d.progress.batches} batches done · ${d.progress.cooking} cooking`} tone={d.progress.pct === 100 && d.progress.batches ? "good" : "default"} />
        <StatCard label="Packed" value={`${d.packing.packed} / ${d.packing.total}`} sub={d.packing.failedChecks ? `${d.packing.failedChecks} failed check(s)` : `${d.packing.pct}%`} tone={d.packing.failedChecks ? "warn" : "good"} />
        <StatCard label="Ready for dispatch" value={d.readyForDispatch.length} sub={can(user, "dispatch.view") ? <Link href={`/admin/dispatch?${qs}`} className="underline">open dispatch</Link> : "packed, not out yet"} />
        <div className="rounded-xl border border-ink-line/80 bg-white p-4 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-mute">Cut-off {d.cutoff}</p>
          {lock ? (
            <p className="mt-1.5 text-sm font-semibold text-saag-dark">Locked {formatStamp(lock.lockedAt)} · {lock.orderCount} orders</p>
          ) : (
            <>
              <p className="mt-1 text-xs text-ink-mute">{d.afterCutoff ? "Cut-off passed — lock to confirm orders." : "Locking early stops customer changes."}</p>
              {can(user, "kitchen.approve") && (
                <ActionForm action={lockDayAction} className="mt-2">
                  <input type="hidden" name="kitchenId" value={kitchen.id} />
                  <input type="hidden" name="date" value={date} />
                  <SubmitButton size="sm" variant={d.afterCutoff ? "primary" : "outline"} confirm={d.afterCutoff ? undefined : "The cut-off hasn't passed. Lock anyway? Customers won't be able to change orders for this day."}>
                    Lock day
                  </SubmitButton>
                </ActionForm>
              )}
            </>
          )}
        </div>
      </div>

      {d.issues.length > 0 && (
        <Panel title={`Production issues (${d.issues.length})`} className="mb-5">
          <ul className="space-y-1.5">
            {d.issues.map((i, n) => (
              <li key={n}>
                <Callout tone={ISSUE_TONE[i.severity]} className="py-2">
                  {i.message} {i.href && <Link href={i.href} className="font-semibold underline">Open</Link>}
                </Callout>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Panel title="Meals by delivery slot" bodyClass="p-0">
            <Table className="rounded-none border-0 shadow-none">
              <thead>
                <tr>
                  <Th>Slot</Th>
                  <Th className="text-right">Orders</Th>
                  <Th className="text-right">Meals</Th>
                  <Th className="text-right">Not started</Th>
                  <Th className="text-right">Preparing</Th>
                  <Th className="text-right">Ready</Th>
                  <Th className="text-right">Dispatched</Th>
                </tr>
              </thead>
              <tbody>
                {d.bySlot.map((s) => (
                  <tr key={s.slot}>
                    <Td className="font-semibold">{s.slot}</Td>
                    <Td className="text-right tabular-nums">{s.orders}</Td>
                    <Td className="text-right font-semibold tabular-nums">{s.meals}</Td>
                    <Td className="text-right tabular-nums">{s.notStarted || "—"}</Td>
                    <Td className="text-right tabular-nums">{s.preparing || "—"}</Td>
                    <Td className="text-right tabular-nums">{s.ready || "—"}</Td>
                    <Td className="text-right tabular-nums">{s.dispatched || "—"}</Td>
                  </tr>
                ))}
                {!d.bySlot.length && <EmptyRow colSpan={7}>No meals for this day yet.</EmptyRow>}
              </tbody>
            </Table>
          </Panel>

          <Panel
            title="Production batches"
            actions={
              <ActionForm action={planBatchesAction} className="flex items-center gap-2" showMessage={false}>
                <input type="hidden" name="kitchenId" value={kitchen.id} />
                <input type="hidden" name="date" value={date} />
                <label className="text-xs text-ink-mute">
                  Buffer % <input name="buffer" type="number" min={0} max={30} defaultValue={buffer} className="field ml-1 inline w-16 py-1" />
                </label>
                <SubmitButton size="sm" variant="dark">{d.batches.length ? "Refresh plan" : "Plan batches"}</SubmitButton>
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
                {d.batches.map((b) => (
                  <tr key={b.id}>
                    <Td className="font-semibold">
                      {b.menuItem.name}
                      {b.assignedTo && <div className="text-xs font-normal text-ink-mute">cook: {b.assignedTo}</div>}
                    </Td>
                    <Td className="text-xs">{b.station}</Td>
                    <Td className="text-right tabular-nums">
                      {b.plannedPortions} + {b.bufferPortions}
                      {b.actualPortions != null && <div className="text-xs text-ink-mute">cooked {b.actualPortions}{b.wastePortions ? ` · waste ${b.wastePortions}` : ""}</div>}
                    </Td>
                    <Td>
                      <Badge tone={b.status === "DONE" ? "good" : b.status === "COOKING" ? "brand" : b.status === "CANCELLED" ? "bad" : "neutral"}>{b.status.toLowerCase()}</Badge>
                      {b.stockPosted && <div className="mt-0.5 text-[11px] text-ink-mute">stock posted</div>}
                      {d.shortages.recorded.some((s) => s.batchId === b.id) && <div className="mt-0.5 text-[11px] font-semibold text-sindoor">stock short</div>}
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
                      {(b.status === "PLANNED" || b.status === "COOKING") && (
                        <details className="mt-1 text-xs">
                          <summary className="cursor-pointer text-ink-mute">Cancel…</summary>
                          <ActionForm action={advanceBatchAction.bind(null, b.id, "CANCELLED")} className="mt-1 flex gap-1">
                            <input name="notes" placeholder="Why?" className="field w-32 py-1" required />
                            <SubmitButton size="sm" variant="ghost">Cancel batch</SubmitButton>
                          </ActionForm>
                        </details>
                      )}
                      {b.status === "CANCELLED" && b.notes && <span className="text-xs text-ink-mute">{b.notes}</span>}
                    </Td>
                  </tr>
                ))}
                {!d.batches.length && <EmptyRow colSpan={5}>{f.meals ? "Plan batches to start cooking." : "No meals for this day yet."}</EmptyRow>}
              </tbody>
            </Table>
            <p className="px-4 py-2 text-xs text-ink-mute">“Done” records cooked and wasted portions and deducts ingredients from stock once, using the recipe version in force. Stock that wasn&apos;t there is recorded as a shortage and shown above.</p>
          </Panel>

          <Panel title="Dishes by recipe" bodyClass="p-0">
            <Table className="rounded-none border-0 shadow-none">
              <thead>
                <tr>
                  <Th>Dish</Th>
                  <Th className="text-right">Portions</Th>
                  <Th>Ingredients (gross, incl. trim)</Th>
                  <Th>Batch</Th>
                </tr>
              </thead>
              <tbody>
                {d.dishes.map((x) => (
                  <tr key={x.menuItemId}>
                    <Td className="font-semibold">
                      {x.name}
                      <div className="text-xs font-normal text-ink-mute">{x.station}</div>
                    </Td>
                    <Td className="text-right tabular-nums">
                      <b>{x.total}</b> <span className="text-xs text-ink-mute">({x.portions}+{x.buffer})</span>
                    </Td>
                    <Td className="text-xs">{x.hasRecipe ? x.lines.map((l) => `${l.name} ${l.gross} ${l.unit.toLowerCase()}`).join(" · ") : <span className="font-semibold text-sindoor">no recipe</span>}</Td>
                    <Td>{x.batch ? <Badge tone={x.batch.status === "DONE" ? "good" : x.batch.status === "COOKING" ? "brand" : x.batch.status === "CANCELLED" ? "bad" : "neutral"}>{x.batch.status.toLowerCase()}{x.batch.stale ? " · stale" : ""}</Badge> : <span className="text-xs text-ink-mute">not planned</span>}</Td>
                  </tr>
                ))}
                {!d.dishes.length && <EmptyRow colSpan={4}>No dishes yet.</EmptyRow>}
              </tbody>
            </Table>
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
          {d.kitchen.status === "OPEN" && canPause && (
            <Panel title="Pause new orders">
              <ActionForm action={kitchenStatusAction} className="space-y-2">
                <input type="hidden" name="kitchenId" value={kitchen.id} />
                <input type="hidden" name="status" value="PAUSED" />
                <input name="reason" placeholder="Reason, e.g. gas outage" className="field w-full" required minLength={3} />
                <SubmitButton size="sm" variant="outline" confirm="Stop new orders for this kitchen now? Existing orders stay.">Pause orders</SubmitButton>
              </ActionForm>
            </Panel>
          )}
          <Panel title={`Shortages (${d.shortages.forecast.length + d.shortages.recorded.length})`}>
            <ul className="space-y-1 text-sm">
              {d.shortages.forecast.map((r) => (
                <li key={r.ingredientId} className="flex justify-between gap-2">
                  <span>{r.name}</span>
                  <span className="tabular-nums text-sindoor">−{r.short} {r.unit.toLowerCase()}</span>
                </li>
              ))}
              {d.shortages.recorded.map((r, i) => (
                <li key={`${r.batchId}-${r.ingredientId}-${i}`} className="flex justify-between gap-2">
                  <span>
                    {r.name} <span className="text-xs text-ink-mute">used by {r.dish} ({r.type.toLowerCase()})</span>
                  </span>
                  <span className="tabular-nums font-semibold text-sindoor">−{r.shortage} {r.unit.toLowerCase()}</span>
                </li>
              ))}
              {!d.shortages.forecast.length && !d.shortages.recorded.length && <li className="text-ink-mute">Stock covers the day.</li>}
            </ul>
            {d.shortages.forecast.length > 0 && (
              <Link href={`/admin/kitchen/requirements?${qs}&buffer=${buffer}`} className="mt-2 inline-block text-xs font-semibold text-sindoor hover:underline">
                Ingredient plan & draft purchases →
              </Link>
            )}
          </Panel>
          <Panel title={`Ready for dispatch (${d.readyForDispatch.length})`}>
            <ul className="space-y-1 text-sm">
              {d.readyForDispatch.map((o) => (
                <li key={o.id} className="flex justify-between gap-2">
                  <span className="font-mono font-semibold">#{o.code}</span>
                  <span className="text-xs text-ink-mute">{o.slot ?? "any slot"} · {o.area}</span>
                </li>
              ))}
              {!d.readyForDispatch.length && <li className="text-ink-mute">Nothing packed and waiting.</li>}
            </ul>
            <p className="mt-2 text-xs text-ink-mute">Tickets printed: {d.tickets.printed}/{d.tickets.total}</p>
          </Panel>
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
                  {d.dishes
                    .filter((x) => x.station === st)
                    .map((x) => (
                      <li key={x.menuItemId} className="flex justify-between gap-2">
                        <span>{x.name}</span>
                        <span className="tabular-nums">
                          <b>{x.total}</b> <span className="text-xs text-ink-mute">({x.portions}+{x.buffer})</span>
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
              {f.diets.map((x) => (
                <Badge key={x.diet} tone={DIET_LABEL[x.diet].veg ? "good" : "warn"}>
                  {DIET_LABEL[x.diet].label}: {x.meals}
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
            {f.allergenFlagged > 0 && <p className="mt-2 text-xs font-semibold text-sindoor">{f.allergenFlagged} order(s) carry a customer allergy note.</p>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
