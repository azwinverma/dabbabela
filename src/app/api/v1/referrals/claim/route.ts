import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { ApiError, readJson } from "@/server/api/http";
import { claimReferral } from "@/server/marketing";

export const dynamic = "force-dynamic";

const schema = z.object({ code: z.string().trim().min(1, "Enter your friend's code").max(40) });

/** Link a friend's referral code to the caller's account (before their first order) — same as the website form. */
export const POST = apiRoute({ auth: "user", limit: "write" }, async ({ req, user }) => {
  const { code } = await readJson(req, schema);
  const r = await claimReferral(user.id, code);
  if (!r.ok) throw new ApiError(422, "REFERRAL_REJECTED", r.error, { code: r.error });
  return { status: r.status, message: `Linked! Enter ${code.toUpperCase()} as the coupon on your first order to get your welcome discount.` };
});
