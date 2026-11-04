import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, dateOnly, todayKTM } from "@/lib/dates";
import { placeCartOrder } from "@/server/orders";
import { generateInvoice, issueInvoice, recordInvoicePayment, voidInvoice, createCreditNote, shareTax, ageing } from "@/server/invoices";
import { memberOf, roster, teamReport, updateMember, teamInvoice, parseRosterCsv, TeamError } from "@/server/team";
import { anonymiseUser, exportUserData } from "@/server/privacy";
import { csv } from "@/server/reports";
import { getClosures } from "@/server/calendar";
import { loadUser, primaryBoxOn, serviceDay } from "../helpers";

const A = "customer.a@demo.dabbabela.local";
const D = "customer.d@demo.dabbabela.local";
let owner: { id: string };
let companyId: string;
const past = addDays(todayKTM(), -3);

async function companyOrder(email: string, n: number) {
  const user = await loadUser(email);
  let d = serviceDay(18, n % 10);
  for (let k = 1; (await getClosures(d, d)).size; k++) d = serviceDay(18, (n % 10) + k);
  const box = await primaryBoxOn(d);
  const r = await placeCartOrder(user, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: user.addresses[0].id, method: "CASH" });
  // Move it into the past so it's billable (invoices only cover meals already due).
  await db.order.update({ where: { id: r.orders[0].id }, data: { deliveryDate: dateOnly(past), status: "DELIVERED" } });
  return r.orders[0];
}

beforeAll(async () => {
  owner = await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });
  companyId = (await db.company.findUniqueOrThrow({ where: { slug: "demo-company" } })).id;
});

describe("company invoices", () => {
  it("bills exactly the employer share once, with proportional VAT", async () => {
    const o1 = await companyOrder(A, 10);
    const o2 = await companyOrder(D, 11);
    const start = addDays(past, -1);
    const inv = await generateInvoice({ companyId, periodStart: start, periodEnd: todayKTM(), actorId: owner.id });
    const linked = await db.order.findMany({ where: { invoiceId: inv.id } });
    expect(linked.map((o) => o.id).sort()).toEqual([o1.id, o2.id].sort());
    expect(inv.total).toBe(linked.reduce((a, o) => a + o.companyShare, 0));
    expect(inv.tax).toBe(linked.reduce((a, o) => a + shareTax(o), 0));
    expect(inv.subtotal + inv.tax).toBe(inv.total);
    const lines = await db.invoiceLine.findMany({ where: { invoiceId: inv.id } });
    expect(lines.reduce((a, l) => a + l.amount, 0)).toBe(inv.total);
    // idempotent
    await expect(generateInvoice({ companyId, periodStart: start, periodEnd: todayKTM(), actorId: owner.id })).rejects.toThrow(/Nothing to invoice/);
    expect(inv.number).toMatch(/^INV-\d{4}-\d{4}$/);
  });

  it("computes VAT share proportionally", () => {
    expect(shareTax({ tax: 2301, total: 20000, companyShare: 10000 })).toBe(1151);
    expect(shareTax({ tax: 0, total: 20000, companyShare: 10000 })).toBe(0);
  });

  it("void unlinks orders so they can be billed again", async () => {
    const o = await companyOrder(A, 12);
    const inv = await generateInvoice({ companyId, periodStart: past, periodEnd: past, actorId: owner.id });
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).invoiceId).toBe(inv.id);
    await voidInvoice(inv.id, owner.id, "Wrong period");
    expect((await db.order.findUniqueOrThrow({ where: { id: o.id } })).invoiceId).toBeNull();
    const again = await generateInvoice({ companyId, periodStart: past, periodEnd: past, actorId: owner.id });
    expect(again.total).toBe(inv.total);
    expect(again.number).not.toBe(inv.number);
  });

  it("records payments, refuses overpayment and settles with a credit note", async () => {
    await companyOrder(D, 13);
    const inv = await generateInvoice({ companyId, periodStart: past, periodEnd: past, actorId: owner.id });
    await expect(recordInvoicePayment(inv.id, owner.id, 100, "chq 1")).rejects.toThrow(/Issue/);
    await issueInvoice(inv.id, owner.id);
    await expect(recordInvoicePayment(inv.id, owner.id, inv.total + 1, "x")).rejects.toThrow(/outstanding/);
    const half = Math.floor(inv.total / 2);
    const p = await recordInvoicePayment(inv.id, owner.id, half, "NIBL-123");
    expect(p.status).toBe("PARTIALLY_PAID");
    const ag = await ageing(companyId);
    expect(ag.rows.find((r) => r.id === inv.id)?.outstanding).toBe(inv.total - half);
    const cn = await createCreditNote(inv.id, owner.id, inv.total - half, "Two cold meals");
    expect(cn.kind).toBe("CREDIT_NOTE");
    expect(cn.relatedId).toBe(inv.id);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    await expect(createCreditNote(inv.id, owner.id, inv.total, "again")).rejects.toThrow(/At most/);
    await expect(voidInvoice(inv.id, owner.id, "x")).rejects.toThrow(/credit note/);
  });
});

describe("corporate portal tenancy", () => {
  it("never shows one company's members, orders or invoices to another company", async () => {
    const other = await db.company.create({ data: { name: "Other Co (test)", slug: `other-${Date.now()}` } });
    const memberA = await db.companyMember.findFirstOrThrow({ where: { companyId } });
    await expect(memberOf(other.id, memberA.id)).rejects.toBeInstanceOf(TeamError);
    await expect(updateMember(other.id, memberA.id, owner.id, { status: "REMOVED" })).rejects.toBeInstanceOf(TeamError);
    expect((await roster(other.id)).length).toBe(0);
    expect((await teamReport(other.id, addDays(todayKTM(), -30), addDays(todayKTM(), 30))).length).toBe(0);
    const inv = await db.invoice.findFirstOrThrow({ where: { companyId } });
    await expect(teamInvoice(other.id, inv.id)).rejects.toBeInstanceOf(TeamError);
    // and the member is still active in their own company
    expect((await memberOf(companyId, memberA.id)).status).toBe("ACTIVE");
  });

  it("won't let the last admin remove themselves", async () => {
    const admin = await db.companyMember.findFirstOrThrow({ where: { companyId, role: "ADMIN" } });
    await expect(updateMember(companyId, admin.id, admin.userId, { status: "REMOVED" })).rejects.toThrow(/only admin/);
  });

  it("validates bulk CSV rows before anything is saved", () => {
    const rows = parseRosterCsv("name,email,department,cost centre\nAsha,asha@example.com,Ops,CC1\n,bad,Ops,\nAsha 2,ASHA@example.com,,\n\"Rai, Bikash\",bikash@example.com,\"Sales, North\",CC2");
    expect(rows.map((r) => r.error)).toEqual([null, "Name missing", "Duplicate email in file", null]);
    expect(rows[3].name).toBe("Rai, Bikash");
    expect(rows[3].department).toBe("Sales, North");
  });
});

describe("privacy", () => {
  it("anonymises personal data but keeps orders and payments", async () => {
    const u = await db.user.create({ data: { name: "Privacy Test", email: `privacy-${Date.now()}@example.com`, phoneNumber: `+97798${String(Date.now()).slice(-8)}` } });
    const zone = await db.deliveryZone.findFirstOrThrow({ where: { areas: { has: "New Baneshwor" } } });
    await db.address.create({ data: { userId: u.id, label: "Office", recipientName: "Privacy Test", phone: "+9779800000099", line1: "Secret street 5", area: "New Baneshwor", zoneId: zone.id, isDefault: true } });
    const user = await loadUser(u.email);
    // A far-off day nobody else's tests use, skipping any closure other suites may have added.
    let d = serviceDay(24, 0);
    for (let n = 1; (await getClosures(d, d)).size; n++) d = serviceDay(24, n);
    const box = await primaryBoxOn(d);
    const r = await placeCartOrder(user, { lines: [{ kind: "box", id: box.id, date: d, qty: 1 }], addressId: user.addresses[0].id, method: "CASH" });
    const exported = await exportUserData(u.id);
    expect(exported.profile.email).toBe(u.email);
    expect(exported.orders.length).toBe(1);
    await anonymiseUser(u.id, owner.id, "Customer request");
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.name).toBe("Deleted customer");
    expect(after.email).toBe(`deleted+${u.id}@invalid`);
    expect(after.phoneNumber).toBeNull();
    expect(after.deletedAt).not.toBeNull();
    const order = await db.order.findUniqueOrThrow({ where: { id: r.orders[0].id } });
    expect(order.total).toBe(r.orders[0].total);
    expect(order.contactPhone).toBe("");
    expect(order.addressLine).toBe("Removed");
    expect(await db.payment.count({ where: { userId: u.id } })).toBe(1);
    expect(await db.address.count({ where: { userId: u.id, line1: "Secret street 5" } })).toBe(0);
  });
});

describe("csv", () => {
  it("escapes quotes and neutralises formula injection", () => {
    const out = csv([["a", 'b "q"', "=HYPERLINK(1)", "x,y"]]);
    expect(out).toBe('﻿a,"b ""q""",\'=HYPERLINK(1),"x,y"');
  });
});
