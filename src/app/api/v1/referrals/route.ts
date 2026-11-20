import { apiRoute } from "@/server/api/route";
import { iso } from "@/server/api/http";
import { ensureReferralCode, myReferrals, settleReferralsOf } from "@/server/marketing";

export const dynamic = "force-dynamic";

/**
 * Refer a friend (same as Account → Refer a friend): the caller's code + share text, friends referred and their
 * status, rewards earned, and whether the caller can still claim a friend's code (POST /referrals/claim).
 */
export const GET = apiRoute({ auth: "user" }, async ({ user }) => {
  let data = await myReferrals(user.id);
  if (data.settings.enabled && !data.code && user.role === "CUSTOMER") {
    await ensureReferralCode(user.id);
    data = await myReferrals(user.id);
  }
  // A friend's order may have been delivered and paid since the last visit: settle open referrals (idempotent).
  if (data.friends.some((f) => f.status === "PENDING" || f.status === "APPROVED" || f.status === "QUALIFIED")) {
    if ((await settleReferralsOf(user.id)) > 0) data = await myReferrals(user.id);
  }
  const s = data.settings;
  const offer = s.refereeType === "PERCENT" ? `${s.refereeValue}% off` : `Rs ${(s.refereeValue / 100).toFixed(0)} off`;
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  return {
    enabled: s.enabled,
    code: data.code,
    shareText: data.code ? `Try Dabba Bela lunch boxes — use my code ${data.code} for ${offer} your first order.${site ? ` Sign up: ${site}/register?ref=${data.code}` : ""}` : null,
    shareUrl: data.code && site ? `${site}/register?ref=${data.code}` : null,
    offer: { refereeType: s.refereeType, refereeValue: s.refereeValue, refereeMinSubtotal: s.refereeMinSubtotal, referrerReward: s.referrerReward },
    friends: data.friends.map((f) => ({ id: f.id, name: f.name, status: f.status, at: iso(f.at) })),
    rewarded: data.rewarded,
    rewardCount: data.rewardCount,
    received: data.received,
    canClaim: data.canClaim,
  };
});
