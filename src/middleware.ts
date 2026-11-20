import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { CONSENT_COOKIE, FIRST_TOUCH_COOKIE, touchCookieUpdates } from "@/lib/attribution";
import { cspFromEnv, generateNonce } from "@/lib/csp";

/**
 * Runs on every route except static assets.
 *  1. Request id: keeps a well-formed upstream `x-request-id` / `x-vercel-id`, otherwise generates one; stamps it on the
 *     request (so `request-context.ts` / audit rows share it) and echoes it on the response.
 *  2. Attribution (WP-11): on consented page views only, records the first touch (once) and the last marketing touch
 *     in first-party cookies (see `src/lib/attribution.ts`).
 *  0. Content-Security-Policy with a fresh nonce per request (src/lib/csp.ts), on the request (for Next's inline
 *     scripts) and on the response.
 *  3. First line of defence only: bounce visitors without a session cookie away from protected areas to /login.
 *     Every protected page and server action re-validates the session and permissions on the server.
 */

const PROTECTED = ["/admin", "/account", "/checkout", "/pay", "/team", "/rider"];
const ID_OK = /^[A-Za-z0-9._:\-]{6,128}$/;

export function requestIdFor(h: Headers): string {
  for (const k of ["x-request-id", "x-vercel-id"]) {
    const v = (h.get(k) ?? "").trim();
    if (ID_OK.test(v)) return v;
  }
  return crypto.randomUUID();
}

function isProtected(pathname: string) {
  return PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isTrackablePageView(req: NextRequest) {
  if (req.method !== "GET") return false;
  const p = req.nextUrl.pathname;
  if (p.startsWith("/api") || p.startsWith("/admin") || p.startsWith("/rider") || p.startsWith("/_next")) return false;
  if (req.headers.get("next-router-prefetch") || req.headers.get("purpose") === "prefetch" || req.headers.get("rsc")) return false;
  return true;
}

export function middleware(req: NextRequest) {
  const requestId = requestIdFor(req.headers);
  const { pathname, search } = req.nextUrl;

  // Per-request CSP nonce: Next reads it from the request's CSP header and puts it on its inline scripts.
  const nonce = generateNonce();
  const csp = cspFromEnv(nonce);

  let res: NextResponse;
  if (isProtected(pathname) && !getSessionCookie(req, { cookiePrefix: "dabba" })) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    res = NextResponse.redirect(url);
  } else {
    const headers = new Headers(req.headers);
    headers.set("x-request-id", requestId);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    res = NextResponse.next({ request: { headers } });
  }
  res.headers.set("x-request-id", requestId);
  res.headers.set("Content-Security-Policy", csp);

  if (req.cookies.get(CONSENT_COOKIE)?.value === "granted" && isTrackablePageView(req)) {
    for (const c of touchCookieUpdates(req.cookies.get(FIRST_TOUCH_COOKIE)?.value, req.nextUrl, req.headers.get("referer"))) {
      res.cookies.set(c.name, c.value, { path: "/", maxAge: c.maxAge, sameSite: "lax", httpOnly: true, secure: req.nextUrl.protocol === "https:" });
    }
  }
  return res;
}

export const config = {
  // Everything except Next's static output and files with an extension (images, fonts, robots.txt, sitemap.xml …).
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|.*\\.[A-Za-z0-9]{2,5}$).*)"],
};
