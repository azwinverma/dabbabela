import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { rs } from "@/lib/money";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { InventoryTabs } from "../_components/InventoryTabs";
import { IngredientForm } from "../IngredientForm";

export const metadata = { title: "Ingredients" };

export default async function IngredientsPage({ searchParams }: { searchParams: Promise<{ q?: string; kitchen?: string }> }) {
  await requirePermission("inventory.view");
  const sp = await searchParams;
  const [rows, suppliers, allergens] = await Promise.all([
    db.ingredient.findMany({ where: sp.q ? { name: { contains: sp.q, mode: "insensitive" } } : {}, include: { supplier: { select: { name: true } }, _count: { select: { recipeLines: true } } }, orderBy: [{ isActive: "desc" }, { category: "asc" }, { name: "asc" }] }),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.allergen.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
  ]);
  return (
    <div>
      <PageHeader title="Ingredients" description="Stock items used by recipes. Costs are per unit in paisa-exact rupees." />
      <InventoryTabs current="ingredients" qs={sp.kitchen ? `kitchen=${sp.kitchen}` : ""} />
      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        <div>
          <form className="mb-3"><input name="q" defaultValue={sp.q} placeholder="Search ingredients" className="field max-w-xs" /></form>
          <Table>
            <thead><tr><Th>Name</Th><Th>Category</Th><Th>Unit</Th><Th className="text-right">Cost</Th><Th>Allergens</Th><Th>Supplier</Th><Th className="text-right">Recipes</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.isActive ? "" : "opacity-50"}>
                  <Td><Link href={`/admin/inventory/ingredients/${r.id}`} className="font-semibold hover:text-sindoor">{r.name}</Link>{r.nameNe && <span className="lang-ne ml-1 text-xs text-ink-mute">{r.nameNe}</span>}</Td>
                  <Td className="text-xs">{r.category ?? "—"}</Td>
                  <Td>{r.unit.toLowerCase()}{r.purchaseUnit && <div className="text-xs text-ink-mute">buy: {r.purchaseUnit === "PACK" ? "sack" : r.purchaseUnit.toLowerCase()} × {r.purchaseFactor}</div>}</Td>
                  <Td className="text-right tabular-nums">{rs(r.costPerUnit)}</Td>
                  <Td>{r.allergenCodes.map((a) => <Badge key={a} tone="bad" className="mr-1">{a.toLowerCase()}</Badge>)}</Td>
                  <Td className="text-xs">{r.supplier?.name ?? "—"}</Td>
                  <Td className="text-right">{r._count.recipeLines}</Td>
                </tr>
              ))}
              {!rows.length && <EmptyRow colSpan={7} />}
            </tbody>
          </Table>
        </div>
        <Panel title="Add ingredient"><IngredientForm suppliers={suppliers} allergens={allergens} /></Panel>
      </div>
    </div>
  );
}
