import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { ApiError, readJson, tooMany } from "@/server/api/http";
import { bearerHeaders } from "@/server/api/auth";
import { auth, authError, authUserDto, sessionTokenFrom } from "@/server/api/auth-flow";
import { hit } from "@/server/api/rate-limit";
import { afterRegister, preRegisterCheck, registerSchema } from "@/server/registration";

export const dynamic = "force-dynamic";

const schema = registerSchema.extend({ ref: z.string().trim().max(20).optional() });

/**
 * Create a customer account (same rules as the web register form) and sign in → `{ token, user }` (201).
 * Bot protection (security review L3): the app can't render Turnstile, so the API uses stricter limits than the web
 * form instead — the web sign-up limit per IP plus `signUpApi` (3 per hour) per IP and per email. TODO: app
 * attestation (Play Integrity / App Attest) once the store builds exist.
 */
export const POST = apiRoute({ auth: "public" }, async ({ req, ip }) => {
  const d = await readJson(req, schema);
  if (!(await hit("signUp", ip)) || !(await hit("signUpApi", ip)) || !(await hit("signUpApi", `email:${d.email.toLowerCase()}`))) throw tooMany();
  const check = await preRegisterCheck(d);
  if (!check.ok) throw new ApiError(422, "VALIDATION_FAILED", check.message, { [check.field]: check.hint });
  let r;
  try {
    r = await auth.api.signUpEmail({ body: { name: d.name, email: d.email, password: d.password }, headers: bearerHeaders(req), returnHeaders: true });
  } catch (e) {
    throw authError(e, "We couldn't create your account");
  }
  const userId = (r.response as { user: { id: string } }).user.id;
  await afterRegister(userId, { phone: check.phone, company: check.company, ref: d.ref });
  const token = sessionTokenFrom(r);
  return new Response(JSON.stringify({ data: { token, user: await authUserDto(userId) } }), { status: 201, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
});
