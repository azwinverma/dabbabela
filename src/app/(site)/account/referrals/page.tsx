import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatStamp } from "@/lib/dates";
import { rs } from "@/lib/money";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input } from "@/components/ui/Fields";
import { ensureReferralCode, myReferrals, settleReferralsOf, type ReferralStatus } from "@/server/marketing";
import { claimReferralAction } from "./actions";

export const metadata = { title: "Refer a friend" };

const STATUS: Record<ReferralStatus, string> = {
  PENDING: "Waiting for their first delivered order",
  HELD: "Being checked by our team",
  APPROVED: "Waiting for their first delivered order",
  QUALIFIED: "Ordered — reward limit reached",
  REWARDED: "Reward added to your wallet",
  REJECTED: "Not eligible",
};

export default async function ReferralsPage() {
  const user = await requireUser("/account/referrals");
  let data = await myReferrals(user.id);
  if (data.settings.enabled && !data.code && user.role === "CUSTOMER") {
    await ensureReferralCode(user.id);
    data = await myReferrals(user.id);
  }
  // A friend's order may have been delivered and paid since the last visit: settle open referrals (idempotent).
  if (data.friends.some((f) => f.status === "PENDING" || f.status === "APPROVED" || f.status === "QUALIFIED")) {
    if ((await settleReferralsOf(user.id)) > 0) data = await myReferrals(user.id);
  }
  const { settings } = data;
  const offer = settings.refereeType === "PERCENT" ? `${settings.refereeValue}% off` : `${rs(settings.refereeValue)} off`;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const share = data.code ? `Try Dabba Bela lunch boxes — use my code ${data.code} for ${offer} your first order.${site ? ` Sign up: ${site}/register?ref=${data.code}` : ""}` : "";

  return (
    <div className="max-w-3xl space-y-8">
      <section className="rounded-2xl border-2 border-ink bg-besar-light p-6">
        <p className="text-xs font-bold uppercase tracking-wider">Refer a friend</p>
        {!settings.enabled ? (
          <p className="mt-2 text-sm text-ink-soft">The referral programme isn&apos;t running right now. Check back soon.</p>
        ) : data.code ? (
          <>
            <p className="mt-1 font-mono text-4xl font-extrabold tracking-wider">{data.code}</p>
            <p className="mt-2 text-sm text-ink-soft">
              Your friend gets <b>{offer}</b> their first order
              {settings.refereeMinSubtotal ? ` (minimum ${rs(settings.refereeMinSubtotal)})` : ""} when they enter this code at checkout. You get <b>{rs(settings.referrerReward)}</b> Dabba Bela credit once their first order is delivered and paid.
            </p>
            <a href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper hover:bg-ink-soft">
              Share on WhatsApp
            </a>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">Referral codes are for customer accounts.</p>
        )}
      </section>

      {settings.enabled && (
        <section>
          <h2 className="text-xl font-extrabold">Friends you referred</h2>
          <p className="mt-1 text-sm text-ink-mute">
            {data.rewardCount > 0 ? `${rs(data.rewarded)} earned from ${data.rewardCount} friend(s). ` : ""}
            Credit shows in your <Link href="/account/wallet" className="font-semibold underline">wallet</Link>.
          </p>
          {data.friends.length === 0 ? (
            <p className="mt-3 text-sm text-ink-mute">No one has used your code yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-ink-line rounded-2xl border-2 border-ink-line bg-white">
              {data.friends.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div>
                    <p className="font-semibold">{f.name}</p>
                    <p className="text-xs text-ink-mute">joined {formatStamp(f.at)}</p>
                  </div>
                  <p className={`text-sm ${f.status === "REWARDED" ? "font-semibold text-saag-dark" : "text-ink-soft"}`}>{STATUS[f.status] ?? f.status}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {settings.enabled && (data.received || data.canClaim) && (
        <section>
          <h2 className="text-xl font-extrabold">Got a friend&apos;s code?</h2>
          {data.received ? (
            <p className="mt-2 text-sm text-ink-soft">
              You joined with <span className="font-mono font-bold">{data.received.code}</span>.{" "}
              {data.received.status === "REJECTED" ? "This referral isn't eligible." : "Enter it as the coupon on your first order to get your welcome discount."}
            </p>
          ) : (
            <ActionForm action={claimReferralAction} className="mt-3 flex max-w-md items-end gap-2">
              <Input name="code" label="Friend's code" className="flex-1 font-mono uppercase" autoComplete="off" />
              <SubmitButton>Use code</SubmitButton>
            </ActionForm>
          )}
          <p className="mt-2 text-xs text-ink-mute">One friend&apos;s code per account, before your first order. You can&apos;t use your own code.</p>
        </section>
      )}
    </div>
  );
}
