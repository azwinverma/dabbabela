import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can, ROLE_LABEL, STAFF_ROLES } from "@/lib/permissions";
import { addDays, dateOnly, formatDay, isoDate, isValidISODate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { dayCapacity, kitchenOrderProblem } from "@/server/capacity";
import { inScope } from "@/components/admin/ops/scope";
import { kitchenPerformance, kitchenStaff, mealsAhead, upcomingOrders } from "@/server/kitchen";
import { Callout, PageHeader, Panel, StatCard, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Checkbox, Select } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { assignManagerAction, assignStaffAction, deleteCapacity, removeStaffAction, saveCapacity, saveHoursAction, saveKitchen, saveSlot, setStatusAction } from "../actions";
import { StatusBadge } from "../StatusBadge";

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;
const pct = (n: number | null) => (n == null ? "—" : `${n}%`);

export default async function KitchenPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requirePermission("rules.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!inScope(user, id)) notFound();
  const today = todayKTM();
  const k = await db.kitchen.findUnique({
    where: { id },
    include: { slots: { orderBy: { sortOrder: "asc" } }, capacities: { where: { date: { gte: dateOnly(today) } }, orderBy: { date: "asc" } }, zones: { orderBy: { sortOrder: "asc" } } },
  });
  if (!k) notFound();
  const to = sp.to && isValidISODate(sp.to) ? sp.to : today;
  const from = sp.from && isValidISODate(sp.from) && sp.from <= to ? sp.from : addDays(to, -29);
  const editRules = can(user, "rules.edit");
  const canStatus = editRules || can(user, "kitchen.approve");
  const canStaff = can(user, "staff.edit");
  const seeMoney = can(user, "expenses.view") || can(user, "analytics.view");
  const [staff, candidates, ahead, upcoming, perf, holidays] = await Promise.all([
    kitchenStaff(k.id),
    db.user.findMany({ where: { role: { in: STAFF_ROLES }, isActive: true }, select: { id: true, name: true, role: true, kitchenId: true, scopes: { select: { kitchenId: true } } }, orderBy: { name: "asc" } }),
    mealsAhead(k.id, today, 7),
    upcomingOrders(k.id),
    kitchenPerformance(k.id, from, to),
    db.holiday.findMany({ where: { date: { gte: dateOnly(today), lte: dateOnly(addDays(today, 30)) }, OR: [{ kitchenId: null }, { kitchenId: k.id }] }, orderBy: { date: "asc" } }),
  ]);
  const caps = await Promise.all(ahead.map((d) => dayCapacity(k.id, d.date)));
  const staffIds = new Set(staff.map((s) => s.id));
  // a manager must be able to work here: unscoped staff or staff already linked to this kitchen
  const managerOptions = candidates.filter((c) => staffIds.has(c.id) || (!c.kitchenId && !c.scopes.some((s) => s.kitchenId)));
  const addable = candidates.filter((c) => !staffIds.has(c.id));
  const gate = kitchenOrderProblem(k, today);

  return (
    <>
      <PageHeader
        title={k.name}
        back={{ href: "/admin/kitchens", label: "Kitchens" }}
        description={`${k.code} · ${k.city}`}
        actions={
          can(user, "kitchen.view") && (
            <Link className="rounded-lg border border-ink-line bg-white px-3 py-2 text-sm font-semibold hover:border-ink" href={`/admin/kitchen?kitchen=${k.id}`}>
              Production dashboard
            </Link>
          )
        }
      />

      <Panel title={<span className="flex items-center gap-2">Status <StatusBadge status={k.status} isActive={k.isActive} /></span>} className="mb-6">
        {gate ? <Callout tone={k.status === "CLOSED" ? "bad" : "warn"} title="Not taking new orders" className="mb-3">{gate}. {upcoming} upcoming order(s) are kept — move or cancel them from Orders if needed.</Callout> : <p className="mb-3 text-sm text-ink-mute">Open and taking orders. {upcoming} upcoming order(s).</p>}
        {canStatus && (
          <ActionForm action={setStatusAction.bind(null, k.id)} className="grid gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-end">
            <Select
              name="status"
              label="Set status"
              defaultValue={k.status}
              options={[
                { value: "OPEN", label: "Open — taking orders" },
                { value: "PAUSED", label: "Paused — temporary stop" },
                ...(editRules ? [{ value: "CLOSED", label: "Shut down" }] : []),
              ]}
            />
            <Input name="reason" label="Reason (required to pause or shut down)" placeholder="Gas line repair until Friday" defaultValue={k.statusNote ?? ""} />
            <SubmitButton size="sm" variant="dark" confirm="Change the kitchen status? Pausing or shutting down stops new orders for this kitchen straight away.">
              Apply
            </SubmitButton>
          </ActionForm>
        )}
        <p className="mt-2 text-xs text-ink-mute">Paused or shut-down kitchens refuse new orders, plan days and add-ons at checkout; existing orders stay and still need cooking. Every change is in the audit log.</p>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Kitchen">
          <ActionForm action={saveKitchen.bind(null, k.id)} className="grid gap-3 sm:grid-cols-2">
            <Input name="name" label="Name" defaultValue={k.name} />
            <Input name="code" label="Code" defaultValue={k.code} />
            <Input name="city" label="City" defaultValue={k.city} />
            <Input name="phone" label="Phone" defaultValue={k.phone ?? ""} />
            <Input name="address" label="Address" defaultValue={k.address ?? ""} className="sm:col-span-2" />
            <Input name="dailyCapacity" type="number" min={0} label="Default daily capacity (meals)" defaultValue={k.dailyCapacity} />
            <Checkbox name="isActive" label="Active (listed)" defaultChecked={k.isActive} className="pt-6" />
            {editRules && <SubmitButton size="sm">Save kitchen</SubmitButton>}
          </ActionForm>
          <p className="mt-4 text-xs text-ink-mute">
            Zones:{" "}
            {k.zones.map((z) => (
              <Link key={z.id} href={`/admin/zones/${z.id}`} className="mr-2 font-medium text-ink hover:text-sindoor">
                {z.name}
              </Link>
            ))}
          </p>
        </Panel>

        <Panel title="Manager, hours and working days">
          <ActionForm action={assignManagerAction.bind(null, k.id)} className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <Select name="managerId" label="Kitchen manager" defaultValue={k.managerId ?? ""} placeholder="No manager" options={managerOptions.map((m) => ({ value: m.id, label: `${m.name} · ${ROLE_LABEL[m.role]}` }))} />
            {editRules && <SubmitButton size="sm" variant="outline">Save manager</SubmitButton>}
          </ActionForm>
          <ActionForm action={saveHoursAction.bind(null, k.id)} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Input name="openTime" type="time" label="Opens" defaultValue={k.openTime ?? ""} />
              <Input name="closeTime" type="time" label="Closes" defaultValue={k.closeTime ?? ""} />
            </div>
            <fieldset>
              <legend className="label">Working days (none ticked = every service day)</legend>
              <div className="flex flex-wrap gap-3">
                {DAYS.map((d) => (
                  <label key={d} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="workingDays" value={d} defaultChecked={k.workingDays.includes(d)} className="h-4 w-4 accent-saag" /> {d}
                  </label>
                ))}
              </div>
            </fieldset>
            {editRules && <SubmitButton size="sm" variant="outline">Save hours</SubmitButton>}
          </ActionForm>
          <div className="mt-4 border-t border-ink-line/60 pt-3 text-sm">
            <p className="label">Closures in the next 30 days</p>
            <ul className="space-y-0.5">
              {holidays.map((h) => (
                <li key={h.id}>
                  <b>{formatDay(isoDate(h.date))}</b> — {h.name} <span className="text-xs text-ink-mute">({h.kitchenId ? "this kitchen" : "all kitchens"})</span>
                </li>
              ))}
              {!holidays.length && <li className="text-ink-mute">None.</li>}
            </ul>
            <Link href="/admin/holidays" className="mt-1 inline-block text-xs font-semibold text-sindoor hover:underline">
              Manage closures & disruptions →
            </Link>
          </div>
        </Panel>

        <Panel title="Capacity — next 7 days">
          <ul className="mb-4 grid grid-cols-7 gap-1 text-center text-xs">
            {ahead.map((d, i) => (
              <li key={d.date} className={`rounded-lg border px-1 py-2 ${d.meals + d.pending > caps[i] ? "border-sindoor bg-sindoor-light/50" : "border-ink-line/60"}`}>
                <div className="font-semibold">{formatDay(d.date)}</div>
                <div className="mt-1 text-sm font-bold tabular-nums">{d.meals}</div>
                <div className="text-ink-mute">of {caps[i]}</div>
                {d.pending > 0 && <div className="text-besar">+{d.pending} unpaid</div>}
              </li>
            ))}
          </ul>
          <p className="label">Overrides (festivals, short staff)</p>
          {editRules && (
            <ActionForm action={saveCapacity.bind(null, k.id)} resetOnSuccess className="mb-4 grid gap-2 sm:grid-cols-[150px_120px_1fr_auto] sm:items-end">
              <Input name="date" type="date" label="Date" />
              <Input name="maxMeals" type="number" min={0} label="Max meals" />
              <Input name="note" label="Why" placeholder="Tihar — half staff" />
              <SubmitButton size="sm">Set</SubmitButton>
            </ActionForm>
          )}
          <ul className="space-y-1.5 text-sm">
            {k.capacities.length === 0 && <li className="text-ink-mute">No overrides — every day uses {k.dailyCapacity} meals.</li>}
            {k.capacities.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg border border-ink-line/60 px-3 py-1.5">
                <span>
                  <b>{formatDay(isoDate(c.date))}</b> — {c.maxMeals} meals {c.note && <span className="text-xs text-ink-mute">· {c.note}</span>}
                </span>
                {editRules && <ConfirmAction action={deleteCapacity.bind(null, c.id)} label="Clear" variant="ghost" />}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={`Staff (${staff.length})`}>
          <ul className="mb-3 divide-y divide-ink-line/60 text-sm">
            {staff.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
                <span>
                  <Link href={`/admin/staff/${s.id}`} className="font-semibold hover:text-sindoor">
                    {s.name}
                  </Link>{" "}
                  <span className="text-xs text-ink-mute">
                    {ROLE_LABEL[s.role]}
                    {s.staffRole ? ` + ${s.staffRole.name}` : ""}
                    {s.primary ? " · primary kitchen" : ""}
                    {s.kitchens > 1 ? ` · ${s.kitchens} kitchens` : ""}
                    {k.managerId === s.id ? " · manager" : ""}
                    {!s.isActive ? " · disabled" : ""}
                  </span>
                </span>
                {canStaff && !s.primary && <ConfirmAction action={removeStaffAction.bind(null, k.id, s.id)} label="Remove" variant="ghost" confirm={`Remove ${s.name} from ${k.name}?`} />}
              </li>
            ))}
            {!staff.length && <li className="py-1.5 text-ink-mute">No staff assigned. Unassigned staff can see every kitchen.</li>}
          </ul>
          {canStaff && addable.length > 0 && (
            <ActionForm action={assignStaffAction.bind(null, k.id)} resetOnSuccess className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
              <Select name="userId" label="Assign staff" placeholder="Pick a staff member" options={addable.map((c) => ({ value: c.id, label: `${c.name} · ${ROLE_LABEL[c.role]}` }))} />
              <SubmitButton size="sm" variant="outline">Assign</SubmitButton>
            </ActionForm>
          )}
          <p className="mt-2 text-xs text-ink-mute">Assigning adds this kitchen to their scope — staff with a scope only see their assigned kitchens. Roles and primary kitchen are on the staff page.</p>
        </Panel>
      </div>

      <Panel
        title="Performance"
        className="mt-6"
        actions={
          <form className="flex items-end gap-2 text-xs">
            <label className="font-semibold text-ink-mute">
              From <input type="date" name="from" defaultValue={from} className="field ml-1 inline w-36 py-1" />
            </label>
            <label className="font-semibold text-ink-mute">
              To <input type="date" name="to" defaultValue={to} className="field ml-1 inline w-36 py-1" />
            </label>
            <button className="rounded-lg bg-ink px-3 py-1.5 font-semibold text-paper">Go</button>
          </form>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Meals" value={perf.meals} sub={`${perf.orders} orders · ${formatDay(from)} – ${formatDay(to)}`} />
          <StatCard label="On-time packing" value={pct(perf.onTimePacking.pct)} sub={`${perf.onTimePacking.onTime} of ${perf.onTimePacking.measured} packed before their window`} tone={perf.onTimePacking.pct != null && perf.onTimePacking.pct < 90 ? "warn" : "default"} />
          <StatCard label="QC pass rate" value={pct(perf.qc.passPct)} sub={`${perf.qc.fail} failed of ${perf.qc.total} checks`} tone={perf.qc.fail ? "warn" : "default"} />
          <StatCard label="Waste" value={pct(perf.waste.costPct)} sub={`of ingredient cost · ${pct(perf.waste.portionPct)} of cooked portions`} tone={(perf.waste.costPct ?? 0) > 8 ? "warn" : "default"} />
          <StatCard label="Food cost / meal" value={seeMoney ? rs(perf.costPerMeal.recipe) : "—"} sub={seeMoney ? `recipe · actual ${rs(perf.costPerMeal.actual)}${perf.costPerMeal.uncostedDishes ? ` · ${perf.costPerMeal.uncostedDishes} dish(es) without recipe` : ""}` : "needs finance or analytics access"} />
        </div>
        {seeMoney && (
          <div className="mt-4">
            <p className="label">Operating costs (approved expenses for this kitchen)</p>
            <Table>
              <thead>
                <tr>
                  <Th>Category</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </thead>
              <tbody>
                {perf.operatingCosts.byCategory.map((c) => (
                  <tr key={c.key}>
                    <Td>{c.name}</Td>
                    <Td className="text-right tabular-nums">{rs(c.amount)}</Td>
                  </tr>
                ))}
                {!perf.operatingCosts.byCategory.length && <EmptyRow colSpan={2}>No approved expenses for this kitchen in the period.</EmptyRow>}
                {perf.operatingCosts.byCategory.length > 0 && (
                  <tr>
                    <Td className="font-semibold">Total {perf.operatingCosts.perMeal != null && <span className="text-xs font-normal text-ink-mute">· {rs(perf.operatingCosts.perMeal)} per meal</span>}</Td>
                    <Td className="text-right font-semibold tabular-nums">{rs(perf.operatingCosts.total)}</Td>
                  </tr>
                )}
              </tbody>
            </Table>
            <p className="mt-1 text-xs text-ink-mute">
              Read-only; amounts before tax. Manage on <Link href="/admin/expenses" className="font-semibold text-sindoor hover:underline">Expenses</Link>.
            </p>
          </div>
        )}
        <p className="mt-3 text-xs text-ink-mute">On time = first “packed” before the order&apos;s delivery window starts (orders without a window aren&apos;t measured; unpacked after the window counts as late). Waste = WASTE ÷ (USAGE + WASTE) cost on the stock ledger. Recipe food cost uses current recipes × dishes ordered.</p>
      </Panel>

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
            {[...k.slots, ...(editRules ? [null] : [])].map((s) => (
              <tr key={s?.id ?? "new"}>
                <Td colSpan={7} className="p-0">
                  <ActionForm action={saveSlot.bind(null, k.id, s?.id ?? null)} resetOnSuccess={!s} showMessage className="grid grid-cols-2 items-end gap-2 px-3 py-2 md:grid-cols-[1.4fr_1fr_1fr_1fr_80px_80px_auto]">
                    <Input name="label" defaultValue={s?.label ?? ""} placeholder={s ? "" : "New window, e.g. 12:30 – 1:00"} aria-label="Label" />
                    <Input name="startTime" type="time" defaultValue={s?.startTime ?? ""} aria-label="Start" />
                    <Input name="endTime" type="time" defaultValue={s?.endTime ?? ""} aria-label="End" />
                    <Input name="capacity" type="number" min={0} defaultValue={s?.capacity ?? 80} aria-label="Capacity" />
                    <Input name="sortOrder" type="number" defaultValue={s?.sortOrder ?? k.slots.length + 1} aria-label="Order" />
                    <Checkbox name="isActive" label="" defaultChecked={s?.isActive ?? true} aria-label="Active" className="pb-2" />
                    {editRules ? <SubmitButton size="sm" variant={s ? "outline" : "primary"}>{s ? "Save" : "Add"}</SubmitButton> : <span />}
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
