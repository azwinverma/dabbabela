import "server-only";
import type { Permission } from "@/lib/permissions";
import { runWithRequestContext, contextFromHeaders } from "@/lib/request-context";
import { ApiError, errorResponse, forbidden, ok, toErrorResponse, tooMany } from "./http";
import { assertStaff2fa, getApiUser, requireApiPermission, requireApiUser, type ApiUser } from "./auth";
import { bodyHash, readIdempotencyKey, withIdempotency } from "./idempotency";
import { hit, type LimitName } from "./rate-limit";

/**
 * Every /api/v1 handler is built with `apiRoute(options, fn)`. The options make the guard explicit and testable
 * (tests/unit/api-guards.test.ts fails when a v1 handler is missing `auth`, or is public without being allow-listed):
 *
 *   auth: "public"                  no session needed (published content, sign-in itself)
 *   auth: "optional"                session used when present (e.g. company-menu filtering), never required
 *   auth: "user"                    any signed-in account (customer endpoints act on the caller's own records only)
 *   auth: { permission: [...] }     signed in + any of the permissions + staff 2FA (= the web's requirePermission)
 *
 *   idempotent: "<scope>"           money-moving POST: Idempotency-Key header required, success replayed on retry
 *   limit: "<bucket>"               rate limit per user (or per IP when anonymous)
 */

export type AuthSpec = "public" | "optional" | "user" | { permission: Permission | Permission[] };

type UserFor<A extends AuthSpec> = A extends "public" | "optional" ? ApiUser | null : ApiUser;

export type ApiContext<A extends AuthSpec, P> = {
  req: Request;
  user: UserFor<A>;
  params: P;
  /** Present on idempotent routes. */
  idempotencyKey: string | null;
  ip: string;
};

export type RouteOptions<A extends AuthSpec> = {
  auth: A;
  idempotent?: string;
  limit?: LimitName;
};

type Handler<A extends AuthSpec, P> = (ctx: ApiContext<A, P>) => Promise<Response | unknown>;

function clientIp(req: Request) {
  const raw = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "").trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(raw) ? raw : "local";
}

/**
 * Browsers are denied cross-origin (no CORS headers are ever sent). Native apps send no Origin header. Same-origin
 * requests (the site itself) and origins listed in API_ALLOWED_ORIGINS pass.
 */
export function originAllowed(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const self = new URL(req.url).origin;
  const allowed = [self, process.env.NEXT_PUBLIC_SITE_URL, process.env.BETTER_AUTH_URL, ...(process.env.API_ALLOWED_ORIGINS?.split(",") ?? [])]
    .filter(Boolean)
    .map((o) => o!.trim().replace(/\/$/, ""));
  return allowed.includes(origin.replace(/\/$/, ""));
}

async function resolveUser(req: Request, spec: AuthSpec): Promise<ApiUser | null> {
  if (spec === "public") return null;
  if (spec === "optional") return getApiUser(req);
  if (spec === "user") return requireApiUser(req);
  const perms = Array.isArray(spec.permission) ? spec.permission : [spec.permission];
  if (!perms.length) throw forbidden();
  return requireApiPermission(req, ...perms);
}

export function apiRoute<A extends AuthSpec, P = Record<string, string>>(opts: RouteOptions<A>, fn: Handler<A, P>) {
  if (!opts || opts.auth === undefined) throw new Error("apiRoute: `auth` is required");
  return async function handler(req: Request, context?: { params: Promise<P> }): Promise<Response> {
    const rc = contextFromHeaders(req.headers);
    return runWithRequestContext(rc, async () => {
      try {
        if (!originAllowed(req)) return errorResponse(403, "CORS_FORBIDDEN", "Cross-origin browser requests are not allowed");
        const user = await resolveUser(req, opts.auth);
        const ip = clientIp(req);
        if (opts.limit && !(await hit(opts.limit, user ? `u:${user.id}` : `ip:${ip}`))) throw tooMany();
        const params = (context?.params ? await context.params : {}) as P;

        if (opts.idempotent) {
          if (!user) throw new ApiError(500, "INTERNAL", "Idempotent routes need a signed-in user");
          const key = readIdempotencyKey(req);
          const buf = new Uint8Array(await req.arrayBuffer());
          const replayable = new Request(req.url, { method: req.method, headers: req.headers, body: buf.byteLength ? buf : undefined });
          const scope = `${req.method} ${new URL(req.url).pathname}`;
          return await withIdempotency(user.id, scope, key, bodyHash(buf), async () => {
            try {
              return wrap(await fn({ req: replayable, user: user as UserFor<A>, params, idempotencyKey: key, ip }));
            } catch (e) {
              return toErrorResponse(e);
            }
          });
        }
        return wrap(await fn({ req, user: user as UserFor<A>, params, idempotencyKey: null, ip }));
      } catch (e) {
        return toErrorResponse(e);
      }
    });
  };
}

function wrap(out: unknown): Response {
  return out instanceof Response ? out : ok(out ?? null);
}

/** Use inside "optional"/"user" handlers that need staff 2FA for a staff-only branch. */
export { assertStaff2fa };
