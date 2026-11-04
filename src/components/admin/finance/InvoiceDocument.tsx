import type { Invoice, InvoiceLine } from "@prisma/client";
import { rs } from "@/lib/money";
import { formatDay, isoDate } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { INVOICE_STATUS } from "@/lib/labels";
import { LogoMark } from "@/components/brand/Logo";

/** Printable invoice / credit note (A4). Used by the control room and the team portal. */
export async function InvoiceDocument({ invoice: inv }: { invoice: Invoice & { lines: InvoiceLine[] } }) {
  const s = await getSettings();
  const credit = inv.kind === "CREDIT_NOTE";
  return (
    <article className="mx-auto max-w-3xl rounded-xl border border-ink-line bg-white p-8 text-sm shadow-card print:max-w-none print:border-0 print:p-0 print:shadow-none">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b-2 border-ink pb-5">
        <div className="flex items-start gap-3">
          <LogoMark className="h-12 w-12" />
          <div>
            <p className="font-display text-lg font-extrabold">{s.legalName || s.brandName}</p>
            <p className="text-xs text-ink-soft">{s.address}</p>
            <p className="text-xs text-ink-soft">{[s.phone, s.email].filter(Boolean).join(" · ")}</p>
            <p className="text-xs font-semibold">PAN/VAT: {s.panVat || "— (to be added in Settings)"}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl font-extrabold uppercase tracking-wide text-sindoor">{credit ? "Credit note" : inv.tax ? "Tax invoice" : "Invoice"}</p>
          <p className="font-mono text-sm font-semibold">{inv.number}</p>
          <p className="mt-1 text-xs text-ink-soft">Issued: {inv.issuedAt ? formatDay(inv.issuedAt, "long") : "Draft — not issued"}</p>
          {inv.dueDate && !credit && <p className="text-xs text-ink-soft">Due: {formatDay(isoDate(inv.dueDate), "long")}</p>}
          <p className="text-xs font-semibold">{INVOICE_STATUS[inv.status].label}</p>
        </div>
      </header>
      <section className="grid gap-4 py-5 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-mute">Bill to</p>
          <p className="font-semibold">{inv.billingName}</p>
          {inv.billingAddress && <p className="whitespace-pre-line text-ink-soft">{inv.billingAddress}</p>}
          <p className="text-ink-soft">PAN/VAT: {inv.panVat || "—"}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-mute">Period</p>
          <p>
            {formatDay(isoDate(inv.periodStart), "long")} – {formatDay(isoDate(inv.periodEnd), "long")}
          </p>
        </div>
      </section>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-ink text-[11px] uppercase tracking-wide text-ink-mute">
            <th className="py-2 pr-2">Description</th>
            <th className="py-2 pr-2 text-right">Qty</th>
            <th className="py-2 pr-2 text-right">Rate</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.id} className="border-b border-ink-line/60 align-top">
              <td className="py-1.5 pr-2">{l.description}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{l.quantity}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{rs(l.unitPrice, { decimals: true })}</td>
              <td className="py-1.5 text-right tabular-nums">{rs(l.amount, { decimals: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ml-auto mt-4 w-full max-w-xs space-y-1 tabular-nums">
        <div className="flex justify-between">
          <span className="text-ink-soft">Taxable amount</span>
          <span>{rs(inv.subtotal, { decimals: true })}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-soft">VAT</span>
          <span>{rs(inv.tax, { decimals: true })}</span>
        </div>
        <div className="flex justify-between border-t-2 border-ink pt-1 text-base font-bold">
          <span>{credit ? "Credit total" : "Total"}</span>
          <span>{rs(inv.total, { decimals: true })}</span>
        </div>
        {!credit && inv.paidAmount > 0 && (
          <>
            <div className="flex justify-between text-ink-soft">
              <span>Received / credited</span>
              <span>− {rs(inv.paidAmount, { decimals: true })}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Balance due</span>
              <span>{rs(inv.total - inv.paidAmount, { decimals: true })}</span>
            </div>
          </>
        )}
      </div>
      <footer className="mt-8 border-t border-ink-line pt-3 text-xs text-ink-mute">
        {s.bankDetails && <p className="mb-1 whitespace-pre-line">Pay to: {s.bankDetails}</p>}
        <p>Amounts in Nepali rupees. {inv.tax ? "VAT shown is contained in the amounts above where menu prices are VAT-inclusive." : "No VAT charged."} This document was generated by {s.brandName}&apos;s billing system.</p>
      </footer>
    </article>
  );
}
