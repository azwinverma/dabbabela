import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatStamp } from "@/lib/dates";
import { rs } from "@/lib/money";
import { METHOD_LABEL, PAYMENT_STATUS } from "@/lib/labels";
import { getSettings } from "@/lib/settings";
import { walletBalance } from "@/server/ledger";
import { topupLimits, topupMethods } from "@/server/wallet-topup";
import { getLocale } from "@/lib/i18n/server";
import { dashboardDict } from "@/lib/i18n/dashboard";
import { Badge } from "@/components/ui/Badge";
import { walletReasonLabel } from "../_lib/wallet";
import { TopupForm } from "./TopupForm";

export default async function WalletPage() {
  const user = await requireUser("/account/wallet");
  const dict = dashboardDict(await getLocale());
  const payments = dict.home.payments;
  const settings = await getSettings();
  const [balance, rows, limits, methods, openTopups] = await Promise.all([
    walletBalance(user.id),
    db.creditLedger.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    topupLimits(user.id, settings),
    topupMethods(settings),
    db.payment.findMany({ where: { userId: user.id, purpose: "WALLET_TOPUP", status: { in: ["PENDING", "FAILED"] } }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  // Payment references for ledger rows that point at a payment (top-ups, refunds, spends).
  const payIds = [...new Set(rows.map((r) => r.paymentId).filter((x): x is string => Boolean(x)))];
  const pays = new Map((payIds.length ? await db.payment.findMany({ where: { id: { in: payIds }, userId: user.id }, select: { id: true, reference: true, purpose: true } }) : []).map((p) => [p.id, p]));
  const enabled = limits.enabled;

  return (
    <div className="max-w-3xl">
      <div className="rounded-2xl border-2 border-ink bg-besar-light p-6">
        <p className="text-xs font-bold uppercase tracking-wider">Dabba Bela credit</p>
        <p className="mt-1 text-4xl font-extrabold tabular-nums" data-testid="wallet-balance">{rs(balance)}</p>
        <p className="mt-2 text-sm text-ink-soft">
          Credit comes from cancellations, skips, refunds{enabled ? " and top-ups" : ""}. Pick &quot;Dabba Bela credit&quot; at checkout to spend it — it covers a whole order (it can&apos;t be split with another method yet). It&apos;s for Dabba Bela meals only and doesn&apos;t expire. Prefer the money back? <Link href="/account/support" className="font-semibold underline">Ask support</Link>.
        </p>
      </div>

      {enabled && <TopupForm methods={methods} min={limits.min} max={limits.max} maxNow={limits.maxNow} daily={limits.daily} cap={limits.cap} usedToday={limits.usedToday} />}

      {openTopups.length > 0 && (
        <section className="mt-8" aria-labelledby="pending-topups">
          <h2 id="pending-topups" className="text-xl font-extrabold">Top-ups not finished</h2>
          <ul className="mt-3 divide-y divide-ink-line rounded-2xl border-2 border-ink-line bg-white">
            {openTopups.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-semibold tabular-nums">
                    {rs(p.amount)} · {METHOD_LABEL[p.method]}
                  </p>
                  <p className="text-xs text-ink-mute">
                    {formatStamp(p.createdAt)} · ref {p.reference}
                    {p.proofUrl ? " · transfer proof being checked" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={PAYMENT_STATUS[p.status].tone}>{p.status === "PENDING" ? "Waiting" : PAYMENT_STATUS[p.status].label}</Badge>
                  <Link href={`/account/wallet/topup/${p.id}`} className="text-sm font-semibold text-sindoor underline underline-offset-2">
                    {p.proofUrl ? "View" : "Continue"}
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-extrabold">History</h2>
        <Link href="/account/payments" className="text-sm font-semibold text-sindoor underline underline-offset-2">{payments}</Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-mute">No credit movements yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-ink-line rounded-2xl border-2 border-ink-line bg-white">
          {rows.map((r) => {
            const pay = r.paymentId ? pays.get(r.paymentId) : undefined;
            return (
              <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div>
                  <p className="font-semibold">{walletReasonLabel(r.reason, dict)}</p>
                  <p className="text-xs text-ink-mute">
                    {formatStamp(r.createdAt)}
                    {r.note ? ` · ${r.note}` : ""}
                    {pay && (
                      <>
                        {" · "}
                        {pay.purpose === "WALLET_TOPUP" ? (
                          <Link href={`/account/wallet/topup/${pay.id}`} className="underline">
                            {pay.reference}
                          </Link>
                        ) : (
                          <span>{pay.reference}</span>
                        )}
                      </>
                    )}
                    {r.orderId && (
                      <>
                        {" · "}
                        <Link href={`/account/orders/${r.orderId}`} className="underline">
                          order
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <p className={`font-bold tabular-nums ${r.amount < 0 ? "text-ink" : "text-saag-dark"}`}>
                  {r.amount > 0 ? "+" : ""}
                  {rs(r.amount)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
