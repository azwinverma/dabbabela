import { notFound } from "next/navigation";
import { requireCompanyAdmin } from "@/lib/auth";
import { teamInvoice } from "@/server/team";
import { InvoiceDocument } from "@/components/admin/finance/InvoiceDocument";
import { PrintButton } from "@/components/admin/finance/PrintButton";

export default async function TeamInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { company } = await requireCompanyAdmin();
  const { id } = await params;
  const inv = await teamInvoice(company.id, id).catch(() => null);
  if (!inv) notFound();
  return (
    <div>
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton label="Print / save PDF" />
      </div>
      <InvoiceDocument invoice={inv} />
    </div>
  );
}
