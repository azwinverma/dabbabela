import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }),
}));

import { db } from "@/lib/db";
import { globalSearch, type Searcher } from "@/app/admin/_kit/search";
import { deleteView, listSavedViews, saveView, MAX_VIEWS_PER_MODULE } from "@/app/admin/_kit/saved-views";

const TAG = `srch${Date.now().toString(36)}`;
let kitchenA: string;
let kitchenB: string;
let customerId: string;
let orderA: string;
let orderB: string;

const SA: Searcher = { role: "SUPER_ADMIN", kitchenIds: null };
const FINANCE: Searcher = { role: "FINANCE", kitchenIds: null }; // customers.view without customers.pii
const COOK_A = (): Searcher => ({ role: "KITCHEN_STAFF", kitchenIds: [kitchenA] }); // orders only, kitchen A only
const CUSTOMER: Searcher = { role: "CUSTOMER", kitchenIds: null };

beforeAll(async () => {
  kitchenA = (await db.kitchen.findFirstOrThrow({ where: { code: "KTM-1" } })).id;
  kitchenB = (await db.kitchen.create({ data: { name: `Search kitchen ${TAG}`, code: `S-${TAG}`.slice(0, 20) } })).id;
  customerId = (await db.user.create({ data: { name: `Sita ${TAG}`, email: `${TAG}@example.com`, phoneNumber: "+9779812349876", role: "CUSTOMER" } })).id;
  const base = { userId: customerId, deliveryDate: new Date("2026-12-01"), contactName: `Sita ${TAG}`, contactPhone: "+9779812349876", addressLine: "Line", area: "Baneshwor", subtotal: 30000, total: 30000 };
  orderA = (await db.order.create({ data: { ...base, number: `${TAG}-A`, code: "QZ7A", kitchenId: kitchenA } })).id;
  orderB = (await db.order.create({ data: { ...base, number: `${TAG}-B`, code: "QZ7B", kitchenId: kitchenB } })).id;
});

describe("global admin search", () => {
  it("finds orders by code or number, customers by name/email/phone for full-access staff", async () => {
    const byCode = await globalSearch(SA, "qz7a");
    expect(byCode.filter((h) => h.group === "orders").map((h) => h.href)).toContain(`/admin/orders/${orderA}`);
    const byNumber = await globalSearch(SA, TAG);
    expect(byNumber.filter((h) => h.group === "orders").map((h) => h.id).sort()).toEqual([orderA, orderB].sort());
    expect(byNumber.find((h) => h.group === "customers")?.href).toBe(`/admin/customers/${customerId}`);
    expect((await globalSearch(SA, `${TAG}@example`)).some((h) => h.id === customerId)).toBe(true);
    const byPhone = await globalSearch(SA, "9812349876");
    const hit = byPhone.find((h) => h.id === customerId);
    expect(hit?.subtitle).toContain(`${TAG}@example.com`);
  });

  it("masks contact details and blocks phone/email probing without customers.pii", async () => {
    const hits = await globalSearch(FINANCE, `Sita ${TAG}`);
    const c = hits.find((h) => h.id === customerId)!;
    expect(c).toBeTruthy();
    expect(c.subtitle).not.toContain(`${TAG}@example.com`);
    expect(c.subtitle).toContain("•••");
    expect(c.subtitle).not.toContain("234");
    expect((await globalSearch(FINANCE, `${TAG}@example.com`)).some((h) => h.id === customerId)).toBe(false);
    expect((await globalSearch(FINANCE, "9812349876")).some((h) => h.id === customerId)).toBe(false);
  });

  it("limits groups by permission and orders by kitchen scope", async () => {
    const hits = await globalSearch(COOK_A(), TAG);
    expect(hits.every((h) => h.group === "orders")).toBe(true); // no customers.view / corporate.view
    expect(hits.map((h) => h.id)).toEqual([orderA]); // kitchen B order hidden
    expect(await globalSearch(CUSTOMER, TAG)).toEqual([]);
    expect(await globalSearch(SA, "a")).toEqual([]); // too short
  });

  it("finds dabbas and companies for roles that can open them", async () => {
    const box = await db.lunchBox.findFirstOrThrow({ select: { id: true, name: true } });
    const company = await db.company.create({ data: { name: `Himal Tech ${TAG}`, slug: `himal-${TAG}` } });
    expect((await globalSearch(SA, box.name.slice(0, 6))).some((h) => h.group === "dabbas" && h.href === `/admin/boxes/${box.id}`)).toBe(true);
    expect((await globalSearch(FINANCE, `Himal Tech ${TAG}`)).some((h) => h.href === `/admin/companies/${company.id}`)).toBe(true);
    expect((await globalSearch(COOK_A(), `Himal Tech ${TAG}`)).length).toBe(0);
  });
});

describe("saved views", () => {
  it("are private per user and per page, overwrite by name, and can't be deleted by another user", async () => {
    const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });
    const other = await db.user.create({ data: { name: "Other staff", email: `${TAG}-other@test.local`, role: "SUPPORT" } });
    const v = await saveView(owner.id, "audit", "  Refunds   this month ", { action: "refund.", page: "3", from: "2026-11-01", bad_key$: "x" });
    expect(v.name).toBe("Refunds this month");
    expect(v.query).toEqual({ action: "refund.", from: "2026-11-01" });
    await saveView(owner.id, "audit", "Refunds this month", { action: "refund.approve" });
    const mine = await listSavedViews(owner.id, "audit");
    expect(mine.filter((x) => x.name === "Refunds this month")).toEqual([{ id: v.id, name: "Refunds this month", query: { action: "refund.approve" } }]);
    expect(await listSavedViews(other.id, "audit")).toEqual([]);
    expect(await listSavedViews(owner.id, "orders")).toEqual([]);
    expect(await deleteView(other.id, v.id)).toBe(false);
    expect(await db.savedView.count({ where: { id: v.id } })).toBe(1);
    expect(await deleteView(owner.id, v.id)).toBe(true);
    await expect(saveView(owner.id, "Bad Module!", "x", {})).rejects.toThrow();
    await expect(saveView(owner.id, "audit", "   ", {})).rejects.toThrow(/name/);
  });

  it("caps views per page", async () => {
    const u = await db.user.create({ data: { name: "Cap staff", email: `${TAG}-cap@test.local`, role: "SUPPORT" } });
    for (let i = 0; i < MAX_VIEWS_PER_MODULE; i++) await saveView(u.id, "orders", `v${i}`, { status: String(i) });
    await expect(saveView(u.id, "orders", "one more", {})).rejects.toThrow(/up to/);
  });
});
