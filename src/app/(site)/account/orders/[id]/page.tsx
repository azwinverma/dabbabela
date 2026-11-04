import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatDay, formatStamp, isoDate } from "@/lib/dates";
import { rs } from "@/lib/money";
import { ORDER_STATUS, ORDER_PAYMENT_STATUS, METHOD_LABEL, ADDRESS_TYPE_LABEL, DIET_LABEL } from "@/lib/labels";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";
import { SummaryRow } from "@/components/site/DeliveryFields";
import { MealActions } from "../../MealActions";
import { changeable } from "../../_lib/meals";
import { FeedbackForm, ProblemForm } from "./OrderForms";

type Component = { name: string; qty: number; allergens?: string[]; substitutedFrom?: string };

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/account/orders/${id}`);
  const order = await db.order.findFirst({
    where: { id, userId: user.id },
    include: {
      items: { include: { customizations: true } },
      events: { orderBy: { createdAt: "asc" } },
      payment: { select: { id: true, method: true, status: true, reference: true, amount: true } },
      feedback: true,
      refunds: { orderBy: { createdAt: "desc" } },
      adjustments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) notFound();
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);
  const t = accountDict(locale).account;
  const open = (await changeable([order], settings)).get(order.id) ?? false;
  const st = ORDER_STATUS[order.status];
  const pay = ORDER_PAYMENT_STATUS[order.paymentStatus];

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/account/orders" className="text-sm font-semibold text-ink-soft underline">← Orders</Link>
          <h2 className="text-2xl font-extrabold">#{order.number}</h2>
          <Badge tone={st.tone}>{st.label}</Badge>
          {order.status !== "CANCELLED" && <Badge tone={pay.tone}>{pay.label}</Badge>}
        </div>
        <p className="text-ink-soft">
          {formatDay(isoDate(order.deliveryDate), "full")} · {order.slotLabel ?? "lunch window"} · code <span className="font-mono font-bold">{order.code}</span>
        </p>

        {order.status === "OUT_FOR_DELIVERY" && order.deliveryOtp && (
          <div className="rounded-2xl border-2 border-ink bg-besar p-5">
            <p className="text-sm font-bold uppercase tracking-wide">{t.deliveryCode}</p>
            <p className="font-mono text-4xl font-extrabold tracking-[0.3em]">{order.deliveryOtp}</p>
            <p className="mt-1 text-sm">{t.deliveryCodeHint}</p>
          </div>
        )}
        {order.status === "PENDING_PAYMENT" && order.payment && (
          <div className="rounded-2xl border-2 border-sindoor bg-sindoor-light/60 p-4">
            <p className="font-bold text-sindoor-dark">This order is waiting for payment.</p>
            <LinkButton href={`/pay/${order.payment.id}`} size="sm" className="mt-2">{t.payNow}</LinkButton>
          </div>
        )}

        <section className="rounded-2xl border-2 border-ink bg-paper-card p-5">
          <h3 className="text-lg font-extrabold">In this order</h3>
          <ul className="mt-3 divide-y divide-ink-line">
            {order.items.map((it) => {
              const comps = (Array.isArray(it.components) ? it.components : []) as Component[];
              const allergens = [...new Set(comps.flatMap((c) => c.allergens ?? []))];
              return (
                <li key={it.id} className="py-3">
                  <div className="flex justify-between gap-4">
                    <p className="font-bold">
                      {it.name} {it.quantity > 1 && <span className="text-ink-mute">×{it.quantity}</span>}
                    </p>
                    <p className="tabular-nums">{rs(it.lineTotal)}</p>
                  </div>
                  <p className="text-sm text-ink-soft">{comps.map((c) => (c.substitutedFrom ? `${c.name} (instead of ${c.substitutedFrom})` : c.name)).join(" · ") || it.details}</p>
                  <p className="mt-1 text-xs text-ink-mute">
                    {DIET_LABEL[it.diet].label}
                    {allergens.length ? ` · contains ${allergens.join(", ").toLowerCase()}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
          {order.allergenNote && <p className="mt-3 rounded-lg bg-sindoor-light px-3 py-2 text-sm text-sindoor-dark">Label note: {order.allergenNote}. Cooked in a shared kitchen — we can't guarantee zero cross-contact.</p>}
        </section>

        <section>
          <h3 className="text-lg font-extrabold">{t.timeline}</h3>
          <ol className="mt-3 space-y-3 border-l-2 border-ink-line pl-5">
            {order.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-ink bg-besar" aria-hidden="true" />
                <p className="font-semibold">{ORDER_STATUS[e.toStatus].label}</p>
                <p className="text-xs text-ink-mute">
                  {formatStamp(e.createdAt)}
                  {e.note ? ` · ${e.note}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </section>

        {order.status === "DELIVERED" && (
          <section className="rounded-2xl border-2 border-ink bg-paper-card p-5">
            <h3 className="text-lg font-extrabold">{t.feedback}</h3>
            <div className="mt-3">
              <FeedbackForm orderId={order.id} existing={order.feedback} />
            </div>
          </section>
        )}
        <ProblemForm orderId={order.id} number={order.number} />
      </div>

      <aside className="space-y-5">
        <div className="rounded-2xl border-2 border-ink bg-paper-card p-5">
          <SummaryRow label="Subtotal" value={order.subtotal} />
          {order.discount > 0 && <SummaryRow label="Discount" value={order.discount} negative />}
          <SummaryRow label="Delivery" value={order.deliveryFee} />
          {order.tax > 0 && <SummaryRow label={order.taxInclusive ? "VAT (included)" : "VAT"} value={order.tax} muted={order.taxInclusive} />}
          <SummaryRow label="Total" value={order.total} strong />
          {order.companyShare > 0 && (
            <>
              <SummaryRow label="Company pays" value={order.companyShare} muted />
              <SummaryRow label="You pay" value={order.customerShare} />
            </>
          )}
          {order.refundedAmount > 0 && <SummaryRow label="Returned to you" value={order.refundedAmount} muted />}
          {order.payment && (
            <p className="mt-3 text-xs text-ink-mute">
              {METHOD_LABEL[order.payment.method]} · {order.payment.reference}
            </p>
          )}
          <Link href={`/account/orders/${order.id}/receipt`} className="mt-3 inline-block text-sm font-semibold text-sindoor underline">{t.receipt}</Link>
        </div>
        <div className="rounded-2xl border-2 border-ink-line bg-white p-5 text-sm">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-mute">Deliver to · {ADDRESS_TYPE_LABEL[order.addressType]}</p>
          <p className="mt-1 font-semibold">{order.contactName} · {order.contactPhone.replace(/^\+977/, "")}</p>
          <p className="text-ink-soft">{[order.placeName, order.addressLine, order.area, order.ward ? `Ward ${order.ward}` : null].filter(Boolean).join(", ")}</p>
          {order.landmark && <p className="text-ink-mute">Near {order.landmark}</p>}
        </div>
        {open && (
          <div className="rounded-2xl border-2 border-ink-line bg-white p-5">
            <MealActions orderId={order.id} kind={order.source === "SUBSCRIPTION" ? "plan" : "single"} status={order.status} open credited={order.paymentStatus === "REFUNDED"} labels={t} />
            <p className="mt-2 text-xs text-ink-mute">Changes close at {settings.orderCutoff} on the day.</p>
          </div>
        )}
        {order.refunds.length > 0 && (
          <div className="rounded-2xl border-2 border-ink-line bg-white p-5 text-sm">
            <p className="font-bold">Refunds</p>
            <ul className="mt-2 space-y-1">
              {order.refunds.map((r) => (
                <li key={r.id}>
                  {rs(r.amount)} · {r.status.toLowerCase()} · {r.method === "WALLET_CREDIT" ? "credit" : r.method.toLowerCase()}
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}
