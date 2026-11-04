import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatDay, formatStamp, isoDate } from "@/lib/dates";
import { rs } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/labels";
import { LogoMark } from "@/components/brand/Logo";
import { PrintButton } from "./PrintButton";

export const metadata = { title: "Receipt", robots: { index: false } };

/** Customer receipt. Not a VAT invoice unless the business is VAT-registered (tax rule active + PAN set). */
export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/account/orders/${id}/receipt`);
  const order = await db.order.findFirst({ where: { id, userId: user.id }, include: { items: true, payment: true } });
  if (!order) notFound();
  const s = await getSettings();
  return (
    <div className="mx-auto max-w-xl rounded-2xl border-2 border-ink bg-white p-8 print:border-0 print:p-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <LogoMark className="h-12 w-12" />
          <div>
            <p className="text-lg font-extrabold">{s.legalName || s.brandName}</p>
            <p className="text-xs text-ink-mute">{s.address}</p>
            {s.panVat ? <p className="text-xs text-ink-mute">PAN/VAT: {s.panVat}</p> : <p className="text-xs text-ink-mute">PAN registration pending</p>}
          </div>
        </div>
        <PrintButton />
      </div>
      <h2 className="mt-6 text-xl font-extrabold">Receipt · #{order.number}</h2>
      <p className="text-sm text-ink-soft">
        Issued {formatStamp(order.createdAt)} · for delivery {formatDay(isoDate(order.deliveryDate), "long")}
      </p>
      <p className="mt-2 text-sm">
        Billed to: <strong>{user.name}</strong>
        {order.placeName ? `, ${order.placeName}` : ""}
      </p>
      <table className="mt-5 w-full text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-left">
            <th className="py-1">Item</th>
            <th className="py-1 text-right">Qty</th>
            <th className="py-1 text-right">Rate</th>
            <th className="py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((i) => (
            <tr key={i.id} className="border-b border-ink-line">
              <td className="py-1.5">{i.name}</td>
              <td className="py-1.5 text-right">{i.quantity}</td>
              <td className="py-1.5 text-right tabular-nums">{rs(i.unitPrice)}</td>
              <td className="py-1.5 text-right tabular-nums">{rs(i.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-4 space-y-1 text-sm">
        {[
          ["Subtotal", order.subtotal],
          ...(order.discount ? [["Discount", -order.discount] as [string, number]] : []),
          ["Delivery", order.deliveryFee],
          ...(order.tax ? [[order.taxInclusive ? "VAT included in prices" : "VAT", order.tax] as [string, number]] : []),
        ].map(([k, v]) => (
          <div key={k as string} className="flex justify-between">
            <dt>{k}</dt>
            <dd className="tabular-nums">{rs(v as number)}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t-2 border-ink pt-1 text-base font-extrabold">
          <dt>Total</dt>
          <dd className="tabular-nums">{rs(order.total)}</dd>
        </div>
        {order.companyShare > 0 && (
          <div className="flex justify-between text-ink-soft">
            <dt>Paid by employer (invoiced separately)</dt>
            <dd className="tabular-nums">{rs(order.companyShare)}</dd>
          </div>
        )}
      </dl>
      {order.payment && (
        <p className="mt-4 text-xs text-ink-mute">
          Payment: {METHOD_LABEL[order.payment.method]} · {order.payment.reference} · {order.payment.status.toLowerCase()}
        </p>
      )}
      <p className="mt-6 text-xs text-ink-mute">This is a payment receipt, not a tax invoice. Contact us if you need a VAT invoice.</p>
    </div>
  );
}
