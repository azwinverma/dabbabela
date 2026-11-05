import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Cookie jar + signed-in customer shared with the mocked next/headers and @/lib/auth.
const state = vi.hoisted(() => ({ jar: new Map<string, string>(), customerEmail: null as string | null }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest-crm" }),
  cookies: async () => ({
    get: (n: string) => (state.jar.has(n) ? { name: n, value: state.jar.get(n)! } : undefined),
    getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
    set: () => {},
    delete: () => {},
    has: (n: string) => state.jar.has(n),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  return {
    ...real,
    // A request already in flight: the user object was loaded before any suspension (stale on purpose).
    getCurrentUser: async () => {
      if (!state.customerEmail) return null;
      const { loadUser } = await import("../helpers");
      return loadUser(state.customerEmail);
    },
  };
});

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/server/auth";
import { createUserWithPassword } from "@/server/seed";
import { getSettings } from "@/lib/settings";
import { builderGroups } from "@/server/builder";
import {
  CONSENT_COOKIE,
  FIRST_TOUCH_COOKIE,
  LAST_TOUCH_COOKIE,
  decodeTouch,
  encodeTouch,
  touchFromRequest,
  type Touch,
} from "@/lib/attribution";
import {
  assertCustomerCanOrder,
  customerProfile,
  decideCreditRequest,
  exportCustomerData,
  exportCustomerDirectory,
  issueCredit,
  listCustomers,
  parseCustomerFilters,
  pendingCreditRequests,
  requestCredit,
  setCustomerActive,
  storeUserAttribution,
  updateCustomer,
  addCustomerNote,
  setCommunicationPrefs,
  customerTimeline,
  type Staff,
} from "@/server/crm";
import { middleware, requestIdFor } from "@/middleware";
import { placeOrderAction, saveCustomBoxAction } from "@/lib/actions/shop";
import { registerAction } from "@/lib/actions/auth";
import { primaryBoxOn, serviceDay } from "../helpers";

const LIST = { page: 1, per: 50, sort: "createdAt" as const, dir: "desc" as const };
let owner: Staff, finance: Staff, support: Staff, ops: Staff, exporter: Staff;
let zedId: string;
const createdUsers: string[] = [];
const createdCampaigns: string[] = [];

async function staff(email: string, role: "OWNER" | "FINANCE" | "SUPPORT" | "OPERATIONS_MANAGER") {
  const u = await db.user.create({ data: { name: `CRM ${role}`, email, role } });
  createdUsers.push(u.id);
  return { id: u.id, role } satisfies Staff;
}

function fd(o: Record<string, string>) {
  const d = new FormData();
  for (const [k, v] of Object.entries(o)) d.set(k, v);
  return d;
}

beforeAll(async () => {
  owner = await staff("crm-owner@test.local", "OWNER");
  finance = await staff("crm-finance@test.local", "FINANCE");
  support = await staff("crm-support@test.local", "SUPPORT");
  ops = await staff("crm-ops@test.local", "OPERATIONS_MANAGER");
  // A custom role can grant export without contact details.
  exporter = { ...(await staff("crm-exporter@test.local", "FINANCE")), customGrants: ["customers.export"] };
  const zed = await createUserWithPassword(db, { name: "Crm Zed Customer", email: "crm-zed@test.local", password: "zed-pass-1234", phoneNumber: "+9779841555001" });
  zedId = zed.id;
  const kitchen = await db.kitchen.findFirstOrThrow({ where: { code: "KTM-1" } });
  const zone = await db.deliveryZone.findFirstOrThrow({ where: { kitchenId: kitchen.id, isActive: true } });
  await db.address.create({ data: { userId: zedId, label: "Home", type: "HOME", recipientName: "Zed", phone: "+9779841555001", line1: "Secret Lane 7", area: "Baluwatar", zoneId: zone.id, isDefault: true } });
  await db.loginEvent.create({ data: { userId: zedId, email: "crm-zed@test.local", ip: "203.0.113.55", userAgent: "zed-phone", method: "email", success: true } });
});

afterAll(async () => {
  await db.campaign.deleteMany({ where: { id: { in: createdCampaigns } } });
});

describe("directory", () => {
  it("masks contact details and refuses email/phone search without customers.pii", async () => {
    const masked = await listCustomers(finance, parseCustomerFilters({ q: "Crm Zed" }), LIST);
    expect(masked.pii).toBe(false);
    const row = masked.rows.find((r) => r.id === zedId)!;
    expect(row.email).not.toBe("crm-zed@test.local");
    expect(row.email).toContain("•••");
    expect(row.phone).not.toContain("555001");
    // No probing by contact details
    expect((await listCustomers(finance, parseCustomerFilters({ q: "crm-zed@test.local" }), LIST)).rows.some((r) => r.id === zedId)).toBe(false);
    expect((await listCustomers(finance, parseCustomerFilters({ q: "9841555001" }), LIST)).rows.some((r) => r.id === zedId)).toBe(false);

    const full = await listCustomers(ops, parseCustomerFilters({ q: "crm-zed@test.local" }), LIST);
    expect(full.rows.find((r) => r.id === zedId)?.email).toBe("crm-zed@test.local");
    expect((await listCustomers(ops, parseCustomerFilters({ q: "9841555001" }), LIST)).rows.some((r) => r.id === zedId)).toBe(true);
  });

  it("filters by status and acquisition source, and requires customers.view", async () => {
    const suspended = await listCustomers(owner, parseCustomerFilters({ status: "suspended", q: "Crm Zed" }), LIST);
    expect(suspended.rows.some((r) => r.id === zedId)).toBe(false);
    const notCaptured = await listCustomers(owner, parseCustomerFilters({ source: "unknown", q: "Crm Zed" }), LIST);
    expect(notCaptured.rows.some((r) => r.id === zedId)).toBe(true);
    await expect(listCustomers({ id: "x", role: "KITCHEN_STAFF" }, {}, LIST)).rejects.toThrow(/permission/);
  });
});

describe("360 profile", () => {
  it("is masked for roles without customers.pii and never carries secrets", async () => {
    const p = (await customerProfile(finance, zedId))!;
    expect(p.email).not.toBe("crm-zed@test.local");
    expect(p.addresses[0]!.address).not.toContain("Secret Lane");
    expect(p.addresses[0]!.recipient).not.toContain("555001");
    expect(p.loginEvents[0]!.ip).toBe("203.0.•.•");
    expect(p.loginEvents[0]!.userAgent).toBeNull();
    const raw = JSON.stringify(p);
    expect(raw).not.toMatch(/password|"token"|secret/i);
    expect(raw).not.toContain("zed-pass-1234");

    const full = (await customerProfile(ops, zedId))!;
    expect(full.email).toBe("crm-zed@test.local");
    expect(full.addresses[0]!.address).toContain("Secret Lane");
    expect(full.loginEvents[0]!.ip).toBe("203.0.113.55");
  });

  it("returns nothing for staff accounts (customers only)", async () => {
    expect(await customerProfile(owner, finance.id)).toBeNull();
  });

  it("staff edits are limited, validated and audited; phone needs customers.pii", async () => {
    const r = await updateCustomer(finance, zedId, { diet: "VEG", allergies: ["peanut", "DAIRY"], spiceTolerance: 1 }, "customer called");
    expect(r.changed.sort()).toEqual(["allergies", "diet", "spiceTolerance"]);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "customer.update", entityId: zedId }, orderBy: { createdAt: "desc" } });
    expect(log.after).toMatchObject({ diet: "VEG", allergies: ["DAIRY", "PEANUT"] });
    expect(log.reason).toBe("customer called");
    await expect(updateCustomer(finance, zedId, { allergies: ["UNOBTAINIUM"] })).rejects.toThrow(/Unknown allergen/);
    await expect(updateCustomer(finance, zedId, { phone: "9841555002" })).rejects.toThrow(/customers.pii/);
    expect((await updateCustomer(finance, zedId, { diet: "VEG" })).changed).toEqual([]);
    await updateCustomer(ops, zedId, { phone: "9841555009" });
    const u = await db.user.findUniqueOrThrow({ where: { id: zedId } });
    expect(u.phoneNumber).toBe("+9779841555009");
    expect(u.phoneNumberVerified).toBe(false);
    const phoneLog = await db.auditLog.findFirstOrThrow({ where: { action: "customer.update", entityId: zedId }, orderBy: { createdAt: "desc" } });
    expect(JSON.stringify(phoneLog.after)).not.toContain("555009");
    await updateCustomer(ops, zedId, { phone: "9841555001" });
  });

  it("support notes and communication preferences land on the timeline", async () => {
    await addCustomerNote(support, zedId, "Called about a late delivery; promised a callback.");
    await setCommunicationPrefs(support, zedId, { "ORDER_UPDATES:IN_APP": true, "ORDER_UPDATES:EMAIL": true, "ORDER_UPDATES:SMS": false, "MARKETING:EMAIL": false }, "customer by phone");
    await expect(setCommunicationPrefs(support, zedId, {}, "")).rejects.toThrow(/who asked/i);
    const t = await customerTimeline(owner, zedId);
    expect(t.some((e) => e.action === "customer.note_added" && e.summary?.includes("late delivery"))).toBe(true);
    expect(t.some((e) => e.action === "customer.comm_prefs")).toBe(true);
    expect((await db.notificationPreference.findUniqueOrThrow({ where: { userId_topic_channel: { userId: zedId, topic: "ORDER_UPDATES", channel: "SMS" } } })).enabled).toBe(false);
  });
});

describe("suspend and reactivate", () => {
  it("revokes sessions, blocks sign-in and ordering; reactivation restores sign-in", async () => {
    const h = new Headers({ "user-agent": "vitest-crm" });
    await auth.api.signInEmail({ body: { email: "crm-zed@test.local", password: "zed-pass-1234" }, headers: h });
    expect(await db.session.count({ where: { userId: zedId } })).toBeGreaterThan(0);

    await expect(setCustomerActive(finance, zedId, false, "abuse")).rejects.toThrow(/customers.pii/);
    await expect(setCustomerActive(ops, zedId, false, "")).rejects.toThrow(/reason/);
    const r = await setCustomerActive(ops, zedId, false, "chargeback fraud");
    expect(r.sessionsRevoked).toBeGreaterThan(0);
    expect(await db.session.count({ where: { userId: zedId } })).toBe(0);
    await expect(auth.api.signInEmail({ body: { email: "crm-zed@test.local", password: "zed-pass-1234" }, headers: h })).rejects.toThrow();
    expect(await db.session.count({ where: { userId: zedId } })).toBe(0);

    await expect(assertCustomerCanOrder(zedId)).rejects.toThrow(/suspended/);
    const user = await db.user.findUniqueOrThrow({ where: { id: zedId }, include: { addresses: true } });
    const d = serviceDay(3, 1);
    const box = await primaryBoxOn(d);
    state.customerEmail = "crm-zed@test.local";
    const res = await placeOrderAction({ lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: user.addresses[0]!.id, method: "CASH", idempotencyKey: "crm-suspended-order-1" });
    state.customerEmail = null;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/suspended/);
    expect(await db.order.count({ where: { userId: zedId } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "customer.suspend", entityId: zedId } })).toBe(1);

    await setCustomerActive(ops, zedId, true, "resolved with bank");
    await auth.api.signInEmail({ body: { email: "crm-zed@test.local", password: "zed-pass-1234" }, headers: h });
    expect(await db.session.count({ where: { userId: zedId } })).toBeGreaterThan(0);
    await expect(assertCustomerCanOrder(zedId)).resolves.toBeUndefined();
    expect(await db.auditLog.count({ where: { action: "customer.reactivate", entityId: zedId } })).toBe(1);
  });
});

describe("credit", () => {
  it("an approver issues credit directly and is recorded as the approver", async () => {
    const before = (await db.creditLedger.aggregate({ where: { userId: zedId }, _sum: { amount: true } }))._sum.amount ?? 0;
    await expect(issueCredit(support, zedId, 10000, "late")).rejects.toThrow(/refunds.approve/);
    await expect(issueCredit(finance, zedId, -100, "bad")).rejects.toThrow(/positive/);
    const row = await issueCredit(finance, zedId, 15000, "Late delivery goodwill");
    expect(row.reason).toBe("GOODWILL");
    expect(row.actorId).toBe(finance.id);
    const after = (await db.creditLedger.aggregate({ where: { userId: zedId }, _sum: { amount: true } }))._sum.amount ?? 0;
    expect(after - before).toBe(15000);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "credit.issue", entityId: zedId } });
    expect(log.approvedById).toBe(finance.id);
  });

  it("a requested credit waits for a different approver and is applied exactly once", async () => {
    const { requestId } = await requestCredit(support, zedId, 5000, "Missing raita");
    expect((await pendingCreditRequests(zedId)).map((p) => p.id)).toContain(requestId);
    await expect(decideCreditRequest(support, requestId, true)).rejects.toThrow(/refunds.approve/);
    const selfReq = await requestCredit(finance, zedId, 1000, "self");
    await expect(decideCreditRequest(finance, selfReq.requestId, true)).rejects.toThrow(/Someone else/);

    const results = await Promise.allSettled([decideCreditRequest(finance, requestId, true), decideCreditRequest(owner, requestId, true)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.creditLedger.count({ where: { userId: zedId, note: "Missing raita" } })).toBe(1);
    const decision = await db.auditLog.findFirstOrThrow({ where: { entity: "CreditRequest", entityId: requestId } });
    expect(decision.approvedById).toBeTruthy();
    expect(decision.action).toBe("credit.approve");
    expect((await pendingCreditRequests(zedId)).map((p) => p.id)).not.toContain(requestId);

    await decideCreditRequest(owner, selfReq.requestId, false, "not needed");
    expect(await db.creditLedger.count({ where: { userId: zedId, note: "self" } })).toBe(0);
  });
});

describe("exports", () => {
  it("customer data export is masked without customers.pii and always audited", async () => {
    await expect(exportCustomerData(finance, zedId)).rejects.toThrow(/customers.export/);
    const masked = await exportCustomerData(exporter, zedId);
    expect(masked.masked).toBe(true);
    const raw = JSON.stringify(masked);
    expect(raw).not.toContain("crm-zed@test.local");
    expect(raw).not.toContain("Secret Lane");
    expect(raw).not.toContain("9841555001");
    const full = await exportCustomerData(owner, zedId);
    expect(full.masked).toBe(false);
    expect(full.profile.email).toBe("crm-zed@test.local");
    const logs = await db.auditLog.findMany({ where: { action: "customer.export", entityId: zedId } });
    expect(logs.map((l) => l.actorId).sort()).toEqual([exporter.id, owner.id].sort());
    expect(logs.find((l) => l.actorId === exporter.id)?.summary).toMatch(/masked/);
  });

  it("directory export is masked and audited", async () => {
    const out = await exportCustomerDirectory(exporter, parseCustomerFilters({ q: "Crm Zed" }));
    expect(out.masked).toBe(true);
    expect(out.count).toBeGreaterThan(0);
    expect(out.csv).not.toContain("crm-zed@test.local");
    expect(await db.auditLog.count({ where: { action: "customer.directory_export", actorId: exporter.id } })).toBe(1);
  });
});

describe("attribution", () => {
  it("parses UTM and external referrers; ignores internal navigation", () => {
    const t = touchFromRequest(new URL("https://dabbabela.com/menu?utm_source=Facebook&utm_medium=cpc&utm_campaign=Dashain%20Box&x=1"), "https://l.facebook.com/some/path?fbclid=abc")!;
    expect(t).toMatchObject({ source: "facebook", medium: "cpc", campaign: "Dashain Box", referrer: "l.facebook.com", landing: "/menu" });
    expect(JSON.stringify(t)).not.toContain("fbclid");
    expect(touchFromRequest(new URL("https://dabbabela.com/plans"), "https://www.google.com/search?q=lunch")).toMatchObject({ source: "google.com", medium: "organic" });
    expect(touchFromRequest(new URL("https://dabbabela.com/plans"), "https://dabbabela.com/menu")).toBeNull();
    expect(decodeTouch("%7Bbad")).toBeNull();
    expect(decodeTouch(encodeTouch({ source: "x<script>", at: new Date().toISOString() }))?.source).toBe("xscript");
  });

  it("middleware stores touches only after consent; first touch is kept, last touch updates", () => {
    const noConsent = middleware(new NextRequest("https://dabbabela.com/menu?utm_source=instagram&utm_campaign=crm-diwali"));
    expect(noConsent.cookies.get(FIRST_TOUCH_COOKIE)).toBeUndefined();

    const first = middleware(new NextRequest("https://dabbabela.com/menu?utm_source=instagram&utm_campaign=crm-diwali", { headers: { cookie: `${CONSENT_COOKIE}=granted` } }));
    const ft = first.cookies.get(FIRST_TOUCH_COOKIE)!.value;
    expect(decodeTouch(ft)).toMatchObject({ source: "instagram", campaign: "crm-diwali" });
    expect(first.cookies.get(FIRST_TOUCH_COOKIE)!.httpOnly).toBe(true);

    const later = middleware(new NextRequest("https://dabbabela.com/plans?utm_source=google&utm_medium=cpc", { headers: { cookie: `${CONSENT_COOKIE}=granted; ${FIRST_TOUCH_COOKIE}=${ft}` } }));
    expect(later.cookies.get(FIRST_TOUCH_COOKIE)).toBeUndefined();
    expect(decodeTouch(later.cookies.get(LAST_TOUCH_COOKIE)!.value)).toMatchObject({ source: "google", medium: "cpc" });

    const api = middleware(new NextRequest("https://dabbabela.com/api/health?utm_source=x", { headers: { cookie: `${CONSENT_COOKIE}=granted` } }));
    expect(api.cookies.get(FIRST_TOUCH_COOKIE)).toBeUndefined();
  });

  it("sign-up stores first touch once; the order gets the last touch and the campaign", async () => {
    const campaign = await db.campaign.create({ data: { name: "CRM Diwali", channel: "INSTAGRAM", utmCampaign: "crm-diwali" } });
    createdCampaigns.push(campaign.id);
    const now = new Date().toISOString();
    const first: Touch = { source: "instagram", medium: "social", campaign: "crm-diwali", landing: "/menu", at: now };
    const last: Touch = { source: "facebook", medium: "cpc", campaign: "crm-diwali", landing: "/plans", at: now };
    state.jar = new Map([
      [CONSENT_COOKIE, "granted"],
      [FIRST_TOUCH_COOKIE, encodeTouch(first)],
      [LAST_TOUCH_COOKIE, encodeTouch(last)],
    ]);
    const reg = await registerAction({ ok: false }, fd({ name: "Attributed Person", email: "crm-attrib@test.local", phone: "9841555777", password: "attrib-pass-123" }));
    expect(reg.ok).toBe(true);
    const u = await db.user.findUniqueOrThrow({ where: { email: "crm-attrib@test.local" } });
    expect(u.acquisitionSource).toBe("instagram");
    expect(u.attribution).toMatchObject({ source: "instagram", campaign: "crm-diwali", last: { source: "facebook" } });
    // stored once
    expect(await storeUserAttribution(u.id, { first: { source: "tiktok", at: now }, last: null })).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).acquisitionSource).toBe("instagram");

    // order from Customer A's checkout carries the last touch and the matching campaign
    const a = await db.user.findUniqueOrThrow({ where: { email: "customer.a@demo.dabbabela.local" }, include: { addresses: { where: { archivedAt: null } } } });
    const d = serviceDay(4, 2);
    const box = await primaryBoxOn(d);
    state.customerEmail = a.email;
    const res = await placeOrderAction({ lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: a.addresses[0]!.id, method: "CASH", idempotencyKey: "crm-attrib-order-1" });
    state.customerEmail = null;
    expect(res.error).toBeUndefined();
    const order = await db.order.findFirstOrThrow({ where: { payment: { idempotencyKey: "crm-attrib-order-1" } } });
    expect(order.attribution).toMatchObject({ source: "facebook", medium: "cpc", campaign: "crm-diwali" });
    expect(order.campaignId).toBe(campaign.id);

    // No consent → nothing stored
    state.jar = new Map([
      [CONSENT_COOKIE, "denied"],
      [FIRST_TOUCH_COOKIE, encodeTouch(first)],
    ]);
    const reg2 = await registerAction({ ok: false }, fd({ name: "Private Person", email: "crm-private@test.local", phone: "9841555778", password: "private-pass-123" }));
    expect(reg2.ok).toBe(true);
    expect((await db.user.findUniqueOrThrow({ where: { email: "crm-private@test.local" } })).acquisitionSource).toBeNull();
    state.jar = new Map();
  });
});

describe("request id", () => {
  it("stamps x-request-id on request and response, keeping a well-formed upstream id", () => {
    const res = middleware(new NextRequest("https://dabbabela.com/menu"));
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("x-middleware-request-x-request-id")).toBe(id);

    const kept = middleware(new NextRequest("https://dabbabela.com/api/health", { headers: { "x-request-id": "upstream-abc-123" } }));
    expect(kept.headers.get("x-request-id")).toBe("upstream-abc-123");
    expect(requestIdFor(new Headers({ "x-request-id": "bad id; <script>" }))).toMatch(/^[0-9a-f-]{36}$/);

    const redirect = middleware(new NextRequest("https://dabbabela.com/account/orders"));
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toContain("/login?next=");
    expect(redirect.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("saved custom box", () => {
  it("keeps the chosen portion", async () => {
    const settings = await getSettings();
    const groups = await builderGroups();
    const picks: { menuItemId: string; qty: number; portionId?: string | null }[] = [];
    for (const g of groups) if (g.minSelect > 0 && g.options[0]) picks.push({ menuItemId: g.options[0].menuItemId, qty: g.minSelect });
    const target = groups.find((g) => g.maxSelect > (g.minSelect || 0) && g.options.length && !picks.some((p) => p.menuItemId === g.options[0]!.menuItemId)) ?? groups.find((g) => g.options.length)!;
    const opt = target.options[0]!;
    const regular = await db.customizationPortion.create({ data: { optionId: opt.id, label: "CRM Regular", qtyMultiplier: 1, priceDelta: 0, sortOrder: 0 } });
    const large = await db.customizationPortion.create({ data: { optionId: opt.id, label: "CRM Large", qtyMultiplier: 1.5, priceDelta: settings.builderMinPrice, sortOrder: 1 } });
    try {
      const existing = picks.find((p) => p.menuItemId === opt.menuItemId);
      if (existing) existing.portionId = large.id;
      else picks.push({ menuItemId: opt.menuItemId, qty: 1, portionId: large.id });
      state.customerEmail = "customer.c@demo.dabbabela.local";
      const r = await saveCustomBoxAction({ name: "CRM portion box", items: picks });
      state.customerEmail = null;
      expect(r.error).toBeUndefined();
      const box = await db.customBox.findUniqueOrThrow({ where: { id: r.data!.id } });
      const items = box.items as { menuItemId: string; portionId: string | null }[];
      expect(items.find((i) => i.menuItemId === opt.menuItemId)?.portionId).toBe(large.id);
      await db.customBox.delete({ where: { id: box.id } });
    } finally {
      state.customerEmail = null;
      await db.customizationPortion.deleteMany({ where: { id: { in: [regular.id, large.id] } } });
    }
  });
});
