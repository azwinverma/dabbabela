import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { cache } from "react";

/**
 * Per-request correlation context (docs/SUPER_ADMIN_ARCHITECTURE.md §3).
 *
 * Resolution order:
 *  1. an explicit context set with `runWithRequestContext()` (cron jobs, scripts, tests);
 *  2. the incoming request headers (`x-request-id`, then `x-vercel-id`, then `x-correlation-id`),
 *     memoised per request with React `cache()` so every audit row of one request shares an id;
 *  3. a generated id when neither exists (outside a request, or the header is missing/malformed).
 *
 * Middleware does not stamp `x-request-id` yet (cross-package request in the tracker); until it does,
 * a request without an upstream id gets one generated on first use, shared within the request via cache().
 */
export type RequestContext = { requestId: string; ip: string | null; userAgent: string | null };

const store = new AsyncLocalStorage<RequestContext>();

const ID_OK = /^[A-Za-z0-9._:\-]{6,128}$/;

export function newRequestId() {
  return randomUUID();
}

/** Keep upstream ids only when they look like ids (no header injection / log forging). */
export function sanitizeRequestId(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return ID_OK.test(s) ? s : null;
}

function firstIp(h: Headers): string | null {
  const fwd = h.get("x-forwarded-for");
  const raw = (fwd ? fwd.split(",")[0] : null) ?? h.get("x-real-ip") ?? h.get("cf-connecting-ip");
  const ip = raw?.trim() ?? "";
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

/** Build a context from request headers (pure; exported for tests). */
export function contextFromHeaders(h: Headers | null | undefined): RequestContext {
  if (!h) return { requestId: newRequestId(), ip: null, userAgent: null };
  const requestId = sanitizeRequestId(h.get("x-request-id")) ?? sanitizeRequestId(h.get("x-vercel-id")) ?? sanitizeRequestId(h.get("x-correlation-id")) ?? newRequestId();
  const ua = h.get("user-agent");
  return { requestId, ip: firstIp(h), userAgent: ua ? ua.slice(0, 300) : null };
}

const fromRequest = cache(async (): Promise<RequestContext> => {
  try {
    const { headers } = await import("next/headers");
    return contextFromHeaders(await headers());
  } catch {
    // Outside a request scope (scripts, cron helpers called directly, unit tests).
    return contextFromHeaders(null);
  }
});

/** The current request's context. Never throws. */
export async function getRequestContext(): Promise<RequestContext> {
  return store.getStore() ?? fromRequest();
}

/** Run `fn` with an explicit context (jobs, scripts, tests). Missing fields are filled in. */
export function runWithRequestContext<T>(ctx: Partial<RequestContext>, fn: () => T): T {
  return store.run({ requestId: sanitizeRequestId(ctx.requestId) ?? newRequestId(), ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null }, fn);
}
