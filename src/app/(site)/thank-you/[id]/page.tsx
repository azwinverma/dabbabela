import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatDay, isoDate } from "@/lib/dates";
import { rs } from "@/lib/money";
import { METHOD_LABEL, ORDER_STATUS } from "@/lib/labels";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { LinkButton } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = { title: "Order received", robots: { index: false } };

export default async function ThankYou({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/thank-you/${id}`);
  const payment = await db.payment.findFirst({
    where: { id, userId: user.id },
    include: {
      orders: { orderBy: { deliveryDate: "asc" }, include: { items: { select: { name: true, quantity: true } } } },
      subscription: { include: { plan: { select: { name: true } } } },
    },
  });
  if (!payment) notFound();
  const [t, settings] = [accountDict(await getLocale()).thanks, await getSettings()];
  const settled = payment.status === "PAID" || payment.method === "CASH" || payment.method === "COMPANY_INVOICE";
  const waiting = !settled;
  return (
    <section className="container max-w-3xl py-10 md:py-14">
      <p className="font-marker text-2xl text-sindoor">{waiting ? "almost there…" : "dhanyabad!"}</p>
      <h1 className="text-3xl font-extrabold md:text-4xl">{waiting ? "We've saved your order" : t.title}</h1>
      <p className="mt-2 text-ink-soft">
        {waiting ? t.pending : payment.method === "CASH" ? `${t.cash} Amount: ${rs(payment.amount)}.` : payment.method === "COMPANY_INVOICE" ? "Billed to your company — nothing to pay now." : `Payment of ${rs(payment.amount)} received (${METHOD_LABEL[payment.method]}).`}
      </p>
      {payment.subscription && (
        <p className="mt-3 rounded-xl bg-besar-light px-4 py-3 text-sm">
          <strong>{payment.subscription.plan.name}</strong> · {payment.subscription.mealsTotal} lunches from {formatDay(isoDate(payment.subscription.startDate))} to {formatDay(isoDate(payment.subscription.endDate))}. Skip or pause from your account before {settings.orderCutoff} on any day.
        </p>
      )}
      <ul className="mt-6 space-y-2">
        {payment.orders.slice(0, 30).map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-ink-line bg-white px-4 py-3">
            <span>
              <span className="font-bold">{formatDay(isoDate(o.deliveryDate))}</span> · {o.items.map((i) => i.name).join(", ")}
              <span className="block text-xs text-ink-mute">#{o.number} · {o.slotLabel ?? "lunch window"}</span>
            </span>
            <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>
          </li>
        ))}
      </ul>
      <div className="mt-8 flex flex-wrap gap-3">
        {waiting && <LinkButton href={`/pay/${payment.id}`}>Finish payment</LinkButton>}
        <LinkButton href="/account" variant={waiting ? "outline" : "primary"}>{t.track}</LinkButton>
        <LinkButton href="/menu" variant="outline">Back to the menu</LinkButton>
      </div>
    </section>
  );
}
