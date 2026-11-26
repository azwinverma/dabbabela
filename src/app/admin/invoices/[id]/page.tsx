import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { InvoiceDocument } from "@/components/admin/finance/InvoiceDocument";
import { PrintButton } from "@/components/admin/finance/PrintButton";
import { PageHeader, Panel } from "@/components/admin/ui";
import { IssueButton, PaymentForm, VoidForm, CreditNoteForm } from "../InvoiceForms";
import Link from "next/link";
import { rs } from "@/lib/money";
import { ktmNow, todayKTM } from "@/lib/dates";
import { invoiceReceipts } from "@/server/invoices";
import { openInvoicePayments } from "@/server/invoice-payments";
import { inCompanyScope, RECEIPT_METHOD_LABEL } from "@/server/corporate";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("invoices.view");
  const { id } = await params;
  const inv = await db.invoice.findUnique({ where: { id }, include: { lines: true, company: true } });
  if (!inv || (inv.companyId && !inCompanyScope(user, inv.companyId))) notFound();
  const [notes, related, receipts, online] = await Promise.all([
    db.invoice.findMany({ where: { relatedId: inv.id }, select: { id: true, number: true, total: true } }),
    inv.relatedId ? db.invoice.findUnique({ where: { id: inv.relatedId }, select: { id: true, number: true } }) : null,
    invoiceReceipts(inv.id),
    openInvoicePayments(inv.id),
  ]);
  const received = receipts.reduce((a, r) => a + r.amount, 0);
  const open = inv.kind === "INVOICE" && ["ISSUED", "PARTIALLY_PAID"].includes(inv.status);

  return (
    <div>
      <div className="print:hidden">
        <PageHeader title={`${inv.kind === "CREDIT_NOTE" ? "Credit note" : "Invoice"} ${inv.number}`} back={{ href: "/admin/invoices", label: "Invoices" }} actions={<PrintButton label="Print / PDF" />} />
        <Panel className="mb-4">
          <div className="flex flex-col gap-3">
            {inv.status === "DRAFT" && (
              <div className="flex flex-wrap items-center gap-3">
                <IssueButton id={inv.id} />
                <span className="text-xs text-ink-mute">Check the lines first. Issuing sets the due date from the company&apos;s terms.</span>
              </div>
            )}
            {open && <PaymentForm id={inv.id} today={todayKTM()} />}
            {inv.kind === "INVOICE" && ["ISSUED", "PARTIALLY_PAID", "PAID"].includes(inv.status) && <CreditNoteForm id={inv.id} />}
            {inv.kind === "INVOICE" && inv.status !== "VOID" && inv.paidAmount === 0 && <VoidForm id={inv.id} />}
            {(notes.length > 0 || related) && (
              <p className="text-sm">
                {related && (
                  <>
                    Credits invoice <Link className="text-sindoor underline" href={`/admin/invoices/${related.id}`}>{related.number}</Link>.{" "}
                  </>
                )}
                {notes.map((n) => (
                  <Link key={n.id} className="mr-2 text-sindoor underline" href={`/admin/invoices/${n.id}`}>
                    {n.number}
                  </Link>
                ))}
              </p>
            )}
            {receipts.length > 0 && (
              <div>
                <p className="text-sm font-semibold">
                  Receipts · {rs(received)} received{received !== inv.paidAmount ? ` (settled ${rs(inv.paidAmount)} incl. credit notes / earlier payments)` : ""}
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-ink-soft" aria-label="Receipts">
                  {receipts.map((r) => (
                    <li key={r.id}>
                      {ktmNow(r.receivedAt).date} · {rs(r.amount)} · {RECEIPT_METHOD_LABEL[r.method] ?? r.method} · {r.reference}
                      {r.note ? ` — ${r.note}` : ""}
                      {r.paymentId && (
                        <>
                          {" · "}
                          <Link className="text-sindoor underline" href={`/admin/payments/${r.paymentId}`}>
                            online payment
                          </Link>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {online.length > 0 && (
              <div data-testid="online-invoice-payments">
                <p className="text-sm font-semibold">Online payment in progress</p>
                <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
                  {online.map((p) => (
                    <li key={p.id}>
                      <Link className="text-sindoor underline" href={`/admin/payments/${p.id}`}>
                        {p.reference}
                      </Link>{" "}
                      · {rs(p.amount)} · {p.method === "ESEWA" ? "eSewa" : "Khalti"} · {p.status === "FAILED" ? "last try failed" : "waiting for the gateway"} · started by {p.user.name}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-ink-mute">Recording a payment, a credit note or voiding cancels it (the company is asked to start again for the new balance).</p>
              </div>
            )}
            {inv.note && <pre className="whitespace-pre-wrap rounded-lg bg-paper p-2 text-xs text-ink-soft">{inv.note}</pre>}
          </div>
        </Panel>
      </div>
      <InvoiceDocument invoice={inv} />
    </div>
  );
}
