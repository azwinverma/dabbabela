import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { apiRoute } from "@/server/api/route";
import { bearerFor, call, idem } from "../api-helpers";
import { serviceDay } from "../helpers";
import * as settings from "@/app/api/v1/settings/route";
import * as menu from "@/app/api/v1/menu/route";
import * as box from "@/app/api/v1/boxes/[slug]/route";
import * as plans from "@/app/api/v1/plans/route";
import * as plan from "@/app/api/v1/plans/[slug]/route";
import * as coverage from "@/app/api/v1/coverage/route";
import * as openapi from "@/app/api/v1/openapi.json/route";

/** Phase 3: public catalogue endpoints + wrapper behaviour (idempotent multipart retries). */

describe("public endpoints", () => {
  it("settings: brand, ordering rules, flags — no secrets", async () => {
    const r = await call(settings.GET, "GET", "/settings");
    expect(r.status).toBe(200);
    expect(r.body.data.brand.name).toBeTruthy();
    expect(r.body.data.ordering.timeZone).toBe("Asia/Kathmandu");
    expect(r.body.data.flags).toHaveProperty("deliveryOtp");
    expect(JSON.stringify(r.body)).not.toMatch(/notifyEmail|approvalThreshold|SECRET/i);
  });

  it("menu by date returns one day with dabbas (paisa prices); week returns 7 days", async () => {
    const date = serviceDay(2);
    const r = await call(menu.GET, "GET", "/menu", { query: { date } });
    expect(r.status).toBe(200);
    expect(r.body.data.days).toHaveLength(1);
    const d = r.body.data.days[0];
    expect(d.date).toBe(date);
    expect(d.items.length).toBeGreaterThan(0);
    expect(Number.isInteger(d.items[0].box.price)).toBe(true);
    const w = await call(menu.GET, "GET", "/menu", { query: { week: date } });
    expect(w.body.data.days).toHaveLength(7);
    expect((await call(menu.GET, "GET", "/menu", { query: { date: "2026-13-40" } })).status).toBe(422);
  });

  it("menu narrows to the company menu for a company member's token", async () => {
    const a = await db.user.findUniqueOrThrow({ where: { email: "customer.a@demo.dabbabela.local" }, include: { membership: true } });
    const date = serviceDay(2);
    const full = await call(menu.GET, "GET", "/menu", { query: { date } });
    const boxes = full.body.data.days[0].items.map((i: { box: { id: string } }) => i.box.id) as string[];
    expect(boxes.length).toBeGreaterThan(1);
    await db.companyMenuItem.deleteMany({ where: { companyId: a.membership!.companyId } });
    await db.companyMenuItem.create({ data: { companyId: a.membership!.companyId, boxId: boxes[0]! } });
    try {
      const token = await bearerFor("customer.a@demo.dabbabela.local", "demo-pass-123");
      const r = await call(menu.GET, "GET", "/menu", { query: { date }, token });
      expect(r.body.data.companyMenu).toBeTruthy();
      expect(r.body.data.days[0].items.map((i: { box: { id: string } }) => i.box.id)).toEqual([boxes[0]]);
    } finally {
      await db.companyMenuItem.deleteMany({ where: { companyId: a.membership!.companyId } });
    }
  });

  it("box detail by slug; hidden/unknown → 404", async () => {
    const b = await db.lunchBox.findFirstOrThrow({ where: { isActive: true, isVisible: true } });
    const r = await call(box.GET, "GET", `/boxes/${b.slug}`, { params: { slug: b.slug } });
    expect(r.status).toBe(200);
    expect(r.body.data.box.id).toBe(b.id);
    expect(Array.isArray(r.body.data.dates)).toBe(true);
    expect((await call(box.GET, "GET", "/boxes/nope", { params: { slug: "nope" } })).status).toBe(404);
  });

  it("plans list + detail", async () => {
    const r = await call(plans.GET, "GET", "/plans");
    expect(r.body.data.length).toBeGreaterThan(0);
    const slug = r.body.data[0].slug;
    const d = await call(plan.GET, "GET", `/plans/${slug}`, { params: { slug } });
    expect(d.status).toBe(200);
    expect(d.body.data.plan.slug).toBe(slug);
    expect(d.body.data.startDates.length).toBeGreaterThan(0);
  });

  it("coverage: search and address check", async () => {
    const zone = await db.deliveryZone.findFirstOrThrow({ where: { isActive: true, NOT: { areas: { has: "*" } } } });
    const area = zone.areas.find((a) => a !== "*")!;
    const s = await call(coverage.GET, "GET", "/coverage", { query: { q: area } });
    expect(s.body.data.listedByName).toBe(true);
    const c = await call(coverage.GET, "GET", "/coverage", { query: { area, city: "Kathmandu" } });
    expect(c.body.data.mode).toBe("address");
    expect(c.body.data.zone).toBeTruthy();
    expect((await call(coverage.GET, "GET", "/coverage")).status).toBe(400);
  });

  it("serves the OpenAPI document", async () => {
    const r = await call(openapi.GET, "GET", "/openapi.json");
    expect(r.status).toBe(200);
    expect((r.body as unknown as { openapi: string }).openapi).toBe("3.1.0");
  });
});

describe("idempotency wrapper", () => {
  it("replays a multipart retry even though the boundary changes; a different file is a different request", async () => {
    let runs = 0;
    const handler = apiRoute({ auth: "user", idempotent: "test-multipart" }, async ({ req }) => {
      runs++;
      const fd = await req.formData();
      return { run: runs, note: fd.get("note") };
    });
    const token = await bearerFor("customer.b@demo.dabbabela.local", "demo-pass-123");
    const key = idem("mp");
    const form = (bytes: string) => {
      const fd = new FormData();
      fd.set("note", "hello");
      fd.set("photo", new Blob([bytes], { type: "image/png" }), "p.png");
      return fd;
    };
    const a = await call(handler, "POST", "/x", { token, idem: key, form: form("abc") });
    const b = await call(handler, "POST", "/x", { token, idem: key, form: form("abc") });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect(b.body.data).toEqual(a.body.data);
    expect(runs).toBe(1);
    const c = await call(handler, "POST", "/x", { token, idem: key, form: form("abd") });
    expect(c.status).toBe(422);
    expect(c.body.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("a failed request releases its key", async () => {
    let fail = true;
    const handler = apiRoute({ auth: "user", idempotent: "test-fail" }, async () => {
      if (fail) throw new Error("Kitchen is closed that day");
      return { ok: true };
    });
    const token = await bearerFor("customer.b@demo.dabbabela.local", "demo-pass-123");
    const key = idem("f");
    const a = await call(handler, "POST", "/x", { token, idem: key, body: { a: 1 } });
    expect(a.status).toBe(422);
    expect(a.body.error?.message).toBe("Kitchen is closed that day");
    fail = false;
    const b = await call(handler, "POST", "/x", { token, idem: key, body: { a: 1 } });
    expect(b.status).toBe(200);
    expect(b.headers.get("idempotent-replayed")).toBeNull();
  });
});
