"use server";

import type { Role } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { canGrantRole, isStaffRole, STAFF_ROLES } from "@/lib/permissions";
import { normalizeNepalPhone } from "@/lib/phone";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkPassword(pw: string) {
  if (pw.length < 10) return "Temporary password must be at least 10 characters";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Use letters and numbers";
  return null;
}

async function setPassword(userId: string, password: string) {
  const hash = await hashPassword(password);
  const acc = await db.account.findFirst({ where: { userId, providerId: "credential" } });
  if (acc) await db.account.update({ where: { id: acc.id }, data: { password: hash } });
  else await db.account.create({ data: { userId, accountId: userId, providerId: "credential", password: hash } });
}

async function activeSuperAdmins(excludeId?: string) {
  return db.user.count({ where: { role: "SUPER_ADMIN", isActive: true, ...(excludeId ? { id: { not: excludeId } } : {}) } });
}

export async function createStaff(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("staff", async (me) => {
    const name = f.str(fd, "name", 80);
    const email = f.str(fd, "email", 160).toLowerCase();
    const role = f.str(fd, "role") as Role;
    const password = f.str(fd, "password", 128);
    if (!name) throw new FieldError("name", "Name is required");
    if (!EMAIL.test(email)) throw new FieldError("email", "Enter a valid email");
    if (!STAFF_ROLES.includes(role)) throw new FieldError("role", "Pick a staff role");
    if (!canGrantRole(me.role, role)) throw new FieldError("role", "You can't grant that role");
    const pwErr = checkPassword(password);
    if (pwErr) throw new FieldError("password", pwErr);
    const phoneRaw = f.str(fd, "phone", 20);
    const phoneNumber = phoneRaw ? normalizeNepalPhone(phoneRaw) : null;
    if (phoneRaw && !phoneNumber) throw new FieldError("phone", "Enter a Nepal phone number");
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) return fail("That email already has an account — use “Give an existing account a role” instead");
    const kitchenId = f.opt(fd, "kitchenId");
    const u = await db.user.create({ data: { name, email, emailVerified: true, role, phoneNumber, kitchenId } });
    await setPassword(u.id, password);
    await audit({ actorId: me.id, action: "staff.create", entity: "User", entityId: u.id, summary: `${email} as ${role}`, after: { role, kitchenId } });
    return done(`${name} can now sign in. Share the temporary password privately and ask them to change it and turn on 2FA.`);
  }, ["/admin/staff"]);
}

export async function promoteUser(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("staff", async (me) => {
    const email = f.str(fd, "email", 160).toLowerCase();
    const role = f.str(fd, "role") as Role;
    if (!STAFF_ROLES.includes(role) || !canGrantRole(me.role, role)) return fail("You can't grant that role");
    const u = await db.user.findUnique({ where: { email } });
    if (!u) return fail("No account with that email");
    if (isStaffRole(u.role)) return fail("Already staff — change their role in the list");
    await db.user.update({ where: { id: u.id }, data: { role } });
    await db.session.deleteMany({ where: { userId: u.id } });
    await audit({ actorId: me.id, action: "staff.promote", entity: "User", entityId: u.id, summary: `${email} → ${role}`, before: { role: u.role }, after: { role } });
    return done(`${u.name} is now ${role.toLowerCase().replace(/_/g, " ")} (they'll need to sign in again)`);
  }, ["/admin/staff"]);
}

export async function updateStaff(userId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("staff", async (me) => {
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u || !isStaffRole(u.role)) return fail("Not a staff account");
    const role = f.str(fd, "role") as Role;
    const kitchenId = f.opt(fd, "kitchenId");
    const reason = f.opt(fd, "reason", 200);
    if (role !== u.role) {
      if (!(STAFF_ROLES.includes(role) || role === "CUSTOMER")) return fail("Unknown role");
      if (!canGrantRole(me.role, role === "CUSTOMER" ? "KITCHEN_STAFF" : role)) return fail("You can't grant that role");
      if (!canGrantRole(me.role, u.role)) return fail("You can't change someone with that role");
      if (u.id === me.id) return fail("You can't change your own role");
      if (u.role === "SUPER_ADMIN" && (await activeSuperAdmins(u.id)) === 0) return fail("Keep at least one active super admin");
      if (!reason) return fail("Give a reason for the role change");
    }
    await db.user.update({ where: { id: userId }, data: { role, kitchenId } });
    if (role !== u.role) await db.session.deleteMany({ where: { userId } });
    await audit({ actorId: me.id, action: "staff.update", entity: "User", entityId: userId, summary: `${u.email}`, before: { role: u.role, kitchenId: u.kitchenId }, after: { role, kitchenId }, reason });
    return done(role === "CUSTOMER" ? "Staff access removed" : "Saved");
  }, ["/admin/staff"]);
}

export async function toggleActive(userId: string): Promise<ActionResult> {
  return guarded("staff", async (me) => {
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u) return fail("Not found");
    if (u.id === me.id) return fail("You can't deactivate yourself");
    if (!canGrantRole(me.role, u.role)) return fail("You can't change someone with that role");
    if (u.isActive && u.role === "SUPER_ADMIN" && (await activeSuperAdmins(u.id)) === 0) return fail("Keep at least one active super admin");
    await db.user.update({ where: { id: userId }, data: { isActive: !u.isActive } });
    const revoked = u.isActive ? (await db.session.deleteMany({ where: { userId } })).count : 0;
    await audit({ actorId: me.id, action: u.isActive ? "staff.deactivate" : "staff.activate", entity: "User", entityId: userId, summary: `${u.email}${revoked ? ` · ${revoked} session(s) revoked` : ""}` });
    return done(u.isActive ? `Deactivated and signed out (${revoked} session(s))` : "Re-activated");
  }, ["/admin/staff"]);
}

export async function resetPassword(userId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("staff", async (me) => {
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u) return fail("Not found");
    if (!canGrantRole(me.role, u.role)) return fail("You can't reset that account");
    const password = f.str(fd, "password", 128);
    const err = checkPassword(password);
    if (err) return fail(err);
    await setPassword(userId, password);
    const revoked = (await db.session.deleteMany({ where: { userId } })).count;
    await audit({ actorId: me.id, action: "staff.reset_password", entity: "User", entityId: userId, summary: `${u.email} · ${revoked} session(s) revoked` });
    return done("Password reset and all their sessions signed out");
  }, ["/admin/staff"]);
}

export async function resetTwoFactor(userId: string): Promise<ActionResult> {
  return guarded("staff", async (me) => {
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u) return fail("Not found");
    if (u.id === me.id) return fail("Use your own security page");
    if (!canGrantRole(me.role, u.role)) return fail("You can't reset that account");
    await db.twoFactor.deleteMany({ where: { userId } });
    await db.user.update({ where: { id: userId }, data: { twoFactorEnabled: false } });
    await db.session.deleteMany({ where: { userId } });
    await audit({ actorId: me.id, action: "staff.reset_2fa", entity: "User", entityId: userId, summary: u.email, reason: "Lost authenticator" });
    return done("2FA removed — they must set it up again on next sign-in");
  }, ["/admin/staff"]);
}
