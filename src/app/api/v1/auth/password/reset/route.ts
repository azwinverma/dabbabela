import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson, tooMany } from "@/server/api/http";
import { bearerHeaders } from "@/server/api/auth";
import { auth, authError } from "@/server/api/auth-flow";
import { hit } from "@/server/api/rate-limit";

export const dynamic = "force-dynamic";

const schema = z.object({ token: z.string().min(8).max(500), password: z.string().min(8, "Use at least 8 characters").max(128) });

/** Set a new password with the token from the reset email. Every session of the account is revoked. */
export const POST = apiRoute({ auth: "public" }, async ({ req, ip }) => {
  const body = await readJson(req, schema);
  if (!(await hit("reset", `submit:${ip}`))) throw tooMany();
  try {
    await auth.api.resetPassword({ body: { newPassword: body.password, token: body.token }, headers: bearerHeaders(req) });
  } catch (e) {
    throw authError(e, "This link has expired — ask for a new one");
  }
  return { reset: true };
});
