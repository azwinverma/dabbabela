import "server-only";
import { db } from "@/lib/db";
import { isStaffRole } from "@/lib/permissions";
import type { Detector, Finding } from "../types";

const HOUR = 3600_000;
/** Failed sign-ins per account within one clock hour that count as a burst (architecture §9). */
export const FAILED_LOGIN_THRESHOLD = 10;
/** Failed sign-ins from one IP address within one clock hour. */
export const FAILED_LOGIN_IP_THRESHOLD = 30;

/** Audit actions that change who can do what. */
export const PERMISSION_ACTIONS = ["staff.create", "staff.promote", "staff.update", "staff.custom_role", "staff.scope", "role.create", "role.update", "role.delete"];

function hourBucket(d: Date) {
  return new Date(Math.floor(d.getTime() / HOUR) * HOUR).toISOString().slice(0, 13);
}

/**
 * Security incidents: bursts of failed sign-ins (LoginEvent) per account or per IP in a clock hour, over the last
 * 24 hours, and staff permission changes from the audit log (last 2 days; CRITICAL when someone is made super admin).
 */
export const security: Detector = {
  name: "security",
  label: "Security incidents",
  mode: "event",
  async run({ now }) {
    const out: Finding[] = [];
    const failed = await db.loginEvent.findMany({ where: { success: false, createdAt: { gte: new Date(now.getTime() - 24 * HOUR), lte: now } }, select: { email: true, ip: true, userId: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 20_000 });
    const byAccount = new Map<string, { email: string; userId: string | null; hour: string; n: number }>();
    const byIp = new Map<string, { ip: string; hour: string; n: number; accounts: Set<string> }>();
    for (const e of failed) {
      const hour = hourBucket(e.createdAt);
      if (e.email) {
        const k = `${e.email}|${hour}`;
        const a = byAccount.get(k) ?? { email: e.email, userId: e.userId, hour, n: 0 };
        a.n++;
        a.userId ??= e.userId;
        byAccount.set(k, a);
      }
      if (e.ip) {
        const k = `${e.ip}|${hour}`;
        const a = byIp.get(k) ?? { ip: e.ip, hour, n: 0, accounts: new Set<string>() };
        a.n++;
        if (e.email) a.accounts.add(e.email);
        byIp.set(k, a);
      }
    }
    const bursts = [...byAccount.values()].filter((a) => a.n >= FAILED_LOGIN_THRESHOLD);
    const users = await db.user.findMany({ where: { id: { in: bursts.map((b) => b.userId).filter((x): x is string => Boolean(x)) } }, select: { id: true, role: true } });
    const roleOf = new Map(users.map((u) => [u.id, u.role]));
    for (const b of bursts) {
      const staff = b.userId ? isStaffRole(roleOf.get(b.userId)) : false;
      out.push({ type: "FAILED_LOGINS", severity: staff ? "CRITICAL" : "WARNING", entity: b.userId ? "User" : null, entityId: b.userId, key: `logins:${b.email}:${b.hour}`, message: `${b.n} failed sign-ins for ${b.email}${staff ? " (staff account)" : ""} in the hour from ${b.hour.replace("T", " ")}:00 UTC`, href: b.userId ? (staff ? `/admin/staff/${b.userId}` : `/admin/customers/${b.userId}`) : "/admin/audit", data: { email: b.email, attempts: b.n, hour: b.hour, staff } });
    }
    for (const b of byIp.values()) {
      if (b.n < FAILED_LOGIN_IP_THRESHOLD) continue;
      out.push({ type: "FAILED_LOGINS_IP", severity: "WARNING", key: `logins-ip:${b.ip}:${b.hour}`, message: `${b.n} failed sign-ins from ${b.ip} across ${b.accounts.size} account(s) in the hour from ${b.hour.replace("T", " ")}:00 UTC`, href: "/admin/audit", data: { ip: b.ip, attempts: b.n, accounts: b.accounts.size, hour: b.hour } });
    }

    const changes = await db.auditLog.findMany({ where: { action: { in: PERMISSION_ACTIONS }, createdAt: { gte: new Date(now.getTime() - 48 * HOUR), lte: now } }, include: { actor: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 200 });
    for (const c of changes) {
      const toSuper = JSON.stringify(c.after ?? null).includes("SUPER_ADMIN");
      out.push({
        type: "PERMISSION_CHANGE",
        severity: toSuper ? "CRITICAL" : "INFO",
        entity: c.entity,
        entityId: c.entityId,
        key: `perm:${c.id}`,
        message: `${c.actor?.name ?? "System"}: ${c.action}${c.summary ? ` — ${c.summary}` : ""}${toSuper ? " (super admin granted)" : ""}`,
        href: `/admin/audit?entityId=${encodeURIComponent(c.entityId ?? "")}`,
        data: { auditId: c.id, action: c.action, actorId: c.actorId, at: c.createdAt.toISOString() },
      });
    }
    return out;
  },
};
