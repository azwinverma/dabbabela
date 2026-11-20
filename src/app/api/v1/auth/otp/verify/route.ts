import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { ApiError, readJson, tooMany } from "@/server/api/http";
import { bearerHeaders } from "@/server/api/auth";
import { auth, authError, authUserDto, challengeFrom, sessionTokenFrom } from "@/server/api/auth-flow";
import { hit } from "@/server/api/rate-limit";
import { getSettings } from "@/lib/settings";
import { normalizeNepalPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const schema = z.object({ phone: z.string().trim().min(8).max(20), code: z.string().trim().min(4).max(10) });

/**
 * Verify the SMS code → `{ token, user, isNew }` (a new phone-only account is created on first sign-in; `isNew` = ask
 * for name/email next). Accounts with an authenticator app get the two-factor challenge instead, like email sign-in.
 */
export const POST = apiRoute({ auth: "public" }, async ({ req, ip }) => {
  const s = await getSettings();
  if (!s.flags.phoneOtp) throw new ApiError(404, "FEATURE_DISABLED", "Mobile sign-in isn't available yet");
  const body = await readJson(req, schema);
  const phone = normalizeNepalPhone(body.phone);
  if (!phone) throw new ApiError(422, "VALIDATION_FAILED", "Enter a Nepal mobile number", { phone: "Invalid" });
  if (!(await hit("otpVerify", ip)) || !(await hit("otpVerify", phone))) throw tooMany();
  try {
    const r = await auth.api.verifyPhoneNumber({ body: { phoneNumber: phone, code: body.code }, headers: bearerHeaders(req), returnHeaders: true });
    const res = r.response as { user?: { id: string; email?: string }; twoFactorRedirect?: boolean };
    const challengeToken = challengeFrom(r.headers);
    if (res.twoFactorRedirect || (challengeToken && !r.headers.get("set-auth-token"))) return { twoFactorRequired: true, challengeToken, token: null, user: null, isNew: false };
    const token = sessionTokenFrom(r);
    if (!token || !res.user) throw new ApiError(401, "INVALID_CODE", "That code isn't right");
    return { twoFactorRequired: false, challengeToken: null, token, user: await authUserDto(res.user.id), isNew: Boolean(res.user.email?.endsWith("@phone.dabbabela.local")) };
  } catch (e) {
    throw authError(e, "That code isn't right");
  }
});
