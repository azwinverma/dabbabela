import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatDay, isoDate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { InventoryTabs } from "../_components/InventoryTabs";
import { pickKitchen } from "@/components/admin/ops/scope";
import { NewPOForm } from "./NewPOForm";

export const metadata = { title: "Purchase orders" };

const PO_TONE = { DRAFT: "neutral", SENT: "info", PARTIAL: "warn", RECEIVED: "good", CANCELLED: "bad" } as const;

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<{ kitchen?: string; status?: string }> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const { kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return null;
  const [pos, suppliers, ingredients] = await Promise.all([
    db.purchaseOrder.findMany({ where: { kitchenId: kitchen.id, ...(sp.status ? { status: sp.status as never } : {}) }, include: { supplier: { select: { name: true } }, _count: { select: { lines: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.ingredient.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, costPerUnit: true, supplierId: true, purchaseUnit: true, purchaseFactor: true } }),
  ]);
  return (
    <div>
      <PageHeader title="Purchase orders" description="Draft → sent → received. Receiving posts stock and updates ingredient cost." />
      <InventoryTabs current="purchases" qs={`kitchen=${kitchen.id}`} />
      <div className="grid gap-5 xl:grid-cols-[1fr_460px]">
        <Table>
          <thead><tr><Th>PO</Th><Th>Supplier</Th><Th>Expected</Th><Th>Status</Th><Th className="text-right">Total</Th></tr></thead>
          <tbody>
            {pos.map((p) => (
              <tr key={p.id}>
                <Td><Link href={`/admin/inventory/purchases/${p.id}`} className="font-mono font-semibold hover:text-sindoor">{p.number}</Link><div className="text-xs text-ink-mute">{p._count.lines} lines</div></Td>
                <Td>{p.supplier.name}</Td>
                <Td className="text-xs">{p.expectedOn ? formatDay(isoDate(p.expectedOn)) : "—"}</Td>
                <Td><Badge tone={PO_TONE[p.status]}>{p.status.toLowerCase()}</Badge></Td>
                <Td className="text-right tabular-nums">{rs(p.total)}</Td>
              </tr>
            ))}
            {!pos.length && <EmptyRow colSpan={5}>No purchase orders yet.</EmptyRow>}
          </tbody>
        </Table>
        <Panel title="New purchase order">
          <NewPOForm kitchenId={kitchen.id} suppliers={suppliers} ingredients={ingredients} today={todayKTM()} />
        </Panel>
      </div>
    </div>
  );
}
