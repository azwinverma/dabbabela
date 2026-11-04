import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatStamp, isoDate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { stockOnHand } from "@/server/inventory";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, StatCard } from "@/components/admin/ui";
import { pickKitchen } from "@/components/admin/ops/scope";
import { IngredientForm } from "../../IngredientForm";
import { MovementForm } from "../../MovementForm";

export const metadata = { title: "Ingredient" };

export default async function IngredientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kitchen?: string }> }) {
  const user = await requirePermission("inventory.view");
  const { id } = await params;
  const sp = await searchParams;
  const ing = await db.ingredient.findUnique({ where: { id }, include: { recipeLines: { include: { version: { include: { recipe: { include: { menuItem: { select: { name: true } } } } } } } } } });
  if (!ing) notFound();
  const { kitchen } = await pickKitchen(user, sp.kitchen);
  const [suppliers, allergens, moves, onHand, actors] = await Promise.all([
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.allergen.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
    db.stockMovement.findMany({ where: { ingredientId: id, ...(kitchen ? { kitchenId: kitchen.id } : {}) }, orderBy: { createdAt: "desc" }, take: 100 }),
    kitchen ? stockOnHand(kitchen.id, [id]) : Promise.resolve(new Map<string, number>()),
    db.user.findMany({ where: { role: { not: "CUSTOMER" } }, select: { id: true, name: true } }),
  ]);
  const who = new Map(actors.map((a) => [a.id, a.name]));
  const qty = onHand.get(id) ?? 0;
  const currentRecipes = ing.recipeLines.filter((l) => l.version.recipe.currentVersionId === l.versionId);
  return (
    <div>
      <PageHeader back={{ href: "/admin/inventory/ingredients", label: "Ingredients" }} title={ing.name} description={kitchen ? `Ledger at ${kitchen.name}` : undefined} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="On hand" value={`${qty} ${ing.unit.toLowerCase()}`} tone={qty < ing.safetyStock ? "warn" : "default"} sub={`safety ${ing.safetyStock}`} />
        <StatCard label="Cost per unit" value={rs(ing.costPerUnit)} />
        <StatCard label="Used in" value={currentRecipes.length} sub={currentRecipes.map((l) => l.version.recipe.menuItem.name).join(", ") || "no current recipes"} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Panel title="Details"><IngredientForm ingredient={ing} suppliers={suppliers} allergens={allergens} /></Panel>
          <Table>
            <thead><tr><Th>When</Th><Th>Type</Th><Th className="text-right">Qty</Th><Th className="text-right">Unit cost</Th><Th>Ref / note</Th><Th>By</Th></tr></thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id}>
                  <Td className="text-xs">{formatStamp(m.createdAt)}</Td>
                  <Td className="text-xs font-semibold">{m.type.toLowerCase()}</Td>
                  <Td className={`text-right tabular-nums ${m.quantity < 0 ? "text-sindoor" : "text-saag-dark"}`}>{m.quantity > 0 ? "+" : ""}{m.quantity}</Td>
                  <Td className="text-right tabular-nums">{m.unitCost != null ? rs(m.unitCost) : "—"}</Td>
                  <Td className="text-xs">{[m.reference, m.note, m.expiresOn ? `exp ${isoDate(m.expiresOn)}` : null].filter(Boolean).join(" · ")}</Td>
                  <Td className="text-xs">{m.actorId ? who.get(m.actorId) : "system"}</Td>
                </tr>
              ))}
              {!moves.length && <EmptyRow colSpan={6}>No movements yet.</EmptyRow>}
            </tbody>
          </Table>
        </div>
        {kitchen && <Panel title="Record movement"><MovementForm kitchenId={kitchen.id} ingredients={[]} fixedIngredient={ing.id} today={todayKTM()} /></Panel>}
      </div>
    </div>
  );
}
