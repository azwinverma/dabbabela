import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatDay, formatStamp } from "@/lib/dates";
import { rs } from "@/lib/money";
import { METHOD_LABEL, PAYMENT_STATUS, REFUND_STATUS } from "@/lib/labels";
import { format } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { dashboardDict } from "@/lib/i18n/dashboard";
import { paymentHistory } from "@/server/customer-dashboard";
import { Badge } from "@/components/ui/Badge";
import { LinkButton } from "@/components/ui/Button";

const TAKE = 50;
const WALLET_REASON: Record<string, string> = {
  SKIP_CREDIT: "Skipped plan meal",
  REFUND: "Refund",
  ADJUSTMENT: "Adjustment",
  SPEND: "Spent on an order",
  REVERSAL: "Reversal",
  GOODWILL: "Goodwill credit",
  CANCEL_CREDIT: "Cancelled order",
  DISRUPTION_CREDIT: "Kitchen closed",
};
const REFUND_METHOD: Record<string, string> = { ORIGINAL: "Back to original payment", BANK: "Bank transfer", CASH: "Cash", WALLET_CREDIT: "Dabba Bela credit" };

export default async function PaymentsPage() {
  const user = await requireUser("/account/payments");
  const d = dashboardDict(await getLocale()).payments;
  const h = await paymentHistory(user.id, { take: TAKE });
  const tiles = [
    { label: d.paid, value: h.totals.paid, sub: h.totals.paidCount ? String(h.totals.paidCount) : null },
    { label: d.refunded, value: h.totals.refunded },
    { label: d.pending, value: h.totals.pending, sub: h.totals.pendingCount ? String(h.totals.pendingCount) : null },
    { label: d.credit, value: h.totals.walletBalance },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-extrabold">{d.title}</h2>
        <p className="mt-1 text-sm text-ink-soft">{d.intro}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border-2 border-ink bg-paper-card p-4">
            <dt className="text-xs font-bold uppercase tracking-wider text-ink-mute">{t.label}</dt>
            <dd className="mt-1 text-2xl font-extrabold tabular-nums">{rs(t.value)}</dd>
            {t.sub && <dd className="text-xs text-ink-mute">× {t.sub}</dd>}
          </div>
        ))}
      </dl>

      <section aria-labelledby="pay-h">
        <h3 id="pay-h" className="text-xl font-extrabold">{d.paymentsH}</h3>
        {h.payments.length === 0 ? (
          <p className="mt-3 text-sm text-ink-mute">{d.noPayments}</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-line rounded-2xl border-2 border-ink-line bg-white">
            {h.payments.map((p) => {
              const first = p.orders[0];
              return (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      <span className="font-mono text-sm">{p.reference}</span> · {METHOD_LABEL[p.method]}
                    </p>
                    <p className="text-xs text-ink-mute">
                      {formatStamp(p.createdAt)}
                      {p.paidAt ? ` · ${format(d.paidOn, { date: formatDay(p.paidAt) })}` : ""}
                      {p.subscription ? ` · ${format(d.plan, { name: p.subscription.plan.name })}` : ""}
                      {p._count.orders > 1 ? ` · ${format(d.lunches, { n: p._count.orders })}` : first ? ` · ${format(d.order, { n: first.number })}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={PAYMENT_STATUS[p.status].tone}>{PAYMENT_STATUS[p.status].label}</Badge>
                    <span className="text-right font-bold tabular-nums">
                      {rs(p.amount)}
                      {p.refundedAmount > 0 && <span className="block text-xs font-normal text-ink-mute">−{rs(p.refundedAmount)}</span>}
                    </span>
                    {p.status === "PENDING" && first ? (
                      <LinkButton href={`/pay/${p.id}`} size="sm">{d.pay}</LinkButton>
                    ) : first && p.status !== "FAILED" && p.status !== "CANCELLED" ? (
                      <Link href={`/account/orders/${first.id}/receipt`} className="text-sm font-semibold text-sindoor underline underline-offset-2">{d.receipt}</Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {h.payments.length >= TAKE && <p className="mt-2 text-xs text-ink-mute">{format(d.showingLatest, { n: TAKE })}</p>}
      </section>

      <section aria-labelledby="ref-h">
        <h3 id="ref-h" className="text-xl font-extrabold">{d.refundsH}</h3>
        {h.refunds.length === 0 ? (
          <p className="mt-3 text-sm text-ink-mute">{d.noRefunds}</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-line rounded-2xl border-2 border-ink-line bg-white">
            {h.refunds.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">{r.reason}</p>
                  <p className="text-xs text-ink-mute">
                    {formatStamp(r.createdAt)} · {REFUND_METHOD[r.method] ?? r.method} · <span className="font-mono">{r.payment.reference}</span>
                    {r.order ? (
                      <>
                        {" · "}
                        <Link href={`/account/orders/${r.order.id}`} className="underline">{format(d.order, { n: r.order.number })}</Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={REFUND_STATUS[r.status].tone}>{REFUND_STATUS[r.status].label}</Badge>
                  <span className="font-bold tabular-nums">{rs(r.amount)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="wal-h">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 id="wal-h" className="text-xl font-extrabold">{d.walletH}</h3>
          <p className="text-xs text-ink-mute">
            {d.creditIn} <span className="font-bold text-saag-dark">+{rs(h.totals.walletIn)}</span> · {d.creditOut} <span className="font-bold">−{rs(h.totals.walletOut)}</span>
          </p>
        </div>
        {h.wallet.length === 0 ? (
          <p className="mt-3 text-sm text-ink-mute">{d.noWallet}</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink-line rounded-2xl border-2 border-ink-line bg-white">
            {h.wallet.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">{WALLET_REASON[r.reason] ?? r.reason}</p>
                  <p className="text-xs text-ink-mute">
                    {formatStamp(r.createdAt)}
                    {r.note ? ` · ${r.note}` : ""}
                  </p>
                </div>
                <p className={`font-bold tabular-nums ${r.amount < 0 ? "text-ink" : "text-saag-dark"}`}>
                  {r.amount > 0 ? "+" : ""}
                  {rs(r.amount)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Link href="/account/wallet" className="mt-2 inline-block text-sm font-semibold text-sindoor underline underline-offset-2">{d.fullHistory}</Link>
      </section>
    </div>
  );
}
