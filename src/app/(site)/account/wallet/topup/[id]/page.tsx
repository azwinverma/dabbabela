import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatStamp } from "@/lib/dates";
import { rs } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/labels";
import { getSettings } from "@/lib/settings";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { walletBalance } from "@/server/ledger";
import { topupMethods } from "@/server/wallet-topup";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { cancelTopupAction } from "@/lib/actions/wallet";
import { PayClient } from "../../../../pay/[id]/PayClient";
import { AutoRefresh } from "../../../AutoRefresh";

export const metadata: Metadata = { title: "Wallet top-up", robots: { index: false } };

/** Result + payment page for one wallet top-up (gateway returns land here via /pay and /thank-you). */
export default async function TopupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; reason?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/account/wallet/topup/${id}`);
  const payment = await db.payment.findFirst({ where: { id, userId: user.id, purpose: "WALLET_TOPUP" }, include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!payment) notFound();
  const [settings, locale, balance, credit] = await Promise.all([
    getSettings(),
    getLocale(),
    walletBalance(user.id),
    db.creditLedger.findFirst({ where: { paymentId: payment.id, reason: "TOPUP", userId: user.id }, select: { amount: true, createdAt: true } }),
  ]);
  const methods = await topupMethods(settings);
  const t = accountDict(locale).pay;
  const paid = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(payment.status);
  const awaitingCheck = payment.method === "BANK_TRANSFER" && Boolean(payment.proofUrl);
  const gatewayStarted = (payment.method === "ESEWA" || payment.method === "KHALTI") && payment.attempts[0]?.status === "STARTED";
  const waiting = !paid && payment.status === "PENDING" && (sp.status === "pending" || awaitingCheck);

  return (
    <section className="max-w-3xl">
      <Link href="/account/wallet" className="text-sm font-semibold text-sindoor underline underline-offset-2">
        ← Dabba Bela credit
      </Link>
      <h1 className="mt-3 text-3xl font-extrabold">{paid ? "Credit added" : payment.status === "CANCELLED" ? "Top-up cancelled" : "Add credit"}</h1>
      <p className="mt-1 text-ink-soft">
        {rs(payment.amount)} · {METHOD_LABEL[payment.method]} · ref {payment.reference} · started {formatStamp(payment.createdAt)}
      </p>

      {paid && (
        <div role="status" className="mt-5 rounded-xl border-2 border-saag bg-saag-light px-4 py-3 text-saag-dark" data-testid="topup-success">
          <p className="font-bold">
            {rs(credit?.amount ?? payment.amount)} was added to your Dabba Bela credit{credit ? ` on ${formatStamp(credit.createdAt)}` : ""}.
          </p>
          <p className="mt-1 text-sm">Your balance is now {rs(balance)}. Pick &quot;Dabba Bela credit&quot; at checkout to use it.</p>
          {payment.status !== "PAID" && <p className="mt-1 text-sm">Part or all of this top-up was refunded to you — see your wallet history.</p>}
        </div>
      )}

      {!paid && sp.status === "failed" && (
        <div role="alert" className="mt-5 rounded-xl border-2 border-sindoor bg-sindoor-light px-4 py-3 text-sindoor-dark">
          <p className="font-bold">{t.failed}</p>
          {sp.reason && <p className="text-sm">{sp.reason.slice(0, 200)}</p>}
          <p className="mt-1 text-sm">No credit was added and we didn&apos;t take any money. Try again or pick another method below.</p>
        </div>
      )}
      {waiting && (
        <div role="status" className="mt-5 rounded-xl border-2 border-besar bg-besar-light px-4 py-3 text-sm" data-testid="topup-pending">
          {awaitingCheck ? "Thanks — we've got your transfer proof. Your credit is added as soon as our finance team sees the money in our account (usually within a working day)." : t.pending}
          <p className="mt-1">Credit is added only after the payment is confirmed on our side — you don&apos;t need to pay again.</p>
          <AutoRefresh seconds={30} />
        </div>
      )}

      {payment.status === "CANCELLED" && (
        <div className="mt-5 rounded-xl border-2 border-ink-line bg-white px-4 py-3 text-sm">
          <p>You cancelled this top-up, so no credit was added. If you did pay, the credit is added automatically once the provider confirms it.</p>
          <Link href="/account/wallet" className="mt-2 inline-block font-semibold text-sindoor underline">
            Start a new top-up
          </Link>
        </div>
      )}

      {!paid && (payment.status === "PENDING" || payment.status === "FAILED") && (
        <>
          {methods.length ? (
            <PayClient paymentId={payment.id} method={payment.method} methods={methods} bankDetails={settings.bankDetails} qrImage={settings.qrImage} awaitingCheck={awaitingCheck} t={t} topup />
          ) : (
            <p className="mt-6 rounded-xl border-2 border-ink-line bg-white px-4 py-3 text-sm">Adding credit is switched off right now. If you already paid, the credit is still added once the payment is confirmed.</p>
          )}
          {!awaitingCheck && (
            <ActionForm action={cancelTopupAction} className="mt-6">
              <input type="hidden" name="paymentId" value={payment.id} />
              <SubmitButton variant="ghost" size="sm" pendingText="Cancelling…">
                {gatewayStarted ? "I didn't pay — cancel this top-up" : "Cancel this top-up"}
              </SubmitButton>
            </ActionForm>
          )}
        </>
      )}
    </section>
  );
}
