import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDay } from "@/lib/dates";
import { rs } from "@/lib/money";
import { forecast, requirements, suggestQty } from "@/server/kitchen";
import { PageHeader, Table, Th, Td, EmptyRow, StatCard } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { DayPicker } from "@/components/admin/ops/DayPicker";
import { pickDate, pickKitchen } from "@/components/admin/ops/scope";
import { draftPurchasesAction } from "../actions";

export const metadata = { title: "Ingredient requirements" };

export default async function RequirementsPage({ searchParams }: { searchParams: Promise<{ kitchen?: string; date?: string; buffer?: string }> }) {
  const user = await requirePermission("kitchen");
  const sp = await searchParams;
  const { kitchens, kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return null;
  const date = pickDate(sp.date);
  const buffer = Math.max(0, Math.min(30, parseInt(sp.buffer ?? "5", 10) || 0));
  const f = await forecast(kitchen.id, date, buffer);
  const req = await requirements(kitchen.id, f.dishes.map((d) => ({ menuItemId: d.menuItemId, name: d.name, total: d.total })));
  const short = req.rows.filter((r) => r.short > 0);
  return (
    <div>
      <PageHeader back={{ href: `/admin/kitchen?kitchen=${kitchen.id}&date=${date}`, label: "Kitchen" }} title="Ingredient requirements" description="Dish portions × current recipe (yield and trim waste) vs. stock on hand in this kitchen." />
      <DayPicker path="/admin/kitchen/requirements" date={date} kitchenId={kitchen.id} kitchens={kitchens} extra={{ buffer: String(buffer) }} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Ingredients needed" value={req.rows.length} sub={`${f.meals} meals · ${buffer}% buffer · ${formatDay(date)}`} />
        <StatCard label="Short" value={short.length} tone={short.length ? "warn" : "good"} sub={short.length ? "need buying before cooking" : "stock covers the day"} />
        <StatCard label="Ingredient cost (est.)" value={can(user.role, "dashboard.finance") || can(user.role, "inventory") ? rs(req.estimatedCost) : "—"} sub="at latest purchase prices" />
      </div>
      {req.missingRecipe.length > 0 && <p className="mb-4 rounded-lg border border-besar/50 bg-besar-light px-3 py-2 text-sm">No costed recipe for: {req.missingRecipe.join(", ")} — their ingredients aren't counted.</p>}
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
          {!req.rows.length && <EmptyRow colSpan={6}>No meals booked for this day.</EmptyRow>}
        </tbody>
      </Table>
      {short.length > 0 && can(user.role, "inventory") && (
        <ActionForm action={draftPurchasesAction} className="mt-4">
          <input type="hidden" name="kitchenId" value={kitchen.id} />
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="buffer" value={buffer} />
          <SubmitButton variant="dark">Create draft purchase orders</SubmitButton>
          <p className="mt-1 text-xs text-ink-mute">One draft per supplier; quantities rounded up to each item&apos;s reorder quantity. Review before sending.</p>
        </ActionForm>
      )}
    </div>
  );
}
