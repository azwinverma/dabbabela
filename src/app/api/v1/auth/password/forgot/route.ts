import { z } from "zod";
import { isAPIError } from "better-auth/api";
import { apiRoute } from "@/server/api/route";
import { readJson, tooMany } from "@/server/api/http";
import { bearerHeaders } from "@/server/api/auth";
import { auth } from "@/server/api/auth-flow";
import { hit } from "@/server/api/rate-limit";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email") });

/**
 * Email a password-reset link (opens the website's /reset-password page). Same answer whether or not the email has an
 * account (no enumeration).
 */
export const POST = apiRoute({ auth: "public" }, async ({ req, ip }) => {
  const { email } = await readJson(req, schema);
  if (!(await hit("reset", ip)) || !(await hit("reset", email))) throw tooMany();
  try {
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" }, headers: bearerHeaders(req) });
  } catch (e) {
    if (isAPIError(e) && (e.statusCode === 429 || e.status === "TOO_MANY_REQUESTS")) throw tooMany("Too many requests — try again in a few minutes");
    log.warn("api.reset_request_failed", { error: e });
  }
  return { sent: true, message: "If that email has an account, a reset link is on its way. Check spam too." };
});
