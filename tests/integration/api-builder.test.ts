import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { bearerFor, call } from "../api-helpers";
import { primaryBoxOn, serviceDay } from "../helpers";
import * as allergens from "@/app/api/v1/allergens/route";
import * as builder from "@/app/api/v1/builder/route";
import * as builderQuote from "@/app/api/v1/builder/quote/route";
import * as savedBoxes from "@/app/api/v1/saved-boxes/route";
import * as savedBox from "@/app/api/v1/saved-boxes/[id]/route";
import * as cartQuote from "@/app/api/v1/cart/quote/route";
import * as notifications from "@/app/api/v1/notifications/route";
import * as signUp from "@/app/api/v1/auth/sign-up/route";

/** Mobile API additions: allergens, Build-a-Dabba (catalogue, quote, saved boxes CRUD, cart), notification targets. */

const B = "customer.b@demo.dabbabela.local";
const C = "customer.c@demo.dabbabela.local";
let tB: string;
let tC: string;
type Catalogue = { minPrice: number; maxQtyPerDish: number; companyBuildBlocked: { companyName: string } | null; groups: { minSelect: number; options: { menuItemId: string; portions: { id: string }[] }[] }[] };
let picks: { menuItemId: string; qty: number }[];

beforeAll(async () => {
  tB = await bearerFor(B, "demo-pass-123");
  tC = await bearerFor(C, "demo-pass-123");
  const r = await call<Catalogue>(builder.GET, "GET", "/builder");
  // A valid build: the first `minSelect` options of every step that needs a pick.
  picks = r.body.data!.groups.flatMap((g) => g.options.slice(0, Math.max(g.minSelect, 0)).map((o) => ({ menuItemId: o.menuItemId, qty: 1 })));
  if (!picks.length && r.body.data!.groups[0]) picks = [{ menuItemId: r.body.data!.groups[0].options[0].menuItemId, qty: 1 }];
});

describe("GET /allergens", () => {
  it("is public and lists every allergen code", async () => {
    const r = await call(allergens.GET, "GET", "/allergens");
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(await db.allergen.count());
    expect(r.body.data[0]).toEqual({ code: expect.any(String), name: expect.any(String), nameNe: expect.toBeOneOf([null, expect.any(String)]) });
  });
});

describe("Build-a-Dabba", () => {
  it("catalogue + quote mirror the web builder (server price, floor, per-dish max)", async () => {
    const s = await getSettings();
    const cat = await call<Catalogue>(builder.GET, "GET", "/builder");
    expect(cat.status).toBe(200);
    expect(cat.body.data).toMatchObject({ minPrice: s.builderMinPrice, maxQtyPerDish: s.builderMaxQty, companyBuildBlocked: null });
    expect(cat.body.data!.groups.length).toBeGreaterThan(0);
    expect(picks.length).toBeGreaterThan(0);

    const q = await call(builderQuote.POST, "POST", "/builder/quote", { body: { picks } });
    expect(q.status).toBe(200);
    expect(q.body.data.problem).toBeNull();
    expect(q.body.data.price).toBeGreaterThanOrEqual(s.builderMinPrice);
    // Quantities are clamped to builderMaxQty; prices from the client are ignored (no such field accepted).
    const big = await call(builderQuote.POST, "POST", "/builder/quote", { body: { picks: [{ ...picks[0], qty: 25 }, ...picks.slice(1)] } });
    expect(big.body.data.lines[0].qty).toBeLessThanOrEqual(s.builderMaxQty);
    const empty = await call(builderQuote.POST, "POST", "/builder/quote", { body: { picks: [] } });
    expect(empty.body.data.problem).toBe("Pick your dishes");
    const bad = await call(builderQuote.POST, "POST", "/builder/quote", { body: { picks: [{ menuItemId: "x", qty: 0 }] } });
    expect(bad.status).toBe(422);
  });

  it("saved boxes: create, list (re-priced), rename/rebuild, delete — own boxes only", async () => {
    const created = await call(savedBoxes.POST, "POST", "/saved-boxes", { token: tB, body: { name: "API box", picks } });
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    expect(created.body.data).toMatchObject({ name: "API box", savedPrice: expect.any(Number) });
    const invalid = await call(savedBoxes.POST, "POST", "/saved-boxes", { token: tB, body: { picks: [{ menuItemId: "nope", qty: 1 }] } });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error?.code).toBe("BUILD_REJECTED");

    const list = await call(savedBoxes.GET, "GET", "/saved-boxes", { token: tB });
    const row = list.body.data.find((b: { id: string }) => b.id === id);
    expect(row).toMatchObject({ problem: null, price: created.body.data.price, details: expect.any(String) });

    const renamed = await call(savedBox.PATCH, "PATCH", `/saved-boxes/${id}`, { token: tB, params: { id }, body: { name: "Renamed box" } });
    expect(renamed.body.data.name).toBe("Renamed box");
    expect((await call(savedBox.PATCH, "PATCH", `/saved-boxes/${id}`, { token: tB, params: { id }, body: { name: "x" } })).status).toBe(422);
    // Another customer: 404 for edit and delete; their list doesn't show it.
    expect((await call(savedBox.PATCH, "PATCH", `/saved-boxes/${id}`, { token: tC, params: { id }, body: { name: "Mine now" } })).status).toBe(404);
    expect((await call(savedBox.DELETE, "DELETE", `/saved-boxes/${id}`, { token: tC, params: { id } })).status).toBe(404);
    expect((await call(savedBoxes.GET, "GET", "/saved-boxes", { token: tC })).body.data.some((b: { id: string }) => b.id === id)).toBe(false);

    // Order it: a cart line kind=custom (same quote as checkout).
    const date = serviceDay(10, 3);
    await primaryBoxOn(date);
    const cart = await call(cartQuote.POST, "POST", "/cart/quote", { token: tB, body: { lines: [{ kind: "custom", id, date, qty: 1 }] } });
    expect(cart.status).toBe(200);
    expect(cart.body.data.lines[0]).toMatchObject({ kind: "custom", id });

    const del = await call(savedBox.DELETE, "DELETE", `/saved-boxes/${id}`, { token: tB, params: { id } });
    expect(del.status).toBe(200);
    expect(await db.customBox.count({ where: { id } })).toBe(0);
    expect((await call(savedBox.DELETE, "DELETE", `/saved-boxes/${id}`, { token: tB, params: { id } })).status).toBe(404);
  });

  it("company-billed members: catalogue says so and checkout refuses a built dabba", async () => {
    const stamp = Date.now();
    const su = await call(signUp.POST, "POST", "/auth/sign-up", { body: { name: "Builder Co Member", email: `builder-co-${stamp}@test.local`, phone: `98${String(stamp).slice(-8)}`, password: "api-pass-1234" }, ip: "198.51.100.77" });
    expect(su.status).toBe(201);
    const token = su.body.data.token as string;
    const userId = su.body.data.user.id as string;
    const date = serviceDay(10, 4);
    const box = await primaryBoxOn(date);
    const company = await db.company.create({ data: { name: `Builder Co ${stamp}`, slug: `builder-co-${stamp}`, billingMode: "COMPANY_PAID", subsidyPct: 100 } });
    await db.companyMenuItem.create({ data: { companyId: company.id, boxId: box.id } });
    await db.companyMember.create({ data: { companyId: company.id, userId, role: "MEMBER", status: "ACTIVE" } });
    const cat = await call<Catalogue>(builder.GET, "GET", "/builder", { token });
    expect(cat.body.data!.companyBuildBlocked).toEqual({ companyName: company.name });
    const saved = await call(savedBoxes.POST, "POST", "/saved-boxes", { token, body: { picks } });
    expect(saved.status).toBe(201);
    const cart = await call(cartQuote.POST, "POST", "/cart/quote", { token, body: { lines: [{ kind: "custom", id: saved.body.data.id, date, qty: 1 }] } });
    expect(cart.body.data.lines[0].problem).toMatch(/Build-a-Dabba isn't part of .*company-billed/);
  });
});

describe("notification targets", () => {
  it("every item carries a structured target next to the web link", async () => {
    const b = await db.user.findUniqueOrThrow({ where: { email: B } });
    await db.notification.createMany({
      data: [
        { userId: b.id, type: "order.delivered", title: "t1", link: "/account/orders/ord_api_1" },
        { userId: b.id, type: "plan.reminder", title: "t2", link: "/account/plans/sub_api_1#renew" },
        { userId: b.id, type: "x", title: "t3", link: null },
      ],
    });
    const r = await call(notifications.GET, "GET", "/notifications", { token: tB, query: { limit: 50 } });
    const by = (title: string) => r.body.data.find((n: { title: string }) => n.title === title);
    expect(by("t1").target).toEqual({ type: "order", id: "ord_api_1" });
    expect(by("t2").target).toEqual({ type: "plan", id: "sub_api_1" });
    expect(by("t3").target).toBeNull();
    expect(by("t1").link).toBe("/account/orders/ord_api_1");
  });
});
