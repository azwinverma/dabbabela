import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Signed-in user for server actions (saveAddressAction, lockDayAction), plus a spy on the detector runner.
const state = vi.hoisted(() => ({ email: null as string | null, detectorRuns: [] as (string[] | undefined)[] }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "vitest-cleanup" }),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  const current = async () => {
    if (!state.email) return null;
    const { loadUser } = await import("../helpers");
    return loadUser(state.email);
  };
  return {
    ...real,
    getCurrentUser: current,
    // Same contract as the real gate (permission check, else redirect), without the request session.
    requirePermission: async (perm: Parameters<typeof real.requirePermission>[0]) => {
      const u = await current();
      const { can } = await import("@/lib/permissions");
      if (!u || !can(u, perm)) throw new Error(`NEXT_REDIRECT forbidden ${perm}`);
      return u;
    },
  };
});
vi.mock("@/server/alerts", async (orig) => {
  const real = await orig<typeof import("@/server/alerts")>();
  return {
    ...real,
    runDetectors: (opts: { now?: Date; only?: string[] } = {}) => {
      state.detectorRuns.push(opts.only);
      return real.runDetectors(opts);
    },
  };
});

import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate, todayKTM, weekdayOf } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { cancelOrder, defaultKitchenId, placeCartOrder } from "@/server/orders";
import { getOffersForDates } from "@/server/menu";
import { exportOrdersCsv, modificationCutoff, MODIFICATION_WINDOW_KEY, OrderForbidden, setModificationWindow, OrderAdminError } from "@/server/orders-admin";
import { COMPANY_SHARE_PREFIX } from "@/server/corporate";
import { renderTemplate, TEMPLATES } from "@/server/notify";
import { CUTOFF_DETECTORS, escalateAlerts } from "@/server/alerts";
import { addCredit } from "@/server/ledger";
import { saveAddressAction } from "@/lib/actions/account";
import { lockDayAction } from "@/app/admin/kitchen/actions";
import { dashboardDict } from "@/lib/i18n/dashboard";
import { accountDict } from "@/lib/i18n/account";
import { walletReasonLabel } from "@/app/(site)/account/_lib/wallet";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

const A = "customer.a@demo.dabbabela.local";
const T = Date.now().toString(36);
let owner: Awaited<ReturnType<typeof loadUser>>;
let support: Awaited<ReturnType<typeof loadUser>>;
let ops: Awaited<ReturnType<typeof loadUser>>;

async function book(email: string, date: string, key: string) {
  const user = await loadUser(email);
  const box = await primaryBoxOn(date);
  const r = await placeCartOrder(user, { lines: [{ kind: "box", id: box.id, date, qty: 1 }], addressId: user.addresses.find((a) => a.zoneId)!.id, method: "CASH", idempotencyKey: key });
  return { user, order: r.orders[0] };
}

/** Minimal CSV reader (quoted fields, doubled quotes) for the export assertions. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

beforeAll(async () => {
  [owner, support, ops] = await Promise.all([loadUser("owner@test.local"), loadUser("support@demo.dabbabela.local"), loadUser("ops@demo.dabbabela.local")]);
});

afterEach(() => {
  vi.useRealTimers();
  state.email = null;
});

describe("1. customer cancel uses the per-day cut-off", () => {
  it("refuses after the menu day's own cut-off, allows it once the override is gone", async () => {
    const settings = await getSettings();
    const date = serviceDay(3, 0);
    const { user, order } = await book(A, date, `cleanup-cancel-${T}`);
    const offer = (await getOffersForDates([date], order.kitchenId)).get(date)!;
    const day = await db.menuDay.findUniqueOrThrow({ where: { menuId_day: { menuId: offer.menuId!, day: weekdayOf(date) } } });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${date}T02:15:00Z`)); // 08:00 Kathmandu on the delivery day
    try {
      await db.menuDay.update({ where: { id: day.id }, data: { cutoffOverride: "07:30" } });
      await expect(cancelOrder(order.id, { id: user.id, isStaff: false }, { reason: "test", userId: user.id })).rejects.toThrow(/closed at 07:30/);
      expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).not.toBe("CANCELLED");
      await db.menuDay.update({ where: { id: day.id }, data: { cutoffOverride: null } });
      if (settings.orderCutoff > "08:00") {
        await cancelOrder(order.id, { id: user.id, isStaff: false }, { reason: "test", userId: user.id });
        expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
      }
    } finally {
      vi.useRealTimers();
      await db.menuDay.update({ where: { id: day.id }, data: { cutoffOverride: day.cutoffOverride } });
    }
  });
});

describe("2. saveAddressAction validates the map pin", () => {
  const base = () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ label: `Cleanup ${T}`, type: "OFFICE", recipientName: "Cleanup Tester", phone: "9800000001", line1: "Shantinagar Marg", area: "New Baneshwor", city: "Kathmandu" })) fd.set(k, v);
    return fd;
  };

  it("refuses half a pin and pins outside Nepal; saves both-or-neither", async () => {
    state.email = A;
    const half = base();
    half.set("lat", "27.7");
    const r1 = await saveAddressAction({ ok: false }, half);
    expect(r1.ok).toBe(false);
    expect(r1.errors?.lat).toMatch(/both latitude and longitude/);

    const outside = base();
    outside.set("lat", "40.1");
    outside.set("lng", "85.3");
    const r2 = await saveAddressAction({ ok: false }, outside);
    expect(r2.ok).toBe(false);
    expect(r2.errors?.lat).toMatch(/outside Nepal/);

    const ok = base();
    ok.set("lat", "27.7172");
    ok.set("lng", "85.324");
    const r3 = await saveAddressAction({ ok: false }, ok);
    expect(r3.ok).toBe(true);
    const saved = await db.address.findUniqueOrThrow({ where: { id: r3.addressId! } });
    expect([saved.lat, saved.lng]).toEqual([27.7172, 85.324]);

    const none = base();
    none.set("id", saved.id);
    none.set("lat", "");
    none.set("lng", "");
    const r4 = await saveAddressAction({ ok: false }, none);
    expect(r4.ok).toBe(true);
    const cleared = await db.address.findUniqueOrThrow({ where: { id: saved.id } });
    expect([cleared.lat, cleared.lng]).toEqual([null, null]);
    expect(await db.address.count({ where: { label: `Cleanup ${T}` } })).toBe(1);
  });
});

describe("3. orders CSV export carries adjustments", () => {
  it("splits customer and company OrderAdjustment rows into their own columns", async () => {
    const date = serviceDay(4, 0);
    const { order } = await book(A, date, `cleanup-export-${T}`);
    await db.orderAdjustment.createMany({
      data: [
        { orderId: order.id, amount: 5000, reason: "Extra dabba added by staff", actorId: owner.id },
        { orderId: order.id, amount: -1500, reason: "Goodwill", actorId: owner.id },
        { orderId: order.id, amount: 2000, reason: `${COMPANY_SHARE_PREFIX} — edit`, actorId: owner.id },
      ],
    });
    const out = await exportOrdersCsv(owner, { from: date, to: date, q: order.code });
    const rows = parseCsv(out.body.replace(/^﻿/, ""));
    const header = rows[0];
    const ci = header.indexOf("Customer adjustments");
    const ki = header.indexOf("Company adjustments");
    expect(ci).toBeGreaterThan(header.indexOf("Customer share"));
    expect(ki).toBe(ci + 1);
    const line = rows.find((r) => r[0] === String(order.number))!;
    expect(line).toBeTruthy();
    expect(line.length).toBe(header.length);
    expect([line[ci], line[ki]]).toEqual(["35.00", "20.00"]);
  });
});

describe("4. alert.escalation template", () => {
  it("is a notification template, and escalation renders it (with a staff override) keeping one email per occurrence", async () => {
    expect(TEMPLATES["alert.escalation"].topic).toBe("SECURITY");
    const r = await renderTemplate("alert.escalation", "EMAIL", { severity: "CRITICAL", message: "Disk <full>", minutes: 45, source: "test" }, { link: "/admin/alerts" });
    expect(r!.subject).toBe("[CRITICAL] Disk <full>");
    expect(r!.body).toContain("Disk &lt;full&gt;");
    expect(r!.body).toContain("45 minutes");

    const tpl = await db.notificationTemplate.create({ data: { key: "alert.escalation", channel: "EMAIL", locale: "en", subject: "ESCALATED {{severity}}: {{message}}", body: "<p>{{message}} — {{minutes}} min</p>" } });
    try {
      const a = await db.alert.create({ data: { type: "TEST", severity: "CRITICAL", source: "cleanup-test", dedupeKey: `cleanup-esc:${T}`, message: `Cleanup escalation ${T}`, ownerId: ops.id, firstSeenAt: new Date(Date.now() - 2 * 3_600_000) } });
      const r1 = await escalateAlerts();
      const r2 = await escalateAlerts();
      expect(r1.alerts).toContain(a.id);
      expect(r2.alerts).not.toContain(a.id);
      const msgs = await db.outboundMessage.findMany({ where: { dedupeKey: { startsWith: `alert-escalate:${a.id}:` } } });
      expect(msgs).toHaveLength(1);
      expect(msgs[0].templateKey).toBe("alert.escalation");
      expect(msgs[0].subject).toBe(`ESCALATED CRITICAL: Cleanup escalation ${T}`);
      expect(msgs[0].body).toContain(`Cleanup escalation ${T} — `);
      const n = await db.notification.findFirstOrThrow({ where: { userId: ops.id, type: "alert.escalation", title: { contains: `Cleanup escalation ${T}` } } });
      expect(n.title).toBe(`[CRITICAL] Cleanup escalation ${T}`);
      expect(n.body).toMatch(/^Open for \d+ min, not acknowledged\.$/);
    } finally {
      await db.notificationTemplate.delete({ where: { id: tpl.id } });
    }
  });
});

describe("5. manual day lock runs the cut-off detectors", () => {
  it("lockDayAction locks, audits and runs the same detectors as the cut-off job", async () => {
    const kitchenId = (await defaultKitchenId())!;
    const date = addDays(todayKTM(), -400); // far past: never a day another test books
    state.email = owner.email;
    state.detectorRuns = [];
    const fd = new FormData();
    fd.set("kitchenId", kitchenId);
    fd.set("date", date);
    try {
      const r = await lockDayAction({ ok: false }, fd);
      expect(r.ok).toBe(true);
      expect(await db.dayLock.count({ where: { kitchenId, date: dateOnly(date) } })).toBe(1);
      expect(state.detectorRuns).toEqual([CUTOFF_DETECTORS]);
      expect(CUTOFF_DETECTORS).toEqual(expect.arrayContaining(["over-capacity", "production", "missing-selections", "unpaid-orders"]));
      expect(await db.auditLog.count({ where: { action: "kitchen.lock_day", entityId: `${kitchenId}:${date}` } })).toBe(1);
    } finally {
      await db.dayLock.deleteMany({ where: { kitchenId, date: dateOnly(date) } });
    }
  });
});

describe("7. staff modification window setting", () => {
  afterAll(async () => {
    await db.setting.deleteMany({ where: { key: MODIFICATION_WINDOW_KEY } });
  });

  it("needs settings.edit, validates HH:MM, saves/clears and audits only real changes", async () => {
    expect(can(support, "settings.edit")).toBe(false);
    await expect(setModificationWindow(support, "10:30")).rejects.toBeInstanceOf(OrderForbidden);
    await expect(setModificationWindow(owner, "25:00")).rejects.toBeInstanceOf(OrderAdminError);
    await expect(setModificationWindow(owner, "9:30")).rejects.toThrow(/HH:MM/);

    const audits = () => db.auditLog.count({ where: { action: "settings.modification_window", actorId: owner.id } });
    const before = await audits();
    expect((await setModificationWindow(owner, "10:45")).changed).toBe(true);
    expect(await modificationCutoff()).toBe("10:45");
    expect((await db.setting.findUniqueOrThrow({ where: { key: MODIFICATION_WINDOW_KEY } })).value).toEqual({ cutoff: "10:45" });
    expect((await setModificationWindow(owner, "10:45")).changed).toBe(false);
    expect(await audits()).toBe(before + 1);

    expect((await setModificationWindow(owner, "")).changed).toBe(true);
    expect(await modificationCutoff()).toBeNull();
    expect(await db.setting.count({ where: { key: MODIFICATION_WINDOW_KEY } })).toBe(0);
    expect(await audits()).toBe(before + 2);
  });
});

describe("8. referral ledger reason, wallet label and nav", () => {
  it("REFERRAL is a ledger reason with EN/NE labels; account nav has Refer a friend", async () => {
    const user = await loadUser(A);
    const row = await db.$transaction((tx) => addCredit(tx, { userId: user.id, amount: 100, reason: "REFERRAL", note: `cleanup ${T}` }));
    expect(row.reason).toBe("REFERRAL");
    await db.creditLedger.delete({ where: { id: row.id } });

    expect(walletReasonLabel("REFERRAL", dashboardDict("en"))).toBe("Referral reward");
    const ne = walletReasonLabel("REFERRAL", dashboardDict("ne"));
    expect(ne).not.toBe("Referral reward");
    expect(ne.length).toBeGreaterThan(0);
    expect(walletReasonLabel("REFUND", dashboardDict("en"))).toBe("Refund");
    expect(walletReasonLabel("SOMETHING_NEW", dashboardDict("en"))).toBe("SOMETHING_NEW");

    expect(accountDict("en").nav.referrals).toBe("Refer a friend");
    expect(accountDict("ne").nav.referrals).toBeTruthy();
    expect(accountDict("ne").nav.referrals).not.toBe("Refer a friend");
    expect(isoDate(dateOnly(todayKTM()))).toBe(todayKTM());
  });
});
