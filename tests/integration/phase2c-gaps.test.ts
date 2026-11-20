import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { activeCompany } from "@/lib/auth";
import { defaultKitchenId, placeCartOrder, quoteCart } from "@/server/orders";
import { getOffersForDates } from "@/server/menu";
import { getClosures, getLockedDates } from "@/server/calendar";
import { filterCompanyMenu, memberCompanyMenu, narrowOffers } from "@/server/corporate";
import { reassignDelivery } from "@/server/orders-admin";
import { loadUser, serviceDay } from "../helpers";

// Phase 2C: company menu for every member (+ Build-a-Dabba only blocked when company-billed); address + window change
// together checks the window against the NEW zone.

const tag = Date.now().toString(36);
let kitchenId: string;
let day: string;
let onMenu: string; // box on the company menu
let offMenu: string; // box served that day but not on the company menu

async function openDay() {
  for (let n = 0; ; n++) {
    const d = serviceDay(6, n);
    const [closed, locked] = await Promise.all([getClosures(d, d, kitchenId), getLockedDates(d, d, kitchenId)]);
    const items = (await getOffersForDates([d], kitchenId)).get(d)?.items.filter((i) => !i.soldOut) ?? [];
    if (!closed.size && !locked.size && items.length >= 2) return { d, items };
  }
}

let seq = 0;
async function member(billingMode: "EMPLOYEE_PAID" | "COMPANY_PAID", withMenu: boolean) {
  const n = ++seq;
  const company = await db.company.create({ data: { name: `P2C ${billingMode} ${tag}`, slug: `p2c-${n}-${tag}`, billingMode, subsidyPct: billingMode === "COMPANY_PAID" ? 100 : 0, requireApproval: false } });
  if (withMenu) await db.companyMenuItem.create({ data: { companyId: company.id, boxId: onMenu } });
  const u = await db.user.create({ data: { name: `P2C ${billingMode}`, email: `p2c-${n}-${tag}@test.local` } });
  await db.companyMember.create({ data: { companyId: company.id, userId: u.id, status: "ACTIVE", role: "MEMBER" } });
  return loadUser(u.email);
}

beforeAll(async () => {
  kitchenId = (await defaultKitchenId())!;
  const o = await openDay();
  day = o.d;
  onMenu = o.items[0].box.id;
  offMenu = o.items[1].box.id;
});

describe("company menu filtering", () => {
  it("filterCompanyMenu / narrowOffers keep only allowed dabbas, and change nothing without a menu", () => {
    const items = [{ box: { id: "a" } }, { box: { id: "b" } }];
    expect(filterCompanyMenu(items, new Set(["b"]))).toEqual([{ box: { id: "b" } }]);
    expect(filterCompanyMenu(items, null)).toBe(items);
    const offers = new Map([["2026-01-01", { cutoff: "09:00", items }]]);
    expect(narrowOffers(offers, new Set(["a"])).get("2026-01-01")).toEqual({ cutoff: "09:00", items: [{ box: { id: "a" } }] });
    expect(narrowOffers(offers, null)).toBe(offers);
  });

  it("memberCompanyMenu applies to every member when the company has a menu; Build-a-Dabba blocked only when company-billed", async () => {
    const emp = await member("EMPLOYEE_PAID", true);
    const paid = await member("COMPANY_PAID", true);
    const none = await member("COMPANY_PAID", false);
    const e = await memberCompanyMenu(activeCompany(emp));
    const p = await memberCompanyMenu(activeCompany(paid));
    expect(e && [...e.allowed]).toEqual([onMenu]);
    expect(e?.buildBlocked).toBe(false);
    expect(p?.buildBlocked).toBe(true);
    expect(await memberCompanyMenu(activeCompany(none))).toBeNull();
    expect(await memberCompanyMenu(null)).toBeNull();
  });

  it("checkout refuses off-menu dabbas for employee-paid members too, and Build-a-Dabba only for company-billed ones", async () => {
    const emp = await member("EMPLOYEE_PAID", true);
    const paid = await member("COMPANY_PAID", true);
    const qe = await quoteCart(emp, { lines: [{ kind: "box", id: offMenu, date: day, qty: 1 }, { kind: "box", id: onMenu, date: day, qty: 1 }] });
    expect(qe.lines.find((l) => l.id === offMenu)?.problem).toMatch(/isn't on .*lunch menu/);
    expect(qe.lines.find((l) => l.id === onMenu)?.problem ?? null).toBeNull();

    const customE = await db.customBox.create({ data: { userId: emp.id, name: "Mine", items: [], price: 0 } });
    const customP = await db.customBox.create({ data: { userId: paid.id, name: "Mine", items: [], price: 0 } });
    const ce = await quoteCart(emp, { lines: [{ kind: "custom", id: customE.id, date: day, qty: 1 }] });
    const cp = await quoteCart(paid, { lines: [{ kind: "custom", id: customP.id, date: day, qty: 1 }] });
    expect(ce.lines[0]?.problem ?? "").not.toMatch(/Build-a-Dabba isn't part/);
    expect(cp.lines[0]?.problem).toMatch(/Build-a-Dabba isn't part of .*company-billed/);
  });
});

describe("address + delivery window change together", () => {
  it("checks the window against the new address's zone", async () => {
    const slots = await db.deliverySlot.findMany({ where: { kitchenId, isActive: true }, orderBy: { sortOrder: "asc" }, take: 2 });
    expect(slots.length).toBe(2);
    const [s1, s2] = slots;
    const zoneA = await db.deliveryZone.create({ data: { name: `P2C A ${tag}`, areas: [`p2c-a-${tag}`], wards: [], kitchenId, distanceRules: { slotIds: [s1.id] } } });
    const zoneB = await db.deliveryZone.create({ data: { name: `P2C B ${tag}`, areas: [`p2c-b-${tag}`], wards: [], kitchenId, distanceRules: { slotIds: [s2.id] } } });
    const u = await db.user.create({ data: { name: "P2C Mover", email: `p2c-mover-${tag}@test.local`, phoneNumber: `+97798${Date.now().toString().slice(-8)}` } });
    const base = { userId: u.id, recipientName: "Mover", phone: "+9779800000099", line1: "Test lane" };
    const addrA = await db.address.create({ data: { ...base, label: "A", area: `p2c-a-${tag}`, zoneId: zoneA.id, isDefault: true } });
    const addrB = await db.address.create({ data: { ...base, label: "B", area: `p2c-b-${tag}`, zoneId: zoneB.id } });
    const owner = await loadUser("owner@test.local");
    const customer = await loadUser(u.email);
    const r = await placeCartOrder(customer, { lines: [{ kind: "box", id: onMenu, date: day, qty: 1 }], addressId: addrA.id, slotId: s1.id, method: "CASH" });
    const order = await db.order.findUniqueOrThrow({ where: { id: r.orders[0].id } });
    expect(order.slotId).toBe(s1.id);

    // New address alone: zone B doesn't serve s1 → asked to pick a window as well.
    await expect(reassignDelivery(owner, order.id, { version: order.version, addressId: addrB.id, reason: "Moved office" })).rejects.toThrow(/doesn't serve the new address's zone/);
    // New address + a window only the OLD zone serves → refused (the new zone decides).
    await expect(reassignDelivery(owner, order.id, { version: order.version, addressId: addrB.id, slotId: s1.id, reason: "Moved office" })).rejects.toThrow(/doesn't serve/);
    // New address + a window of the new zone → accepted (the old zone would have refused s2).
    const ok = await reassignDelivery(owner, order.id, { version: order.version, addressId: addrB.id, slotId: s2.id, reason: "Moved office" });
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ zoneId: zoneB.id, addressId: addrB.id, slotId: s2.id, version: ok.version });
    // Window alone is still checked against the order's (now new) zone.
    await expect(reassignDelivery(owner, order.id, { version: ok.version, slotId: s1.id, reason: "Earlier" })).rejects.toThrow(/isn't available/);
  });
});
