import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));
// Gateway look-ups would hit eSewa/Khalti over the network; housekeeping's other steps run for real.
vi.mock("@/server/payments", async (orig) => ({ ...(await orig<typeof import("@/server/payments")>()), reconcileGatewayAttempts: async () => ({ checked: 0, paid: 0 }) }));

import type { OrderStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dateOnly, todayKTM } from "@/lib/dates";
import type { CurrentUser } from "@/lib/auth";
import { DETECTORS, acknowledgeAlerts, applyFindings, assignAlerts, escalateAlerts, listAlerts, reopenAlert, resolveAlerts, runDetectors } from "@/server/alerts";
import { housekeepingJob, jobOverview, JOBS, retryJobRun, runJobManually } from "@/server/jobs";
import { GET as cron } from "@/app/api/cron/daily/route";
import { loadUser } from "../helpers";

const T = Date.now().toString(36);
const today = todayKTM();
/** A fixed "now": 13:15 Kathmandu today — after the 12:00–12:30 slot used below and the 11:00 production deadline. */
const NOW = new Date(`${today}T13:15:00+05:45`);
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

let owner: CurrentUser, ops: CurrentUser, finance: CurrentUser, support: CurrentUser;
let custId: string, kX: string, slotId: string, menuItemId: string, planId: string;
let n = 0;
const made = { orders: [] as string[], payments: [] as string[], subs: [] as string[] };
const ids: Record<string, string> = {};

async function mkOrder(o: { date: string; status: OrderStatus; qty?: number; createdAt?: Date; subscriptionId?: string; withSlot?: boolean }) {
  const qty = o.qty ?? 1;
  const row = await db.order.create({
    data: {
      number: `WP16-${T}-${++n}`,
      code: "WP16",
      userId: custId,
      kitchenId: kX,
      deliveryDate: dateOnly(o.date),
      status: o.status,
      slotId: o.withSlot ? slotId : null,
      subscriptionId: o.subscriptionId ?? null,
      contactName: "WP16 Customer",
      contactPhone: "+9779800000016",
      addressLine: "Sample road",
      area: "WP16 tole",
      subtotal: 10_000 * qty,
      total: 10_000 * qty,
      createdAt: o.createdAt,
      items: { create: [{ name: "Lunch dabba", components: [], unitPrice: 10_000, lineTotal: 10_000 * qty, quantity: qty }] },
    },
  });
  made.orders.push(row.id);
  return row;
}

async function alertByKey(key: string) {
  return db.alert.findUnique({ where: { dedupeKey: key } });
}

beforeAll(async () => {
  [owner, ops, finance, support] = await Promise.all([loadUser("owner@test.local"), loadUser("ops@demo.dabbabela.local"), loadUser("finance@demo.dabbabela.local"), loadUser("support@demo.dabbabela.local")]);
  custId = (await db.user.findUniqueOrThrow({ where: { email: "customer.b@demo.dabbabela.local" } })).id;
  menuItemId = (await db.menuItem.findFirstOrThrow()).id;
  planId = (await db.mealPlan.findFirstOrThrow()).id;
  kX = (await db.kitchen.create({ data: { name: `WP16 kitchen ${T}`, code: `WP16-${T}`, dailyCapacity: 2 } })).id;
  slotId = (await db.deliverySlot.create({ data: { kitchenId: kX, label: "12:00 – 12:30", startTime: "12:00", endTime: "12:30" } })).id;

  // unpaid orders · over capacity · delayed + failed deliveries
  ids.unpaid = (await mkOrder({ date: addDays(today, 41), status: "PENDING_PAYMENT", createdAt: ago(180) })).id;
  ids.capacity = (await mkOrder({ date: addDays(today, 1), status: "SCHEDULED", qty: 3 })).id;
  await mkOrder({ date: today, status: "OUT_FOR_DELIVERY", withSlot: true });
  ids.failed = (await mkOrder({ date: today, status: "FAILED_DELIVERY" })).id;

  // plan renewal unpaid for 2 days · plan meal without a dabba
  const sub = (data: { status: "ACTIVE" | "PENDING_PAYMENT"; renewedFromId?: string; createdAt?: Date }) =>
    db.subscription.create({ data: { reference: `WP16-${T}-${++n}`, userId: custId, planId, startDate: dateOnly(addDays(today, 2)), endDate: dateOnly(addDays(today, 9)), mealsTotal: 5, pricePerMeal: 10_000, subtotal: 50_000, total: 50_000, ...data } });
  const parent = await sub({ status: "ACTIVE" });
  const renewal = await sub({ status: "PENDING_PAYMENT", renewedFromId: parent.id, createdAt: ago(48 * 60) });
  made.subs.push(renewal.id, parent.id);
  ids.renewal = renewal.id;
  await mkOrder({ date: addDays(today, 2), status: "SCHEDULED", subscriptionId: parent.id });

  // stock: low (safety stock, none on hand) + a lot expiring tomorrow
  ids.ing = (await db.ingredient.create({ data: { name: `WP16 saffron ${T}`, costPerUnit: 100, safetyStock: 5 } })).id;
  ids.lot = (await db.stockLot.create({ data: { ingredientId: ids.ing, kitchenId: kX, code: `L-WP16-${T}`, receivedQty: 5, remainingQty: 5, unitCost: 100, expiresOn: dateOnly(addDays(todayKTM(), 1)) } })).id;

  // production: a batch not started after the 11:00 deadline; yesterday wasted 25%
  ids.batch = (await db.productionBatch.create({ data: { kitchenId: kX, date: dateOnly(today), menuItemId, plannedPortions: 10 } })).id;
  await db.productionBatch.create({ data: { kitchenId: kX, date: dateOnly(addDays(today, -1)), menuItemId, plannedPortions: 40, actualPortions: 40, wastePortions: 10, status: "DONE" } });

  // refunds spike + duplicate payments
  const pay = (amount: number, paidAt: Date) => db.payment.create({ data: { reference: `WP16-${T}-${++n}`, userId: custId, method: "CASH", status: "PAID", amount, paidAt } });
  const refundPay = await pay(50_000, ago(300));
  made.payments.push(refundPay.id);
  for (let i = 0; i < 4; i++) await db.refund.create({ data: { paymentId: refundPay.id, amount: 1_000, reason: "WP16 test", createdAt: ago(60 + i) } });
  const a = await pay(77_700, ago(30));
  const b = await pay(77_700, ago(28));
  made.payments.push(a.id, b.id);
  ids.dupA = a.id;
  ids.dupB = b.id;

  // corporate: overdue invoice + contract ending in 5 days with an unmet monthly minimum
  ids.company = (await db.company.create({ data: { name: `WP16 Co ${T}`, slug: `wp16-co-${T}` } })).id;
  ids.invoice = (await db.invoice.create({ data: { number: `INV-WP16-${T}`, companyId: ids.company, status: "ISSUED", periodStart: dateOnly(addDays(today, -40)), periodEnd: dateOnly(addDays(today, -20)), billingName: "WP16 Co", subtotal: 100_000, total: 100_000, dueDate: dateOnly(addDays(todayKTM(), -10)) } })).id;
  ids.contract = (await db.corporateContract.create({ data: { companyId: ids.company, title: "WP16 lunch", startsOn: dateOnly(addDays(today, -100)), endsOn: dateOnly(addDays(today, 5)), status: "ACTIVE", minMealsPerMonth: 100 } })).id;

  // finance: open settlement with a variance
  ids.settlement = (await db.dailySettlement.create({ data: { date: dateOnly(addDays(today, -3)), kitchenId: kX, method: "CASH", expected: 10_000, counted: 9_500, variance: -500 } })).id;

  // integrations: failed job run, a skipped email, a gateway mismatch
  await db.jobRun.create({ data: { name: "housekeeping.plans", key: `housekeeping.plans:wp16-${T}`, status: "FAILED", error: "boom", startedAt: ago(60), finishedAt: ago(59) } });
  await db.outboundMessage.create({ data: { channel: "SMS", to: "+9779800000016", body: "x", status: "SKIPPED", createdAt: ago(60) } });
  ids.event = (await db.paymentProviderEvent.create({ data: { provider: "KHALTI", eventKey: `wp16-${T}`, outcome: "MISMATCH", payload: {}, createdAt: ago(60) } })).id;

  // security: 10 failed sign-ins in one clock hour; a super-admin grant
  const hour = new Date(Math.floor(ago(60).getTime() / 3_600_000) * 3_600_000);
  ids.hour = hour.toISOString().slice(0, 13);
  for (let i = 0; i < 10; i++) await db.loginEvent.create({ data: { email: `attacker-${T}@test.local`, method: "email", success: false, reason: "INVALID_EMAIL_OR_PASSWORD", createdAt: new Date(hour.getTime() + i * 60_000) } });
  ids.audit = (await db.auditLog.create({ data: { actorId: owner.id, action: "staff.promote", entity: "User", entityId: custId, summary: "wp16 → SUPER_ADMIN", after: { role: "SUPER_ADMIN" }, createdAt: ago(30) } })).id;
});

afterAll(async () => {
  await db.refund.deleteMany({ where: { paymentId: { in: made.payments } } });
  await db.order.deleteMany({ where: { id: { in: made.orders } } });
  await db.payment.deleteMany({ where: { id: { in: made.payments } } });
  await db.subscription.deleteMany({ where: { id: { in: made.subs } } });
  await db.stockLot.deleteMany({ where: { kitchenId: kX } });
  await db.ingredient.deleteMany({ where: { id: ids.ing } });
  await db.invoice.deleteMany({ where: { id: ids.invoice } });
  await db.company.deleteMany({ where: { id: ids.company } });
  await db.dailySettlement.deleteMany({ where: { id: ids.settlement } });
  await db.paymentProviderEvent.deleteMany({ where: { id: ids.event } });
  await db.loginEvent.deleteMany({ where: { email: `attacker-${T}@test.local` } });
  await db.kitchen.delete({ where: { id: kX } });
});

const EXPECTED = () => ({
  "unpaid-orders": `unpaid-orders:${addDays(today, 41)}`,
  "plan-renewals": `plan-renewals:${ids.renewal}`,
  "missing-selections": `missing-selections:${kX}:${addDays(today, 2)}`,
  "over-capacity": `over-capacity:${kX}:${addDays(today, 1)}`,
  inventory: `inventory:low-stock:${kX}:${ids.ing}`,
  production: `production:delayed:${ids.batch}`,
  "delayed-deliveries": `delayed-deliveries:${kX}:${today}:${slotId}`,
  "failed-deliveries": `failed-deliveries:${ids.failed}`,
  "refund-spike": `refund-spike:${today}`,
  "waste-spike": `waste-spike:${kX}:${addDays(today, -1)}`,
  "corporate-invoices": `corporate-invoices:${ids.invoice}`,
  "corporate-accounts": `corporate-accounts:contract:${ids.contract}`,
  "corporate-shortfall": `corporate-shortfall:${ids.company}:${addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)}`,
  "duplicate-payments": `duplicate-payments:${ids.dupA}:${ids.dupB}`,
  reconciliation: `reconciliation:settlement:${ids.settlement}`,
  integrations: `integrations:job:housekeeping.plans:wp16-${T}`,
  "payment-mismatch": `payment-mismatch:${ids.event}`,
  security: `security:logins:attacker-${T}@test.local:${ids.hour}`,
});

describe("detectors", () => {
  it("each detector raises an alert from its seeded condition", async () => {
    const r = await runDetectors({ now: NOW });
    expect(r.failed).toEqual([]);
    const expected = EXPECTED();
    expect(Object.keys(expected).sort()).toEqual(DETECTORS.map((d) => d.name).sort());
    for (const [source, key] of Object.entries(expected)) {
      const a = await alertByKey(key);
      expect(a, `${source} → ${key}`).not.toBeNull();
      expect(a!.source).toBe(source);
      expect(a!.status).toBe("OPEN");
    }
    // extra checks on details
    expect((await alertByKey(`inventory:expiring:${ids.lot}`))?.type).toBe("EXPIRING_STOCK");
    expect((await alertByKey(expected["delayed-deliveries"]))?.severity).toBe("CRITICAL"); // 45 min after the slot
    expect((await alertByKey(expected["corporate-accounts"]))?.severity).toBe("CRITICAL"); // ≤ 7 days
    expect((await alertByKey(`security:perm:${ids.audit}`))?.severity).toBe("CRITICAL"); // super admin granted
    expect((await alertByKey("integrations:outbox-skipped:SMS"))?.message).toMatch(/no SMS provider/);
  });

  it("re-running doesn't duplicate (same rows, count unchanged, lastSeenAt bumped)", async () => {
    const keys = Object.values(EXPECTED());
    const before = await db.alert.findMany({ where: { dedupeKey: { in: keys } }, orderBy: { dedupeKey: "asc" } });
    const total = await db.alert.count();
    const later = new Date(NOW.getTime() + 60_000);
    const r = await runDetectors({ now: later });
    expect(r.raised).toBe(0);
    expect(await db.alert.count()).toBe(total);
    const after = await db.alert.findMany({ where: { dedupeKey: { in: keys } }, orderBy: { dedupeKey: "asc" } });
    expect(after.map((a) => [a.id, a.count, a.status])).toEqual(before.map((a) => [a.id, a.count, a.status]));
    expect(after.every((a) => a.lastSeenAt.getTime() === later.getTime())).toBe(true);
  });

  it("a resolved condition alert re-opens when it recurs; a resolved event alert stays resolved", async () => {
    const cap = (await alertByKey(EXPECTED()["over-capacity"]))!;
    const failed = (await alertByKey(EXPECTED()["failed-deliveries"]))!;
    await resolveAlerts(ops, [cap.id, failed.id], "Called the customer / moved meals");
    await runDetectors({ now: NOW, only: ["over-capacity", "failed-deliveries"] });
    const reopened = (await db.alert.findUniqueOrThrow({ where: { id: cap.id } }))!;
    expect(reopened.status).toBe("OPEN");
    expect(reopened.count).toBe(2);
    expect(reopened.resolvedAt).toBeNull();
    expect(reopened.resolutionNote).toBeNull();
    expect((await db.alert.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe("RESOLVED");
  });

  it("auto-resolves when the condition clears (capacity raised), without touching event alerts", async () => {
    await db.kitchen.update({ where: { id: kX }, data: { dailyCapacity: 10 } });
    const r = await runDetectors({ now: NOW, only: ["over-capacity"] });
    expect(r.detectors[0].resolved).toBeGreaterThanOrEqual(1);
    const a = (await alertByKey(EXPECTED()["over-capacity"]))!;
    expect(a.status).toBe("RESOLVED");
    expect(a.resolvedById).toBeNull();
    expect(a.resolutionNote).toMatch(/Auto-resolved/);
    // event detectors never auto-resolve: the failed-login burst survives a run where the window has passed
    await runDetectors({ now: new Date(NOW.getTime() + 3 * 86_400_000), only: ["security"] });
    expect((await alertByKey(EXPECTED().security))!.status).toBe("OPEN");
  });

  it("a detector that throws leaves its alerts alone and is reported", async () => {
    const before = await db.alert.count({ where: { source: "inventory", status: { not: "RESOLVED" } } });
    expect(before).toBeGreaterThan(0);
    const inv = DETECTORS.find((d) => d.name === "inventory")!;
    const run = inv.run;
    inv.run = async () => {
      throw new Error("database unavailable");
    };
    try {
      const r = await runDetectors({ now: NOW, only: ["inventory"] });
      expect(r.failed).toEqual(["inventory: database unavailable"]);
    } finally {
      inv.run = run;
    }
    expect(await db.alert.count({ where: { source: "inventory", status: { not: "RESOLVED" } } })).toBe(before);
    // applyFindings itself: a new key raises, a missing one is auto-resolved
    const res = await applyFindings({ name: "wp16-probe", mode: "condition" }, [{ type: "PROBE", severity: "INFO", key: "a", message: "probe" }], NOW);
    expect(res.raised).toBe(1);
    expect((await applyFindings({ name: "wp16-probe", mode: "condition" }, [], NOW)).resolved).toBe(1);
  });
});

describe("staff actions", () => {
  it("acknowledge needs alerts.edit; ops can acknowledge (audited)", async () => {
    const a = (await alertByKey(EXPECTED()["waste-spike"]))!;
    await expect(acknowledgeAlerts(finance, [a.id])).rejects.toThrow(/permission/);
    await expect(listAlerts(support, {}, { page: 1, per: 25, sort: "lastSeenAt", dir: "desc" })).rejects.toThrow(/permission/);
    expect((await listAlerts(finance, { source: "waste-spike" }, { page: 1, per: 25, sort: "lastSeenAt", dir: "desc" })).rows.some((r) => r.id === a.id)).toBe(true);
    expect((await acknowledgeAlerts(ops, [a.id])).changed).toBe(1);
    const row = await db.alert.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.status).toBe("ACKNOWLEDGED");
    expect(row.ackById).toBe(ops.id);
    expect(await db.auditLog.count({ where: { action: "alert.acknowledge", entityId: a.id, actorId: ops.id } })).toBe(1);
    expect((await acknowledgeAlerts(ops, [a.id])).changed).toBe(0); // already acknowledged
  });

  it("assign only to staff who can see alerts; audited", async () => {
    const a = (await alertByKey(EXPECTED()["corporate-invoices"]))!;
    await expect(assignAlerts(ops, [a.id], custId)).rejects.toThrow(/staff/);
    await expect(assignAlerts(ops, [a.id], support.id)).rejects.toThrow(/staff/); // support can't see alerts
    expect((await assignAlerts(ops, [a.id], finance.id)).changed).toBe(1);
    expect((await db.alert.findUniqueOrThrow({ where: { id: a.id } })).ownerId).toBe(finance.id);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "alert.assign", entityId: a.id } });
    expect(log.after).toEqual({ ownerId: finance.id });
    expect((await listAlerts(finance, { owner: finance.id }, { page: 1, per: 25, sort: "severity", dir: "desc" })).rows.map((r) => r.id)).toContain(a.id);
  });

  it("kitchen-scoped staff see their kitchen's alerts and global ones only", async () => {
    const other = await db.kitchen.findFirstOrThrow({ where: { id: { not: kX } } });
    const st = { page: 1, per: 100, sort: "lastSeenAt" as const, dir: "desc" as const };
    const mine = await listAlerts({ ...ops, kitchenIds: [other.id] }, { source: "waste-spike" }, st);
    expect(mine.rows.find((r) => r.meta.kitchenId === kX)).toBeUndefined();
    const scoped = await listAlerts({ ...ops, kitchenIds: [kX] }, { status: "ALL" }, st);
    expect(scoped.rows.some((r) => r.meta.kitchenId === kX)).toBe(true);
    expect(scoped.rows.some((r) => r.meta.kitchenScope === "*")).toBe(true);
    expect(scoped.rows.every((r) => r.meta.kitchenId == null || r.meta.kitchenId === kX)).toBe(true);
    await expect(acknowledgeAlerts({ ...ops, kitchenIds: [other.id] }, [(await alertByKey(EXPECTED()["delayed-deliveries"]))!.id])).resolves.toEqual({ changed: 0 });
  });

  it("resolve requires a note, records who and why; re-open is audited", async () => {
    const a = (await alertByKey(EXPECTED()["payment-mismatch"]))!;
    await expect(resolveAlerts(ops, [a.id], " ")).rejects.toThrow(/note/);
    await expect(resolveAlerts(finance, [a.id], "checked")).rejects.toThrow(/permission/);
    expect((await resolveAlerts(ops, [a.id], "Khalti confirmed the amount; data fixed")).changed).toBe(1);
    const row = await db.alert.findUniqueOrThrow({ where: { id: a.id } });
    expect([row.status, row.resolvedById, row.resolutionNote]).toEqual(["RESOLVED", ops.id, "Khalti confirmed the amount; data fixed"]);
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "alert.resolve", entityId: a.id } })).reason).toBe("Khalti confirmed the amount; data fixed");
    await reopenAlert(ops, a.id, "Resolved by mistake");
    expect((await db.alert.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("OPEN");
    expect(await db.auditLog.count({ where: { action: "alert.reopen", entityId: a.id } })).toBe(1);
  });
});

describe("escalation", () => {
  it("queues exactly one email for an unacknowledged critical alert, even when run twice", async () => {
    const a = await db.alert.create({ data: { type: "TEST", severity: "CRITICAL", source: "wp16-test", dedupeKey: `wp16-test:${T}`, message: "WP16 escalation test", ownerId: ops.id, firstSeenAt: new Date(Date.now() - 2 * 3_600_000) } });
    const fresh = await db.alert.create({ data: { type: "TEST", severity: "CRITICAL", source: "wp16-test", dedupeKey: `wp16-test-fresh:${T}`, message: "WP16 too new to escalate", ownerId: ops.id } });
    const r1 = await escalateAlerts();
    const r2 = await escalateAlerts();
    expect(r1.alerts).toContain(a.id);
    expect(r1.alerts).not.toContain(fresh.id);
    expect(r2.alerts).not.toContain(a.id);
    expect(r1.emailConfigured).toBe(false); // honest: no provider in tests
    const msgs = await db.outboundMessage.findMany({ where: { dedupeKey: { startsWith: `alert-escalate:${a.id}:` } } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].to).toBe(ops.email.toLowerCase());
    expect(await db.notification.count({ where: { userId: ops.id, type: "alert.escalation", title: { contains: "WP16 escalation test" } } })).toBe(1);
    expect((await db.outboundMessage.count({ where: { dedupeKey: { startsWith: `alert-escalate:${fresh.id}:` } } }))).toBe(0);
    // acknowledged alerts are never escalated
    await acknowledgeAlerts(ops, [fresh.id]);
    await db.alert.update({ where: { id: fresh.id }, data: { firstSeenAt: new Date(Date.now() - 3 * 3_600_000) } });
    expect((await escalateAlerts()).alerts).not.toContain(fresh.id);
  });
});

describe("jobs", () => {
  it("housekeeping is idempotent per day: the second run skips every step and raises nothing new", async () => {
    const bucket = `wp16-${T}`;
    const first = await housekeepingJob({ bucket });
    expect(first.failed).toEqual([]);
    expect(first.steps.map((s) => s.step)).toEqual(JOBS.housekeeping.steps);
    expect(first.steps.every((s) => !s.skipped)).toBe(true);
    const alerts = await db.alert.count();
    const messages = await db.outboundMessage.count();
    const second = await housekeepingJob({ bucket });
    expect(second.steps.every((s) => s.skipped)).toBe(true);
    expect(await db.alert.count()).toBe(alerts);
    expect(await db.outboundMessage.count()).toBe(messages);
    expect(await db.jobRun.count({ where: { key: { endsWith: `:${bucket}` } } })).toBe(JOBS.housekeeping.steps.length);
    expect(await db.jobRun.count({ where: { key: { endsWith: `:${bucket}` }, status: "DONE" } })).toBe(JOBS.housekeeping.steps.length);
    const overview = await jobOverview({ name: "housekeeping.detectors" });
    expect(overview.latest.find((l) => l.name === "housekeeping.detectors")?.status).toBe("DONE");
    expect(overview.rows.every((r) => r.name === "housekeeping.detectors")).toBe(true);
  });

  it("manual runs need settings.edit, are audited and don't duplicate alerts; failed runs can be retried", async () => {
    await expect(runJobManually(ops, "alerts")).rejects.toThrow(/permission/);
    const r = await runJobManually(owner, "alerts");
    expect(r.failed).toEqual([]);
    const total = await db.alert.count();
    // a second manual run (next minute → new bucket) re-runs every detector and finds nothing new
    const again = await runJobManually(owner, "alerts", new Date(Date.now() + 60_000));
    const d = (again as { steps: { step: string; skipped: boolean; result?: unknown }[] }).steps.find((s) => s.step === "detectors")!;
    expect(d.skipped).toBe(false);
    expect((d.result as { raised: number; reopened: number }).raised).toBe(0);
    expect(await db.alert.count()).toBe(total);
    expect(await db.auditLog.count({ where: { action: "job.run", actorId: owner.id } })).toBeGreaterThanOrEqual(1);

    const key = `housekeeping.plan-prices:wp16-retry-${T}`;
    await db.jobRun.create({ data: { name: "housekeeping.plan-prices", key, status: "FAILED", error: "db hiccup" } });
    await expect(retryJobRun(ops, key)).rejects.toThrow(/permission/);
    expect((await retryJobRun(owner, key)).ok).toBe(true);
    expect((await db.jobRun.findUniqueOrThrow({ where: { key } })).status).toBe("DONE");
    await expect(retryJobRun(owner, key)).rejects.toThrow(/already finished/);
    expect(await db.auditLog.count({ where: { action: "job.retry", actorId: owner.id } })).toBe(1);
  });

  it("cron refuses requests without the bearer secret", async () => {
    const prev = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      expect((await cron(new Request("http://x/api/cron/daily?job=nope", { headers: { authorization: "Bearer undefined" } }))).status).toBe(401);
      process.env.CRON_SECRET = "wp16-secret";
      expect((await cron(new Request("http://x/api/cron/daily?job=nope"))).status).toBe(401);
      expect((await cron(new Request("http://x/api/cron/daily?job=nope", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
      expect((await cron(new Request("http://x/api/cron/daily?job=nope", { headers: { authorization: "Bearer wp16-secret" } }))).status).toBe(400);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});
