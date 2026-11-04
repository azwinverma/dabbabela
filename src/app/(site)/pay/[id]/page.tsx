import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatDay, isoDate } from "@/lib/dates";
import { rs } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/labels";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { availableMethods } from "@/server/payments/methods";
import { walletBalance } from "@/server/ledger";
import { PayClient } from "./PayClient";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };

export default async function PayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; reason?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/pay/${id}`);
  const payment = await db.payment.findFirst({
    where: { id, userId: user.id },
    include: {
      orders: { select: { id: true, number: true, deliveryDate: true, status: true, items: { select: { name: true, quantity: true } } }, orderBy: { deliveryDate: "asc" } },
      subscription: { select: { reference: true, plan: { select: { name: true } } } },
      attempts: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!payment) notFound();
  if (payment.status === "PAID") redirect(`/thank-you/${payment.id}`);
  const [settings, locale, balance] = await Promise.all([getSettings(), getLocale(), walletBalance(user.id)]);
  const t = accountDict(locale).pay;
  const methods = (await availableMethods(settings, { hasCompany: Boolean(payment.companyId), customerShare: payment.amount })).filter((m) => m !== "WALLET" || balance >= payment.amount);
  const expired = payment.status === "CANCELLED" || payment.orders.every((o) => o.status === "CANCELLED");
  const awaitingCheck = payment.method === "BANK_TRANSFER" && Boolean(payment.proofUrl);

  return (
    <section className="container max-w-3xl py-8 md:py-12">
      <h1 className="text-3xl font-extrabold">{t.title}</h1>
      <p className="mt-1 text-ink-soft">
        {payment.subscription ? `${payment.subscription.plan.name} · ${payment.subscription.reference}` : `${payment.orders.length} delivery day${payment.orders.length === 1 ? "" : "s"}`} · ref {payment.reference}
      </p>

      {sp.status === "failed" && (
        <div role="alert" className="mt-5 rounded-xl border-2 border-sindoor bg-sindoor-light px-4 py-3 text-sindoor-dark">
          <p className="font-bold">{t.failed}</p>
          {sp.reason && <p className="text-sm">{sp.reason.slice(0, 200)}</p>}
          <p className="mt-1 text-sm">No money was taken by us. Try again or pick another method below.</p>
        </div>
      )}
      {sp.status === "pending" && (
        <div role="status" className="mt-5 rounded-xl border-2 border-besar bg-besar-light px-4 py-3 text-sm">
          {t.pending}
        </div>
      )}

      <div className="mt-6 rounded-2xl border-2 border-ink bg-paper-card p-5">
        <div className="flex items-baseline justify-between gap-4">
          <span className="font-semibold">Amount due</span>
          <span className="text-3xl font-extrabold tabular-nums">{rs(payment.amount)}</span>
        </div>
        <ul className="mt-3 space-y-1 text-sm text-ink-soft">
          {payment.orders.slice(0, 8).map((o) => (
            <li key={o.id}>
              {formatDay(isoDate(o.deliveryDate))} — {o.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(", ")}
            </li>
          ))}
          {payment.orders.length > 8 && <li>…and {payment.orders.length - 8} more days</li>}
        </ul>
        <p className="mt-3 text-xs text-ink-mute">Paying with: {METHOD_LABEL[payment.method]}</p>
      </div>

      {expired ? (
        <div className="mt-6 rounded-2xl border-2 border-ink-line bg-white p-5">
          <p className="font-bold">This order expired before payment arrived.</p>
          <p className="mt-1 text-sm text-ink-soft">If you did pay, the money is added to your credit automatically once the provider confirms it.</p>
          <Link href="/menu" className="mt-3 inline-block font-semibold text-sindoor underline">Order again</Link>
        </div>
      ) : (
        <PayClient
          paymentId={payment.id}
          method={payment.method}
          methods={methods}
          bankDetails={settings.bankDetails}
          qrImage={settings.qrImage}
          awaitingCheck={awaitingCheck}
          t={t}
        />
      )}
    </section>
  );
}
