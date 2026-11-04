import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }),
}));

import { db } from "@/lib/db";
import { kitchenScope } from "@/lib/user-context";
import { kitchenWhere } from "@/components/admin/ops/scope";
import { assignStaffRole, createRole, deleteRole, revokeSessions, setScopes, updateRole, type Actor } from "@/server/access";
import { ensureFoundationData } from "@/server/foundation";
import { createUserWithPassword } from "@/server/seed";
import { auth } from "@/server/auth";

let superAdmin: Actor;
let owner: Actor;
let cookId: string;
let kitchenA: string;
let kitchenB: string;

beforeAll(async () => {
  const sa = await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });
  superAdmin = { id: sa.id, role: sa.role };
  const o = await db.user.create({ data: { name: "Access Owner", email: "access-owner@test.local", role: "OWNER" } });
  owner = { id: o.id, role: "OWNER" };
  cookId = (await db.user.create({ data: { name: "Access Cook", email: "access-cook@test.local", role: "KITCHEN_STAFF" } })).id;
  kitchenA = (await db.kitchen.findFirstOrThrow({ where: { code: "KTM-1" } })).id;
  kitchenB = (await db.kitchen.create({ data: { name: "Lalitpur kitchen", code: "LTP-TEST" } })).id;
});

describe("foundation backfill", () => {
  it("is idempotent and installed the presets", async () => {
    const again = await ensureFoundationData(db);
    expect(Object.values(again).every((n) => n === 0)).toBe(true);
    expect(await db.staffRole.count({ where: { key: { in: ["kitchen-manager", "delivery-manager"] } } })).toBe(2);
    expect(await db.expenseCategory.count()).toBe(10);
    const plans = await db.mealPlan.findMany({ include: { prices: true } });
    for (const p of plans) {
      expect(p.prices).toHaveLength(1);
      expect(p.prices[0]!.pricePerMeal).toBe(p.pricePerMeal);
    }
    expect(await db.navItem.count({ where: { menu: "HEADER" } })).toBe(5);
    expect(await db.lunchBox.count({ where: { categoryId: null, tags: { isEmpty: false } } })).toBe(0);
  });
});

describe("custom roles", () => {
  it("only super admins create, edit and delete roles; changes are audited", async () => {
    await expect(createRole(owner, { name: "Shift lead", permissions: ["kitchen.view"] })).rejects.toThrow(/super admin/);
    await expect(createRole(superAdmin, { name: "Bad", permissions: ["kitchen.fly"] })).rejects.toThrow(/Unknown permission/);
    const role = await createRole(superAdmin, { name: "Shift lead", permissions: ["kitchen.view", "kitchen.approve", "kitchen.view"] });
    expect(role.key).toBe("shift-lead");
    expect(role.permissions).toEqual(["kitchen.approve", "kitchen.view"]);
    await updateRole(superAdmin, role.id, { name: "Shift lead", permissions: ["kitchen.view", "inventory.view"] });
    const log = await db.auditLog.findFirstOrThrow({ where: { entity: "StaffRole", entityId: role.id, action: "role.update" } });
    expect(log.after).toMatchObject({ added: ["inventory.view"], removed: ["kitchen.approve"] });
    await deleteRole(superAdmin, role.id);
    expect(await db.staffRole.findUnique({ where: { id: role.id } })).toBeNull();
  });

  it("preset roles can't be deleted, and roles in use can't be deleted", async () => {
    const preset = await db.staffRole.findUniqueOrThrow({ where: { key: "kitchen-manager" } });
    await expect(deleteRole(superAdmin, preset.id)).rejects.toThrow(/Preset/);
    const r = await createRole(superAdmin, { name: "Temp role", permissions: ["orders.view"] });
    await assignStaffRole(superAdmin, cookId, r.id);
    await expect(deleteRole(superAdmin, r.id)).rejects.toThrow(/still have this role/);
    await assignStaffRole(superAdmin, cookId, null);
    await deleteRole(superAdmin, r.id);
  });
});

describe("assigning custom roles (escalation)", () => {
  it("an owner can give a cook the Kitchen manager preset", async () => {
    const preset = await db.staffRole.findUniqueOrThrow({ where: { key: "kitchen-manager" } });
    await assignStaffRole(owner, cookId, preset.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: cookId } })).staffRoleId).toBe(preset.id);
    await assignStaffRole(owner, cookId, null);
  });

  it("a staff editor can't hand out a role containing permissions they don't hold", async () => {
    const opsUser = await db.user.create({ data: { name: "Ops w/ staff", email: "ops-staff@test.local", role: "OPERATIONS_MANAGER" } });
    const ops: Actor = { id: opsUser.id, role: "OPERATIONS_MANAGER", customGrants: ["staff.view", "staff.edit"] };
    const money = await createRole(superAdmin, { name: "Money hands", permissions: ["refunds.approve"] });
    await expect(assignStaffRole(ops, cookId, money.id)).rejects.toThrow(/don't hold: refunds.approve/);
    const kitchenOnly = await createRole(superAdmin, { name: "Kitchen helper", permissions: ["kitchen.approve"] });
    await assignStaffRole(ops, cookId, kitchenOnly.id); // ops holds kitchen.approve
    await assignStaffRole(ops, cookId, null);
    // and nobody without staff.edit can do anything
    await expect(assignStaffRole({ id: opsUser.id, role: "OPERATIONS_MANAGER" }, cookId, null)).rejects.toThrow(/permission to manage staff/);
    // can't touch a finance account (would need refunds.approve etc.)
    const fin = await db.user.create({ data: { name: "Fin", email: "fin-acc@test.local", role: "FINANCE" } });
    await expect(assignStaffRole(ops, fin.id, null)).rejects.toThrow(/can't change a finance account/);
  });
});

describe("scopes", () => {
  it("limit what a staff member sees to their kitchens", async () => {
    await setScopes(superAdmin, cookId, { kitchenIds: [kitchenB], companyIds: [] });
    const cook = await db.user.findUniqueOrThrow({ where: { id: cookId }, include: { scopes: true } });
    const ids = kitchenScope(cook);
    expect(ids).toEqual([kitchenB]);
    const ing = await db.ingredient.findFirstOrThrow();
    await db.stockMovement.createMany({
      data: [
        { ingredientId: ing.id, kitchenId: kitchenA, type: "ADJUSTMENT", quantity: 5, note: "scope-test A" },
        { ingredientId: ing.id, kitchenId: kitchenB, type: "ADJUSTMENT", quantity: 7, note: "scope-test B" },
      ],
    });
    const stock = await db.stockMovement.findMany({ where: { note: { startsWith: "scope-test" }, ...kitchenWhere({ kitchenIds: ids }) } });
    expect(stock.map((m) => m.note)).toEqual(["scope-test B"]);
    const orders = await db.order.findMany({ where: kitchenWhere({ kitchenIds: ids }), select: { kitchenId: true } });
    expect(orders.every((o) => o.kitchenId === kitchenB)).toBe(true);
    // unscoped staff see both
    const all = await db.stockMovement.count({ where: { note: { startsWith: "scope-test" }, ...kitchenWhere({ kitchenIds: null }) } });
    expect(all).toBe(2);
  });

  it("a kitchen-scoped staff editor can't widen someone's scope beyond their own", async () => {
    const lead = await db.user.create({ data: { name: "Kitchen B lead", email: "kb-lead@test.local", role: "OPERATIONS_MANAGER", kitchenId: kitchenB } });
    const actor: Actor = { id: lead.id, role: "OPERATIONS_MANAGER", customGrants: ["staff.edit"], kitchenIds: [kitchenB] };
    await expect(setScopes(actor, cookId, { kitchenIds: [kitchenA], companyIds: [] })).rejects.toThrow(/inside your own scope/);
    await setScopes(actor, cookId, { kitchenIds: [kitchenB], companyIds: [] });
    const log = await db.auditLog.findFirst({ where: { action: "staff.scope", entityId: cookId, actorId: lead.id } });
    expect(log).toBeTruthy();
  });
});

describe("sessions", () => {
  it("revokes one session or all of them, audited", async () => {
    const mk = (n: number) => db.session.create({ data: { userId: cookId, token: `tok-${n}-${Date.now()}`, expiresAt: new Date(Date.now() + 864e5) } });
    const [s1] = await Promise.all([mk(1), mk(2), mk(3)]);
    expect(await revokeSessions(superAdmin, cookId, s1!.id)).toBe(1);
    expect(await db.session.count({ where: { userId: cookId } })).toBe(2);
    expect(await revokeSessions(superAdmin, cookId, null)).toBe(2);
    expect(await db.session.count({ where: { userId: cookId } })).toBe(0);
    expect(await db.auditLog.count({ where: { entityId: cookId, action: { in: ["staff.session_revoke", "staff.sessions_revoke_all"] } } })).toBe(2);
  });
});

describe("login activity", () => {
  it("records failed and successful sign-ins without secrets", async () => {
    await createUserWithPassword(db, { name: "Login Tester", email: "login-tester@test.local", password: "right-pass-123", role: "SUPPORT" });
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "user-agent": "vitest-agent" });
    await expect(auth.api.signInEmail({ body: { email: "login-tester@test.local", password: "wrong-pass-999" }, headers })).rejects.toThrow();
    await auth.api.signInEmail({ body: { email: "login-tester@test.local", password: "right-pass-123" }, headers });
    const events = await db.loginEvent.findMany({ where: { email: "login-tester@test.local" }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.success)).toEqual([false, true]);
    expect(events[0]!.reason).toBeTruthy();
    expect(events[1]!.userId).toBeTruthy();
    expect(events[1]!.ip).toBe("203.0.113.7");
    expect(events[1]!.userAgent).toBe("vitest-agent");
    const raw = JSON.stringify(events);
    expect(raw).not.toContain("right-pass-123");
    expect(raw).not.toContain("wrong-pass-999");
  });
});
