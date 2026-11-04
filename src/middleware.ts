import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * First line of defence only: bounce visitors without a session cookie to /login.
 * Every protected page and server action re-validates the session and permissions on the server.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const cookie = getSessionCookie(req, { cookiePrefix: "dabba" });
  if (!cookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/account/:path*", "/checkout/:path*", "/pay/:path*", "/team/:path*", "/rider/:path*"],
};
