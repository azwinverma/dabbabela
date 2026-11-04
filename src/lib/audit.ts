import { db } from "./db";
import { log } from "./logger";

type AuditInput = {
  actorId?: string | null;
  action: string; // "order.status", "menu.publish", "settings.update" …
  entity: string;
  entityId?: string | null;
  summary?: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
};

const json = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

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
    await db.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        summary: input.summary,
        reason: input.reason ?? null,
        before: json(input.before),
        after: json(input.after),
      },
    });
  } catch (e) {
    log.error("audit.write_failed", { action: input.action, entity: input.entity, error: e });
  }
}
