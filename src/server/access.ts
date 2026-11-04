import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can, canGrantRole, isGranular, isStaffRole, ungrantable, ROLE_LABEL } from "@/lib/permissions";

/**
 * Staff access management (WP-01): custom roles, role assignment, data scopes, sessions.
 * Every function re-checks authority itself — callers (server actions) can't skip a guard.
 */
export type Actor = { id: string; role: Role; customGrants?: readonly string[] | null; kitchenIds?: string[] | null };

export class AccessError extends Error {}

function deny(msg: string): never {
  throw new AccessError(msg);
}

const KEY = /^[a-z][a-z0-9-]{1,40}$/;

function cleanPermissions(perms: readonly string[]) {
  const unique = [...new Set(perms.map((p) => p.trim()).filter(Boolean))];
  const bad = unique.filter((p) => !isGranular(p));
  if (bad.length) deny(`Unknown permission(s): ${bad.join(", ")}`);
  return unique.sort();
}

function requireRoleEditor(actor: Actor) {
  if (actor.role !== "SUPER_ADMIN" || !can(actor, "roles.edit")) deny("Only a super admin can create or change roles");
}

function slugKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export async function createRole(actor: Actor, input: { name: string; key?: string | null; description?: string | null; permissions: readonly string[] }) {
  requireRoleEditor(actor);
  const name = input.name.trim().slice(0, 60);
  if (name.length < 3) deny("Give the role a name (3+ characters)");
  const key = (input.key?.trim() || slugKey(name)).toLowerCase();
  if (!KEY.test(key)) deny("Key: lowercase letters, numbers and dashes");
  const permissions = cleanPermissions(input.permissions);
  const missing = ungrantable(actor, permissions);
  if (missing.length) deny(`You can't grant permissions you don't hold: ${missing.join(", ")}`);
  if (await db.staffRole.findUnique({ where: { key } })) deny("A role with that key already exists");
  const role = await db.staffRole.create({ data: { key, name, description: input.description?.trim().slice(0, 500) || null, permissions } });
  await audit({ actorId: actor.id, action: "role.create", entity: "StaffRole", entityId: role.id, summary: `${name} (${permissions.length} permissions)`, after: { key, name, permissions } });
  return role;
}

export async function updateRole(actor: Actor, id: string, input: { name: string; description?: string | null; permissions: readonly string[] }) {
  requireRoleEditor(actor);
  const role = await db.staffRole.findUnique({ where: { id } });
  if (!role) deny("Role not found");
  const name = input.name.trim().slice(0, 60);
  if (name.length < 3) deny("Give the role a name (3+ characters)");
  const permissions = cleanPermissions(input.permissions);
  const missing = ungrantable(actor, permissions);
  if (missing.length) deny(`You can't grant permissions you don't hold: ${missing.join(", ")}`);
  const updated = await db.staffRole.update({ where: { id }, data: { name, description: input.description?.trim().slice(0, 500) || null, permissions } });
  const added = permissions.filter((p) => !role.permissions.includes(p));
  const removed = role.permissions.filter((p) => !permissions.includes(p));
  await audit({
    actorId: actor.id,
    action: "role.update",
    entity: "StaffRole",
    entityId: id,
    summary: `${name}: +${added.length} / −${removed.length}`,
    before: { name: role.name, permissions: role.permissions },
    after: { name, permissions, added, removed },
  });
  return updated;
}

export async function deleteRole(actor: Actor, id: string) {
  requireRoleEditor(actor);
  const role = await db.staffRole.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
  if (!role) deny("Role not found");
  if (role.isSystem) deny("Preset roles can be edited but not deleted");
  if (role._count.users) deny(`${role._count.users} staff member(s) still have this role — move them first`);
  await db.staffRole.delete({ where: { id } });
  await audit({ actorId: actor.id, action: "role.delete", entity: "StaffRole", entityId: id, summary: role.name, before: { key: role.key, permissions: role.permissions } });
}

async function loadTarget(actor: Actor, userId: string) {
  if (!can(actor, "staff.edit")) deny("You don't have permission to manage staff");
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) deny("Not found");
  if (!canGrantRole(actor, u.role)) deny(`You can't change a ${ROLE_LABEL[u.role].toLowerCase()} account`);
  return u;
}

/** Give a staff member a custom role (or remove it with null). The role's grants must all be held by the actor. */
export async function assignStaffRole(actor: Actor, userId: string, staffRoleId: string | null) {
  const u = await loadTarget(actor, userId);
  if (!isStaffRole(u.role)) deny("Custom roles add to a staff role — give them a staff role first");
  if (u.id === actor.id) deny("You can't change your own access");
  let role: { id: string; name: string; permissions: string[] } | null = null;
  if (staffRoleId) {
    role = await db.staffRole.findUnique({ where: { id: staffRoleId }, select: { id: true, name: true, permissions: true } });
    if (!role) deny("Role not found");
    const missing = ungrantable(actor, role.permissions);
    if (missing.length) deny(`That role includes permissions you don't hold: ${missing.join(", ")}`);
  }
  if ((u.staffRoleId ?? null) === (role?.id ?? null)) return u;
  const before = u.staffRoleId ? await db.staffRole.findUnique({ where: { id: u.staffRoleId }, select: { name: true } }) : null;
  const updated = await db.user.update({ where: { id: userId }, data: { staffRoleId: role?.id ?? null } });
  await audit({ actorId: actor.id, action: "staff.custom_role", entity: "User", entityId: userId, summary: `${u.email}: ${before?.name ?? "none"} → ${role?.name ?? "none"}`, before: { staffRole: before?.name ?? null }, after: { staffRole: role?.name ?? null } });
  return updated;
}

/** Replace a staff member's extra kitchen/company scopes. A kitchen-scoped actor can only hand out their own kitchens. */
export async function setScopes(actor: Actor, userId: string, input: { kitchenIds: readonly string[]; companyIds: readonly string[] }) {
  const u = await loadTarget(actor, userId);
  if (!isStaffRole(u.role)) deny("Scopes apply to staff accounts");
  const kitchenIds = [...new Set(input.kitchenIds)].filter(Boolean);
  const companyIds = [...new Set(input.companyIds)].filter(Boolean);
  if (actor.kitchenIds && kitchenIds.some((k) => !actor.kitchenIds!.includes(k))) deny("You can only assign kitchens inside your own scope");
  if (actor.kitchenIds && !kitchenIds.length && !u.kitchenId) deny("You can't give all-kitchen access — you're limited to your own kitchens");
  const [kCount, cCount] = await Promise.all([db.kitchen.count({ where: { id: { in: kitchenIds } } }), db.company.count({ where: { id: { in: companyIds } } })]);
  if (kCount !== kitchenIds.length || cCount !== companyIds.length) deny("Unknown kitchen or company");
  const before = await db.staffScope.findMany({ where: { userId }, select: { kitchenId: true, companyId: true } });
  await db.$transaction([
    db.staffScope.deleteMany({ where: { userId } }),
    db.staffScope.createMany({ data: [...kitchenIds.map((kitchenId) => ({ userId, kitchenId })), ...companyIds.map((companyId) => ({ userId, companyId }))] }),
  ]);
  await audit({
    actorId: actor.id,
    action: "staff.scope",
    entity: "User",
    entityId: userId,
    summary: `${u.email}: ${kitchenIds.length} kitchen(s), ${companyIds.length} compan${companyIds.length === 1 ? "y" : "ies"}`,
    before: { kitchens: before.filter((s) => s.kitchenId).map((s) => s.kitchenId), companies: before.filter((s) => s.companyId).map((s) => s.companyId) },
    after: { kitchens: kitchenIds, companies: companyIds },
  });
}

/** Sign a staff member out of one session, or all of them. */
export async function revokeSessions(actor: Actor, userId: string, sessionId?: string | null) {
  const u = await loadTarget(actor, userId);
  const where = sessionId ? { id: sessionId, userId } : { userId };
  const { count } = await db.session.deleteMany({ where });
  if (sessionId && !count) deny("That session has already ended");
  await audit({ actorId: actor.id, action: sessionId ? "staff.session_revoke" : "staff.sessions_revoke_all", entity: "User", entityId: userId, summary: `${u.email} · ${count} session(s) signed out` });
  return count;
}
