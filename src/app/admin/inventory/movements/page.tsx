import Link from "next/link";
import type { Prisma, StockMovementType } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { addDays, dateOnly, formatStamp, isValidISODate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { PageHeader, Table, Th, Td, EmptyRow, Pagination } from "@/components/admin/ui";
import { InventoryTabs } from "../_components/InventoryTabs";
import { pickKitchen } from "@/components/admin/ops/scope";

export const metadata = { title: "Stock movements" };
const PER = 100;

export default async function MovementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const { kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return null;
  const from = sp.from && isValidISODate(sp.from) ? sp.from : addDays(todayKTM(), -7);
  const to = sp.to && isValidISODate(sp.to) ? sp.to : todayKTM();
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where: Prisma.StockMovementWhereInput = { kitchenId: kitchen.id, createdAt: { gte: dateOnly(from), lt: dateOnly(addDays(to, 1)) }, ...(sp.type ? { type: sp.type as StockMovementType } : {}) };
  const [rows, total, actors] = await Promise.all([
    db.stockMovement.findMany({ where, include: { ingredient: { select: { name: true, unit: true } }, lot: { select: { code: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PER, take: PER }),
    db.stockMovement.count({ where }),
    db.user.findMany({ where: { role: { not: "CUSTOMER" } }, select: { id: true, name: true } }),
  ]);
  const who = new Map(actors.map((a) => [a.id, a.name]));
  return (
    <div>
      <PageHeader title="Stock movements" description="Append-only ledger. To correct a mistake, record an adjustment with a reason." />
      <InventoryTabs current="movements" qs={`kitchen=${kitchen.id}`} />
      <form className="mb-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="kitchen" value={kitchen.id} />
        <label className="text-xs font-semibold text-ink-mute">From<input type="date" name="from" defaultValue={from} className="field mt-1" /></label>
        <label className="text-xs font-semibold text-ink-mute">To<input type="date" name="to" defaultValue={to} className="field mt-1" /></label>
        <select name="type" defaultValue={sp.type ?? ""} className="field w-40" aria-label="Type"><option value="">All types</option>{["RECEIPT", "USAGE", "WASTE", "ADJUSTMENT", "RETURN", "TRANSFER_OUT", "TRANSFER_IN"].map((t) => <option key={t} value={t}>{t.toLowerCase().replace("_", " ")}</option>)}</select>
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Filter</button>
      </form>
      <Table>
        <thead><tr><Th>When</Th><Th>Ingredient</Th><Th>Type</Th><Th className="text-right">Qty</Th><Th className="text-right">Value</Th><Th>Ref / note</Th><Th>By</Th></tr></thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <Td className="text-xs">{formatStamp(m.createdAt)}</Td>
              <Td><Link href={`/admin/inventory/ingredients/${m.ingredientId}?kitchen=${kitchen.id}`} className="font-medium hover:text-sindoor">{m.ingredient.name}</Link></Td>
              <Td className="text-xs font-semibold">{m.type.toLowerCase().replace("_", " ")}</Td>
              <Td className={`text-right tabular-nums ${m.quantity < 0 ? "text-sindoor" : "text-saag-dark"}`}>{m.quantity > 0 ? "+" : ""}{m.quantity} {m.ingredient.unit.toLowerCase()}</Td>
              <Td className="text-right tabular-nums">{m.unitCost != null ? rs(Math.round(Math.abs(m.quantity) * m.unitCost)) : "—"}</Td>
              <Td className="text-xs">{[m.reference, m.lot ? `lot ${m.lot.code}` : null, m.note].filter(Boolean).join(" · ")}</Td>
              <Td className="text-xs">{m.actorId ? who.get(m.actorId) : "system"}</Td>
            </tr>
          ))}
          {!rows.length && <EmptyRow colSpan={7}>No movements in this range.</EmptyRow>}
        </tbody>
      </Table>
      <Pagination page={page} pages={Math.ceil(total / PER)} params={{ ...sp, from, to, kitchen: kitchen.id }} basePath="/admin/inventory/movements" />
    </div>
  );
}
