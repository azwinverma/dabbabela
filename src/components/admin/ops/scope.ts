import "server-only";
import { db } from "@/lib/db";
import { can } from "@/lib/permissions";
import { maskEmail, maskPhone, formatNepalPhone } from "@/lib/phone";
import { todayKTM, isValidISODate } from "@/lib/dates";
import { fail, type ActionResult } from "@/lib/action";
import type { CurrentUser } from "@/lib/auth";

/** Kitchens this staff member may see (User.kitchenId scopes to one). */
export async function kitchensFor(user: Pick<CurrentUser, "kitchenId">) {
  return db.kitchen.findMany({ where: { isActive: true, ...(user.kitchenId ? { id: user.kitchenId } : {}) }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, code: true } });
}

/** Resolve ?kitchen= against the user's scope; first allowed kitchen by default. */
export async function pickKitchen(user: Pick<CurrentUser, "kitchenId">, requested?: string) {
  const ks = await kitchensFor(user);
  const k = ks.find((x) => x.id === requested) ?? ks[0] ?? null;
  return { kitchens: ks, kitchen: k };
}

export function assertKitchen(user: Pick<CurrentUser, "kitchenId">, kitchenId: string) {
  if (user.kitchenId && user.kitchenId !== kitchenId) throw new Error("That kitchen isn't in your scope");
}

/** Where-clause fragment for kitchen-scoped queries. */
export function kitchenWhere(user: Pick<CurrentUser, "kitchenId">) {
  return user.kitchenId ? { kitchenId: user.kitchenId } : {};
}

export function pickDate(v?: string) {
  return v && isValidISODate(v) ? v : todayKTM();
}

/** PII helpers: full value only for roles with customers.pii. */
export function piiFor(role: string) {
  const full = can(role, "customers.pii");
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
