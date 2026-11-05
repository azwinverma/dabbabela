import { Prisma } from "@prisma/client";
import { db } from "./db";
import { log } from "./logger";
import { getRequestContext } from "./request-context";

export type AuditInput = {
  actorId?: string | null;
  action: string; // "order.status", "menu.publish", "settings.update" …
  entity: string;
  entityId?: string | null;
  summary?: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  /** Who approved this change (refund approve, credit over threshold, post-publish price change). */
  approvedById?: string | null;
  /** Overrides for the request context (normally filled automatically from the request). */
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

// ───────────────────────────── Redaction ─────────────────────────────
// Secrets never enter before/after: passwords, tokens, OTPs, signatures, card/gateway credentials.
// Deliberately narrower than the logger's list (that one also hides "code"/"key", which would blank
// order codes, coupon codes and setting keys that the audit trail needs).

export const REDACTED = "[redacted]";

/** Key words (camelCase / snake_case / kebab parts) that always mean a secret. */
const SECRET_WORDS = new Set([
  "password", "passwd", "pwd", "passcode", "passphrase", "secret", "secrets", "token", "tokens", "otp", "otps", "pin", "mpin", "tpin",
  "cvv", "cvv2", "cvc", "signature", "signatures", "authorization", "cookie", "cookies", "hash", "salt", "credential", "credentials",
]);
/** Substrings of the joined, lower-cased key that mean a secret. */
const SECRET_COMPOUNDS = ["password", "apikey", "privatekey", "secretkey", "accesskey", "clientsecret", "cardnumber", "cardno", "backupcode", "verificationcode", "resetcode", "authcode", "merchantkey"];

function keyWords(k: string) {
  return k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export function isSecretKey(k: string) {
  const words = keyWords(k);
  if (words.some((w) => SECRET_WORDS.has(w))) return true;
  const joined = words.join("");
  return SECRET_COMPOUNDS.some((c) => joined.includes(c));
}

function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const CARD_LIKE = /\b\d(?:[ -]?\d){12,18}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

function redactString(s: string) {
  return s
    .replace(BEARER, REDACTED)
    .replace(JWT, REDACTED)
    .replace(CARD_LIKE, (m) => {
      const d = m.replace(/\D/g, "");
      return d.length >= 13 && d.length <= 19 && luhn(d) ? REDACTED : m;
    });
}

/** Deep-copy `value` as JSON with secret keys and secret-looking strings replaced by "[redacted]". */
export function redactSecrets(value: unknown, depth = 0): unknown {
  if (value === undefined) return undefined;
  if (depth > 8) return "[depth]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return redactString(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 500).map((v) => (v === undefined ? null : redactSecrets(v, depth + 1)));
  if (typeof value === "object") {
    const maybe = value as { toJSON?: () => unknown };
    if (typeof maybe.toJSON === "function") return redactSecrets(maybe.toJSON(), depth + 1);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || typeof v === "function") continue;
      out[k] = isSecretKey(k) ? REDACTED : redactSecrets(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

/** Note: "pan" alone is NOT secret here — in Nepal it is the tax PAN (Company.panVat). Card numbers are caught by value (Luhn). */
const toJson = (v: unknown) => (v === undefined ? undefined : v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue));

const clip = (s: string | null | undefined, n: number) => (s ? s.slice(0, n) : null);

/** Write an audit row. Never throws (an audit failure must not break the user's action, but is logged loudly). */
export async function audit(input: AuditInput): Promise<void>;
export async function audit(
  actorId: string | null | undefined,
  action: string,
  entity: string,
  entityId?: string | null,
  summary?: string,
  meta?: Record<string, unknown>,
): Promise<void>;
export async function audit(...args: unknown[]) {
  const input: AuditInput =
    typeof args[0] === "object" && args[0] !== null && "action" in (args[0] as object)
      ? (args[0] as AuditInput)
      : {
          actorId: args[0] as string | null,
          action: args[1] as string,
          entity: args[2] as string,
          entityId: args[3] as string | null,
          summary: args[4] as string | undefined,
          after: args[5],
        };
  try {
    const ctx = await getRequestContext();
    const before = redactSecrets(input.before);
    const after = redactSecrets(input.after);
    await db.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        summary: input.summary !== undefined ? redactString(input.summary) : undefined,
        reason: input.reason != null ? redactString(input.reason) : null,
        before: toJson(before),
        after: toJson(after),
        approvedById: input.approvedById ?? null,
        requestId: clip(input.requestId ?? ctx.requestId, 128),
        ip: clip(input.ip ?? ctx.ip, 45),
        userAgent: clip(input.userAgent ?? ctx.userAgent, 300),
      },
    });
  } catch (e) {
    log.error("audit.write_failed", { action: input.action, entity: input.entity, error: e });
  }
}
