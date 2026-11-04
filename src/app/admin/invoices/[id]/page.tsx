import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { InvoiceDocument } from "@/components/admin/finance/InvoiceDocument";
import { PrintButton } from "@/components/admin/finance/PrintButton";
import { PageHeader, Panel } from "@/components/admin/ui";
import { IssueButton, PaymentForm, VoidForm, CreditNoteForm } from "../InvoiceForms";
import Link from "next/link";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("invoices");
  const { id } = await params;
  const inv = await db.invoice.findUnique({ where: { id }, include: { lines: true, company: true } });
  if (!inv) notFound();
  const [notes, related] = await Promise.all([
    db.invoice.findMany({ where: { relatedId: inv.id }, select: { id: true, number: true, total: true } }),
    inv.relatedId ? db.invoice.findUnique({ where: { id: inv.relatedId }, select: { id: true, number: true } }) : null,
  ]);
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
            {open && <PaymentForm id={inv.id} />}
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
            {inv.note && <pre className="whitespace-pre-wrap rounded-lg bg-paper p-2 text-xs text-ink-soft">{inv.note}</pre>}
          </div>
        </Panel>
      </div>
      <InvoiceDocument invoice={inv} />
    </div>
  );
}
