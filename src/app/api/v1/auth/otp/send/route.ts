import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { ApiError, readJson, tooMany } from "@/server/api/http";
import { bearerHeaders } from "@/server/api/auth";
import { auth, authError } from "@/server/api/auth-flow";
import { hit } from "@/server/api/rate-limit";
import { getSettings } from "@/lib/settings";
import { isNepalMobile, normalizeNepalPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const schema = z.object({ phone: z.string().trim().min(8).max(20) });

/** Send a 6-digit sign-in code by SMS (only when `flags.phoneOtp` is on and an SMS provider is configured). */
export const POST = apiRoute({ auth: "public" }, async ({ req, ip }) => {
  const s = await getSettings();
  if (!s.flags.phoneOtp) throw new ApiError(404, "FEATURE_DISABLED", "Mobile sign-in isn't available yet — use your email");
  const { phone: raw } = await readJson(req, schema);
  const phone = normalizeNepalPhone(raw);
  if (!phone || !isNepalMobile(phone)) throw new ApiError(422, "VALIDATION_FAILED", "Enter a Nepal mobile number (98/97/96…)", { phone: "98/97/96 + 8 digits" });
  if (!(await hit("otpSend", ip)) || !(await hit("otpSend", phone))) throw tooMany();
  try {
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone }, headers: bearerHeaders(req) });
  } catch (e) {
    throw authError(e, "We couldn't send a code");
  }
  return { sent: true, phone };
});
