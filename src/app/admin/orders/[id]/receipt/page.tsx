import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { formatDay, formatStamp, isoDate } from "@/lib/dates";
import { rs } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/labels";
import { inScope, piiFor } from "@/components/admin/ops/scope";
import { PrintButton } from "@/components/admin/ops/PrintButton";

export const metadata = { title: "Staff receipt", robots: { index: false } };

/** Printable staff copy of an order: original amounts as placed, plus every adjustment recorded since. Not a tax invoice. */
export default async function StaffReceipt({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("orders.view");
  const { id } = await params;
  const o = await db.order.findUnique({ where: { id }, include: { items: { include: { customizations: true } }, payment: true, adjustments: { orderBy: { createdAt: "asc" } }, user: { select: { name: true } }, company: { select: { name: true } } } });
  if (!o || !inScope(user, o.kitchenId)) notFound();
  const s = await getSettings();
  const pii = piiFor(user);
  const customerAdj = o.adjustments.filter((a) => !a.reason.startsWith("Company share"));
  const companyAdj = o.adjustments.filter((a) => a.reason.startsWith("Company share"));
  return (
    <div className="mx-auto max-w-xl rounded-2xl border-2 border-ink bg-white p-8 print:border-0 print:p-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-lg font-extrabold">{s.legalName || s.brandName}</p>
          <p className="text-xs text-ink-mute">{s.address}</p>
          {s.panVat ? <p className="text-xs text-ink-mute">PAN/VAT: {s.panVat}</p> : null}
        </div>
        <div className="flex gap-2">
          <Link href={`/admin/orders/${o.id}`} className="no-print text-sm text-akash underline">
            Back
          </Link>
          <PrintButton />
        </div>
      </div>
      <h1 className="mt-6 text-xl font-extrabold">Order {o.number} · #{o.code}</h1>
      <p className="text-sm text-ink-soft">
        Placed {formatStamp(o.createdAt)} · delivery {formatDay(isoDate(o.deliveryDate), "long")}
        {o.slotLabel ? ` · ${o.slotLabel}` : ""}
      </p>
      <p className="mt-2 text-sm">
        {o.user.name}
        {o.company ? ` · ${o.company.name}` : ""} · {o.contactName} {pii.phone(o.contactPhone)}
        <br />
        {[o.placeName, o.addressLine, o.area].filter(Boolean).join(", ")}
      </p>
      <table className="mt-5 w-full text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-left">
            <th className="py-1">Item (current contents)</th>
            <th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Rate</th>
            <th className="py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((i) => (
            <tr key={i.id} className="border-b border-ink-line align-top">
              <td className="py-1.5">
                {i.name}
                {i.customizations.map((c) => (
                  <span key={c.id} className="block text-xs text-ink-mute">
                    {c.label}
                  </span>
                ))}
              </td>
              <td className="py-1.5 text-right">{i.quantity}</td>
              <td className="py-1.5 text-right tabular-nums">{rs(i.unitPrice)}</td>
              <td className="py-1.5 text-right tabular-nums">{rs(i.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-4 space-y-1 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-mute">As placed</p>
        {(
          [
            ["Subtotal", o.subtotal],
            ["Delivery", o.deliveryFee],
            ...(o.discount ? [["Discount", -o.discount]] : []),
            ...(o.tax ? [[o.taxInclusive ? "VAT included" : "VAT", o.tax]] : []),
            ["Total", o.total],
            ...(o.companyShare ? [["Company share", o.companyShare]] : []),
            ["Customer share", o.customerShare],
          ] as [string, number][]
        ).map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt>{k}</dt>
            <dd className="tabular-nums">{rs(v)}</dd>
          </div>
        ))}
        {o.adjustments.length > 0 && (
          <>
            <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-ink-mute">Adjustments since</p>
            {o.adjustments.map((a) => (
              <div key={a.id} className="flex justify-between gap-3">
                <dt className="text-xs">
                  {formatStamp(a.createdAt)} — {a.reason}
                </dt>
                <dd className="tabular-nums">{rs(a.amount)}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t-2 border-ink pt-1 font-extrabold">
              <dt>Customer share after adjustments</dt>
              <dd className="tabular-nums">{rs(o.customerShare + customerAdj.reduce((a, x) => a + x.amount, 0))}</dd>
            </div>
            {(o.companyShare > 0 || companyAdj.length > 0) && (
              <div className="flex justify-between">
                <dt>Company share after adjustments</dt>
                <dd className="tabular-nums">{rs(o.companyShare + companyAdj.reduce((a, x) => a + x.amount, 0))}</dd>
              </div>
            )}
          </>
        )}
      </dl>
      {o.payment && (
        <p className="mt-4 text-xs text-ink-mute">
          Payment: {METHOD_LABEL[o.payment.method]} · {o.payment.reference} · {o.payment.status.toLowerCase()}
        </p>
      )}
      <p className="mt-6 text-xs text-ink-mute">Staff copy — not a tax invoice.</p>
    </div>
  );
}
