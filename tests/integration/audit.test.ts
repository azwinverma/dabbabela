import { beforeAll, describe, expect, it, vi } from "vitest";

// Simulated incoming request headers (next/headers is read by request-context when no explicit context is set).
const reqHeaders = new Headers({ "x-request-id": "req-from-header-0001", "user-agent": "Vitest/1.0 (audit)", "x-forwarded-for": "203.0.113.9, 10.0.0.1" });
vi.mock("next/headers", () => ({
  headers: async () => reqHeaders,
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }),
}));

import { db } from "@/lib/db";
import { audit, isSecretKey, redactSecrets, REDACTED } from "@/lib/audit";
import { contextFromHeaders, runWithRequestContext, sanitizeRequestId } from "@/lib/request-context";
import { can } from "@/lib/permissions";
import { buildAuditWhere, diffKeys, parseAuditFilters, parseAuditList, searchAudit } from "@/app/admin/audit/query";
import { recordHref } from "@/app/admin/_kit/links";

let ownerId: string;
let approverId: string;
const TAG = `wp17-${Date.now()}`;

beforeAll(async () => {
  ownerId = (await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } })).id;
  approverId = (await db.user.create({ data: { name: "Audit Approver", email: `${TAG}-approver@test.local`, role: "FINANCE" } })).id;
});

describe("request context", () => {
  it("reads x-request-id, IP and user agent from headers; rejects malformed ids", () => {
    const c = contextFromHeaders(new Headers({ "x-request-id": "abc-123-xyz", "user-agent": "UA", "x-forwarded-for": "198.51.100.4, 10.0.0.2" }));
    expect(c).toEqual({ requestId: "abc-123-xyz", ip: "198.51.100.4", userAgent: "UA" });
    expect(contextFromHeaders(new Headers({ "x-vercel-id": "bom1::abcde-12345" })).requestId).toBe("bom1::abcde-12345");
    expect(sanitizeRequestId("bad id\nInjected: yes")).toBeNull();
    const gen = contextFromHeaders(new Headers({ "x-request-id": "<script>" }));
    expect(gen.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(contextFromHeaders(new Headers({ "x-forwarded-for": "not-an-ip" })).ip).toBeNull();
  });
});

describe("audit() correlation and approval", () => {
  it("fills requestId, IP and user agent from the request automatically", async () => {
    await audit({ actorId: ownerId, action: "test.header", entity: "Setting", entityId: `${TAG}-h`, summary: "from header" });
    const row = await db.auditLog.findFirstOrThrow({ where: { entityId: `${TAG}-h` } });
    expect(row.requestId).toBe("req-from-header-0001");
    expect(row.userAgent).toBe("Vitest/1.0 (audit)");
    expect(row.ip).toBe("203.0.113.9");
  });

  it("shares one request id across every entry of an explicit context and records the approver", async () => {
    await runWithRequestContext({ requestId: `${TAG}-req-A`, userAgent: "cron" }, async () => {
      await audit({ actorId: ownerId, action: "refund.request", entity: "Refund", entityId: `${TAG}-r1`, summary: "requested" });
      await audit({ actorId: ownerId, action: "refund.approve", entity: "Refund", entityId: `${TAG}-r1`, summary: "approved", reason: "duplicate charge", approvedById: approverId });
    });
    // Both rows can share a millisecond timestamp, so look them up by action rather than by order.
    const rows = await db.auditLog.findMany({ where: { entityId: `${TAG}-r1` } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.requestId === `${TAG}-req-A` && r.userAgent === "cron")).toBe(true);
    const requested = rows.find((r) => r.action === "refund.request")!;
    const approved = rows.find((r) => r.action === "refund.approve")!;
    expect(requested.approvedById).toBeNull();
    expect(approved.approvedById).toBe(approverId);
    expect(approved.reason).toBe("duplicate charge");
  });

  it("keeps the legacy positional signature working", async () => {
    await audit(ownerId, "test.legacy", "Setting", `${TAG}-legacy`, "positional", { flag: true });
    const row = await db.auditLog.findFirstOrThrow({ where: { entityId: `${TAG}-legacy` } });
    expect(row.after).toEqual({ flag: true });
    expect(row.requestId).toBeTruthy();
  });

  it("accepts null before/after", async () => {
    await audit({ actorId: ownerId, action: "test.null", entity: "Setting", entityId: `${TAG}-null`, before: null, after: { a: 1 } });
    const row = await db.auditLog.findFirstOrThrow({ where: { entityId: `${TAG}-null` } });
    expect(row.before).toBeNull();
  });
});

describe("secret redaction", () => {
  it("classifies secret keys without hiding business fields", () => {
    for (const k of ["password", "passwordHash", "new_password", "token", "accessToken", "refresh-token", "otp", "deliveryOtp", "signature", "webhookSignature", "apiKey", "secretKey", "client_secret", "cardNumber", "cvv", "pin", "twoFactorSecret", "backupCodes", "authorization", "cookie"])
      expect(isSecretKey(k), k).toBe(true);
    for (const k of ["code", "couponCode", "key", "panVat", "company", "name", "email", "phoneNumber", "total", "footprint", "status", "keywords"]) expect(isSecretKey(k), k).toBe(false);
  });

  it("never stores passwords, tokens, OTPs, signatures or card data", async () => {
    const card = "4111 1111 1111 1111";
    await audit({
      actorId: ownerId,
      action: "test.redact",
      entity: "Setting",
      entityId: `${TAG}-secret`,
      summary: `Charged card ${card} with Bearer abcdefghijklmnop123`,
      before: { password: "hunter2", nested: { otp: "908172", list: [{ token: "tok_live_x" }] } },
      after: {
        couponCode: "DASHAIN10",
        panVat: "601234567",
        esewa: { signature: "c2lnbmF0dXJl", merchantKey: "8gBm/:&EnhH.1/q" },
        note: `paid with ${card}`,
        jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijklmno",
        phone: "+9779812345678",
      },
    });
    const row = await db.auditLog.findFirstOrThrow({ where: { entityId: `${TAG}-secret` } });
    const stored = JSON.stringify([row.summary, row.before, row.after]);
    for (const secret of ["hunter2", "tok_live_x", "908172", "c2lnbmF0dXJl", "8gBm", "4111", "abcdefghijklmnop123", "eyJhbGci"]) expect(stored).not.toContain(secret);
    expect(row.summary).toBe(`Charged card ${REDACTED} with ${REDACTED}`);
    expect(row.before).toEqual({ password: REDACTED, nested: { otp: REDACTED, list: [{ token: REDACTED }] } });
    expect(row.after).toMatchObject({ couponCode: "DASHAIN10", panVat: "601234567", esewa: { signature: REDACTED, merchantKey: REDACTED }, note: `paid with ${REDACTED}`, jwt: REDACTED, phone: "+9779812345678" });
  });

  it("leaves non-Luhn long numbers (order numbers, amounts) alone", () => {
    expect(redactSecrets({ ref: "1234567890123" })).toEqual({ ref: "1234567890123" });
    expect(redactSecrets({ when: new Date("2026-01-01T00:00:00Z"), n: 5, ok: true, nil: null })).toEqual({ when: "2026-01-01T00:00:00.000Z", n: 5, ok: true, nil: null });
  });
});

describe("audit search", () => {
  beforeAll(async () => {
    await runWithRequestContext({ requestId: `${TAG}-req-B` }, async () => {
      await audit({ actorId: approverId, action: "expense.approve", entity: "Expense", entityId: `${TAG}-e1`, summary: "Gas cylinder refill", approvedById: approverId });
      await audit({ actorId: null, action: "job.run", entity: "Job", entityId: `${TAG}-j1`, summary: "nightly roll-up" });
    });
    await db.auditLog.create({ data: { action: "old.entry", entity: "Expense", entityId: `${TAG}-old`, summary: "ancient", createdAt: new Date("2025-01-15T06:00:00Z") } });
  });

  const ids = async (sp: Record<string, string>) => {
    const owner = { role: "OWNER" as const };
    const { rows } = await searchAudit(owner, parseAuditFilters(sp), parseAuditList({ ...sp, per: "100" }));
    return rows.map((r) => r.entityId).filter((x) => x?.startsWith(TAG));
  };

  it("filters by request id, actor, entity, action prefix, approvals and text", async () => {
    expect((await ids({ requestId: `${TAG}-req-B` })).sort()).toEqual([`${TAG}-e1`, `${TAG}-j1`]);
    expect(await ids({ actor: approverId })).toEqual([`${TAG}-e1`]);
    expect(await ids({ actor: "system", requestId: `${TAG}-req-B` })).toEqual([`${TAG}-j1`]);
    expect((await ids({ entity: "Expense" })).sort()).toEqual([`${TAG}-e1`, `${TAG}-old`]);
    expect(await ids({ action: "expense.", entity: "Expense" })).toEqual([`${TAG}-e1`]);
    expect((await ids({ approved: "yes" })).sort()).toEqual([`${TAG}-e1`, `${TAG}-r1`]);
    expect(await ids({ q: "cylinder" })).toEqual([`${TAG}-e1`]);
    expect(await ids({ q: "Audit Approver", entity: "Expense" })).toEqual([`${TAG}-e1`]);
    expect(await ids({ entityId: `${TAG}-r1`, action: "refund.approve" })).toEqual([`${TAG}-r1`]);
  });

  it("filters by Kathmandu date range (swapped bounds are fixed)", async () => {
    expect(await ids({ entity: "Expense", from: "2025-01-15", to: "2025-01-15" })).toEqual([`${TAG}-old`]);
    expect(await ids({ entity: "Expense", from: "2025-01-31", to: "2025-01-01" })).toEqual([`${TAG}-old`]);
    expect(await ids({ entity: "Expense", from: "2026-01-01" })).toEqual([`${TAG}-e1`]);
    expect(buildAuditWhere(parseAuditFilters({ from: "nonsense" }))).toEqual({});
  });

  it("resolves approver names and record deep links", async () => {
    const { rows } = await searchAudit({ role: "OWNER" }, parseAuditFilters({ entityId: `${TAG}-r1`, action: "refund.approve" }), parseAuditList({}));
    expect(rows[0]!.approver).toEqual({ id: approverId, name: "Audit Approver" });
    expect(rows[0]!.href).toBe("/admin/refunds");
    expect(recordHref("Order", "o1")).toBe("/admin/orders/o1");
    expect(recordHref("User", "u1", { role: "FINANCE" })).toBe("/admin/staff/u1");
    expect(recordHref("User", "u1", { role: "CUSTOMER" })).toBe("/admin/customers/u1");
    expect(recordHref("Job", "x")).toBeNull();
  });

  it("is limited to audit.view", async () => {
    expect(can("SUPPORT", "audit.view")).toBe(false);
    await expect(searchAudit({ role: "SUPPORT" }, {}, parseAuditList({}))).rejects.toThrow(/audit\.view/);
    await expect(searchAudit({ role: "KITCHEN_STAFF", customGrants: [] }, {}, parseAuditList({}))).rejects.toThrow(/audit\.view/);
    // a custom role that grants audit.view opens it
    await expect(searchAudit({ role: "SUPPORT", customGrants: ["audit.view"] }, {}, parseAuditList({}))).resolves.toHaveProperty("total");
  });

  it("diffs only changed fields", () => {
    expect(diffKeys({ a: 1, b: 2, updatedAt: "x" }, { a: 1, b: 3, c: 4, updatedAt: "y" })).toEqual([
      { key: "b", before: 2, after: 3 },
      { key: "c", before: undefined, after: 4 },
    ]);
  });
});
