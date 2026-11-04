import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import {
  ALL_GRANULAR,
  can,
  canGrantRole,
  effectivePermissions,
  isGranular,
  LEGACY_MAP,
  LEGACY_MATRIX,
  resolvePermission,
  STAFF_ROLES,
  ungrantable,
  type LegacyPermission,
  type Permission,
} from "@/lib/permissions";
import { ADMIN_NAV_ALL } from "@/components/admin/nav";
import { PRESET_ROLES } from "@/server/foundation";

/**
 * Frozen copy of the pre-2026-11-04 matrix. If LEGACY_MATRIX ever drifts from this, existing staff would
 * silently gain or lose access — so the copy lives here, independent of the source.
 */
const A = ["SUPER_ADMIN", "OWNER"];
const SNAPSHOT: Record<string, string[]> = {
  dashboard: [...A, "OPERATIONS_MANAGER", "FINANCE"],
  "dashboard.finance": [...A, "FINANCE"],
  reports: [...A, "OPERATIONS_MANAGER", "FINANCE"],
  "orders.view": [...A, "OPERATIONS_MANAGER", "KITCHEN_STAFF", "DISPATCHER", "FINANCE", "SUPPORT"],
  "orders.manage": [...A, "OPERATIONS_MANAGER", "SUPPORT"],
  "orders.bulk": [...A, "OPERATIONS_MANAGER"],
  kitchen: [...A, "OPERATIONS_MANAGER", "KITCHEN_STAFF", "INVENTORY_MANAGER"],
  "kitchen.lock": [...A, "OPERATIONS_MANAGER"],
  inventory: [...A, "OPERATIONS_MANAGER", "INVENTORY_MANAGER"],
  dispatch: [...A, "OPERATIONS_MANAGER", "DISPATCHER"],
  rider: [...A, "DELIVERY_AGENT", "DISPATCHER"],
  subscriptions: [...A, "OPERATIONS_MANAGER", "SUPPORT"],
  "payments.view": [...A, "FINANCE", "OPERATIONS_MANAGER", "SUPPORT"],
  "payments.verify": [...A, "FINANCE"],
  "refunds.request": [...A, "FINANCE", "OPERATIONS_MANAGER", "SUPPORT"],
  "refunds.approve": [...A, "FINANCE"],
  invoices: [...A, "FINANCE"],
  menu: [...A, "MENU_MANAGER", "OPERATIONS_MANAGER"],
  recipes: [...A, "MENU_MANAGER", "INVENTORY_MANAGER"],
  plans: [...A, "MENU_MANAGER"],
  rules: [...A, "OPERATIONS_MANAGER"],
  pricing: [...A, "FINANCE"],
  customers: [...A, "OPERATIONS_MANAGER", "SUPPORT", "FINANCE"],
  "customers.pii": [...A, "SUPPORT", "OPERATIONS_MANAGER"],
  corporate: [...A, "OPERATIONS_MANAGER", "FINANCE", "SUPPORT"],
  leads: [...A, "OPERATIONS_MANAGER"],
  support: [...A, "SUPPORT", "OPERATIONS_MANAGER"],
  content: [...A, "CONTENT_EDITOR"],
  media: [...A, "CONTENT_EDITOR", "MENU_MANAGER"],
  marketing: [...A, "CONTENT_EDITOR"],
  staff: [...A],
  settings: [...A],
  audit: [...A],
  privacy: [...A, "SUPPORT"],
};
const ROLES: Role[] = [...STAFF_ROLES, "CUSTOMER"];

describe("legacy matrix → granular grants (no one gains or loses existing access)", () => {
  it("the legacy matrix is unchanged", () => {
    const norm = (m: Record<string, readonly string[]>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]));
    expect(norm(LEGACY_MATRIX)).toEqual(norm(SNAPSHOT));
  });

  it("every role keeps exactly its legacy abilities — via legacy key, view key and write key", () => {
    for (const legacy of Object.keys(SNAPSHOT) as LegacyPermission[]) {
      for (const role of ROLES) {
        const had = SNAPSHOT[legacy]!.includes(role);
        expect([legacy, role, can(role, legacy)]).toEqual([legacy, role, had]);
        expect([LEGACY_MAP[legacy].view, role, can(role, LEGACY_MAP[legacy].view)]).toEqual([LEGACY_MAP[legacy].view, role, had]);
        expect([LEGACY_MAP[legacy].write, role, can(role, LEGACY_MAP[legacy].write)]).toEqual([LEGACY_MAP[legacy].write, role, had]);
      }
    }
  });

  it("all mapped keys exist in the registry", () => {
    for (const { view, write } of Object.values(LEGACY_MAP)) {
      expect(isGranular(view)).toBe(true);
      expect(isGranular(write)).toBe(true);
    }
  });

  it("super admin has everything; owner everything but editing roles; customers nothing", () => {
    for (const p of ALL_GRANULAR) {
      expect(can("SUPER_ADMIN", p)).toBe(true);
      expect(can("OWNER", p)).toBe(p !== "roles.edit");
      expect(can("CUSTOMER", p)).toBe(false);
    }
  });

  it("riders still only get the rider app", () => {
    expect([...effectivePermissions("DELIVERY_AGENT")].sort()).toEqual(["rider.edit", "rider.view"]);
  });

  it("unknown keys are rejected loudly", () => {
    expect(() => resolvePermission("orders.fly" as Permission)).toThrow(/Unknown permission/);
  });
});

describe("custom roles", () => {
  it("add grants on top of a staff base role", () => {
    const cook = { role: "KITCHEN_STAFF" as Role, customGrants: ["inventory.edit", "kitchen.approve"] };
    expect(can("KITCHEN_STAFF", "inventory.edit")).toBe(false);
    expect(can(cook, "inventory.edit")).toBe(true);
    expect(can(cook, "kitchen.approve")).toBe(true);
    expect(can(cook, "kitchen")).toBe(true); // legacy key still resolves
    expect(can(cook, "refunds.approve")).toBe(false);
  });

  it("never apply to customers, and ignore junk keys", () => {
    expect(can({ role: "CUSTOMER", customGrants: ["orders.view"] }, "orders.view")).toBe(false);
    expect(effectivePermissions({ role: "KITCHEN_STAFF", customGrants: ["nope.view"] }).has("nope.view" as never)).toBe(false);
  });

  it("preset roles only use real permission keys", () => {
    for (const r of PRESET_ROLES) for (const p of r.permissions) expect(isGranular(p)).toBe(true);
  });
});

describe("escalation guards", () => {
  it("ungrantable lists what the actor doesn't hold", () => {
    expect(ungrantable("OPERATIONS_MANAGER", ["orders.edit", "refunds.approve"])).toEqual(["refunds.approve"]);
    expect(ungrantable("SUPER_ADMIN", ALL_GRANULAR)).toEqual([]);
    expect(ungrantable("OWNER", ["roles.edit"])).toEqual(["roles.edit"]);
  });

  it("a staff editor can only hand out base roles whose permissions they hold", () => {
    const opsWithStaff = { role: "OPERATIONS_MANAGER" as Role, customGrants: ["staff.view", "staff.edit"] };
    expect(canGrantRole(opsWithStaff, "KITCHEN_STAFF")).toBe(true); // ops holds everything kitchen staff has
    expect(canGrantRole(opsWithStaff, "FINANCE")).toBe(false); // would hand out refunds.approve
    expect(canGrantRole(opsWithStaff, "OWNER")).toBe(false);
    expect(canGrantRole("OPERATIONS_MANAGER", "KITCHEN_STAFF")).toBe(false); // no staff.edit at all
  });

  it("super admin / owner rules are unchanged", () => {
    expect(canGrantRole("SUPER_ADMIN", "SUPER_ADMIN")).toBe(true);
    expect(canGrantRole("OWNER", "SUPER_ADMIN")).toBe(false);
    expect(canGrantRole("OWNER", "OWNER")).toBe(true);
    expect(canGrantRole("OWNER", "FINANCE")).toBe(true);
  });
});

describe("sidebar registry", () => {
  const items = ADMIN_NAV_ALL.flatMap((g) => g.items);
  const pageFor = (href: string) => path.join(process.cwd(), "src/app", href, "page.tsx");

  it("every entry is guarded by a real permission", () => {
    for (const i of items) expect([i.href, isGranular(i.perm)]).toEqual([i.href, true]);
  });

  it("ready entries have a page; not-ready entries don't (flip `ready` when the page lands)", () => {
    for (const i of items) expect([i.href, existsSync(pageFor(i.href))]).toEqual([i.href, i.ready !== false]);
  });
});
