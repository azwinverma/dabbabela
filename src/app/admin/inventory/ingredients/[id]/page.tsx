import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth";
import { formatDay, formatStamp, isoDate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { STANDARD_CONVERSIONS, inPurchaseUnits, lotsFor, stockOnHand } from "@/server/inventory";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, StatCard } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { pickKitchen } from "@/components/admin/ops/scope";
import { IngredientForm } from "../../IngredientForm";
import { MovementForm } from "../../MovementForm";
import { deleteConversionAction, saveConversionAction } from "../../actions";

export const metadata = { title: "Ingredient" };
const UNITS = ["KG", "G", "L", "ML", "PC", "PACK"];

export default async function IngredientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kitchen?: string }> }) {
  const user = await requirePermission("inventory.view");
  const { id } = await params;
  const sp = await searchParams;
  const ing = await db.ingredient.findUnique({ where: { id }, include: { conversions: true, recipeLines: { include: { version: { include: { recipe: { include: { menuItem: { select: { name: true } } } } } } } } } });
  if (!ing) notFound();
  const { kitchen } = await pickKitchen(user, sp.kitchen);
  const editable = can(user, "inventory.edit");
  const [suppliers, allergens, moves, onHand, actors, lots, locations, globalConv] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.allergen.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
    kitchen ? db.stockMovement.findMany({ where: { ingredientId: id, kitchenId: kitchen.id }, include: { lot: { select: { code: true } } }, orderBy: { createdAt: "desc" }, take: 100 }) : Promise.resolve([]),
    kitchen ? stockOnHand(kitchen.id, [id]) : Promise.resolve(new Map<string, number>()),
    db.user.findMany({ where: { role: { not: "CUSTOMER" } }, select: { id: true, name: true } }),
    kitchen ? lotsFor(kitchen.id, { ingredientId: id }) : Promise.resolve([]),
    kitchen ? db.inventoryLocation.findMany({ where: { kitchenId: kitchen.id, isActive: true }, select: { id: true, name: true } }) : Promise.resolve([]),
    db.unitConversion.findMany({ where: { ingredientId: null } }),
  ]);
  const who = new Map(actors.map((a) => [a.id, a.name]));
  const qty = onHand.get(id) ?? 0;
  const purchase = inPurchaseUnits(qty, ing);
  const currentRecipes = ing.recipeLines.filter((l) => l.version.recipe.currentVersionId === l.versionId);
  const unitLabel = (u: string) => (u === "PACK" ? "pack/sack" : u.toLowerCase());
  return (
    <div>
      <PageHeader back={{ href: "/admin/inventory/ingredients", label: "Ingredients" }} title={ing.name} description={kitchen ? `Ledger at ${kitchen.name}` : undefined} />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label="On hand" value={`${qty} ${ing.unit.toLowerCase()}`} tone={qty < 0 ? "warn" : qty <= (ing.reorderPoint ?? ing.safetyStock) ? "warn" : "default"} sub={purchase ? `${purchase.qty} ${unitLabel(purchase.unit)}` : `reorder at ${ing.reorderPoint ?? ing.safetyStock}`} />
        <StatCard label="Cost per unit" value={rs(ing.costPerUnit)} sub={ing.purchaseUnit ? `${rs(Math.round(ing.costPerUnit * ing.purchaseFactor))} per ${unitLabel(ing.purchaseUnit)}` : undefined} />
        <StatCard label="Open lots" value={lots.length} sub={lots[0]?.expiresOn ? `next expiry ${formatDay(isoDate(lots[0].expiresOn))}` : undefined} />
        <StatCard label="Used in" value={currentRecipes.length} sub={currentRecipes.map((l) => l.version.recipe.menuItem.name).join(", ") || "no current recipes"} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Panel title="Details"><IngredientForm ingredient={ing} suppliers={suppliers} allergens={allergens} /></Panel>
          {lots.length > 0 && (
            <Panel title="Lots (first expiry first out)" bodyClass="p-0">
              <Table className="rounded-none border-0 shadow-none">
                <thead><tr><Th>Lot</Th><Th className="text-right">Left / received</Th><Th className="text-right">Unit cost</Th><Th>Expires</Th><Th>Location</Th></tr></thead>
                <tbody>
                  {lots.map((l) => (
                    <tr key={l.id}>
                      <Td className="font-mono text-xs">{l.code}</Td>
                      <Td className="text-right tabular-nums">{l.remainingQty} / {l.receivedQty}</Td>
                      <Td className="text-right tabular-nums">{rs(l.unitCost)}</Td>
                      <Td className="text-xs">{l.expiresOn ? formatDay(isoDate(l.expiresOn)) : "—"}</Td>
                      <Td className="text-xs">{l.location?.name ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}
          <Table>
            <thead><tr><Th>When</Th><Th>Type</Th><Th className="text-right">Qty</Th><Th className="text-right">Unit cost</Th><Th>Ref / note</Th><Th>By</Th></tr></thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id}>
                  <Td className="text-xs">{formatStamp(m.createdAt)}</Td>
                  <Td className="text-xs font-semibold">{m.type.toLowerCase().replace("_", " ")}</Td>
                  <Td className={`text-right tabular-nums ${m.quantity < 0 ? "text-sindoor" : "text-saag-dark"}`}>{m.quantity > 0 ? "+" : ""}{m.quantity}</Td>
                  <Td className="text-right tabular-nums">{m.unitCost != null ? rs(m.unitCost) : "—"}</Td>
                  <Td className="text-xs">{[m.reference, m.lot ? `lot ${m.lot.code}` : null, m.note, m.expiresOn ? `exp ${isoDate(m.expiresOn)}` : null].filter(Boolean).join(" · ")}</Td>
                  <Td className="text-xs">{m.actorId ? who.get(m.actorId) : "system"}</Td>
                </tr>
              ))}
              {!moves.length && <EmptyRow colSpan={6}>No movements yet.</EmptyRow>}
            </tbody>
          </Table>
        </div>
        <div className="space-y-5">
          {kitchen && editable && <Panel title="Record movement"><MovementForm kitchenId={kitchen.id} ingredients={[]} fixedIngredient={{ id: ing.id, name: ing.name, unit: ing.unit, purchaseUnit: ing.purchaseUnit }} locations={locations} today={todayKTM()} /></Panel>}
          <Panel title="Unit conversions">
            <p className="mb-2 text-xs text-ink-mute">Stock is kept in {ing.unit.toLowerCase()}. Purchase orders, receipts and movements can be entered in any unit below.</p>
            <ul className="mb-3 space-y-1 text-sm">
              {ing.purchaseUnit && <li>1 {unitLabel(ing.purchaseUnit)} = {ing.purchaseFactor} {ing.unit.toLowerCase()} <span className="text-xs text-ink-mute">(purchase unit)</span></li>}
              {ing.conversions.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span>1 {unitLabel(c.fromUnit)} = {c.factor} {unitLabel(c.toUnit)}</span>
                  {editable && (
                    <form action={async () => { "use server"; await deleteConversionAction(c.id); }}>
                      <button className="text-xs text-sindoor">remove</button>
                    </form>
                  )}
                </li>
              ))}
              {[...globalConv, ...STANDARD_CONVERSIONS].map((c, i) => <li key={i} className="text-xs text-ink-mute">1 {unitLabel(c.fromUnit)} = {c.factor} {unitLabel(c.toUnit)} (all ingredients)</li>)}
            </ul>
            {editable && (
              <ActionForm action={saveConversionAction.bind(null, ing.id)} className="grid grid-cols-[70px_1fr_70px] items-center gap-1.5 text-sm" resetOnSuccess>
                <span className="text-xs text-ink-mute">1</span>
                <select name="fromUnit" className="field py-1" aria-label="From unit">{UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}</select>
                <span />
                <span className="text-xs text-ink-mute">equals</span>
                <input name="factor" inputMode="decimal" placeholder="e.g. 25" className="field py-1" aria-label="Factor" />
                <select name="toUnit" defaultValue={ing.unit} className="field py-1" aria-label="To unit">{UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}</select>
                <div className="col-span-3"><SubmitButton size="sm">Add conversion</SubmitButton></div>
              </ActionForm>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
