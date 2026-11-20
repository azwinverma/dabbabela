import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson, tooMany } from "@/server/api/http";
import { bearerHeaders } from "@/server/api/auth";
import { auth, authError, sessionTokenFrom } from "@/server/api/auth-flow";
import { hit } from "@/server/api/rate-limit";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const schema = z.object({ code: z.string().trim().min(6).max(10) });

/**
 * Confirm enrolment with the first 6-digit code. Better Auth rotates the session when 2FA turns on, so the response
 * carries a **new token** — replace the stored one (the old token stops working).
 */
export const POST = apiRoute({ auth: "user" }, async ({ req, user, ip }) => {
  const { code } = await readJson(req, schema);
  if (!(await hit("twoFactor", ip))) throw tooMany();
  let token: string | null;
  try {
    const r = await auth.api.verifyTOTP({ body: { code: code.replace(/\s/g, "") }, headers: bearerHeaders(req), returnHeaders: true });
    token = r.headers.get("set-auth-token") ?? sessionTokenFrom(r);
  } catch (e) {
    throw authError(e, "That code isn't right");
  }
  await audit({ actorId: user.id, action: "user.2fa_enabled", entity: "User", entityId: user.id, summary: "via mobile app" });
  return { twoFactorEnabled: true, token };
});
