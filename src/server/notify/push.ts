import "server-only";
import { importPKCS8, SignJWT } from "jose";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";

/**
 * Mobile push through Firebase Cloud Messaging HTTP v1 (Android directly, iOS through FCM's APNs bridge — upload the
 * APNs key in the Firebase console; no APNs credentials live here).
 *
 * Env-gated on `FCM_SERVICE_ACCOUNT_JSON`: the Firebase service-account key (JSON, or the same JSON base64-encoded)
 * with `project_id`, `client_email`, `private_key`. Unset or unparseable → push is a no-op (nothing is queued) and
 * `/api/health` reports `push: false`.
 *
 * Auth: a short-lived OAuth2 access token from a self-signed RS256 JWT (scope firebase.messaging), cached in memory
 * until shortly before it expires. One HTTP request per device token (FCM v1 has no multicast). A token FCM reports
 * as UNREGISTERED (HTTP 404 / errorCode UNREGISTERED) is deleted — the app re-registers on next launch.
 */

type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

let cachedRaw: string | undefined;
let cachedAccount: ServiceAccount | null = null;

/** The configured service account, or null (unset / not JSON / missing fields). */
export function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON?.trim();
  if (raw === cachedRaw) return cachedAccount;
  cachedRaw = raw;
  cachedAccount = null;
  if (!raw) return null;
  for (const text of [raw, safeBase64(raw)]) {
    if (!text) continue;
    try {
      const j = JSON.parse(text) as Partial<ServiceAccount>;
      if (typeof j.project_id === "string" && typeof j.client_email === "string" && typeof j.private_key === "string" && j.private_key.includes("PRIVATE KEY")) {
        cachedAccount = { project_id: j.project_id, client_email: j.client_email, private_key: j.private_key.replace(/\\n/g, "\n"), token_uri: typeof j.token_uri === "string" ? j.token_uri : undefined };
        return cachedAccount;
      }
    } catch {
      /* try the next form */
    }
  }
  log.warn("push.bad_service_account", { hint: "FCM_SERVICE_ACCOUNT_JSON is set but isn't a service-account JSON (raw or base64)" });
  return null;
}

function safeBase64(s: string) {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(s)) return null;
  try {
    return Buffer.from(s, "base64").toString("utf8");
  } catch {
    return null;
  }
}

export function pushConfigured() {
  return serviceAccount() !== null;
}

let token: { value: string; exp: number; account: string } | null = null;

/** OAuth2 access token for FCM (cached). Exported for tests. */
export async function fcmAccessToken(force = false): Promise<string> {
  const sa = serviceAccount();
  if (!sa) throw new Error("Push is not configured");
  if (!force && token && token.account === sa.client_email && token.exp - 60_000 > Date.now()) return token.value;
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri ?? DEFAULT_TOKEN_URI;
  const key = await importPKCS8(sa.private_key, "RS256");
  const assertion = await new SignJWT({ scope: SCOPE }).setProtectedHeader({ alg: "RS256", typ: "JWT" }).setIssuer(sa.client_email).setSubject(sa.client_email).setAudience(tokenUri).setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`FCM token HTTP ${res.status}`);
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("FCM token response had no access_token");
  token = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000, account: sa.client_email };
  return token.value;
}

/** Test hook: forget the cached access token / service account. */
export function resetPushCache() {
  token = null;
  cachedRaw = undefined;
  cachedAccount = null;
}

export type PushMessage = { title: string; body: string; data?: Record<string, string> };
export type PushResult = { ok: boolean; skipped?: boolean; error?: string; sent: number; removed: number; failed: number };

/** FCM error code from a v1 error body (details[].errorCode, e.g. UNREGISTERED / INVALID_ARGUMENT / QUOTA_EXCEEDED). */
function fcmErrorCode(body: unknown): string | null {
  const err = (body as { error?: { status?: string; details?: { errorCode?: string }[] } } | null)?.error;
  return err?.details?.find((d) => d?.errorCode)?.errorCode ?? err?.status ?? null;
}

/**
 * Send one notification to every device the user registered. ok = delivered to at least one device; skipped = push
 * not configured or the user has no (remaining) devices; otherwise failed (the outbox retries with backoff).
 */
export async function deliverPush(userId: string, msg: PushMessage): Promise<PushResult> {
  const sa = serviceAccount();
  if (!sa) return { ok: false, skipped: true, sent: 0, removed: 0, failed: 0 };
  const devices = await db.deviceToken.findMany({ where: { userId }, select: { id: true, token: true, platform: true } });
  if (!devices.length) return { ok: false, skipped: true, sent: 0, removed: 0, failed: 0 };
  const data = Object.fromEntries(Object.entries(msg.data ?? {}).filter(([, v]) => typeof v === "string" && v.length > 0));
  let sent = 0,
    removed = 0,
    failed = 0;
  let lastError: string | undefined;
  let access: string;
  try {
    access = await fcmAccessToken();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), sent, removed, failed: devices.length };
  }
  for (const d of devices) {
    const message = {
      token: d.token,
      notification: { title: msg.title.slice(0, 200), body: msg.body.slice(0, 1000) },
      data,
      android: { priority: "HIGH", notification: { channel_id: "default" } },
      apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } },
    };
    try {
      let res = await send(sa.project_id, access, message);
      if (res.status === 401) {
        // Token revoked / rotated: refresh once.
        access = await fcmAccessToken(true);
        res = await send(sa.project_id, access, message);
      }
      if (res.ok) {
        sent++;
        continue;
      }
      const body = await res.json().catch(() => null);
      const code = fcmErrorCode(body);
      if (res.status === 404 || code === "UNREGISTERED") {
        await db.deviceToken.deleteMany({ where: { id: d.id } });
        removed++;
        log.info("push.token_removed", { userId, platform: d.platform, suffix: d.token.slice(-6) });
        continue;
      }
      failed++;
      lastError = `FCM HTTP ${res.status}${code ? ` ${code}` : ""}`;
    } catch (e) {
      failed++;
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  if (sent) return { ok: true, sent, removed, failed };
  if (!failed) return { ok: false, skipped: true, sent, removed, failed };
  return { ok: false, error: lastError, sent, removed, failed };
}

function send(projectId: string, access: string, message: unknown) {
  return fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(10_000),
  });
}
