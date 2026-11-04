import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatDay, formatStamp, isoDate, todayKTM } from "@/lib/dates";
import { rs, rupeesInput } from "@/lib/money";
import { PageHeader, Panel, KV, Table, Th, Td } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { PrintButton } from "@/components/admin/ops/PrintButton";
import { ReasonForm } from "@/components/admin/ops/ReasonForm";
import { poStatusAction, receiveAction } from "../../actions";

export const metadata = { title: "Purchase order" };
const TONE = { DRAFT: "neutral", SENT: "info", PARTIAL: "warn", RECEIVED: "good", CANCELLED: "bad" } as const;

export default async function POPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("inventory");
  const { id } = await params;
  const po = await db.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, kitchen: { select: { name: true } }, lines: { include: { ingredient: { select: { name: true, unit: true, shelfLifeDays: true } } } } } });
  if (!po || (user.kitchenId && po.kitchenId !== user.kitchenId)) notFound();
  const open = ["DRAFT", "SENT", "PARTIAL"].includes(po.status);
  const receipts = await db.stockMovement.findMany({ where: { reference: po.number, type: "RECEIPT" }, include: { ingredient: { select: { name: true } } }, orderBy: { createdAt: "desc" } });
  return (
    <div>
      <PageHeader back={{ href: "/admin/inventory/purchases", label: "Purchase orders" }} title={`PO ${po.number}`} description={<Badge tone={TONE[po.status]}>{po.status.toLowerCase()}</Badge>} actions={<PrintButton />} />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Panel title="Lines" bodyClass="p-0">
            <ActionForm action={receiveAction.bind(null, po.id)}>
              <Table className="rounded-none border-0 shadow-none">
                <thead><tr><Th>Item</Th><Th className="text-right">Ordered</Th><Th className="text-right">Received</Th><Th className="text-right">Unit cost</Th><Th className="text-right">Line</Th>{open && <Th className="no-print">Receive now</Th>}</tr></thead>
                <tbody>
                  {po.lines.map((l) => {
                    const left = Math.round((l.quantity - l.receivedQty) * 1000) / 1000;
                    return (
                      <tr key={l.id}>
                        <Td className="font-medium">{l.ingredient.name}</Td>
                        <Td className="text-right tabular-nums">{l.quantity} {l.ingredient.unit.toLowerCase()}</Td>
                        <Td className="text-right tabular-nums">{l.receivedQty}</Td>
                        <Td className="text-right tabular-nums">{rs(l.unitCost)}</Td>
                        <Td className="text-right tabular-nums">{rs(Math.round(l.quantity * l.unitCost))}</Td>
                        {open && (
                          <Td className="no-print">
                            {left > 0 ? (
                              <div className="flex gap-1">
                                <input name={`qty_${l.id}`} defaultValue={left} inputMode="decimal" className="field w-20 py-1" aria-label="Quantity received" />
                                <input name={`cost_${l.id}`} defaultValue={rupeesInput(l.unitCost)} inputMode="decimal" className="field w-20 py-1" aria-label="Actual unit cost" />
                                <input name={`exp_${l.id}`} type="date" min={todayKTM()} className="field w-36 py-1" aria-label="Expiry date" />
                              </div>
                            ) : (
                              <span className="text-xs text-saag-dark">complete</span>
                            )}
                          </Td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
              {open && (
                <div className="no-print border-t border-ink-line/60 p-3">
                  <SubmitButton variant="dark" size="sm">Receive goods</SubmitButton>
                  <span className="ml-2 text-xs text-ink-mute">Set a quantity to 0 for items that didn&apos;t come.</span>
                </div>
              )}
            </ActionForm>
          </Panel>
          {receipts.length > 0 && (
            <Panel title="Receipts">
              <ul className="space-y-1 text-sm">
                {receipts.map((r) => (
                  <li key={r.id} className="flex justify-between">
                    <span>{r.ingredient.name} +{r.quantity}{r.expiresOn ? ` · exp ${formatDay(isoDate(r.expiresOn))}` : ""}</span>
                    <span className="text-xs text-ink-mute">{formatStamp(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
        <div className="space-y-5">
          <Panel title="Order">
            <KV items={[["Supplier", po.supplier.name], ["Phone", po.supplier.phone], ["Kitchen", po.kitchen.name], ["Expected", po.expectedOn ? formatDay(isoDate(po.expectedOn)) : null], ["Total", rs(po.total)], ["Notes", po.notes], ["Created", formatStamp(po.createdAt)]]} />
          </Panel>
          {po.status === "DRAFT" && (
            <Panel title="Send">
              <ActionForm action={poStatusAction.bind(null, po.id, "SENT")}>
                <p className="mb-2 text-xs text-ink-mute">Mark as sent once you&apos;ve shared it with the supplier (phone, Viber or printed).</p>
                <SubmitButton size="sm">Mark sent</SubmitButton>
              </ActionForm>
            </Panel>
          )}
          {open && (
            <Panel title="Cancel">
              <ReasonForm action={poStatusAction.bind(null, po.id, "CANCELLED")} label="Cancel PO" variant="danger" confirm="Cancel this purchase order?" />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
