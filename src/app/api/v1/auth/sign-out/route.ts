import { apiRoute } from "@/server/api/route";
import { bearerHeaders } from "@/server/api/auth";
import { auth } from "@/server/api/auth-flow";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** End this session (the bearer token stops working). Optionally drops a push token registered by this device. */
export const POST = apiRoute({ auth: "user" }, async ({ req, user }) => {
  let deviceToken: string | null = null;
  try {
    const b = (await req.json()) as { deviceToken?: unknown };
    if (typeof b?.deviceToken === "string" && b.deviceToken.length <= 4096) deviceToken = b.deviceToken;
  } catch {
    /* no body */
  }
  if (deviceToken) await db.deviceToken.deleteMany({ where: { token: deviceToken, userId: user.id } });
  try {
    await auth.api.signOut({ headers: bearerHeaders(req) });
  } catch {
    /* already gone */
  }
  await db.session.deleteMany({ where: { id: user.sessionId, userId: user.id } });
  return { signedOut: true };
});
