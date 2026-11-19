import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDay } from "@/lib/dates";
import { rs } from "@/lib/money";
import { requirementsHorizon, suggestQty } from "@/server/kitchen";
import { PageHeader, Table, Th, Td, EmptyRow, StatCard, Panel } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { DayPicker } from "@/components/admin/ops/DayPicker";
import { pickDate, pickKitchen } from "@/components/admin/ops/scope";
import { draftPurchasesAction } from "../actions";

export const metadata = { title: "Ingredient requirements" };

export default async function RequirementsPage({ searchParams }: { searchParams: Promise<{ kitchen?: string; date?: string; buffer?: string; days?: string }> }) {
  const user = await requirePermission("kitchen.view");
  const sp = await searchParams;
  const { kitchens, kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return null;
  const date = pickDate(sp.date);
  const buffer = Math.max(0, Math.min(30, parseInt(sp.buffer ?? "5", 10) || 0));
  const days = Math.max(1, Math.min(14, parseInt(sp.days ?? "1", 10) || 1));
  const req = await requirementsHorizon(kitchen.id, date, days, buffer);
  const meals = req.perDay.reduce((a, d) => a + d.meals, 0);
  const short = req.rows.filter((r) => r.short > 0);
  const period = days > 1 ? `${formatDay(req.from)} – ${formatDay(req.to)}` : formatDay(date);
  return (
    <div>
      <PageHeader back={{ href: `/admin/kitchen?kitchen=${kitchen.id}&date=${date}`, label: "Kitchen" }} title="Ingredient requirements" description="Dish portions × current recipe (scaled with yield and trim waste — the same maths used when batches post stock) vs. stock on hand in this kitchen." />
      <DayPicker path="/admin/kitchen/requirements" date={date} kitchenId={kitchen.id} kitchens={kitchens} extra={{ buffer: String(buffer) }}>
        <label className="text-xs font-semibold text-ink-mute">
          Horizon
          <select name="days" defaultValue={String(days)} className="field mt-1 w-28">
            {[1, 2, 3, 5, 7, 14].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1 day" : `${n} days`}
              </option>
            ))}
          </select>
        </label>
      </DayPicker>
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Ingredients needed" value={req.rows.length} sub={`${meals} meals · ${buffer}% buffer · ${period}`} />
        <StatCard label="Short" value={short.length} tone={short.length ? "warn" : "good"} sub={short.length ? "need buying before cooking" : "stock covers the period"} />
        <StatCard label="Ingredient cost (est.)" value={can(user, "analytics.view") || can(user, "inventory.view") ? rs(req.estimatedCost) : "—"} sub="at latest purchase prices" />
      </div>
      {days > 1 && (
        <Panel title="Meals per day" className="mb-5">
          <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-7">
            {req.perDay.map((d) => (
              <li key={d.date} className="rounded-lg border border-ink-line/60 px-2 py-1.5">
                <b>{formatDay(d.date)}</b> <span className="tabular-nums">{d.meals}</span>
                {d.pendingPayment > 0 && <span className="block text-xs text-ink-mute">+{d.pendingPayment} unpaid orders</span>}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-mute">Later days fill up until their cut-off; plan purchases with that in mind.</p>
        </Panel>
      )}
      {req.missingRecipe.length > 0 && <p className="mb-4 rounded-lg border border-besar/50 bg-besar-light px-3 py-2 text-sm">No costed recipe for: {req.missingRecipe.join(", ")} — their ingredients aren&apos;t counted.</p>}
      <Table>
        <thead>
          <tr>
            <Th>Ingredient</Th>
            <Th className="text-right">Need</Th>
            <Th className="text-right">On hand</Th>
            <Th className="text-right">Short</Th>
            <Th className="text-right">Suggest buying</Th>
            <Th>Supplier</Th>
          </tr>
        </thead>
        <tbody>
          {req.rows.map((r) => (
            <tr key={r.ingredientId} className={r.short > 0 ? "bg-sindoor-light/40" : ""}>
              <Td className="font-medium">{r.name}</Td>
              <Td className="text-right tabular-nums">{r.need} {r.unit.toLowerCase()}</Td>
              <Td className="text-right tabular-nums">{r.onHand}</Td>
              <Td className="text-right font-semibold tabular-nums">{r.short || "—"}</Td>
              <Td className="text-right tabular-nums">{r.short ? `${suggestQty(r.short, r.reorderQty)} ${r.unit.toLowerCase()}` : "—"}</Td>
              <Td className="text-xs">{r.supplierName ?? <span className="text-sindoor">none set</span>}</Td>
            </tr>
          ))}
          {!req.rows.length && <EmptyRow colSpan={6}>No meals booked for this period.</EmptyRow>}
        </tbody>
      </Table>
      {short.length > 0 && can(user, "inventory.edit") && (
        <ActionForm action={draftPurchasesAction} className="mt-4">
          <input type="hidden" name="kitchenId" value={kitchen.id} />
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="buffer" value={buffer} />
          <input type="hidden" name="days" value={days} />
          <SubmitButton variant="dark">Create draft purchase orders</SubmitButton>
          <p className="mt-1 text-xs text-ink-mute">One draft per supplier; quantities rounded up to each item&apos;s reorder quantity. Review before sending.</p>
        </ActionForm>
      )}
      <Panel title="By recipe" className="mt-6" bodyClass="p-0">
        <Table className="rounded-none border-0 shadow-none">
          <thead>
            <tr>
              <Th>Dish</Th>
              <Th className="text-right">Portions</Th>
              <Th>Ingredients (net → gross)</Th>
            </tr>
          </thead>
          <tbody>
            {req.byDish.map((d) => (
              <tr key={d.menuItemId}>
                <Td className="font-semibold">{d.name}</Td>
                <Td className="text-right tabular-nums">{d.portions}</Td>
                <Td className="text-xs">{d.lines.length ? d.lines.map((l) => `${l.name} ${l.net}→${l.gross} ${l.unit.toLowerCase()}`).join(" · ") : <span className="text-sindoor">no recipe</span>}</Td>
              </tr>
            ))}
            {!req.byDish.length && <EmptyRow colSpan={3}>No dishes.</EmptyRow>}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
