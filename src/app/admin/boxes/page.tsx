import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { rs } from "@/lib/money";
import { pct } from "@/lib/utils";
import { DIET_LABEL } from "@/lib/labels";
import { boxFacts, boxInclude } from "@/server/menu";
import { PageHeader, Table, Th, Td, EmptyRow, FilterBar } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { toggleBox } from "./actions";

export default async function BoxesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requirePermission("menu.view");
  const sp = await searchParams;
  const boxes = await db.lunchBox.findMany({
    where: {
      ...(sp.status === "archived" ? { isActive: false } : sp.status === "all" ? {} : { isActive: true }),
      ...(sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { nameNe: { contains: sp.q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { ...boxInclude, _count: { select: { menuDayItems: true, orderItems: true } } },
  });
  return (
    <>
      <PageHeader title="Dabbas" description="Set boxes offered on the weekly menu. Cost, diet and allergens are worked out from the dishes inside." actions={<Link href="/admin/boxes/new" className={buttonClass("primary", "sm")}>New dabba</Link>} />
      <FilterBar q={sp.q} placeholder="Search dabbas">
        <select name="status" defaultValue={sp.status ?? ""} className="field w-auto" aria-label="Status">
          <option value="">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </FilterBar>
      <Table>
        <thead>
          <tr>
            <Th>Dabba</Th>
            <Th>Diet</Th>
            <Th>Allergens</Th>
            <Th className="text-right">Price</Th>
            <Th className="text-right">Food cost</Th>
            <Th className="text-right">Margin</Th>
            <Th>On menus</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {boxes.length === 0 && <EmptyRow colSpan={8}>No dabbas match.</EmptyRow>}
          {boxes.map((b) => {
            const facts = boxFacts(b);
            const cost = b.costPrice || facts.cost;
            const fc = pct(cost, b.price);
            return (
              <tr key={b.id} className={b.isActive ? "" : "opacity-60"}>
                <Td>
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-12 shrink-0 overflow-hidden rounded-md border border-ink-line/60 bg-paper">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {b.image ? <img src={b.image} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-[9px] text-ink-mute">art</span>}
                    </div>
                    <div>
                      <Link href={`/admin/boxes/${b.id}`} className="font-semibold hover:text-sindoor">
                        {b.name}
                      </Link>
                      <div className="text-xs text-ink-mute">
                        {b.items.map((i) => i.menuItem.name).join(" · ")}
                        {b.isSpecial && <span className="ml-1.5 font-semibold text-besar-dark">special</span>}
                      </div>
                    </div>
                  </div>
                </Td>
                <Td>
                  <Badge tone={facts.isVeg ? "good" : "bad"}>{DIET_LABEL[facts.diet].short}</Badge>
                </Td>
                <Td className="text-xs">{facts.allergens.map((a) => (a.mayContain ? `(${a.code.toLowerCase()})` : a.code.toLowerCase())).join(", ") || "—"}</Td>
                <Td className="text-right tabular-nums font-semibold">{rs(b.price)}</Td>
                <Td className="text-right tabular-nums text-ink-mute">{rs(cost)}</Td>
                <Td className={`text-right tabular-nums ${fc > 55 ? "font-semibold text-sindoor" : ""}`}>{100 - fc}%</Td>
                <Td className="text-xs text-ink-mute">
                  {b._count.menuDayItems} day(s) · {b._count.orderItems} order line(s)
                </Td>
                <Td className="text-right">
                  <ConfirmAction action={toggleBox.bind(null, b.id)} label={b.isActive ? "Archive" : "Restore"} variant="ghost" />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <p className="mt-3 text-xs text-ink-mute">Margin = price minus food + packaging cost, before delivery and staff. Below 45% is highlighted.</p>
    </>
  );
}
