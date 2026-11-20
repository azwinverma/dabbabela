import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { ApiError, badRequest, conflict } from "./http";

/**
 * `Idempotency-Key` for money-moving POSTs.
 *
 * Every such endpoint requires the header (8–80 chars of [A-Za-z0-9_-:.]). The first request with a key runs; its
 * successful (2xx) response is stored for 24 h and replayed byte-for-byte to any retry with the same key, user and
 * endpoint (`Idempotent-Replayed: true`). A retry while the first is still running gets 409 IDEMPOTENCY_IN_PROGRESS;
 * the same key with a different body gets 422 IDEMPOTENCY_KEY_REUSED. Failed requests release the key so the client
 * can retry with it. Where a service has its own idempotency (checkout, plans, add meal, renew, top-up), the key is
 * passed through as well, so even a lost replay record can't create a second payment.
 *
 * Storage: Better Auth's `Verification` table (identifier `api-idem:<user>:<scope>:<key>`) — no schema change; the
 * claim is atomic under a transaction-scoped advisory lock on the identifier.
 */

const KEY_OK = /^[A-Za-z0-9_\-:.]{8,80}$/;
const TTL_MS = 24 * 60 * 60 * 1000;
const PENDING_STALE_MS = 2 * 60 * 1000; // a crashed request's claim stops blocking after this

type Stored = { state: "pending"; hash: string; at: number } | { state: "done"; hash: string; status: number; body: string };

export function readIdempotencyKey(req: Request): string {
  const k = (req.headers.get("idempotency-key") ?? "").trim();
  if (!k) throw badRequest("Send an Idempotency-Key header (a fresh random id per user action, reused on retry)", undefined, "IDEMPOTENCY_KEY_REQUIRED");
  if (!KEY_OK.test(k)) throw badRequest("Idempotency-Key must be 8–80 characters of letters, digits, - _ : .", undefined, "IDEMPOTENCY_KEY_INVALID");
  return k;
}

export function bodyHash(body: string | Uint8Array) {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Run `fn` at most once per (user, scope, key). `scope` should identify the endpoint + resource (e.g. "POST /orders").
 */
export async function withIdempotency(userId: string, scope: string, key: string, reqHash: string, fn: () => Promise<Response>): Promise<Response> {
  const identifier = `api-idem:${userId}:${scope}:${key}`.slice(0, 250);
  const claimed = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${identifier}))`;
    const row = await tx.verification.findFirst({ where: { identifier }, orderBy: { createdAt: "desc" } });
    if (row && row.expiresAt > new Date()) {
      const v = JSON.parse(row.value) as Stored;
      if (v.hash !== reqHash) return { kind: "reused" as const };
      if (v.state === "done") return { kind: "replay" as const, v };
      if (Date.now() - v.at < PENDING_STALE_MS) return { kind: "busy" as const };
    }
    if (row) await tx.verification.deleteMany({ where: { identifier } });
    const pending: Stored = { state: "pending", hash: reqHash, at: Date.now() };
    await tx.verification.create({ data: { identifier, value: JSON.stringify(pending), expiresAt: new Date(Date.now() + TTL_MS) } });
    return { kind: "run" as const };
  });

  if (claimed.kind === "reused") throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different request");
  if (claimed.kind === "busy") throw conflict("The first request with this Idempotency-Key is still being processed — retry shortly", "IDEMPOTENCY_IN_PROGRESS");
  if (claimed.kind === "replay") {
    const v = claimed.v as Extract<Stored, { state: "done" }>;
    return new Response(v.body, { status: v.status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Idempotent-Replayed": "true" } });
  }

  let res: Response;
  try {
    res = await fn();
  } catch (e) {
    await db.verification.deleteMany({ where: { identifier } }).catch(() => null);
    throw e;
  }
  if (res.status >= 200 && res.status < 300) {
    const body = await res.clone().text();
    const done: Stored = { state: "done", hash: reqHash, status: res.status, body };
    await db.verification.updateMany({ where: { identifier }, data: { value: JSON.stringify(done) } }).catch((e) => log.error("api.idempotency_store_failed", { error: e }));
  } else {
    await db.verification.deleteMany({ where: { identifier } }).catch(() => null);
  }
  return res;
}
