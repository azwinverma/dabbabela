import { createHash, randomBytes } from "node:crypto";
import type { MemberRole, Weekday } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dateOnly, monthRange } from "@/lib/dates";
import { rs } from "@/lib/money";
import type { CurrentUser } from "@/lib/auth";
import { CURRENT_USER_INCLUDE, toCurrentUser } from "@/lib/user-context";
import { REVENUE_STATUSES } from "./transitions";
import { notify } from "./notify";
import { placeCartOrder, quoteCart, activeContracts, contractPricesOn } from "./orders";
import { getOffersForDates } from "./menu";
import { companyShareFor, negotiatedUnitPrice } from "./pricing";
import {
  budgetStatus,
  cleanWeekdays,
  companyMenuBoxIds,
  companyOrderReport,
  companySpecFor,
  departmentBudgetRemaining,
  eligibilityProblem,
  filterCompanyMenu,
  invoicePaymentHistory,
  minCommitment,
  setDeliveryInstructions,
  unpaidInvoices,
  upcomingDeliveries,
  upsertDepartmentBudget,
} from "./corporate";

/**
 * Corporate portal services. EVERY function takes the admin's own companyId (from requireCompanyAdmin)
 * and scopes every read/write to it — records of other companies are reported as "not found".
 */
export class TeamError extends Error {}

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function memberOf(companyId: string, memberId: string) {
  const m = await db.companyMember.findFirst({ where: { id: memberId, companyId }, include: { user: { select: { id: true, name: true, email: true, phoneNumber: true } }, officeLocation: true } });
  if (!m) throw new TeamError("Member not found");
  return m;
}

export async function teamOverview(companyId: string, ym: string) {
  const { start, end } = monthRange(ym);
  const where = { companyId, deliveryDate: { gte: dateOnly(start), lte: dateOnly(end) }, status: { in: REVENUE_STATUSES } };
  const [company, agg, meals, members, pending] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId } }),
    db.order.aggregate({ where, _sum: { companyShare: true, customerShare: true, total: true }, _count: true }),
    db.orderItem.aggregate({ where: { order: where }, _sum: { quantity: true } }),
    db.companyMember.count({ where: { companyId, status: "ACTIVE" } }),
    db.companyMember.count({ where: { companyId, status: "PENDING" } }),
  ]);
  const perMember = await db.order.groupBy({ by: ["userId"], where, _sum: { companyShare: true } });
  const allowanceUsed = perMember.reduce((a, r) => a + (r._sum.companyShare ?? 0), 0);
  const allowancePool = company.monthlyAllowance != null ? company.monthlyAllowance * members : null;
  return {
    company,
    ym,
    orders: agg._count,
    meals: meals._sum.quantity ?? 0,
    companySpend: agg._sum.companyShare ?? 0,
    employeeSpend: agg._sum.customerShare ?? 0,
    members,
    pending,
    eaters: perMember.length,
    allowanceUsed,
    allowancePool,
  };
}

export async function roster(companyId: string, q?: { status?: string; department?: string; search?: string }) {
  return db.companyMember.findMany({
    where: {
      companyId,
      ...(q?.status ? { status: q.status as "PENDING" | "ACTIVE" | "REMOVED" } : { status: { not: "REMOVED" } }),
      ...(q?.department ? { department: q.department } : {}),
      ...(q?.search ? { user: { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } }] } } : {}),
    },
    include: { user: { select: { id: true, name: true, email: true, phoneNumber: true } }, officeLocation: { select: { name: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
}

export type MemberPatch = {
  status?: "ACTIVE" | "REMOVED";
  role?: MemberRole;
  department?: string | null;
  costCenter?: string | null;
  employeeCode?: string | null;
  officeLocationId?: string | null;
  mealEligible?: boolean;
  eligibleDays?: Weekday[];
  allowanceOverride?: number | null;
};

export async function updateMember(companyId: string, memberId: string, actorId: string, patch: MemberPatch) {
  const m = await memberOf(companyId, memberId);
  if (patch.officeLocationId) {
    const loc = await db.officeLocation.findFirst({ where: { id: patch.officeLocationId, companyId } });
    if (!loc) throw new TeamError("Office location not found");
  }
  if (m.userId === actorId && (patch.status === "REMOVED" || patch.role === "MEMBER")) {
    const admins = await db.companyMember.count({ where: { companyId, role: "ADMIN", status: "ACTIVE", NOT: { id: m.id } } });
    if (!admins) throw new TeamError("You're the only admin — make someone else admin first");
  }
  if (patch.allowanceOverride != null && (!Number.isInteger(patch.allowanceOverride) || patch.allowanceOverride < 0)) throw new TeamError("Allowance must be a positive amount");
  const data = { ...patch, ...(patch.eligibleDays ? { eligibleDays: cleanWeekdays(patch.eligibleDays) } : {}) };
  const updated = await db.companyMember.update({ where: { id: m.id }, data });
  await audit({
    actorId,
    action: "team.member.update",
    entity: "CompanyMember",
    entityId: m.id,
    before: { status: m.status, role: m.role, department: m.department, mealEligible: m.mealEligible, eligibleDays: m.eligibleDays, allowanceOverride: m.allowanceOverride },
    after: data,
  });
  return updated;
}

export async function officeLocations(companyId: string) {
  return db.officeLocation.findMany({ where: { companyId, isActive: true }, orderBy: { name: "asc" } });
}

// ───────────── invites ─────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function createInvite(companyId: string, inviter: { id: string; name: string }, input: { email: string; name?: string | null; department?: string | null; role?: MemberRole }, origin: string) {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new TeamError(`"${input.email}" isn't a valid email`);
  const existingMember = await db.companyMember.findFirst({ where: { companyId, status: { not: "REMOVED" }, user: { email } } });
  if (existingMember) throw new TeamError(`${email} is already on the team`);
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const token = randomBytes(24).toString("base64url");
  await db.companyInvite.deleteMany({ where: { companyId, email, acceptedAt: null } });
  const invite = await db.companyInvite.create({
    data: { companyId, email, name: input.name?.trim() || null, department: input.department?.trim() || null, role: input.role ?? "MEMBER", tokenHash: hash(token), expiresAt: new Date(Date.now() + 14 * 86400000), invitedById: inviter.id },
  });
  await notify("company.invite", { email }, { company: company.name, inviter: inviter.name }, { link: `${origin}/team/invite/${token}`, dedupeKey: `invite:${invite.id}` });
  return { invite, token };
}

export async function findInvite(token: string) {
  const inv = await db.companyInvite.findUnique({ where: { tokenHash: hash(token) }, include: { company: { select: { id: true, name: true, isActive: true } } } });
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date() || !inv.company.isActive) return null;
  return inv;
}

/** A signed-in user accepts an invite. The invite email must match the account email. */
export async function acceptInvite(token: string, user: { id: string; email: string }) {
  const inv = await findInvite(token);
  if (!inv) throw new TeamError("This invite has expired or was already used");
  if (inv.email !== user.email.toLowerCase()) throw new TeamError(`This invite was sent to ${inv.email}. Log in with that email to accept it.`);
  const existing = await db.companyMember.findUnique({ where: { userId: user.id } });
  if (existing && existing.status !== "REMOVED" && existing.companyId !== inv.companyId) throw new TeamError("You're already part of another company's lunch account — leave it first from your profile");
  await db.$transaction([
    db.companyMember.upsert({
      where: { userId: user.id },
      create: { companyId: inv.companyId, userId: user.id, role: inv.role, status: "ACTIVE", department: inv.department },
      update: { companyId: inv.companyId, role: inv.role, status: "ACTIVE", department: inv.department ?? existing?.department },
    }),
    db.companyInvite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } }),
  ]);
  return inv.company;
}

export async function pendingInvites(companyId: string) {
  return db.companyInvite.findMany({ where: { companyId, acceptedAt: null }, orderBy: { createdAt: "desc" } });
}

export async function revokeInvite(companyId: string, inviteId: string) {
  const r = await db.companyInvite.deleteMany({ where: { id: inviteId, companyId, acceptedAt: null } });
  if (!r.count) throw new TeamError("Invite not found");
}

// ───────────── bulk CSV import ─────────────

export type ImportRow = { line: number; name: string; email: string; department: string; costCenter: string; error: string | null };

/** Parse "name,email,department,cost centre" (header optional). Pure — nothing is saved. */
export function parseRosterCsv(text: string): ImportRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 501);
  const out: ImportRow[] = [];
  const seen = new Set<string>();
  lines.forEach((l, i) => {
    const cells = splitCsv(l);
    if (i === 0 && /email/i.test(l) && !EMAIL.test(cells[1] ?? "")) return; // header
    const [name = "", email = "", department = "", costCenter = ""] = cells.map((c) => c.trim());
    let error: string | null = null;
    const e = email.toLowerCase();
    if (!name) error = "Name missing";
    else if (!EMAIL.test(e)) error = "Email isn't valid";
    else if (seen.has(e)) error = "Duplicate email in file";
    seen.add(e);
    out.push({ line: i + 1, name: name.slice(0, 120), email: e, department: department.slice(0, 80), costCenter: costCenter.slice(0, 40), error });
  });
  return out;
}

function splitCsv(line: string) {
  const out: string[] = [];
  let cur = "",
    q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export async function commitImport(companyId: string, inviter: { id: string; name: string }, rows: ImportRow[], origin: string) {
  const results: { email: string; ok: boolean; message: string }[] = [];
  for (const r of rows) {
    if (r.error) {
      results.push({ email: r.email, ok: false, message: r.error });
      continue;
    }
    try {
      await createInvite(companyId, inviter, { email: r.email, name: r.name, department: r.department }, origin);
      results.push({ email: r.email, ok: true, message: "Invited" });
    } catch (e) {
      results.push({ email: r.email, ok: false, message: e instanceof Error ? e.message : "Failed" });
    }
  }
  await audit({ actorId: inviter.id, action: "team.import", entity: "Company", entityId: companyId, summary: `${results.filter((x) => x.ok).length}/${rows.length} invited` });
  return results;
}

// ───────────── team order ─────────────

async function loadMemberUser(userId: string): Promise<CurrentUser> {
  const u = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: CURRENT_USER_INCLUDE,
  });
  return toCurrentUser(u, "team-order");
}

/**
 * Delivery address for a member's team order: their office-location address (created if missing), else
 * their default address. The office address carries the receiver and the company's delivery instructions.
 */
async function memberAddressId(user: CurrentUser, companyInstructions: string | null) {
  const loc = user.membership?.officeLocation;
  if (loc) {
    const instructions = [loc.receiverName ? `Hand to ${loc.receiverName}` : null, companyInstructions].filter(Boolean).join(". ").slice(0, 500) || null;
    const found = user.addresses.find((a) => a.type === "OFFICE" && a.line1 === loc.line1 && a.area === loc.area);
    if (found) {
      if (found.label === loc.name && found.instructions !== instructions) await db.address.update({ where: { id: found.id }, data: { instructions } });
      return found.id;
    }
    const a = await db.address.create({
      data: { userId: user.id, label: loc.name, type: "OFFICE", recipientName: user.name, phone: loc.receiverPhone || user.phoneNumber || "", placeName: loc.name, line1: loc.line1, area: loc.area, ward: loc.ward, landmark: loc.landmark, zoneId: loc.zoneId, instructions },
    });
    return a.id;
  }
  return user.addresses[0]?.id ?? null;
}

/** Dabbas the company's admin can order on `date`: the day's menu, limited to the company menu, at negotiated prices. */
export async function teamMenu(companyId: string, date: string) {
  const [offers, allowed, contracts] = await Promise.all([getOffersForDates([date]), companyMenuBoxIds(companyId), activeContracts(companyId, date, date)]);
  const offer = offers.get(date);
  const prices = contractPricesOn(contracts, date);
  const items = filterCompanyMenu(offer?.items ?? [], allowed).map((i) => ({ ...i, price: negotiatedUnitPrice(i.price, i.box.id, prices), listPrice: i.price }));
  return { closed: offer?.closed ?? false, items, limited: allowed != null };
}

export type TeamOrderResult = { name: string; ok: boolean; message: string; warning?: string };

/**
 * Order one dabba per selected member for a date. Each member gets their own order (their split
 * applies); the admin is recorded as placedBy. Members' share, if any, is cash at hand-off.
 * - Only dabbas on the day's menu and on the company menu (if it has one).
 * - Members not eligible that day (mealEligible / eligibleDays) are refused.
 * - Department budget: when the company share would go beyond what's left of the member's department
 *   budget the member is refused (`overBudget: "refuse"`, default) or ordered with the company share
 *   capped at the budget and the rest paid by the employee (`"employee-pays"`, reported as a warning).
 */
export async function placeTeamOrder(
  companyId: string,
  admin: { id: string },
  input: { memberIds: string[]; date: string; boxId: string; slotId?: string | null; overBudget?: "refuse" | "employee-pays" },
): Promise<TeamOrderResult[]> {
  if (!input.memberIds.length) throw new TeamError("Pick at least one person");
  const menu = await teamMenu(companyId, input.date);
  if (!menu.items.some((i) => i.box.id === input.boxId)) throw new TeamError(menu.limited ? "That dabba isn't on your company menu that day" : "That dabba isn't on the menu that day");
  const members = await db.companyMember.findMany({ where: { id: { in: input.memberIds }, companyId, status: "ACTIVE" } });
  if (members.length !== new Set(input.memberIds).size) throw new TeamError("Some people aren't active members of your team");
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const ym = input.date.slice(0, 7);
  const results: TeamOrderResult[] = [];
  for (const m of members) {
    const user = await loadMemberUser(m.userId);
    try {
      const notEligible = eligibilityProblem(m, input.date);
      if (notEligible) throw new TeamError(notEligible);
      const addressId = await memberAddressId(user, company.deliveryInstructions);
      if (!addressId) throw new TeamError("No office location or address on file");
      const fresh = await loadMemberUser(m.userId);
      const lines = [{ kind: "box" as const, id: input.boxId, date: input.date, qty: 1 }];
      const idempotencyKey = `team:${companyId}:${m.id}:${input.date}:${input.boxId}`;
      let warning: string | undefined;
      const replay = await db.payment.findUnique({ where: { idempotencyKey }, select: { id: true } });
      if (!replay && company.billingMode !== "EMPLOYEE_PAID") {
        const left = await departmentBudgetRemaining(companyId, m.department, ym);
        if (left != null) {
          const q = await quoteCart(fresh, { lines, addressId });
          if (!q.ok) throw new TeamError(q.error ?? "Can't order that dabba");
          const wanted = companyShareFor(q.total, 1, await companySpecFor(m.userId, company, [input.date], { ignoreBudget: true }));
          if (wanted > left) {
            const msg = `${m.department} budget for ${ym} has ${rs(left)} left; this lunch needs ${rs(wanted)} from the company`;
            if (input.overBudget !== "employee-pays") throw new TeamError(`Over budget — ${msg}`);
            warning = `${msg}; ${rs(wanted - left)} is paid by the employee`;
          }
        }
      }
      const r = await placeCartOrder(fresh, { lines, addressId, slotId: input.slotId ?? null, method: "CASH", source: "CORPORATE", placedById: admin.id, idempotencyKey });
      results.push({ name: user.name, ok: true, message: r.replayed ? "Already ordered" : `Order ${r.orders.map((o) => o.number).join(", ")}`, ...(warning ? { warning } : {}) });
    } catch (e) {
      results.push({ name: user.name, ok: false, message: e instanceof Error ? e.message : "Failed" });
    }
  }
  await audit({
    actorId: admin.id,
    action: "team.order",
    entity: "Company",
    entityId: companyId,
    summary: `${results.filter((r) => r.ok).length} dabbas for ${input.date}`,
    after: { date: input.date, boxId: input.boxId, overBudget: input.overBudget ?? "refuse", results },
  });
  return results;
}

// ───────────── budgets, delivery, commitments ─────────────

export async function teamBudgets(companyId: string, ym: string) {
  return budgetStatus(companyId, ym);
}

export async function setTeamBudget(companyId: string, actorId: string, input: { department: string; month: string; amount: number | null }) {
  return upsertDepartmentBudget(companyId, actorId, input);
}

export async function setTeamDeliveryInstructions(companyId: string, actorId: string, text: string | null) {
  return setDeliveryInstructions(companyId, actorId, text);
}

export async function teamDeliveries(companyId: string, days = 14) {
  return upcomingDeliveries(companyId, undefined, days);
}

export async function teamCommitment(companyId: string, ym: string) {
  return minCommitment(companyId, ym);
}

export async function teamPayments(companyId: string) {
  const [unpaid, history] = await Promise.all([unpaidInvoices(companyId), invoicePaymentHistory(companyId)]);
  return { unpaid, history };
}

// ───────────── reports ─────────────

export async function teamReport(companyId: string, from: string, to: string) {
  return companyOrderReport(companyId, from, to);
}

export async function teamFeedback(companyId: string) {
  const rows = await db.feedback.findMany({ where: { order: { companyId } }, include: { order: { select: { deliveryDate: true, items: { select: { name: true } } } } }, orderBy: { createdAt: "desc" }, take: 50 });
  const avg = rows.length ? rows.reduce((a, r) => a + r.rating, 0) / rows.length : null;
  return { avg, count: rows.length, rows };
}

export async function teamInvoices(companyId: string) {
  return db.invoice.findMany({ where: { companyId, status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" } });
}

export async function teamInvoice(companyId: string, invoiceId: string) {
  const inv = await db.invoice.findFirst({ where: { id: invoiceId, companyId, status: { not: "DRAFT" } }, include: { lines: true } });
  if (!inv) throw new TeamError("Invoice not found");
  return inv;
}
