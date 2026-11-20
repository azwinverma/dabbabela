import { Prisma, type Company, type CompanyMember, type Weekday } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { rs } from "@/lib/money";
import { can, type Permission, type PermissionSubject } from "@/lib/permissions";
import { addDays, dateOnly, formatDay, isoDate, isValidISODate, monthRange, todayKTM, weekdayOf } from "@/lib/dates";
import type { CompanySpec } from "./pricing";
import { LIVE_STATUSES, REVENUE_STATUSES } from "./transitions";

/**
 * Corporate (B2B) services: pricing hooks used at checkout, contracts (versions, negotiated prices,
 * minimum commitment, credit terms), department budgets, meal eligibility, company menus, delivery
 * grouping and contract-aware company invoices.
 *
 * Staff entry points take the acting staff member and re-check the permission key and company scope
 * (`CorporateForbidden`). Company-admin entry points live in `team.ts` and are always scoped to the
 * admin's own companyId.
 */
export class CorporateError extends Error {}
export class CorporateForbidden extends CorporateError {}

type Tx = Prisma.TransactionClient;
export type StaffActor = { id: string; role: string; customGrants?: readonly string[] | null; scopes?: { companyId: string | null }[] };

// ───────────── staff access ─────────────

/** Companies a staff member is limited to (StaffScope company rows); null = every company. */
export function companyScope(actor: { role: string; scopes?: { companyId: string | null }[] }): string[] | null {
  if (actor.role === "SUPER_ADMIN") return null;
  const ids = (actor.scopes ?? []).map((s) => s.companyId).filter((x): x is string => Boolean(x));
  return ids.length ? ids : null;
}

export function inCompanyScope(actor: { role: string; scopes?: { companyId: string | null }[] }, companyId: string) {
  const scope = companyScope(actor);
  return !scope || scope.includes(companyId);
}

/** Permission + company scope check for staff actions (throws `CorporateForbidden`). */
export function assertCompanyAccess(actor: StaffActor, companyId: string, perm: Permission = "corporate.view") {
  if (!can(actor as PermissionSubject, perm)) throw new CorporateForbidden(`You don't have permission to do that (${perm})`);
  if (!inCompanyScope(actor, companyId)) throw new CorporateForbidden("That company isn't in your scope");
}

/** Prisma filter for company lists a staff member may see. */
export function companyScopeWhere(actor: StaffActor): Prisma.CompanyWhereInput {
  const scope = companyScope(actor);
  return scope ? { id: { in: scope } } : {};
}

// ───────────── eligibility ─────────────

type EligibilityFields = Pick<CompanyMember, "mealEligible" | "eligibleDays" | "status">;

/** Whether the company pays for this member's meal on `date` (active, eligible, on an eligible weekday). */
export function isEligibleOn(member: EligibilityFields | null | undefined, date: string) {
  if (!member || member.status !== "ACTIVE" || !member.mealEligible) return false;
  return !member.eligibleDays.length || member.eligibleDays.includes(weekdayOf(date));
}

export function eligibilityProblem(member: EligibilityFields & { companyId?: string }, date: string): string | null {
  if (member.status !== "ACTIVE") return "Not an active member";
  if (!member.mealEligible) return "Not eligible for company meals";
  if (member.eligibleDays.length && !member.eligibleDays.includes(weekdayOf(date))) return `Not eligible for company meals on ${formatDay(date, "long")}`;
  return null;
}

export const WEEKDAY_ORDER: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export function cleanWeekdays(values: readonly string[]): Weekday[] {
  return WEEKDAY_ORDER.filter((d) => values.includes(d));
}

// ───────────── department budgets ─────────────

/** Employer share already committed this month by members of `department` (live orders). */
export async function departmentSpend(companyId: string, department: string, ym: string, client: Tx | typeof db = db) {
  const { start, end } = monthRange(ym);
  const agg = await client.order.aggregate({
    _sum: { companyShare: true },
    where: { companyId, status: { in: LIVE_STATUSES }, deliveryDate: { gte: dateOnly(start), lte: dateOnly(end) }, user: { membership: { companyId, department } } },
  });
  return agg._sum.companyShare ?? 0;
}

/** Remaining budget of a department for a month; null when the department has no budget. */
export async function departmentBudgetRemaining(companyId: string, department: string | null | undefined, ym: string) {
  if (!department) return null;
  const budget = await db.departmentBudget.findUnique({ where: { companyId_department_month: { companyId, department, month: ym } } });
  if (!budget) return null;
  return Math.max(0, budget.amount - (await departmentSpend(companyId, department, ym)));
}

export type BudgetRow = { department: string; budget: number | null; spent: number; remaining: number | null; over: boolean; members: number };

/** Spending vs budget per department for a month (departments with members, a budget or spend). */
export async function budgetStatus(companyId: string, ym: string): Promise<BudgetRow[]> {
  const { start, end } = monthRange(ym);
  const [budgets, members, orders] = await Promise.all([
    db.departmentBudget.findMany({ where: { companyId, month: ym } }),
    db.companyMember.groupBy({ by: ["department"], where: { companyId, status: "ACTIVE" }, _count: true }),
    db.order.findMany({
      where: { companyId, status: { in: LIVE_STATUSES }, deliveryDate: { gte: dateOnly(start), lte: dateOnly(end) } },
      select: { companyShare: true, user: { select: { membership: { select: { companyId: true, department: true } } } } },
    }),
  ]);
  const spent = new Map<string, number>();
  for (const o of orders) {
    const m = o.user.membership;
    const dept = m?.companyId === companyId && m.department ? m.department : "";
    spent.set(dept, (spent.get(dept) ?? 0) + o.companyShare);
  }
  const names = new Set<string>([...budgets.map((b) => b.department), ...members.map((m) => m.department ?? ""), ...spent.keys()]);
  return [...names]
    .sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map((department) => {
      const b = budgets.find((x) => x.department === department);
      const s = spent.get(department) ?? 0;
      return { department, budget: b?.amount ?? null, spent: s, remaining: b ? b.amount - s : null, over: b ? s > b.amount : false, members: members.find((m) => (m.department ?? "") === department)?._count ?? 0 };
    });
}

/** Create, change or (amount null) remove a department's monthly cap. Audited. */
export async function upsertDepartmentBudget(companyId: string, actorId: string, input: { department: string; month: string; amount: number | null }) {
  const department = input.department.trim().slice(0, 80);
  if (!department) throw new CorporateError("Name the department");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new CorporateError("Pick a month");
  if (input.amount != null && (!Number.isInteger(input.amount) || input.amount < 0)) throw new CorporateError("Budget must be a positive amount");
  const key = { companyId_department_month: { companyId, department, month: input.month } };
  const before = await db.departmentBudget.findUnique({ where: key });
  if (input.amount == null) {
    if (before) await db.departmentBudget.delete({ where: key });
  } else {
    await db.departmentBudget.upsert({ where: key, create: { companyId, department, month: input.month, amount: input.amount }, update: { amount: input.amount } });
  }
  await audit({
    actorId,
    action: input.amount == null ? "company.budget.remove" : "company.budget.set",
    entity: "Company",
    entityId: companyId,
    summary: `${department} ${input.month}: ${input.amount == null ? "removed" : rs(input.amount)}`,
    before: before ? { department, month: input.month, amount: before.amount } : null,
    after: input.amount == null ? null : { department, month: input.month, amount: input.amount },
  });
}

// ───────────── checkout pricing hook ─────────────

/**
 * Company pricing spec for a member, with this month's remaining allowance.
 * - Not eligible on any of the cart's dates (mealEligible off, or a day outside eligibleDays) → the
 *   company pays nothing for this cart (the member can still order and pay themselves).
 * - Department budget: the company share is capped by what is left of the member's department budget
 *   for the month (`ignoreBudget` gives the uncapped share — used to warn/refuse in team orders).
 */
export async function companySpecFor(userId: string, company: Company, dates: string[], opts: { ignoreBudget?: boolean } = {}): Promise<CompanySpec> {
  let allowanceRemaining: number | null = null;
  const member = await db.companyMember.findUnique({ where: { userId } });
  const ym = (dates[0] ?? todayKTM()).slice(0, 7);
  const paying = company.billingMode !== "EMPLOYEE_PAID";
  const allowance = member?.allowanceOverride ?? company.monthlyAllowance;
  if (allowance != null && paying) {
    const { start, end } = monthRange(ym);
    const used = await db.order.aggregate({
      _sum: { companyShare: true },
      where: { userId, companyId: company.id, status: { in: LIVE_STATUSES }, deliveryDate: { gte: dateOnly(start), lte: dateOnly(end) } },
    });
    allowanceRemaining = Math.max(0, allowance - (used._sum.companyShare ?? 0));
  }
  if (paying && member && member.companyId === company.id) {
    if (dates.some((d) => !isEligibleOn(member, d))) allowanceRemaining = 0;
    else if (!opts.ignoreBudget) {
      const left = await departmentBudgetRemaining(company.id, member.department, ym);
      if (left != null) allowanceRemaining = Math.min(allowanceRemaining ?? left, left);
    }
  }
  return {
    discountPct: company.discountPct,
    freeDelivery: company.freeDelivery,
    billingMode: company.billingMode,
    subsidyPct: company.billingMode === "COMPANY_PAID" ? 100 : company.subsidyPct,
    subsidyCap: company.subsidyCap,
    allowanceRemaining,
  };
}

// ───────────── company menu ─────────────

/** Dabbas a company's members may see; null = no allow-list (full menu). */
export async function companyMenuBoxIds(companyId: string | null | undefined): Promise<Set<string> | null> {
  if (!companyId) return null;
  const rows = await db.companyMenuItem.findMany({ where: { companyId }, select: { boxId: true } });
  return rows.length ? new Set(rows.map((r) => r.boxId)) : null;
}

/** Filter offer items (anything with `box.id`) down to the company's allow-list. */
export function filterCompanyMenu<T extends { box: { id: string } }>(items: T[], allowed: Set<string> | null): T[] {
  return allowed ? items.filter((i) => allowed.has(i.box.id)) : items;
}

/** A day-offer map narrowed to a company's menu (unchanged when the company has none). */
export function narrowOffers<T extends { items: { box: { id: string } }[] }>(offers: Map<string, T>, allowed: Set<string> | null): Map<string, T> {
  if (!allowed) return offers;
  return new Map([...offers].map(([date, o]) => [date, { ...o, items: filterCompanyMenu(o.items, allowed) }]));
}

/**
 * Company menu as it applies to one signed-in member (decision 2026-11-20): when the company has a menu it applies to
 * every member on the public menu, account pages and checkout, whoever pays; Build-a-Dabba is blocked only when the
 * company is billed (COMPANY_PAID / SPLIT). Null when the member's company has no menu (full menu).
 */
export async function memberCompanyMenu(company: Pick<Company, "id" | "name" | "billingMode"> | null | undefined) {
  if (!company) return null;
  const allowed = await companyMenuBoxIds(company.id);
  if (!allowed) return null;
  return { companyId: company.id, companyName: company.name, allowed, buildBlocked: company.billingMode !== "EMPLOYEE_PAID" };
}

export async function setCompanyMenu(actor: StaffActor, companyId: string, boxIds: string[]) {
  assertCompanyAccess(actor, companyId, "corporate.edit");
  const ids = [...new Set(boxIds.filter(Boolean))];
  if (ids.length && (await db.lunchBox.count({ where: { id: { in: ids } } })) !== ids.length) throw new CorporateError("Unknown dabba");
  const before = await db.companyMenuItem.findMany({ where: { companyId }, select: { boxId: true } });
  await db.$transaction([db.companyMenuItem.deleteMany({ where: { companyId } }), db.companyMenuItem.createMany({ data: ids.map((boxId) => ({ companyId, boxId })) })]);
  await audit({ actorId: actor.id, action: "company.menu", entity: "Company", entityId: companyId, summary: ids.length ? `${ids.length} dabbas allowed` : "Full menu", before: before.map((b) => b.boxId), after: ids });
}

// ───────────── contracts ─────────────

export type ContractInput = {
  title: string;
  startsOn: string;
  endsOn?: string | null;
  pricePerMeal?: number | null;
  minMealsPerDay?: number | null;
  minMealsPerMonth?: number | null;
  creditTermsDays?: number | null;
  boxPrices?: Record<string, number> | null;
  terms?: string | null;
  documentUrl?: string | null;
};

async function cleanContract(input: ContractInput) {
  const title = input.title.trim();
  if (!title) throw new CorporateError("Give the contract a title");
  if (!isValidISODate(input.startsOn)) throw new CorporateError("Pick a start date");
  if (input.endsOn && (!isValidISODate(input.endsOn) || input.endsOn < input.startsOn)) throw new CorporateError("End date must be after the start");
  const nonNeg = (v: number | null | undefined, label: string) => {
    if (v == null) return null;
    if (!Number.isInteger(v) || v < 0) throw new CorporateError(`${label} must be a whole positive number`);
    return v;
  };
  const prices: Record<string, number> = {};
  for (const [boxId, p] of Object.entries(input.boxPrices ?? {})) {
    if (!Number.isInteger(p) || p < 0) throw new CorporateError("Negotiated prices must be positive amounts");
    prices[boxId] = p;
  }
  const ids = Object.keys(prices);
  if (ids.length && (await db.lunchBox.count({ where: { id: { in: ids } } })) !== ids.length) throw new CorporateError("A negotiated price points at an unknown dabba");
  const creditTermsDays = nonNeg(input.creditTermsDays, "Credit terms");
  if (creditTermsDays != null && creditTermsDays > 180) throw new CorporateError("Credit terms can be at most 180 days");
  return {
    title: title.slice(0, 160),
    startsOn: dateOnly(input.startsOn),
    endsOn: input.endsOn ? dateOnly(input.endsOn) : null,
    pricePerMeal: nonNeg(input.pricePerMeal, "Price per meal"),
    minMealsPerDay: nonNeg(input.minMealsPerDay, "Minimum meals per day"),
    minMealsPerMonth: nonNeg(input.minMealsPerMonth, "Minimum meals per month"),
    creditTermsDays,
    boxPrices: ids.length ? (prices as Prisma.InputJsonValue) : undefined,
    terms: input.terms?.trim() || null,
    documentUrl: input.documentUrl?.trim() || null,
  };
}

/** New contract (version 1, DRAFT). */
export async function createContract(actor: StaffActor, companyId: string, input: ContractInput) {
  assertCompanyAccess(actor, companyId, "corporate.edit");
  const data = await cleanContract(input);
  const c = await db.corporateContract.create({ data: { ...data, boxPrices: data.boxPrices ?? undefined, companyId, status: "DRAFT", version: 1 } });
  await audit({ actorId: actor.id, action: "contract.create", entity: "CorporateContract", entityId: c.id, summary: `${c.title} v1`, after: data });
  return c;
}

/** Edit a contract. Only drafts are editable — an active contract changes through a new version. */
export async function updateContract(actor: StaffActor, contractId: string, input: ContractInput) {
  const before = await db.corporateContract.findUnique({ where: { id: contractId } });
  if (!before) throw new CorporateError("Contract not found");
  assertCompanyAccess(actor, before.companyId, "corporate.edit");
  if (before.status !== "DRAFT") throw new CorporateError("Only drafts can be edited — create a new version to change an active contract");
  const data = await cleanContract(input);
  const c = await db.corporateContract.update({ where: { id: contractId }, data: { ...data, boxPrices: data.boxPrices ?? Prisma.DbNull } });
  await audit({ actorId: actor.id, action: "contract.update", entity: "CorporateContract", entityId: c.id, summary: `${c.title} v${c.version}`, before, after: data });
  return c;
}

/**
 * Draft the next version of a contract (copies its terms, version + 1, `supersedesId` = it).
 * Becomes effective only when activated.
 */
export async function newContractVersion(actor: StaffActor, fromId: string, input: ContractInput) {
  const from = await db.corporateContract.findUnique({ where: { id: fromId } });
  if (!from) throw new CorporateError("Contract not found");
  assertCompanyAccess(actor, from.companyId, "corporate.edit");
  if (from.status === "DRAFT") throw new CorporateError("Edit the draft instead of versioning it");
  if (await db.corporateContract.findFirst({ where: { supersedesId: from.id, status: { not: "ENDED" } } })) throw new CorporateError("This contract already has a newer version");
  if (input.startsOn <= isoDate(from.startsOn)) throw new CorporateError("A new version must start after the current one");
  const latest = await db.corporateContract.aggregate({ where: { companyId: from.companyId }, _max: { version: true } });
  const data = await cleanContract(input);
  const c = await db.corporateContract.create({
    data: { ...data, boxPrices: data.boxPrices ?? undefined, companyId: from.companyId, status: "DRAFT", version: Math.max(from.version, latest._max.version ?? 0) + 1, supersedesId: from.id },
  });
  await audit({ actorId: actor.id, action: "contract.version", entity: "CorporateContract", entityId: c.id, summary: `${c.title} v${c.version} (supersedes v${from.version})`, after: { ...data, supersedesId: from.id } });
  return c;
}

/**
 * Activate a draft. A new version ends the version it supersedes the day before it starts (the old
 * one stays ACTIVE for its remaining days so its prices keep applying until then; ENDED once over).
 * Overlapping a different active contract without superseding it is refused. When the contract is in
 * force today its credit terms become the company's invoice terms.
 */
export async function activateContract(actor: StaffActor, contractId: string) {
  const c = await db.corporateContract.findUnique({ where: { id: contractId } });
  if (!c) throw new CorporateError("Contract not found");
  assertCompanyAccess(actor, c.companyId, "corporate.edit");
  if (c.status !== "DRAFT") throw new CorporateError("Only drafts can be activated");
  const today = todayKTM();
  const startsOn = isoDate(c.startsOn);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`contract-company:${c.companyId}`}))`;
    const overlapping = await tx.corporateContract.findMany({
      where: { companyId: c.companyId, status: "ACTIVE", id: { not: c.id }, OR: [{ endsOn: null }, { endsOn: { gte: c.startsOn } }], ...(c.endsOn ? { startsOn: { lte: c.endsOn } } : {}) },
    });
    const blocking = overlapping.filter((o) => o.id !== c.supersedesId);
    if (blocking.length) throw new CorporateError(`"${blocking[0].title}" (v${blocking[0].version}) is active for those dates — create a new version of it instead`);
    if (c.supersedesId) {
      const prev = await tx.corporateContract.findUnique({ where: { id: c.supersedesId } });
      if (prev && prev.status === "ACTIVE") {
        const end = addDays(startsOn, -1);
        const newEnd = prev.endsOn && isoDate(prev.endsOn) < end ? isoDate(prev.endsOn) : end;
        await tx.corporateContract.update({ where: { id: prev.id }, data: { endsOn: dateOnly(newEnd), status: newEnd < today ? "ENDED" : "ACTIVE" } });
      }
    }
    await tx.corporateContract.update({ where: { id: c.id }, data: { status: "ACTIVE" } });
    if (c.creditTermsDays != null && startsOn <= today) await tx.company.update({ where: { id: c.companyId }, data: { invoiceTermsDays: c.creditTermsDays } });
  });
  await audit({ actorId: actor.id, action: "contract.activate", entity: "CorporateContract", entityId: c.id, summary: `${c.title} v${c.version}${c.supersedesId ? " supersedes previous version" : ""}`, after: { status: "ACTIVE", startsOn, supersedesId: c.supersedesId } });
}

export async function endContract(actor: StaffActor, contractId: string, endsOn: string, reason: string) {
  const c = await db.corporateContract.findUnique({ where: { id: contractId } });
  if (!c) throw new CorporateError("Contract not found");
  assertCompanyAccess(actor, c.companyId, "corporate.edit");
  if (c.status !== "ACTIVE") throw new CorporateError("Only active contracts can be ended");
  if (!isValidISODate(endsOn) || endsOn < isoDate(c.startsOn)) throw new CorporateError("Pick an end date on or after the start");
  if (!reason.trim()) throw new CorporateError("Give a reason");
  await db.corporateContract.update({ where: { id: c.id }, data: { endsOn: dateOnly(endsOn), status: endsOn < todayKTM() ? "ENDED" : "ACTIVE" } });
  await audit({ actorId: actor.id, action: "contract.end", entity: "CorporateContract", entityId: c.id, summary: `${c.title} v${c.version} ends ${endsOn}`, reason, before: { endsOn: c.endsOn ? isoDate(c.endsOn) : null }, after: { endsOn } });
}

/** The ACTIVE contract in force on `date` (newest start wins). */
export async function contractOn(companyId: string, date: string) {
  return db.corporateContract.findFirst({
    where: { companyId, status: "ACTIVE", startsOn: { lte: dateOnly(date) }, OR: [{ endsOn: null }, { endsOn: { gte: dateOnly(date) } }] },
    orderBy: [{ startsOn: "desc" }, { version: "desc" }],
  });
}

/** Credit terms (days) on `date`: the contract in force, else the company's invoice terms. */
export async function creditTermsOn(companyId: string, date: string) {
  const [c, company] = await Promise.all([contractOn(companyId, date), db.company.findUniqueOrThrow({ where: { id: companyId }, select: { invoiceTermsDays: true } })]);
  return c?.creditTermsDays ?? company.invoiceTermsDays;
}

export type Commitment = { ym: string; contractId: string | null; contractTitle: string | null; minMealsPerMonth: number | null; meals: number; shortfall: number };

/** Meals delivered/booked in a month against the contract's monthly minimum. */
export async function minCommitment(companyId: string, ym: string): Promise<Commitment> {
  const { start, end } = monthRange(ym);
  const contract = await db.corporateContract.findFirst({
    where: { companyId, status: { in: ["ACTIVE", "ENDED"] }, minMealsPerMonth: { not: null }, startsOn: { lte: dateOnly(end) }, OR: [{ endsOn: null }, { endsOn: { gte: dateOnly(start) } }] },
    orderBy: [{ startsOn: "desc" }, { version: "desc" }],
  });
  const meals = await db.orderItem.aggregate({ _sum: { quantity: true }, where: { order: { companyId, status: { in: REVENUE_STATUSES }, deliveryDate: { gte: dateOnly(start), lte: dateOnly(end) } } } });
  const n = meals._sum.quantity ?? 0;
  const min = contract?.minMealsPerMonth ?? null;
  return { ym, contractId: contract?.id ?? null, contractTitle: contract ? `${contract.title} v${contract.version}` : null, minMealsPerMonth: min, meals: n, shortfall: min != null ? Math.max(0, min - n) : 0 };
}

export function boxPricesOf(json: Prisma.JsonValue | null | undefined): Record<string, number> {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(json)) if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[k] = v;
  return out;
}

// ───────────── delivery ─────────────

export async function setDeliveryInstructions(companyId: string, actorId: string, text: string | null) {
  const value = text?.trim().slice(0, 500) || null;
  const before = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { deliveryInstructions: true } });
  await db.company.update({ where: { id: companyId }, data: { deliveryInstructions: value } });
  await audit({ actorId, action: "company.delivery_instructions", entity: "Company", entityId: companyId, before, after: { deliveryInstructions: value } });
  return value;
}

export type DeliveryGroup = { date: string; office: string; address: string; slot: string | null; receiver: string | null; orders: number; meals: number; people: string[] };

/**
 * Upcoming company deliveries grouped by day → office (address) → slot: what lands at each office.
 * Company instructions apply to every group.
 */
export async function upcomingDeliveries(companyId: string, from = todayKTM(), days = 14) {
  const to = addDays(from, days - 1);
  const [company, orders, locations] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId }, select: { deliveryInstructions: true } }),
    db.order.findMany({
      where: { companyId, status: { in: LIVE_STATUSES.filter((s) => s !== "DELIVERED" && s !== "FAILED_DELIVERY") }, deliveryDate: { gte: dateOnly(from), lte: dateOnly(to) } },
      select: { deliveryDate: true, officeLocationId: true, placeName: true, addressLine: true, area: true, slotLabel: true, contactName: true, items: { select: { quantity: true } } },
      orderBy: [{ deliveryDate: "asc" }, { slotLabel: "asc" }],
    }),
    db.officeLocation.findMany({ where: { companyId }, select: { id: true, name: true, line1: true, area: true, receiverName: true } }),
  ]);
  const groups = new Map<string, DeliveryGroup>();
  for (const o of orders) {
    const loc = locations.find((l) => l.id === o.officeLocationId);
    const office = loc?.name ?? o.placeName ?? o.addressLine;
    const address = loc ? `${loc.line1}, ${loc.area}` : `${o.addressLine}, ${o.area}`;
    const date = isoDate(o.deliveryDate);
    const k = `${date}|${loc?.id ?? address}|${o.slotLabel ?? ""}`;
    const g = groups.get(k) ?? { date, office, address, slot: o.slotLabel, receiver: loc?.receiverName ?? null, orders: 0, meals: 0, people: [] };
    g.orders++;
    g.meals += o.items.reduce((a, i) => a + i.quantity, 0);
    g.people.push(o.contactName);
    groups.set(k, g);
  }
  return { instructions: company.deliveryInstructions, groups: [...groups.values()] };
}

// ───────────── money owed ─────────────

export const COMPANY_SHARE_PREFIX = "Company share";
/**
 * An adjustment counts as billed while it is linked to a line of a non-void invoice (`OrderAdjustment.invoiceLineId`).
 * Regenerating a draft deletes its lines (SetNull frees the adjustment); voiding keeps the link for history but the
 * adjustment becomes billable again.
 */
export const UNBILLED_ADJUSTMENT = { OR: [{ invoiceLineId: null }, { invoiceLine: { invoice: { status: "VOID" as const } } }] } satisfies Prisma.OrderAdjustmentWhereInput;

/** Company-share adjustments (WP-03 staff edits) not yet billed on a non-void invoice. */
async function unbilledCompanyAdjustments(client: Tx | typeof db, companyId: string, upTo?: string) {
  return client.orderAdjustment.findMany({
    where: { reason: { startsWith: COMPANY_SHARE_PREFIX }, ...UNBILLED_ADJUSTMENT, order: { companyId, ...(upTo ? { deliveryDate: { lte: dateOnly(upTo) } } : {}) } },
    include: { order: { select: { id: true, number: true, deliveryDate: true, tax: true, total: true, invoiceId: true, status: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** Employer money owed: company share of live orders not yet invoiced (+ unbilled company adjustments) + unpaid invoice balances. */
export async function companyOutstanding(companyId: string) {
  const [uninvoiced, invoices, adjustments] = await Promise.all([
    db.order.aggregate({ _sum: { companyShare: true }, where: { companyId, invoiceId: null, status: { in: LIVE_STATUSES } } }),
    db.invoice.findMany({ where: { companyId, kind: "INVOICE", status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { total: true, paidAmount: true } }),
    unbilledCompanyAdjustments(db, companyId),
  ]);
  return (uninvoiced._sum.companyShare ?? 0) + adjustments.reduce((a, x) => a + x.amount, 0) + invoices.reduce((a, i) => a + i.total - i.paidAmount, 0);
}

// ───────────── contract-aware company invoices ─────────────

async function nextInvoiceNumber(tx: Tx, year: string) {
  // Same lock key and format as invoices.ts so both generators share one number sequence.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-number:INV:${year}`}))`;
  const last = await tx.invoice.findFirst({ where: { number: { startsWith: `INV-${year}-` } }, orderBy: { number: "desc" }, select: { number: true } });
  const n = last ? parseInt(last.number.split("-")[2], 10) + 1 : 1;
  return `INV-${year}-${String(n).padStart(4, "0")}`;
}

const shareTaxOf = (o: { tax: number; total: number }, amount: number) => (o.tax && o.total ? Math.round((o.tax * amount) / o.total) : 0);

/**
 * Bill the employer share of a company's meals for a period (DRAFT), using the contract terms:
 * - every not-yet-invoiced, due (delivery ≤ today), live order with a company share (its share already
 *   reflects the negotiated per-dabba price, company discount and split at checkout);
 * - company-share `OrderAdjustment` rows (staff edits) not billed before — on these orders or on
 *   orders already invoiced — each as its own line linked through `OrderAdjustment.invoiceLineId` so it is billed exactly once;
 * - the due date preview = period end + credit terms of the contract in force (re-set on issue).
 * Running it twice never double-bills.
 */
export async function generateCompanyInvoice(actor: StaffActor, input: { companyId: string; periodStart: string; periodEnd: string; grouping?: "ORDER" | "DAY" }) {
  assertCompanyAccess(actor, input.companyId, "invoices.edit");
  if (!isValidISODate(input.periodStart) || !isValidISODate(input.periodEnd)) throw new CorporateError("Pick the period");
  if (input.periodEnd < input.periodStart) throw new CorporateError("Period end is before the start");
  const today = todayKTM();
  const lastDay = input.periodEnd < today ? input.periodEnd : today;
  const terms = await creditTermsOn(input.companyId, lastDay);
  const inv = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-company:${input.companyId}`}))`;
      const company = await tx.company.findUniqueOrThrow({ where: { id: input.companyId } });
      const orders = await tx.order.findMany({
        where: { companyId: company.id, invoiceId: null, companyShare: { gt: 0 }, status: { in: REVENUE_STATUSES }, deliveryDate: { gte: dateOnly(input.periodStart), lte: dateOnly(lastDay) } },
        include: { user: { select: { name: true } }, items: { select: { name: true, quantity: true } } },
        orderBy: [{ deliveryDate: "asc" }, { number: "asc" }],
      });
      const orderIds = new Set(orders.map((o) => o.id));
      // Adjustments on orders in this batch, or on orders billed earlier (invoiced → the adjustment is new money).
      const adjustments = (await unbilledCompanyAdjustments(tx, company.id, lastDay)).filter((a) => orderIds.has(a.order.id) || (a.order.invoiceId && REVENUE_STATUSES.includes(a.order.status)));
      if (!orders.length && !adjustments.length) throw new CorporateError("Nothing to invoice for that period — every meal is already billed or none were company-paid.");

      let lines: Prisma.InvoiceLineCreateWithoutInvoiceInput[];
      if (input.grouping === "DAY") {
        const byDay = new Map<string, typeof orders>();
        for (const o of orders) byDay.set(isoDate(o.deliveryDate), [...(byDay.get(isoDate(o.deliveryDate)) ?? []), o]);
        lines = [...byDay.entries()].map(([d, os]) => {
          const meals = os.reduce((a, o) => a + o.items.reduce((b, i) => b + i.quantity, 0), 0);
          const amount = os.reduce((a, o) => a + o.companyShare, 0);
          return { description: `Staff lunches — ${formatDay(d, "long")} (${os.length} orders)`, quantity: meals, unitPrice: meals ? Math.round(amount / meals) : amount, amount };
        });
      } else {
        lines = orders.map((o) => {
          const meals = o.items.reduce((a, i) => a + i.quantity, 0);
          return {
            order: { connect: { id: o.id } },
            description: `${formatDay(isoDate(o.deliveryDate))} · ${o.number} · ${o.user.name} · ${o.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(", ")}`.slice(0, 300),
            quantity: meals,
            unitPrice: meals ? Math.round(o.companyShare / meals) : o.companyShare,
            amount: o.companyShare,
          };
        });
      }
      // Adjustment lines are created one by one after the invoice so each adjustment can point at its line
      // (`invoiceLineId` — the "already billed" marker). The `[adj:<id>]` tag stays in the text for older readers.
      const adjustmentLines = adjustments.map((a) => {
        const reason = a.reason.slice(COMPANY_SHARE_PREFIX.length).replace(/^[\s:—–-]+/, "") || "change";
        return { adjustmentId: a.id, orderId: a.order.id, description: `Adjustment · ${a.order.number} · ${formatDay(isoDate(a.order.deliveryDate))} · ${reason}`.slice(0, 270) + ` [adj:${a.id}]`, amount: a.amount };
      });
      const total = orders.reduce((s, o) => s + o.companyShare, 0) + adjustments.reduce((s, a) => s + a.amount, 0);
      if (total <= 0) throw new CorporateError("The adjustments cancel out the meals — nothing to invoice; issue a credit note instead if money is owed back.");
      const tax = orders.reduce((s, o) => s + shareTaxOf(o, o.companyShare), 0) + adjustments.reduce((s, a) => s + shareTaxOf(a.order, a.amount), 0);
      const created = await tx.invoice.create({
        data: {
          number: await nextInvoiceNumber(tx, input.periodStart.slice(0, 4)),
          kind: "INVOICE",
          companyId: company.id,
          periodStart: dateOnly(input.periodStart),
          periodEnd: dateOnly(input.periodEnd),
          status: "DRAFT",
          billingName: company.legalName || company.name,
          billingAddress: company.billingAddress,
          panVat: company.panVat,
          subtotal: total - tax,
          discount: 0,
          tax,
          total,
          dueDate: dateOnly(addDays(lastDay, terms)),
          note: `Credit terms ${terms} days`,
          createdById: actor.id,
          lines: { create: lines },
        },
      });
      for (const l of adjustmentLines) {
        const line = await tx.invoiceLine.create({ data: { invoiceId: created.id, orderId: l.orderId, description: l.description, quantity: 1, unitPrice: l.amount, amount: l.amount } });
        const tagged = await tx.orderAdjustment.updateMany({ where: { id: l.adjustmentId, ...UNBILLED_ADJUSTMENT }, data: { invoiceLineId: line.id } });
        if (tagged.count !== 1) throw new CorporateError("Some adjustments were invoiced at the same time — try again");
      }
      if (orders.length) {
        const linked = await tx.order.updateMany({ where: { id: { in: orders.map((o) => o.id) }, invoiceId: null }, data: { invoiceId: created.id } });
        if (linked.count !== orders.length) throw new CorporateError("Some orders were invoiced at the same time — try again");
      }
      return created;
    },
    { timeout: 30_000 },
  );
  await audit({ actorId: actor.id, action: "invoice.generate", entity: "Invoice", entityId: inv.id, summary: `${inv.number} ${rs(inv.total)}`, after: { period: [input.periodStart, input.periodEnd], creditTermsDays: terms } });
  return inv;
}

/** Issue a draft company invoice; due date = issue date + credit terms of the contract in force. */
export async function issueCompanyInvoice(actor: StaffActor, invoiceId: string) {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv || !inv.companyId) throw new CorporateError("Invoice not found");
  assertCompanyAccess(actor, inv.companyId, "invoices.edit");
  if (inv.status !== "DRAFT") throw new CorporateError("Only drafts can be issued");
  const today = todayKTM();
  const terms = await creditTermsOn(inv.companyId, today);
  const r = await db.invoice.updateMany({ where: { id: invoiceId, status: "DRAFT" }, data: { status: "ISSUED", issuedAt: new Date(), dueDate: dateOnly(addDays(today, terms)) } });
  if (!r.count) throw new CorporateError("Only drafts can be issued");
  await audit({ actorId: actor.id, action: "invoice.issue", entity: "Invoice", entityId: invoiceId, summary: `${inv.number} · due in ${terms} days` });
  return db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
}

export type InvoicePaymentRecord = {
  invoiceId: string;
  number: string;
  /** When the money arrived (receipt) — for legacy rows, when the payment was keyed in. */
  at: Date;
  summary: string;
  /** Paisa; null for legacy rows. */
  amount: number | null;
  method: string | null;
  reference: string | null;
  source: "receipt" | "legacy";
};

/**
 * Dated payment history for a company's invoices: `InvoiceReceipt` rows (written by `recordInvoicePayment` since
 * Phase 2C) plus the legacy `invoice.payment` audit rows from before receipts existed. Dedupe rule: an audit row that
 * carries `after.receiptId` belongs to a receipt and is skipped; audit rows without it are legacy and shown as-is
 * (their amount lives only in the formatted summary, so `amount` is null).
 */
export async function invoicePaymentHistory(companyId: string): Promise<InvoicePaymentRecord[]> {
  const invoices = await db.invoice.findMany({ where: { companyId }, select: { id: true, number: true } });
  if (!invoices.length) return [];
  const ids = invoices.map((i) => i.id);
  const numberOf = (id: string) => invoices.find((i) => i.id === id)?.number ?? "";
  const [receipts, audits] = await Promise.all([
    db.invoiceReceipt.findMany({ where: { invoiceId: { in: ids } }, orderBy: { receivedAt: "desc" }, take: 200 }),
    db.auditLog.findMany({ where: { entity: "Invoice", action: "invoice.payment", entityId: { in: ids } }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  const fromReceipts: InvoicePaymentRecord[] = receipts.map((r) => ({
    invoiceId: r.invoiceId,
    number: numberOf(r.invoiceId),
    at: r.receivedAt,
    summary: `${rs(r.amount)} · ${RECEIPT_METHOD_LABEL[r.method] ?? r.method} · ${r.reference}${r.note ? ` — ${r.note}` : ""}`,
    amount: r.amount,
    method: r.method,
    reference: r.reference,
    source: "receipt",
  }));
  const hasReceipt = (after: Prisma.JsonValue | null) => Boolean(after && typeof after === "object" && !Array.isArray(after) && "receiptId" in after);
  const legacy: InvoicePaymentRecord[] = audits
    .filter((a) => !hasReceipt(a.after))
    .map((a) => ({ invoiceId: a.entityId!, number: numberOf(a.entityId!), at: a.createdAt, summary: a.summary ?? "", amount: null, method: null, reference: null, source: "legacy" }));
  return [...fromReceipts, ...legacy].sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, 200);
}

export const RECEIPT_METHOD_LABEL: Record<string, string> = { BANK_TRANSFER: "Bank transfer", CHEQUE: "Cheque", CASH: "Cash", ESEWA: "eSewa", KHALTI: "Khalti", OTHER: "Other" };

/** Unpaid invoices with days overdue. */
export async function unpaidInvoices(companyId: string) {
  const today = todayKTM();
  const invs = await db.invoice.findMany({ where: { companyId, kind: "INVOICE", status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, orderBy: { dueDate: "asc" } });
  return invs.map((i) => {
    const due = i.dueDate ? isoDate(i.dueDate) : null;
    return { id: i.id, number: i.number, total: i.total, paid: i.paidAmount, outstanding: i.total - i.paidAmount, due, overdueDays: due && due < today ? Math.round((dateOnly(today).getTime() - dateOnly(due).getTime()) / 86400000) : 0 };
  });
}

// ───────────── reports ─────────────

/** Corporate order report rows (staff or portal): one row per order, department from the member. */
export async function companyOrderReport(companyId: string, from: string, to: string) {
  const orders = await db.order.findMany({
    where: { companyId, deliveryDate: { gte: dateOnly(from), lte: dateOnly(to) } },
    include: {
      user: { select: { name: true, email: true, membership: { select: { department: true, costCenter: true, employeeCode: true, companyId: true } } } },
      items: { select: { name: true, quantity: true } },
      adjustments: { select: { amount: true, reason: true } },
    },
    orderBy: [{ deliveryDate: "asc" }, { number: "asc" }],
  });
  return orders.map((o) => {
    const own = o.user.membership?.companyId === companyId ? o.user.membership : null;
    const companyAdj = o.adjustments.filter((a) => a.reason.startsWith(COMPANY_SHARE_PREFIX)).reduce((s, a) => s + a.amount, 0);
    return {
      date: isoDate(o.deliveryDate),
      number: o.number,
      name: o.user.name,
      email: o.user.email,
      department: own?.department ?? "",
      costCenter: own?.costCenter ?? "",
      employeeCode: own?.employeeCode ?? "",
      items: o.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(", "),
      meals: o.items.reduce((a, i) => a + i.quantity, 0),
      status: o.status,
      discount: o.discount,
      companyShare: o.companyShare,
      companyAdjustments: companyAdj,
      employeeShare: o.customerShare,
      invoiced: Boolean(o.invoiceId),
    };
  });
}

export type ReportRow = Awaited<ReturnType<typeof companyOrderReport>>[number];

/** Totals per department over report rows (cancelled / skipped orders excluded). */
export function departmentSummary(rows: ReportRow[]) {
  const live = new Set<string>(REVENUE_STATUSES);
  const by = new Map<string, { department: string; orders: number; meals: number; company: number; employee: number; discount: number }>();
  for (const r of rows) {
    if (!live.has(r.status)) continue;
    const k = r.department || "";
    const g = by.get(k) ?? { department: k, orders: 0, meals: 0, company: 0, employee: 0, discount: 0 };
    g.orders++;
    g.meals += r.meals;
    g.company += r.companyShare + r.companyAdjustments;
    g.employee += r.employeeShare;
    g.discount += r.discount;
    by.set(k, g);
  }
  return [...by.values()].sort((a, b) => b.company - a.company);
}
