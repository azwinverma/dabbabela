import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { can, type PermissionSubject } from "@/lib/permissions";
import { dateWhere, one, pageWindow, parseDateRange, parseListParams, type ListState, type SearchParamsRecord } from "../_kit/params";
import { recordHref } from "../_kit/links";

/** Audit log search (WP-17). Pure filter parsing + a permission-checked query used by the page and tests. */
export const AUDIT_SORTABLE = ["createdAt", "action", "entity"] as const;
export type AuditSort = (typeof AUDIT_SORTABLE)[number];

export type AuditFilters = {
  q?: string;
  actor?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  requestId?: string;
  approved?: boolean;
  from?: string;
  to?: string;
  gte?: Date;
  lte?: Date;
};

export function parseAuditFilters(sp: SearchParamsRecord): AuditFilters {
  const range = parseDateRange(sp);
  return {
    q: one(sp, "q"),
    actor: one(sp, "actor"),
    action: one(sp, "action"),
    entity: one(sp, "entity"),
    entityId: one(sp, "entityId"),
    requestId: one(sp, "requestId"),
    approved: one(sp, "approved") === "yes" || undefined,
    ...range,
  };
}

export function parseAuditList(sp: SearchParamsRecord): ListState<AuditSort> {
  return parseListParams(sp, { sortable: AUDIT_SORTABLE, sort: "createdAt", dir: "desc", per: 50 });
}

export function buildAuditWhere(f: AuditFilters): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (f.actor) and.push(f.actor === "system" ? { actorId: null } : { actorId: f.actor });
  if (f.action) and.push({ action: { startsWith: f.action } });
  if (f.entity) and.push({ entity: f.entity });
  if (f.entityId) and.push({ entityId: f.entityId });
  if (f.requestId) and.push({ requestId: f.requestId });
  if (f.approved) and.push({ approvedById: { not: null } });
  const created = dateWhere(f);
  if (created) and.push({ createdAt: created });
  if (f.q)
    and.push({
      OR: [
        { summary: { contains: f.q, mode: "insensitive" } },
        { reason: { contains: f.q, mode: "insensitive" } },
        { action: { contains: f.q, mode: "insensitive" } },
        { entityId: f.q },
        { requestId: f.q },
        { actor: { name: { contains: f.q, mode: "insensitive" } } },
      ],
    });
  return and.length ? { AND: and } : {};
}

export type AuditRow = Awaited<ReturnType<typeof searchAudit>>["rows"][number];

/** Server-side gate: throws without audit.view (pages also call requirePermission first). */
export async function searchAudit(user: PermissionSubject, filters: AuditFilters, state: ListState<AuditSort>) {
  if (!can(user, "audit.view")) throw new Error("Forbidden: audit.view required");
  const where = buildAuditWhere(filters);
  const orderBy: Prisma.AuditLogOrderByWithRelationInput[] = state.sort === "createdAt" ? [{ createdAt: state.dir }] : [{ [state.sort]: state.dir }, { createdAt: "desc" }];
  const [logs, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy, ...pageWindow(state), include: { actor: { select: { id: true, name: true, role: true } } } }),
    db.auditLog.count({ where }),
  ]);
  const approverIds = [...new Set(logs.map((l) => l.approvedById).filter((x): x is string => Boolean(x)))];
  const userEntityIds = [...new Set(logs.filter((l) => l.entity === "User" && l.entityId).map((l) => l.entityId!))];
  const [approvers, entityUsers] = await Promise.all([
    approverIds.length ? db.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } }) : [],
    userEntityIds.length ? db.user.findMany({ where: { id: { in: userEntityIds } }, select: { id: true, role: true } }) : [],
  ]);
  const approverName = new Map(approvers.map((a) => [a.id, a.name]));
  const roleOf = new Map(entityUsers.map((u) => [u.id, u.role]));
  return {
    total,
    rows: logs.map((l) => ({
      ...l,
      approver: l.approvedById ? { id: l.approvedById, name: approverName.get(l.approvedById) ?? "Unknown user" } : null,
      href: recordHref(l.entity, l.entityId, { role: l.entityId ? roleOf.get(l.entityId) : null }),
    })),
  };
}

/** Options for the filter selects. */
export async function auditFilterOptions() {
  const [entities, actors] = await Promise.all([
    db.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
    db.user.findMany({ where: { role: { not: "CUSTOMER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { entities: entities.map((e) => e.entity), actors };
}

/** Field-level diff of before/after JSON (pure, shared by the page and tests). */
export function diffKeys(before: unknown, after: unknown): { key: string; before: unknown; after: unknown }[] {
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const b = obj(before);
  const a = obj(after);
  return [...new Set([...Object.keys(b), ...Object.keys(a)])]
    .filter((k) => !["updatedAt", "createdAt"].includes(k) && JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => ({ key: k, before: b[k], after: a[k] }));
}
