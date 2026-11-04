import Link from "next/link";
import type { ItemCategory, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { CATEGORY_LABEL, DIET_LABEL } from "@/lib/labels";
import { rs } from "@/lib/money";
import { pct } from "@/lib/utils";
import { PageHeader, Table, Th, Td, EmptyRow, FilterBar, Tabs } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { toggleDish } from "./actions";

const CATS = Object.keys(CATEGORY_LABEL) as ItemCategory[];

export default async function DishesPage({ searchParams }: { searchParams: Promise<{ q?: string; cat?: string; status?: string }> }) {
  await requirePermission("menu.view");
  const sp = await searchParams;
  const cat = CATS.includes(sp.cat as ItemCategory) ? (sp.cat as ItemCategory) : undefined;
  const where: Prisma.MenuItemWhereInput = {
    ...(cat ? { category: cat } : {}),
    ...(sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { nameNe: { contains: sp.q, mode: "insensitive" } }] } : {}),
    ...(sp.status === "archived" ? { isActive: false } : sp.status === "all" ? {} : { isActive: true }),
  };
  const [dishes, counts] = await Promise.all([
    db.menuItem.findMany({
      where,
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { boxItems: true } },
        allergens: { include: { allergen: true } },
        recipe: { include: { currentVersion: { select: { version: true, costPerPortion: true } } } },
      },
    }),
    db.menuItem.groupBy({ by: ["category"], where: { isActive: true }, _count: true }),
  ]);
  const total = counts.reduce((a, c) => a + c._count, 0);
  const q = (c?: string) => `/admin/dishes?${new URLSearchParams({ ...(c ? { cat: c } : {}), ...(sp.q ? { q: sp.q } : {}), ...(sp.status ? { status: sp.status } : {}) })}`;

  return (
    <>
      <PageHeader
        title="Dishes & recipes"
        description="Every component the kitchen cooks. Dabbas are built from these; recipes drive food cost, allergen labels and the prep sheet."
        actions={<Link href="/admin/dishes/new" className={buttonClass("primary", "sm")}>Add dish</Link>}
      />
      <Tabs current={cat ?? "all"} tabs={[{ key: "all", label: "All", href: q(), count: total }, ...CATS.map((c) => ({ key: c, label: CATEGORY_LABEL[c], href: q(c), count: counts.find((x) => x.category === c)?._count ?? 0 }))]} />
      <FilterBar q={sp.q} placeholder="Search dishes (English or नेपाली)">
        {cat && <input type="hidden" name="cat" value={cat} />}
        <select name="status" defaultValue={sp.status ?? ""} className="field w-auto" aria-label="Status">
          <option value="">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </FilterBar>
      <Table>
        <thead>
          <tr>
            <Th>Dish</Th>
            <Th>Category</Th>
            <Th>Allergens</Th>
            <Th className="text-right">Builder price</Th>
            <Th className="text-right">Cost / portion</Th>
            <Th className="text-right">Food cost %</Th>
            <Th>Recipe</Th>
            <Th>Used in</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {dishes.length === 0 && <EmptyRow colSpan={9}>No dishes match.</EmptyRow>}
          {dishes.map((d) => {
            const cost = d.recipe?.currentVersion?.costPerPortion || d.costPrice;
            const fc = pct(cost, d.price);
            return (
              <tr key={d.id} className={d.isActive ? "" : "opacity-60"}>
                <Td>
                  <Link href={`/admin/dishes/${d.id}`} className="font-semibold hover:text-sindoor">
                    {d.name}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-mute">
                    {d.nameNe && <span className="lang-ne">{d.nameNe}</span>}
                    <Badge tone={DIET_LABEL[d.diet].veg ? "good" : "bad"}>{DIET_LABEL[d.diet].short}</Badge>
                    {!d.dietVerified && <span title="Preparation not yet verified by the kitchen">unverified</span>}
                    {!d.allowCustom && <span>· not in builder</span>}
                  </div>
                </Td>
                <Td>{CATEGORY_LABEL[d.category]}</Td>
                <Td className="text-xs">
                  {d.allergens.length ? d.allergens.map((a) => (a.mayContain ? `(${a.allergen.code.toLowerCase()})` : a.allergen.code.toLowerCase())).join(", ") : <span className="text-ink-mute">—</span>}
                </Td>
                <Td className="text-right tabular-nums">{rs(d.price)}</Td>
                <Td className="text-right tabular-nums text-ink-mute">{rs(cost)}</Td>
                <Td className={`text-right tabular-nums ${fc > 45 ? "font-semibold text-sindoor" : ""}`}>{d.price ? `${fc}%` : "—"}</Td>
                <Td className="text-xs">{d.recipe?.currentVersion ? `v${d.recipe.currentVersion.version}` : <Badge tone="warn">No recipe</Badge>}</Td>
                <Td className="text-xs text-ink-mute">{d._count.boxItems} dabba(s)</Td>
                <Td className="text-right">
                  <ConfirmAction action={toggleDish.bind(null, d.id)} label={d.isActive ? "Archive" : "Restore"} variant="ghost" />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className="mt-3 text-xs text-ink-mute">Allergens in brackets are “may contain” (shared equipment). Food cost above 45% of the builder price is highlighted.</p>
    </>
  );
}
