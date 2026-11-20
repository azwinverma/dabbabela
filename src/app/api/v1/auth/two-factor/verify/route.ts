import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson, tooMany } from "@/server/api/http";
import { auth, authError, authUserDto, challengeHeaders, sessionTokenFrom } from "@/server/api/auth-flow";
import { hit } from "@/server/api/rate-limit";

export const dynamic = "force-dynamic";

const schema = z.object({
  challengeToken: z.string().min(10).max(2000),
  code: z.string().trim().min(4).max(32),
  /** true = `code` is one of the backup codes instead of the 6-digit TOTP. */
  backup: z.boolean().optional(),
});

/** Second sign-in step for accounts with an authenticator app: TOTP (or a backup code) → `{ token, user }`. */
export const POST = apiRoute({ auth: "public" }, async ({ req, ip }) => {
  const body = await readJson(req, schema);
  if (!(await hit("twoFactor", ip))) throw tooMany();
  const headers = challengeHeaders(req, body.challengeToken);
  const code = body.code.replace(/\s/g, "");
  try {
    const r = body.backup
      ? await auth.api.verifyBackupCode({ body: { code }, headers, returnHeaders: true })
      : await auth.api.verifyTOTP({ body: { code, trustDevice: false }, headers, returnHeaders: true });
    const res = r.response as { token?: string; user?: { id: string } };
    const token = sessionTokenFrom(r);
    if (!token || !res.user) throw new Error("No session issued");
    return { token, user: await authUserDto(res.user.id) };
  } catch (e) {
    throw authError(e, "That code isn't right");
  }
});
