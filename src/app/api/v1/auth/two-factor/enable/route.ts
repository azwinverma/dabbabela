import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson, tooMany } from "@/server/api/http";
import { bearerHeaders } from "@/server/api/auth";
import { auth, authError } from "@/server/api/auth-flow";
import { hit } from "@/server/api/rate-limit";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({ password: z.string().min(1, "Enter your password").max(128) });

/**
 * Start authenticator-app enrolment (required for staff when `staff2fa` is on). Returns the `otpauth://` URI (show as
 * a QR code / copyable secret) and one-time backup codes. Finish with POST /auth/two-factor/confirm.
 */
export const POST = apiRoute({ auth: "user" }, async ({ req, user, ip }) => {
  const { password } = await readJson(req, schema);
  if (!(await hit("twoFactor", ip))) throw tooMany();
  try {
    const res = (await auth.api.enableTwoFactor({ body: { password }, headers: bearerHeaders(req) })) as { totpURI: string; backupCodes: string[] };
    await audit({ actorId: user.id, action: "user.2fa_started", entity: "User", entityId: user.id, summary: "via mobile app" });
    return { totpURI: res.totpURI, backupCodes: res.backupCodes };
  } catch (e) {
    throw authError(e, "We couldn't start two-step sign-in");
  }
});
