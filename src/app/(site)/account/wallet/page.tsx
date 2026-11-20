import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatStamp } from "@/lib/dates";
import { rs } from "@/lib/money";
import { walletBalance } from "@/server/ledger";
import { getLocale } from "@/lib/i18n/server";
import { dashboardDict } from "@/lib/i18n/dashboard";
import { walletReasonLabel } from "../_lib/wallet";

export default async function WalletPage() {
  const user = await requireUser("/account/wallet");
  const dict = dashboardDict(await getLocale());
  const payments = dict.home.payments;
  const [balance, rows] = await Promise.all([walletBalance(user.id), db.creditLedger.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 })]);
  return (
    <div className="max-w-3xl">
      <div className="rounded-2xl border-2 border-ink bg-besar-light p-6">
        <p className="text-xs font-bold uppercase tracking-wider">Dabba Bela credit</p>
        <p className="mt-1 text-4xl font-extrabold tabular-nums">{rs(balance)}</p>
        <p className="mt-2 text-sm text-ink-soft">Credit comes from cancellations, skips and refunds. Pick "Dabba Bela credit" at checkout to spend it. It doesn't expire. Prefer the money back? <Link href="/account/support" className="font-semibold underline">Ask support</Link>.</p>
      </div>
      <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-xl font-extrabold">History</h2>
        <Link href="/account/payments" className="text-sm font-semibold text-sindoor underline underline-offset-2">{payments}</Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-mute">No credit movements yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-ink-line rounded-2xl border-2 border-ink-line bg-white">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="font-semibold">{walletReasonLabel(r.reason, dict)}</p>
                <p className="text-xs text-ink-mute">
                  {formatStamp(r.createdAt)}
                  {r.note ? ` · ${r.note}` : ""}
                </p>
              </div>
              <p className={`font-bold tabular-nums ${r.amount < 0 ? "text-ink" : "text-saag-dark"}`}>{r.amount > 0 ? "+" : ""}{rs(r.amount)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
