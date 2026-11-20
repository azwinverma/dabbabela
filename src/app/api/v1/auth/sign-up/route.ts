import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { ApiError, readJson, tooMany } from "@/server/api/http";
import { bearerHeaders } from "@/server/api/auth";
import { auth, authError, authUserDto, sessionTokenFrom } from "@/server/api/auth-flow";
import { hit } from "@/server/api/rate-limit";
import { afterRegister, preRegisterCheck, registerSchema } from "@/server/registration";

export const dynamic = "force-dynamic";

const schema = registerSchema.extend({ ref: z.string().trim().max(20).optional() });

/** Create a customer account (same rules as the web register form) and sign in → `{ token, user }` (201). */
export const POST = apiRoute({ auth: "public" }, async ({ req, ip }) => {
  const d = await readJson(req, schema);
  if (!(await hit("signUp", ip))) throw tooMany();
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
