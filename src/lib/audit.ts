import { Prisma } from "@prisma/client";
import { db } from "./db";
import { log } from "./logger";
import { getRequestContext } from "./request-context";
import { redactSecrets, redactString } from "./redact";

export { REDACTED, isSecretKey, redactSecrets } from "./redact";

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
