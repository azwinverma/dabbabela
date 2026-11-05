import { NextResponse } from "next/server";
import { CONSENT_COOKIE, CONSENT_MAX_AGE, FIRST_TOUCH_COOKIE, LAST_TOUCH_COOKIE, touchCookieUpdates } from "@/lib/attribution";

export const dynamic = "force-dynamic";

/**
 * Records the visitor's answer to the attribution notice (WP-11).
 *  - granted: remember the choice and record the touch of the page they accepted on (its path + utm_* only, and the
 *    referring host), so the visit that brought them is not lost.
 *  - denied: remember the choice and delete any attribution cookies.
 * Body: { choice: "granted" | "denied", landing?: string (same-site URL), referrer?: string }
 */
export async function POST(req: Request) {
  const own = new URL(req.url);
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== own.host) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let body: { choice?: unknown; landing?: unknown; referrer?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body */
  }
  const choice = body.choice === "granted" ? "granted" : body.choice === "denied" ? "denied" : null;
  if (!choice) return NextResponse.json({ error: "choice must be granted or denied" }, { status: 400 });

  const secure = own.protocol === "https:";
  const res = NextResponse.json({ ok: true, choice });
  res.cookies.set(CONSENT_COOKIE, choice, { path: "/", maxAge: CONSENT_MAX_AGE, sameSite: "lax", secure });
  if (choice === "denied") {
    res.cookies.delete(FIRST_TOUCH_COOKIE);
    res.cookies.delete(LAST_TOUCH_COOKIE);
    return res;
  }
  let landing = new URL("/", own);
  if (typeof body.landing === "string") {
    try {
      const l = new URL(body.landing, own);
      if (l.host === own.host) landing = l;
    } catch {
      /* keep default */
    }
  }
  const referrer = typeof body.referrer === "string" ? body.referrer.slice(0, 500) : null;
  const cookieHeader = req.headers.get("cookie") ?? "";
  const existingFirst = cookieHeader
    .split(/;\s*/)
    .find((c) => c.startsWith(`${FIRST_TOUCH_COOKIE}=`))
    ?.slice(FIRST_TOUCH_COOKIE.length + 1);
  for (const c of touchCookieUpdates(existingFirst, landing, referrer)) res.cookies.set(c.name, c.value, { path: "/", maxAge: c.maxAge, sameSite: "lax", httpOnly: true, secure });
  return res;
}
