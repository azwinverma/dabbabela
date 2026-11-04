import { describe, expect, it } from "vitest";
import { can, canGrantRole, LEGACY_MATRIX, STAFF_ROLES } from "@/lib/permissions";
import { canTransition, TRANSITIONS } from "@/server/transitions";

describe("RBAC matrix", () => {
  it("customers have no staff permissions", () => {
    for (const p of Object.keys(LEGACY_MATRIX) as (keyof typeof LEGACY_MATRIX)[]) expect(can("CUSTOMER", p)).toBe(false);
  });
  it("operations managers can't see finance or change settings", () => {
    expect(can("OPERATIONS_MANAGER", "orders.manage")).toBe(true);
    expect(can("OPERATIONS_MANAGER", "dashboard.finance")).toBe(false);
    expect(can("OPERATIONS_MANAGER", "refunds.approve")).toBe(false);
    expect(can("OPERATIONS_MANAGER", "settings")).toBe(false);
    expect(can("OPERATIONS_MANAGER", "invoices")).toBe(false);
  });
  it("riders only get the rider app", () => {
    const perms = (Object.keys(LEGACY_MATRIX) as (keyof typeof LEGACY_MATRIX)[]).filter((p) => can("DELIVERY_AGENT", p));
    expect(perms).toEqual(["rider"]);
  });
  it("content editors can't touch orders or money", () => {
    expect(can("CONTENT_EDITOR", "content")).toBe(true);
    expect(can("CONTENT_EDITOR", "orders.view")).toBe(false);
    expect(can("CONTENT_EDITOR", "payments.view")).toBe(false);
  });
  it("only super admins grant super admin", () => {
    expect(canGrantRole("OWNER", "SUPER_ADMIN")).toBe(false);
    expect(canGrantRole("SUPER_ADMIN", "SUPER_ADMIN")).toBe(true);
    expect(canGrantRole("OPERATIONS_MANAGER", "KITCHEN_STAFF")).toBe(false);
  });
  it("every staff role has at least one permission", () => {
    for (const r of STAFF_ROLES) expect((Object.keys(LEGACY_MATRIX) as (keyof typeof LEGACY_MATRIX)[]).some((p) => can(r, p))).toBe(true);
  });
});

describe("order state machine", () => {
  it("follows the happy path", () => {
    const path = ["PENDING_PAYMENT", "SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED"] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
  it("blocks impossible moves", () => {
    expect(canTransition("DELIVERED", "CANCELLED")).toBe(false);
    expect(canTransition("CANCELLED", "SCHEDULED")).toBe(false);
    expect(canTransition("PENDING_PAYMENT", "PREPARING")).toBe(false);
    expect(canTransition("OUT_FOR_DELIVERY", "CANCELLED")).toBe(false);
  });
  it("terminal states have no exits", () => {
    expect(TRANSITIONS.DELIVERED).toEqual([]);
    expect(TRANSITIONS.CANCELLED).toEqual([]);
  });
  it("failed deliveries can be retried", () => {
    expect(canTransition("FAILED_DELIVERY", "OUT_FOR_DELIVERY")).toBe(true);
  });
});
