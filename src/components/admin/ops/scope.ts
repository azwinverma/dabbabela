import "server-only";
import { db } from "@/lib/db";
import { can, type PermissionSubject } from "@/lib/permissions";
import { maskEmail, maskPhone, formatNepalPhone } from "@/lib/phone";
import { todayKTM, isValidISODate } from "@/lib/dates";
import { fail, type ActionResult } from "@/lib/action";

/** Kitchen scope of a staff member: StaffScope kitchens ∪ User.kitchenId (see lib/user-context). null = all kitchens. */
export type KitchenScoped = { kitchenId?: string | null; kitchenIds?: string[] | null };
export function scopeIds(user: KitchenScoped): string[] | null {
  if (user.kitchenIds !== undefined) return user.kitchenIds;
  return user.kitchenId ? [user.kitchenId] : null;
}

/** Kitchens this staff member may see. */
export async function kitchensFor(user: KitchenScoped) {
  const ids = scopeIds(user);
  return db.kitchen.findMany({ where: { isActive: true, ...(ids ? { id: { in: ids } } : {}) }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, code: true } });
}

/** Resolve ?kitchen= against the user's scope; first allowed kitchen by default. */
export async function pickKitchen(user: KitchenScoped, requested?: string) {
  const ks = await kitchensFor(user);
  const k = ks.find((x) => x.id === requested) ?? ks[0] ?? null;
  return { kitchens: ks, kitchen: k };
}

export function inScope(user: KitchenScoped, kitchenId: string) {
  const ids = scopeIds(user);
  return !ids || ids.includes(kitchenId);
}

export function assertKitchen(user: KitchenScoped, kitchenId: string) {
  if (!inScope(user, kitchenId)) throw new Error("That kitchen isn't in your scope");
}

/** Where-clause fragment for kitchen-scoped queries (any model with a kitchenId column). */
export function kitchenWhere(user: KitchenScoped) {
  const ids = scopeIds(user);
  return ids ? { kitchenId: { in: ids } } : {};
}

export function pickDate(v?: string) {
  return v && isValidISODate(v) ? v : todayKTM();
}

/** PII helpers: full value only for roles with customers.pii. */
export function piiFor(subject: PermissionSubject) {
  const full = can(subject, "customers.pii");
  return {
    full,
    phone: (p: string | null | undefined) => (full ? formatNepalPhone(p) || p || "" : maskPhone(p)),
    email: (e: string | null | undefined) => (full ? e ?? "" : maskEmail(e)),
  };
}

/** Wrap a server action body: thrown errors become a friendly ActionResult. */
export async function guard(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    return fail(e instanceof Error ? e.message : "Something went wrong");
  }
}

export function reasonOf(fd: FormData) {
  const r = String(fd.get("reason") ?? "").trim();
  if (r.length < 3) throw new Error("Give a reason (at least a few words) — it goes in the audit log");
  return r.slice(0, 500);
}
