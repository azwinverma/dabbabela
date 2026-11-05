import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { rs } from "@/lib/money";
import { formatDay, formatStamp, isoDate, todayKTM } from "@/lib/dates";
import { PageHeader, Panel, KV, Table, Th, Td, EmptyRow, Callout } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { PAY_METHODS, threeWayMatch } from "@/server/finance/payables";
import { FinBadge, label } from "../../expenses/_shared";
import { recordSupplierPaymentAction, reverseSupplierPaymentAction, voidSupplierInvoiceAction } from "../actions";

export const metadata = { title: "Supplier invoice" };

export default async function SupplierInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("purchasing.view");
  const { id } = await params;
  const inv = await db.supplierInvoice.findUnique({ where: { id }, include: { supplier: true, po: { select: { id: true, number: true } }, payments: { orderBy: { createdAt: "asc" } } } });
  if (!inv) notFound();
  const match = await threeWayMatch(id);
  const reversed = new Set(inv.payments.filter((p) => p.reference.startsWith("REV:")).map((p) => p.reference.slice(4)));
  const canPay = can(user, "purchasing.approve");
  const outstanding = inv.total - inv.paidAmount;
  const tone = match.status === "MATCH" ? "good" : match.status === "OVER_INVOICED" ? "bad" : "warn";

  return (
    <div>
      <PageHeader title={`Invoice ${inv.number}`} description={inv.supplier.name} back={{ href: "/admin/payables", label: "Supplier payables" }} actions={<FinBadge status={inv.status} />} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Invoice">
          <KV
            items={[
              ["Supplier", inv.supplier.name],
              ["PAN / VAT", inv.supplier.panVat ?? "—"],
              ["Date", formatDay(isoDate(inv.date), "long")],
              ["Due", inv.dueDate ? formatDay(isoDate(inv.dueDate), "long") : "—"],
              ["Before tax", rs(inv.subtotal)],
              ["Tax", rs(inv.tax)],
              ["Total", rs(inv.total)],
              ["Paid", rs(inv.paidAmount)],
              ["Outstanding", rs(outstanding)],
              ["Purchase order", inv.po ? <Link key="po" className="text-sindoor underline" href={`/admin/inventory/purchases/${inv.po.id}`}>{inv.po.number}</Link> : "—"],
            ]}
          />
          {inv.attachmentUrl && (
            <a href={inv.attachmentUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-sindoor underline">
              View invoice scan
            </a>
          )}
        </Panel>
        <div className="space-y-4 lg:col-span-2">
          <Callout tone={tone} title="Three-way match (PO ↔ received ↔ invoiced)">
            {match.message}
            {match.ordered != null && (
              <span className="mt-1 block text-xs">
                Ordered {rs(match.ordered)} · received {rs(match.received)} · invoiced on this PO {rs(match.invoiced)} (before tax)
              </span>
            )}
          </Callout>
          {canPay && outstanding > 0 && inv.status !== "VOID" && (
            <Panel title="Record a payment">
              <ActionForm action={recordSupplierPaymentAction} resetOnSuccess className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="invoiceId" value={inv.id} />
                <label className={label}>
                  Amount (Rs)
                  <input name="amount" required inputMode="decimal" defaultValue={(outstanding / 100).toFixed(2)} className="field mt-1 w-32" />
                </label>
                <label className={label}>
                  Method
                  <select name="method" required className="field mt-1 w-32" defaultValue="BANK">
                    {PAY_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m.charAt(0) + m.slice(1).toLowerCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={label}>
                  Reference
                  <input name="reference" required maxLength={120} className="field mt-1 w-44" placeholder="Bank txn / cheque no." />
                </label>
                <label className={label}>
                  Paid on
                  <input type="date" name="paidAt" defaultValue={todayKTM()} max={todayKTM()} className="field mt-1 w-40" />
                </label>
                <SubmitButton variant="dark">Record payment</SubmitButton>
              </ActionForm>
            </Panel>
          )}
          <Panel title="Payments" bodyClass="p-0">
            <Table className="rounded-none border-0 shadow-none">
              <thead>
                <tr>
                  <Th>Paid</Th>
                  <Th>Method</Th>
                  <Th>Reference</Th>
                  <Th className="text-right">Amount</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {inv.payments.length ? (
                  inv.payments.map((p) => (
                    <tr key={p.id}>
                      <Td className="whitespace-nowrap text-xs">{formatStamp(p.paidAt)}</Td>
                      <Td>{p.method}</Td>
                      <Td className="font-mono text-xs">{p.reference.startsWith("REV:") ? "Reversal" : p.reference}</Td>
                      <Td className={`text-right tabular-nums ${p.amount < 0 ? "text-sindoor" : ""}`}>{rs(p.amount)}</Td>
                      <Td>
                        {canPay && p.amount > 0 && !reversed.has(p.id) && (
                          <ActionForm action={reverseSupplierPaymentAction} className="flex items-center gap-1">
                            <input type="hidden" name="paymentId" value={p.id} />
                            <input name="reason" required placeholder="Why" aria-label="Reason" className="field h-8 w-32 py-1 text-xs" />
                            <SubmitButton size="sm" variant="outline" pendingText="…" confirm="Reverse this payment with a negative entry?">
                              Reverse
                            </SubmitButton>
                          </ActionForm>
                        )}
                        {reversed.has(p.id) && <span className="text-xs text-ink-mute">Reversed</span>}
                      </Td>
                    </tr>
                  ))
                ) : (
                  <EmptyRow colSpan={5}>No payments yet.</EmptyRow>
                )}
              </tbody>
            </Table>
          </Panel>
          {canPay && inv.paidAmount === 0 && inv.status !== "VOID" && (
            <Panel title="Void invoice">
              <ActionForm action={voidSupplierInvoiceAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={inv.id} />
                <label className={label}>
                  Reason
                  <input name="reason" required className="field mt-1 w-72" />
                </label>
                <SubmitButton variant="danger" size="sm" confirm="Void this invoice? It stays on record.">
                  Void
                </SubmitButton>
              </ActionForm>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
