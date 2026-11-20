import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson, tooMany } from "@/server/api/http";
import { bearerHeaders } from "@/server/api/auth";
import { auth, authError, authUserDto, challengeFrom, sessionTokenFrom } from "@/server/api/auth-flow";
import { hit } from "@/server/api/rate-limit";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email"), password: z.string().min(1, "Enter your password").max(128) });

/**
 * Email + password sign-in. Returns `{ token, user }`, or `{ twoFactorRequired: true, challengeToken }` for accounts
 * with an authenticator app (then POST /auth/two-factor/verify).
 */
export const POST = apiRoute({ auth: "public" }, async ({ req, ip }) => {
  const body = await readJson(req, schema);
  if (!(await hit("signIn", ip)) || !(await hit("signInEmail", body.email))) throw tooMany();
  try {
    const r = await auth.api.signInEmail({ body: { email: body.email, password: body.password, rememberMe: true }, headers: bearerHeaders(req), returnHeaders: true });
    const res = r.response as { twoFactorRedirect?: boolean; user?: { id: string } };
    if (res.twoFactorRedirect) {
      const challengeToken = challengeFrom(r.headers);
      if (!challengeToken) throw new Error("Two-factor challenge missing");
      return { twoFactorRequired: true, challengeToken, token: null, user: null };
    }
    const token = sessionTokenFrom(r);
    if (!token || !res.user) throw new Error("No session issued");
    return { twoFactorRequired: false, challengeToken: null, token, user: await authUserDto(res.user.id) };
  } catch (e) {
    throw authError(e, "We couldn't sign you in");
  }
});
