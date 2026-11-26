import { notFound } from "next/navigation";
import { requireCompanyAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { rs } from "@/lib/money";
import { teamInvoice } from "@/server/team";
import { invoicePayMethods } from "@/server/invoice-payments";
import { InvoiceDocument } from "@/components/admin/finance/InvoiceDocument";
import { PrintButton } from "@/components/admin/finance/PrintButton";
import { Callout } from "@/components/admin/ui";
import { InvoicePay } from "./InvoicePay";

export default async function TeamInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ payment?: string; reason?: string }> }) {
  const { company } = await requireCompanyAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const inv = await teamInvoice(company.id, id).catch(() => null);
  if (!inv) notFound();
  const outstanding = inv.total - inv.paidAmount;
  const payable = inv.kind === "INVOICE" && (inv.status === "ISSUED" || inv.status === "PARTIALLY_PAID") && outstanding > 0;
  const [settings, methods] = payable ? await Promise.all([getSettings(), invoicePayMethods()]) : [null, []];
  return (
    <div>
      {sp.payment === "paid" && (
        <Callout tone="good" title="Payment received — thank you" className="mb-4 print:hidden">
          {inv.status === "PAID" ? "This invoice is now fully paid." : `${rs(outstanding)} is still outstanding.`}
        </Callout>
      )}
      {sp.payment === "pending" && (
        <Callout tone="info" title="Waiting for the gateway to confirm" className="mb-4 print:hidden">
          We&apos;ll mark the invoice paid as soon as the gateway confirms — usually within a few minutes. No need to pay again.
        </Callout>
      )}
      {sp.payment === "failed" && (
        <Callout tone="bad" title="The payment didn't go through" className="mb-4 print:hidden">
          {sp.reason ? `${sp.reason.slice(0, 200)} — ` : ""}No money was taken by us. Try again or pay by bank transfer.
        </Callout>
      )}
      {payable && settings && <InvoicePay invoiceId={inv.id} number={inv.number} outstanding={rs(outstanding)} methods={methods} bankDetails={settings.bankDetails} qrImage={settings.qrImage} />}
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton label="Print / save PDF" />
      </div>
      <InvoiceDocument invoice={inv} />
    </div>
  );
}
