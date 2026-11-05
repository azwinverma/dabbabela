import { notFound } from "next/navigation";
import { inScope } from "@/components/admin/ops/scope";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/lib/auth";
import { formatDay, formatStamp, isoDate, todayKTM } from "@/lib/dates";
import { rs, rupeesInput } from "@/lib/money";
import { inPurchaseUnits, purchaseReturns, returnedByLine, supplierInvoicesForPO } from "@/server/inventory";
import { PageHeader, Panel, KV, Table, Th, Td } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { PrintButton } from "@/components/admin/ops/PrintButton";
import { ReasonForm } from "@/components/admin/ops/ReasonForm";
import { poStatusAction, receiveAction, returnAction } from "../../actions";

export const metadata = { title: "Purchase order" };
const TONE = { DRAFT: "neutral", SENT: "info", PARTIAL: "warn", RECEIVED: "good", CANCELLED: "bad" } as const;
const unitLabel = (u: string) => (u === "PACK" ? "sack" : u.toLowerCase());

export default async function POPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("inventory.view");
  const { id } = await params;
  const po = await db.purchaseOrder.findUnique({ where: { id }, include: { supplier: true, kitchen: { select: { name: true } }, lines: { include: { ingredient: { select: { name: true, unit: true, shelfLifeDays: true, purchaseUnit: true, purchaseFactor: true } } } } } });
  if (!po || !inScope(user, po.kitchenId)) notFound();
  const editable = can(user, "inventory.edit");
  const open = editable && ["DRAFT", "SENT", "PARTIAL"].includes(po.status);
  const [receipts, returns, returned, invoices, locations] = await Promise.all([
    db.stockMovement.findMany({ where: { reference: po.number, type: "RECEIPT" }, include: { ingredient: { select: { name: true } }, lot: { select: { code: true } } }, orderBy: { createdAt: "desc" } }),
    purchaseReturns(po.id),
    returnedByLine(po),
    supplierInvoicesForPO(po.id),
    db.inventoryLocation.findMany({ where: { kitchenId: po.kitchenId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const returnable = po.lines.filter((l) => l.receivedQty - (returned.get(l.id) ?? 0) > 1e-9);
  return (
    <div>
      <PageHeader back={{ href: `/admin/inventory/purchases?kitchen=${po.kitchenId}`, label: "Purchase orders" }} title={`PO ${po.number}`} description={<Badge tone={TONE[po.status]}>{po.status.toLowerCase()}</Badge>} actions={<PrintButton />} />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Panel title="Lines" bodyClass="p-0">
            <ActionForm action={receiveAction.bind(null, po.id)}>
              <Table className="rounded-none border-0 shadow-none">
                <thead><tr><Th>Item</Th><Th className="text-right">Ordered</Th><Th className="text-right">Received</Th><Th className="text-right">Unit cost</Th><Th className="text-right">Line</Th>{open && <Th className="no-print">Receive now (qty · unit · Rs/unit · expiry · lot)</Th>}</tr></thead>
                <tbody>
                  {po.lines.map((l) => {
                    const left = Math.round((l.quantity - l.receivedQty) * 1000) / 1000;
                    const p = inPurchaseUnits(l.quantity, l.ingredient);
                    const units = [...new Set([l.ingredient.unit, ...(l.ingredient.purchaseUnit ? [l.ingredient.purchaseUnit] : [])])];
                    return (
                      <tr key={l.id}>
                        <Td className="font-medium">{l.ingredient.name}</Td>
                        <Td className="text-right tabular-nums">{l.quantity} {l.ingredient.unit.toLowerCase()}{p && <div className="text-xs text-ink-mute">{p.qty} {unitLabel(p.unit)}</div>}</Td>
                        <Td className="text-right tabular-nums">{l.receivedQty}{(returned.get(l.id) ?? 0) > 0 && <div className="text-xs text-sindoor">−{returned.get(l.id)} returned</div>}</Td>
                        <Td className="text-right tabular-nums">{rs(l.unitCost)}</Td>
                        <Td className="text-right tabular-nums">{rs(Math.round(l.quantity * l.unitCost))}</Td>
                        {open && (
                          <Td className="no-print">
                            {left > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                <input name={`qty_${l.id}`} defaultValue={left} inputMode="decimal" className="field w-20 py-1" aria-label="Quantity received" />
                                <select name={`unit_${l.id}`} defaultValue={l.ingredient.unit} className="field w-20 px-1 py-1" aria-label="Unit">{units.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}</select>
                                <input name={`cost_${l.id}`} defaultValue={rupeesInput(l.unitCost)} inputMode="decimal" className="field w-20 py-1" aria-label="Actual cost per unit chosen" />
                                <input name={`exp_${l.id}`} type="date" min={todayKTM()} className="field w-36 py-1" aria-label="Expiry date" />
                                <input name={`lot_${l.id}`} placeholder="lot / batch no." className="field w-28 py-1" aria-label="Supplier lot code" />
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
                <div className="no-print flex flex-wrap items-center gap-2 border-t border-ink-line/60 p-3">
                  {locations.length > 0 && (
                    <select name="locationId" className="field w-44 py-1" aria-label="Store in">
                      <option value="">No location</option>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  )}
                  <SubmitButton variant="dark" size="sm">Receive goods</SubmitButton>
                  <span className="text-xs text-ink-mute">Each line received opens a lot. Set a quantity to 0 for items that didn&apos;t come.</span>
                </div>
              )}
            </ActionForm>
          </Panel>
          {receipts.length > 0 && (
            <Panel title="Receipts">
              <ul className="space-y-1 text-sm">
                {receipts.map((r) => (
                  <li key={r.id} className="flex justify-between">
                    <span>{r.ingredient.name} +{r.quantity}{r.lot ? ` · lot ${r.lot.code}` : ""}{r.expiresOn ? ` · exp ${formatDay(isoDate(r.expiresOn))}` : ""}</span>
                    <span className="text-xs text-ink-mute">{formatStamp(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {returns.rows.length > 0 && (
            <Panel title={`Returns · credit due ${rs(returns.credit)}`}>
              <ul className="space-y-1 text-sm">
                {returns.rows.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <span>{r.ingredient.name} {r.quantity} {r.ingredient.unit.toLowerCase()} · {rs(r.value)} <span className="text-xs text-ink-mute">{r.note}</span></span>
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
          <Panel title="Supplier invoices">
            {invoices.length ? (
              <ul className="space-y-1 text-sm">
                {invoices.map((i) => (
                  <li key={i.id} className="flex justify-between gap-2"><span className="font-mono">{i.number}</span><span>{rs(i.total)} · {i.status.toLowerCase()}</span></li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-mute">No supplier invoice recorded against this PO yet. Invoices and payments are entered under supplier payables.</p>
            )}
          </Panel>
          {po.status === "DRAFT" && editable && (
            <Panel title="Send">
              <ActionForm action={poStatusAction.bind(null, po.id, "SENT")}>
                <p className="mb-2 text-xs text-ink-mute">Mark as sent once you&apos;ve shared it with the supplier (phone, Viber or printed).</p>
                <SubmitButton size="sm">Mark sent</SubmitButton>
              </ActionForm>
            </Panel>
          )}
          {editable && returnable.length > 0 && (
            <Panel title="Return to supplier">
              <ReasonForm action={returnAction.bind(null, po.id)} label="Post return" placeholder="Reason (damaged, wrong item…) — goes in the audit log" confirm="Post this return? Stock leaves the kitchen now.">
                <div className="space-y-1.5">
                  {returnable.map((l) => (
                    <div key={l.id} className="grid grid-cols-[1fr_64px_64px] items-center gap-1.5 text-sm">
                      <span className="truncate">{l.ingredient.name} <span className="text-xs text-ink-mute">≤ {Math.round((l.receivedQty - (returned.get(l.id) ?? 0)) * 1000) / 1000}</span></span>
                      <input name={`ret_${l.id}`} inputMode="decimal" placeholder="0" className="field py-1" aria-label={`Return quantity for ${l.ingredient.name}`} />
                      <select name={`retunit_${l.id}`} defaultValue={l.ingredient.unit} className="field px-1 py-1" aria-label="Unit">{[...new Set([l.ingredient.unit, ...(l.ingredient.purchaseUnit ? [l.ingredient.purchaseUnit] : [])])].map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}</select>
                    </div>
                  ))}
                </div>
              </ReasonForm>
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
