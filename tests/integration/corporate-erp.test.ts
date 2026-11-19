import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, dateOnly, isoDate, todayKTM, weekdayOf } from "@/lib/dates";
import { defaultKitchenId, placeCartOrder, quoteCart } from "@/server/orders";
import { getClosures, getLockedDates } from "@/server/calendar";
import { getOffersForDates } from "@/server/menu";
import {
  activateContract,
  assertCompanyAccess,
  budgetStatus,
  companyOutstanding,
  companySpecFor,
  CorporateError,
  CorporateForbidden,
  createContract,
  creditTermsOn,
  filterCompanyMenu,
  generateCompanyInvoice,
  issueCompanyInvoice,
  minCommitment,
  newContractVersion,
  setCompanyMenu,
  updateContract,
  upsertDepartmentBudget,
} from "@/server/corporate";
import {
  createInvite,
  memberOf,
  placeTeamOrder,
  revokeInvite,
  setTeamBudget,
  setTeamDeliveryInstructions,
  teamBudgets,
  teamDeliveries,
  teamInvoice,
  teamMenu,
  teamPayments,
  teamReport,
  updateMember,
  TeamError,
} from "@/server/team";
import { loadUser } from "../helpers";

const tag = Date.now().toString(36);
let owner: Awaited<ReturnType<typeof loadUser>>;
let chef: Awaited<ReturnType<typeof loadUser>>;

type Fx = { company: string; admin: string; adminMember: string; members: Record<string, { member: string; user: string; email: string }> };
const A = { members: {} } as Fx;
const B = { members: {} } as Fx;

// Unlocked, open service days well ahead (cut-offs never interfere), distinct per test.
let cursor = 0;
async function nextDay() {
  const kitchenId = (await defaultKitchenId())!;
  for (;;) {
    const d = addDays(todayKTM(), 9 + cursor++);
    if (weekdayOf(d) === "SAT") continue;
    const [closed, locked] = await Promise.all([getClosures(d, d, kitchenId), getLockedDates(d, d, kitchenId)]);
    if (closed.size || locked.size) continue;
    const offer = (await getOffersForDates([d])).get(d);
    if (!offer || offer.closed || !offer.items.some((i) => !i.soldOut)) continue;
    return d;
  }
}
async function boxOn(d: string, n = 0) {
  const offer = (await getOffersForDates([d])).get(d)!;
  return offer.items.filter((i) => !i.soldOut)[n] ?? offer.items[0];
}

async function makeCompany(fx: Fx, name: string, members: { key: string; department?: string; eligibleDays?: ("SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT")[]; mealEligible?: boolean }[]) {
  const zone = await db.deliveryZone.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
  const c = await db.company.create({ data: { name: `${name} ${tag}`, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${tag}`, billingMode: "COMPANY_PAID", subsidyPct: 100, freeDelivery: true, requireApproval: false, zoneId: zone.id } });
  fx.company = c.id;
  const loc = await db.officeLocation.create({ data: { companyId: c.id, name: `${name} HQ`, line1: `${name} tower`, area: "New Baneshwor", zoneId: zone.id, receiverName: "Reception" } });
  const admin = await db.user.create({ data: { name: `${name} Admin`, email: `wp12-${name.toLowerCase().replace(/\W+/g, "")}-admin-${tag}@test.local` } });
  const am = await db.companyMember.create({ data: { companyId: c.id, userId: admin.id, role: "ADMIN", status: "ACTIVE", officeLocationId: loc.id } });
  fx.admin = admin.id;
  fx.adminMember = am.id;
  for (const m of members) {
    const email = `wp12-${name.toLowerCase().replace(/\W+/g, "")}-${m.key}-${tag}@test.local`;
    const u = await db.user.create({ data: { name: `${name} ${m.key}`, email } });
    await db.address.create({ data: { userId: u.id, label: "Office", type: "OFFICE", recipientName: u.name, phone: "9800000000", line1: `${name} tower`, area: "New Baneshwor", zoneId: zone.id, isDefault: true } });
    const cm = await db.companyMember.create({ data: { companyId: c.id, userId: u.id, status: "ACTIVE", officeLocationId: loc.id, department: m.department ?? null, eligibleDays: m.eligibleDays ?? [], mealEligible: m.mealEligible ?? true } });
    fx.members[m.key] = { member: cm.id, user: u.id, email };
  }
}

let day1 = "";
let v2Id = "";
let negotiated = 0;

beforeAll(async () => {
  [owner, chef] = await Promise.all([loadUser("owner@test.local"), loadUser("chef@demo.dabbabela.local")]);
  day1 = await nextDay();
  const otherDay = (["SUN", "MON", "TUE", "WED", "THU", "FRI"] as const).find((w) => w !== weekdayOf(day1))!;
  await makeCompany(A, "WP12 Alpha", [
    { key: "sales1", department: "Sales" },
    { key: "sales2", department: "Sales" },
    { key: "ops", department: "Ops" },
    { key: "partTime", department: "Ops", eligibleDays: [otherDay] },
    { key: "intern", department: "Ops", mealEligible: false },
  ]);
  await makeCompany(B, "WP12 Beta", [{ key: "eng", department: "Engineering" }]);
});

describe("contracts", () => {
  it("versions supersede each other; the negotiated per-dabba price is used at checkout", async () => {
    const item = await boxOn(day1);
    const box = item.box;
    const today = todayKTM();
    const v1 = await createContract(owner, A.company, { title: "Lunch agreement", startsOn: today, boxPrices: { [box.id]: Math.max(0, item.price - 500) }, creditTermsDays: 20 });
    expect(v1.version).toBe(1);
    expect(v1.status).toBe("DRAFT");
    await activateContract(owner, v1.id);
    expect((await db.company.findUniqueOrThrow({ where: { id: A.company } })).invoiceTermsDays).toBe(20); // in force today → company terms

    const member = await loadUser(A.members.ops.email);
    let q = await quoteCart(member, { lines: [{ kind: "box", id: box.id, date: day1, qty: 1 }], addressId: member.addresses[0].id });
    expect(q.lines[0].unitPrice).toBe(item.price - 500);

    // Active contracts change only through a new version.
    await expect(updateContract(owner, v1.id, { title: "x", startsOn: today })).rejects.toThrow(/new version/);
    negotiated = Math.max(0, item.price - 1000);
    const v2 = await newContractVersion(owner, v1.id, { title: "Lunch agreement (renewed)", startsOn: day1, boxPrices: { [box.id]: negotiated }, creditTermsDays: 30, minMealsPerMonth: 50 });
    v2Id = v2.id;
    expect(v2.version).toBe(2);
    expect(v2.supersedesId).toBe(v1.id);
    // A second, parallel contract can't overlap the active one.
    const rogue = await createContract(owner, A.company, { title: "Side deal", startsOn: day1 });
    await expect(activateContract(owner, rogue.id)).rejects.toThrow(/active for those dates/);
    await db.corporateContract.delete({ where: { id: rogue.id } });

    await activateContract(owner, v2.id);
    const old = await db.corporateContract.findUniqueOrThrow({ where: { id: v1.id } });
    expect(isoDate(old.endsOn!)).toBe(addDays(day1, -1)); // ends the day before v2 starts
    expect(old.status).toBe("ACTIVE"); // still in force until then
    q = await quoteCart(member, { lines: [{ kind: "box", id: box.id, date: day1, qty: 1 }], addressId: member.addresses[0].id });
    expect(q.lines[0].unitPrice).toBe(negotiated);
    expect(await creditTermsOn(A.company, day1)).toBe(30);
    expect(await creditTermsOn(A.company, today)).toBe(20);

    const r = await placeCartOrder(member, { lines: [{ kind: "box", id: box.id, date: day1, qty: 1 }], addressId: member.addresses[0].id, method: "CASH" });
    const o = await db.order.findUniqueOrThrow({ where: { id: r.orders[0].id } });
    expect(o.subtotal).toBe(negotiated);
    expect(o.companyShare).toBe(o.total); // company pays

    const audits = await db.auditLog.findMany({ where: { entityId: { in: [v1.id, v2.id] } }, select: { action: true } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["contract.create", "contract.activate", "contract.version"]));
  });

  it("shows the minimum-commitment shortfall for the month", async () => {
    const ym = day1.slice(0, 7);
    const before = await minCommitment(A.company, ym);
    expect(before.minMealsPerMonth).toBe(50);
    expect(before.contractId).toBe(v2Id);
    expect(before.shortfall).toBe(Math.max(0, 50 - before.meals));
    const member = await loadUser(A.members.ops.email);
    const item = await boxOn(day1);
    await placeCartOrder(member, { lines: [{ kind: "box", id: item.box.id, date: day1, qty: 2 }], addressId: member.addresses[0].id, method: "CASH" });
    const after = await minCommitment(A.company, ym);
    expect(after.meals).toBe(before.meals + 2);
    expect(after.shortfall).toBe(Math.max(0, before.shortfall - 2));
  });

  it("refuses contract changes without corporate.edit", async () => {
    await expect(createContract(chef, A.company, { title: "No", startsOn: todayKTM() })).rejects.toBeInstanceOf(CorporateForbidden);
    await expect(activateContract(chef, v2Id)).rejects.toBeInstanceOf(CorporateError);
  });
});

describe("department budgets", () => {
  it("refuses a team order beyond the budget, or caps the company share when the admin lets the employee pay", async () => {
    const d = await nextDay();
    const ym = d.slice(0, 7);
    const item = await boxOn(d);
    await setTeamBudget(A.company, A.admin, { department: "Sales", month: ym, amount: 5000 });
    expect(await db.auditLog.count({ where: { action: "company.budget.set", entityId: A.company } })).toBeGreaterThan(0);

    const refused = await placeTeamOrder(A.company, { id: A.admin }, { memberIds: [A.members.sales1.member], date: d, boxId: item.box.id });
    expect(refused[0].ok).toBe(false);
    expect(refused[0].message).toMatch(/Over budget/);

    const allowed = await placeTeamOrder(A.company, { id: A.admin }, { memberIds: [A.members.sales1.member], date: d, boxId: item.box.id, overBudget: "employee-pays" });
    expect(allowed[0].ok).toBe(true);
    expect(allowed[0].warning).toMatch(/paid by the employee/);
    const o = await db.order.findFirstOrThrow({ where: { userId: A.members.sales1.user, deliveryDate: dateOnly(d) } });
    expect(o.companyShare).toBe(5000);
    expect(o.customerShare).toBe(o.total - 5000);

    const sales = (await budgetStatus(A.company, ym)).find((b) => b.department === "Sales")!;
    expect(sales.spent).toBe(5000);
    expect(sales.remaining).toBe(0);

    // Employee self-ordering under company billing is capped by the same budget.
    const s2 = await loadUser(A.members.sales2.email);
    const q = await quoteCart(s2, { lines: [{ kind: "box", id: item.box.id, date: d, qty: 1 }], addressId: s2.addresses[0].id });
    expect(q.companyShare).toBe(0);
    expect(q.customerShare).toBe(q.total);
    // Other departments are unaffected.
    const ops = await loadUser(A.members.ops.email);
    const q2 = await quoteCart(ops, { lines: [{ kind: "box", id: item.box.id, date: d, qty: 1 }], addressId: ops.addresses[0].id });
    expect(q2.companyShare).toBe(q2.total);

    await expect(upsertDepartmentBudget(A.company, A.admin, { department: "Sales", month: "2026-13", amount: 1 })).rejects.toThrow(/month/);
  });
});

describe("eligibility", () => {
  it("refuses ineligible members in team orders and stops company billing for their own orders", async () => {
    const d = day1;
    const item = await boxOn(d);
    const r = await placeTeamOrder(A.company, { id: A.admin }, { memberIds: [A.members.partTime.member, A.members.intern.member], date: d, boxId: item.box.id });
    expect(r.every((x) => !x.ok)).toBe(true);
    expect(r.map((x) => x.message).join(" ")).toMatch(/Not eligible/);
    expect(await db.order.count({ where: { userId: { in: [A.members.partTime.user, A.members.intern.user] } } })).toBe(0);

    const pt = await loadUser(A.members.partTime.email);
    const q = await quoteCart(pt, { lines: [{ kind: "box", id: item.box.id, date: d, qty: 1 }], addressId: pt.addresses[0].id });
    expect(q.ok).toBe(true);
    expect(q.companyShare).toBe(0);
    expect(q.customerShare).toBe(q.total);
    const company = await db.company.findUniqueOrThrow({ where: { id: A.company } });
    expect((await companySpecFor(A.members.intern.user, company, [d]))?.allowanceRemaining).toBe(0);

    // Eligibility is edited by the company admin (audited).
    await updateMember(A.company, A.members.partTime.member, A.admin, { eligibleDays: [weekdayOf(d)] });
    const ok = await placeTeamOrder(A.company, { id: A.admin }, { memberIds: [A.members.partTime.member], date: d, boxId: item.box.id });
    expect(ok[0].ok).toBe(true);
    expect(await db.auditLog.count({ where: { action: "team.member.update", entityId: A.members.partTime.member } })).toBe(1);
  });
});

describe("company menu", () => {
  it("limits which dabbas the company can order; empty list = full menu", async () => {
    const d = day1;
    const item = await boxOn(d);
    const other = await db.lunchBox.findFirstOrThrow({ where: { isActive: true, id: { not: item.box.id } } });
    await setCompanyMenu(owner, A.company, [other.id]);
    const menu = await teamMenu(A.company, d);
    expect(menu.limited).toBe(true);
    expect(menu.items.some((i) => i.box.id === item.box.id)).toBe(false);
    await expect(placeTeamOrder(A.company, { id: A.admin }, { memberIds: [A.members.ops.member], date: d, boxId: item.box.id })).rejects.toThrow(/company menu/);
    expect(filterCompanyMenu([{ box: { id: "a" } }, { box: { id: "b" } }], new Set(["b"]))).toEqual([{ box: { id: "b" } }]);
    expect(filterCompanyMenu([{ box: { id: "a" } }], null)).toHaveLength(1);
    await setCompanyMenu(owner, A.company, []);
    const full = await teamMenu(A.company, d);
    expect(full.limited).toBe(false);
    expect(full.items.find((i) => i.box.id === item.box.id)?.price).toBe(negotiated); // negotiated price shown to the admin
    expect(await db.auditLog.count({ where: { action: "company.menu", entityId: A.company } })).toBe(2);
    await expect(setCompanyMenu(chef, A.company, [])).rejects.toBeInstanceOf(CorporateForbidden);
  });
});

describe("company invoices", () => {
  it("bills the company share plus company adjustments exactly once, with the due date from the contract's credit terms", async () => {
    const past = addDays(todayKTM(), -4);
    const member = await loadUser(A.members.ops.email);
    const d = await nextDay();
    const item = await boxOn(d);
    const r = await placeCartOrder(member, { lines: [{ kind: "box", id: item.box.id, date: d, qty: 1 }], addressId: member.addresses[0].id, method: "CASH" });
    const order = await db.order.update({ where: { id: r.orders[0].id }, data: { deliveryDate: dateOnly(past), status: "DELIVERED" } });
    const adj1 = await db.orderAdjustment.create({ data: { orderId: order.id, amount: 1500, reason: "Company share: extra raita", actorId: owner.id } });
    await db.orderAdjustment.create({ data: { orderId: order.id, amount: -300, reason: "Customer credit: late", actorId: owner.id } }); // customer part — never on the company invoice

    const before = await companyOutstanding(A.company);
    const inv = await generateCompanyInvoice(owner, { companyId: A.company, periodStart: past, periodEnd: past });
    const lines = await db.invoiceLine.findMany({ where: { invoiceId: inv.id } });
    expect(lines.some((l) => l.description.includes(`[adj:${adj1.id}]`) && l.amount === 1500)).toBe(true);
    expect(lines.some((l) => l.orderId === order.id && l.amount === order.companyShare)).toBe(true);
    expect(inv.total).toBe(order.companyShare + 1500);
    expect(isoDate(inv.dueDate!)).toBe(addDays(past, await creditTermsOn(A.company, past)));

    const issued = await issueCompanyInvoice(owner, inv.id);
    expect(isoDate(issued.dueDate!)).toBe(addDays(todayKTM(), 20)); // v1 (20 days) is in force today
    expect(issued.status).toBe("ISSUED");
    expect(await companyOutstanding(A.company)).toBe(before); // moved from unbilled to invoiced, nothing double counted

    // A later company-share adjustment on the billed order goes on the next invoice — once.
    await db.orderAdjustment.create({ data: { orderId: order.id, amount: 700, reason: "Company share: added a dabba", actorId: owner.id } });
    expect(await companyOutstanding(A.company)).toBe(before + 700);
    const next = await generateCompanyInvoice(owner, { companyId: A.company, periodStart: past, periodEnd: past });
    expect(next.total).toBe(700);
    await expect(generateCompanyInvoice(owner, { companyId: A.company, periodStart: past, periodEnd: past })).rejects.toThrow(/Nothing to invoice/);
    await expect(generateCompanyInvoice(chef, { companyId: A.company, periodStart: past, periodEnd: past })).rejects.toBeInstanceOf(CorporateForbidden);
  });
});

describe("organisation isolation", () => {
  it("a company admin of A can never read or act on company B", async () => {
    const bMember = B.members.eng;
    const d = day1;
    const item = await boxOn(d);
    // B has an order, an invoice, an invite and a budget.
    const eng = await loadUser(bMember.email);
    const r = await placeCartOrder(eng, { lines: [{ kind: "box", id: item.box.id, date: d, qty: 1 }], addressId: eng.addresses[0].id, method: "CASH" });
    const bInvoice = await db.invoice.create({ data: { number: `WP12-B-${tag}`, companyId: B.company, periodStart: dateOnly(d), periodEnd: dateOnly(d), status: "ISSUED", billingName: "Beta", subtotal: 100, total: 100 } });
    await db.auditLog.create({ data: { action: "invoice.payment", entity: "Invoice", entityId: bInvoice.id, summary: "Rs 1 · B-REF" } });
    const { invite } = await createInvite(B.company, { id: B.admin, name: "Beta Admin" }, { email: `wp12-beta-new-${tag}@test.local` }, "http://localhost");
    await setTeamBudget(B.company, B.admin, { department: "Engineering", month: d.slice(0, 7), amount: 999900 });
    await setTeamDeliveryInstructions(B.company, B.admin, "Beta gate 2");

    await expect(memberOf(A.company, bMember.member)).rejects.toBeInstanceOf(TeamError);
    await expect(updateMember(A.company, bMember.member, A.admin, { mealEligible: false })).rejects.toBeInstanceOf(TeamError);
    await expect(placeTeamOrder(A.company, { id: A.admin }, { memberIds: [bMember.member], date: d, boxId: item.box.id })).rejects.toThrow(/aren't active members/);
    await expect(teamInvoice(A.company, bInvoice.id)).rejects.toBeInstanceOf(TeamError);
    await expect(revokeInvite(A.company, invite.id)).rejects.toBeInstanceOf(TeamError);

    const report = await teamReport(A.company, addDays(d, -60), addDays(d, 60));
    expect(report.some((x) => x.number === r.orders[0].number)).toBe(false);
    const deliveries = await teamDeliveries(A.company, 60);
    expect(deliveries.instructions).not.toBe("Beta gate 2");
    expect(deliveries.groups.flatMap((g) => g.people)).not.toContain(eng.name);
    expect((await teamBudgets(A.company, d.slice(0, 7))).some((b) => b.department === "Engineering")).toBe(false);
    const pay = await teamPayments(A.company);
    expect(pay.history.some((h) => h.invoiceId === bInvoice.id)).toBe(false);
    expect(pay.unpaid.some((u) => u.id === bInvoice.id)).toBe(false);

    // B's data is intact.
    expect((await memberOf(B.company, bMember.member)).mealEligible).toBe(true);
    expect((await db.companyInvite.findUniqueOrThrow({ where: { id: invite.id } })).acceptedAt).toBeNull();
    expect((await teamPayments(B.company)).history).toHaveLength(1);
  });

  it("staff scoped to one company can't act on another", async () => {
    const u = await db.user.create({ data: { name: "WP12 scoped finance", email: `wp12-scoped-${tag}@test.local`, role: "FINANCE" } });
    await db.staffScope.create({ data: { userId: u.id, companyId: B.company } });
    const scoped = await loadUser(u.email);
    expect(() => assertCompanyAccess(scoped, B.company, "corporate.edit")).not.toThrow();
    expect(() => assertCompanyAccess(scoped, A.company)).toThrow(CorporateForbidden);
    await expect(setCompanyMenu(scoped, A.company, [])).rejects.toBeInstanceOf(CorporateForbidden);
    await expect(createContract(scoped, A.company, { title: "x", startsOn: todayKTM() })).rejects.toBeInstanceOf(CorporateForbidden);
    await expect(generateCompanyInvoice(scoped, { companyId: A.company, periodStart: todayKTM(), periodEnd: todayKTM() })).rejects.toBeInstanceOf(CorporateForbidden);
    // Unscoped owner sees everything.
    expect(() => assertCompanyAccess(owner, A.company, "corporate.edit")).not.toThrow();
  });
});
