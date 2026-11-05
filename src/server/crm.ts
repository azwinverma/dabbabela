import "server-only";
import type { DietPreference, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can, type Permission } from "@/lib/permissions";
import { getRequestContext } from "@/lib/request-context";
import { formatNepalPhone, isNepalMobile, maskEmail, maskPhone, normalizeNepalPhone } from "@/lib/phone";
import { PREF_CHANNELS, PREF_TOPICS } from "@/lib/actions/account-constants";
import { userAttributionSnapshot, type Touch } from "@/lib/attribution";
import { dateWhere, one, pageWindow, parseDateRange, parseEnum, type ListState, type SearchParamsRecord } from "@/app/admin/_kit/params";
import { addCredit } from "./ledger";
import { lockUser } from "./capacity";
import { completeDataRequest, exportUserData } from "./privacy";
import { csv } from "./reports";

/**
 * CRM (WP-11): customer directory, 360 profile, staff edits, suspension, credit, notes, communication preferences,
 * privacy and exports. Every function takes the acting staff member and checks permissions itself (pages and actions
 * check too). Contact details (email, phone, street address, IP) are masked unless the actor holds `customers.pii`.
 * Passwords, sessions tokens, 2FA secrets and payment credentials are never selected.
 */

export class CrmError extends Error {}

export type Staff = { id: string; role: Role | string; customGrants?: readonly string[] | null };

function need(actor: Staff, ...perms: Permission[]) {
  for (const p of perms) if (!can(actor, p)) throw new CrmError(`You don't have permission for this (${p})`);
}

async function customerOr404(id: string) {
  const u = await db.user.findUnique({ where: { id } });
  if (!u || u.role !== "CUSTOMER") throw new CrmError("Customer not found");
  return u;
}

// ───────────────────────────── Directory ─────────────────────────────

export const CUSTOMER_SORTS = ["createdAt", "name", "orders", "lastLoginAt"] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];
const DIETS: DietPreference[] = ["ANY", "VEG", "EGG_OK", "VEGAN"];

export type CustomerFilters = {
  q?: string;
  status?: "active" | "suspended";
  company?: "yes" | "no";
  diet?: DietPreference;
  allergies?: "yes";
  plan?: "active";
  source?: string;
  from?: string;
  to?: string;
  gte?: Date;
  lte?: Date;
};

export function parseCustomerFilters(sp: SearchParamsRecord): CustomerFilters {
  const range = parseDateRange(sp);
  const statusRaw = one(sp, "status");
  return {
    q: one(sp, "q"),
    // "inactive" kept for old links / saved views
    status: statusRaw === "inactive" ? "suspended" : parseEnum(sp, "status", ["active", "suspended"] as const),
    company: parseEnum(sp, "company", ["yes", "no"] as const),
    diet: parseEnum(sp, "diet", DIETS),
    allergies: parseEnum(sp, "allergies", ["yes"] as const),
    plan: parseEnum(sp, "plan", ["active"] as const),
    source: one(sp, "source")?.slice(0, 100),
    ...range,
  };
}

/** Where-clause for the directory. Email / phone search only for actors who may see contact details (no PII probing). */
export function customerWhere(actor: Staff, f: CustomerFilters): Prisma.UserWhereInput {
  const pii = can(actor, "customers.pii");
  const q = f.q?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const or: Prisma.UserWhereInput[] = [];
  if (q) {
    or.push({ name: { contains: q, mode: "insensitive" } }, { addresses: { some: { area: { contains: q, mode: "insensitive" } } } });
    if (pii) {
      or.push({ email: { contains: q, mode: "insensitive" } });
      if (digits.length >= 4) or.push({ phoneNumber: { contains: digits } });
    }
    if (/^c[a-z0-9]{20,30}$/.test(q)) or.push({ id: q });
  }
  const joined = dateWhere(f);
  return {
    role: "CUSTOMER",
    deletedAt: null,
    ...(f.status === "suspended" ? { isActive: false } : f.status === "active" ? { isActive: true } : {}),
    ...(f.company === "yes" ? { membership: { status: "ACTIVE" } } : f.company === "no" ? { OR: [{ membership: null }, { membership: { status: { not: "ACTIVE" } } }] } : {}),
    ...(f.diet ? { diet: f.diet } : {}),
    ...(f.allergies === "yes" ? { NOT: { allergies: { isEmpty: true } } } : {}),
    ...(f.plan === "active" ? { subscriptions: { some: { status: { in: ["ACTIVE", "PAUSED"] } } } } : {}),
    ...(f.source ? (f.source === "unknown" ? { acquisitionSource: null } : { acquisitionSource: f.source }) : {}),
    ...(joined ? { createdAt: joined } : {}),
    ...(or.length ? { AND: [{ OR: or }] } : {}),
  };
}

export type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  isActive: boolean;
  area: string | null;
  diet: DietPreference;
  allergyCount: number;
  company: string | null;
  orders: number;
  plans: number;
  source: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
};

function orderByFor(state: Pick<ListState<CustomerSort>, "sort" | "dir">): Prisma.UserOrderByWithRelationInput[] {
  const dir = state.dir;
  if (state.sort === "name") return [{ name: dir }, { id: "asc" }];
  if (state.sort === "orders") return [{ orders: { _count: dir } }, { id: "asc" }];
  if (state.sort === "lastLoginAt") return [{ lastLoginAt: { sort: dir, nulls: "last" } }, { id: "asc" }];
  return [{ createdAt: dir }, { id: "asc" }];
}

export async function listCustomers(actor: Staff, f: CustomerFilters, state: ListState<CustomerSort>) {
  need(actor, "customers.view");
  const pii = can(actor, "customers.pii");
  const where = customerWhere(actor, f);
  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        isActive: true,
        diet: true,
        allergies: true,
        acquisitionSource: true,
        createdAt: true,
        lastLoginAt: true,
        membership: { select: { status: true, company: { select: { name: true } } } },
        addresses: { where: { isDefault: true, archivedAt: null }, select: { area: true }, take: 1 },
        _count: { select: { orders: true, subscriptions: true } },
      },
      orderBy: orderByFor(state),
      ...pageWindow(state),
    }),
    db.user.count({ where }),
  ]);
  const out: CustomerRow[] = rows.map((c) => ({
    id: c.id,
    name: c.name,
    email: pii ? c.email : maskEmail(c.email),
    phone: pii ? formatNepalPhone(c.phoneNumber) : maskPhone(c.phoneNumber),
    isActive: c.isActive,
    area: c.addresses[0]?.area ?? null,
    diet: c.diet,
    allergyCount: c.allergies.length,
    company: c.membership ? `${c.membership.company.name}${c.membership.status !== "ACTIVE" ? ` (${c.membership.status.toLowerCase()})` : ""}` : null,
    orders: c._count.orders,
    plans: c._count.subscriptions,
    source: c.acquisitionSource,
    createdAt: c.createdAt,
    lastLoginAt: c.lastLoginAt,
  }));
  return { rows: out, total, pii };
}

/** Distinct acquisition sources for the directory filter. */
export async function acquisitionSources(): Promise<string[]> {
  const g = await db.user.groupBy({ by: ["acquisitionSource"], where: { role: "CUSTOMER", deletedAt: null, acquisitionSource: { not: null } }, orderBy: { acquisitionSource: "asc" }, take: 50 });
  return g.map((r) => r.acquisitionSource!).filter(Boolean);
}

/** Directory CSV (current filters), masked per `customers.pii`, audited. */
export async function exportCustomerDirectory(actor: Staff, f: CustomerFilters) {
  need(actor, "customers.export");
  const pii = can(actor, "customers.pii");
  const us = await db.user.findMany({
    where: customerWhere(actor, f),
    select: {
      name: true,
      email: true,
      phoneNumber: true,
      diet: true,
      allergies: true,
      marketingOptIn: true,
      isActive: true,
      acquisitionSource: true,
      createdAt: true,
      membership: { select: { company: { select: { name: true } } } },
      _count: { select: { orders: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 50_000,
  });
  const rows: (string | number | boolean | null | undefined | Date)[][] = [["Name", "Email", "Phone", "Diet", "Allergies", "Company", "Orders", "Marketing opt-in", "Active", "Acquisition source", "Joined"]];
  for (const u of us)
    rows.push([u.name, pii ? u.email : maskEmail(u.email), pii ? (u.phoneNumber ?? "") : maskPhone(u.phoneNumber), u.diet, u.allergies.join(" "), u.membership?.company.name, u._count.orders, u.marketingOptIn, u.isActive, u.acquisitionSource ?? "", u.createdAt]);
  const filters = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== undefined && k !== "gte" && k !== "lte"));
  await audit({ actorId: actor.id, action: "customer.directory_export", entity: "Export", entityId: "customers", summary: `${us.length} customers${pii ? ", with contact details" : ", contact details masked"}`, after: { filters } });
  return { csv: csv(rows), count: us.length, masked: !pii };
}

// ───────────────────────────── 360 profile ─────────────────────────────

function maskIp(ip: string | null) {
  if (!ip) return null;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 2).join(":")}:…`;
  const p = ip.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}.•.•` : "•••";
}

const LIVE_STATUSES = ["SCHEDULED", "CONFIRMED", "PREPARING", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED"] as const;

/** Everything staff see on the customer page, already masked for the actor. */
export async function customerProfile(actor: Staff, id: string) {
  need(actor, "customers.view");
  const pii = can(actor, "customers.pii");
  const c = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      emailVerified: true,
      phoneNumber: true,
      phoneNumberVerified: true,
      twoFactorEnabled: true,
      role: true,
      isActive: true,
      locale: true,
      diet: true,
      spiceTolerance: true,
      allergies: true,
      avoidOnionGarlic: true,
      dietaryNotes: true,
      marketingOptIn: true,
      internalNote: true,
      lastLoginAt: true,
      deletedAt: true,
      createdAt: true,
      acquisitionSource: true,
      attribution: true,
      addresses: { orderBy: [{ archivedAt: "asc" }, { isDefault: "desc" }], include: { zone: { select: { name: true } } } },
      membership: { select: { role: true, status: true, department: true, company: { select: { id: true, name: true } } } },
      orders: {
        orderBy: { deliveryDate: "desc" },
        take: 25,
        select: { id: true, number: true, deliveryDate: true, status: true, total: true, source: true, campaignId: true, attribution: true, items: { select: { name: true, quantity: true } } },
      },
      subscriptions: { orderBy: { createdAt: "desc" }, select: { id: true, reference: true, status: true, startDate: true, endDate: true, total: true, plan: { select: { name: true } } } },
      payments: { orderBy: { createdAt: "desc" }, take: 15, select: { id: true, reference: true, method: true, status: true, amount: true, refundedAmount: true, createdAt: true } },
      credits: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, amount: true, reason: true, note: true, createdAt: true, actorId: true } },
      tickets: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, number: true, subject: true, status: true, priority: true, createdAt: true } },
      feedback: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, rating: true, comment: true, createdAt: true, order: { select: { id: true, number: true } } } },
      dataRequests: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, type: true, status: true, note: true, createdAt: true } },
      loginEvents: { orderBy: { createdAt: "desc" }, take: 15, select: { id: true, method: true, success: true, reason: true, ip: true, userAgent: true, createdAt: true } },
      _count: { select: { orders: true, sessions: true } },
    },
  });
  if (!c || c.role !== "CUSTOMER") return null;

  const [balance, spent, refunds, prefsRows, timeline, pending] = await Promise.all([
    db.creditLedger.aggregate({ where: { userId: id }, _sum: { amount: true } }),
    db.order.aggregate({ where: { userId: id, status: { in: [...LIVE_STATUSES] } }, _sum: { customerShare: true } }),
    db.refund.findMany({ where: { payment: { userId: id } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, amount: true, status: true, method: true, reason: true, createdAt: true } }),
    db.notificationPreference.findMany({ where: { userId: id } }),
    customerTimeline(actor, id),
    pendingCreditRequests(id),
  ]);

  const prefs: Record<string, boolean> = {};
  for (const t of PREF_TOPICS)
    for (const ch of PREF_CHANNELS) {
      const p = prefsRows.find((x) => x.topic === t && x.channel === ch);
      prefs[`${t}:${ch}`] = p ? p.enabled : t === "MARKETING" ? c.marketingOptIn && ch !== "SMS" : ch !== "SMS" || t === "ORDER_UPDATES";
    }

  return {
    pii,
    id: c.id,
    name: c.name,
    email: pii ? c.email : maskEmail(c.email),
    emailVerified: c.emailVerified && !c.email.endsWith("@phone.dabbabela.local"),
    phone: pii ? formatNepalPhone(c.phoneNumber) : maskPhone(c.phoneNumber),
    phoneVerified: Boolean(c.phoneNumberVerified),
    twoFactorEnabled: Boolean(c.twoFactorEnabled),
    isActive: c.isActive,
    deletedAt: c.deletedAt,
    createdAt: c.createdAt,
    lastLoginAt: c.lastLoginAt,
    activeSessions: c._count.sessions,
    locale: c.locale,
    diet: c.diet,
    spiceTolerance: c.spiceTolerance,
    allergies: c.allergies,
    avoidOnionGarlic: c.avoidOnionGarlic,
    dietaryNotes: c.dietaryNotes,
    marketingOptIn: c.marketingOptIn,
    internalNote: c.internalNote,
    acquisitionSource: c.acquisitionSource,
    attribution: (c.attribution ?? null) as (Partial<Touch> & { last?: Partial<Touch> }) | null,
    company: c.membership ? { id: c.membership.company.id, name: c.membership.company.name, role: c.membership.role, status: c.membership.status, department: c.membership.department } : null,
    addresses: c.addresses.map((a) => ({
      id: a.id,
      label: a.label,
      type: a.type,
      isDefault: a.isDefault,
      archived: Boolean(a.archivedAt),
      zone: a.zone?.name ?? null,
      address: pii ? [a.placeName, a.line1, a.area, a.ward ? `Ward ${a.ward}` : null, a.landmark].filter(Boolean).join(", ") : `${a.area}${a.ward ? `, ward ${a.ward}` : ""}`,
      recipient: pii ? `${a.recipientName} · ${formatNepalPhone(a.phone)}` : a.recipientName,
      instructions: pii ? a.instructions : null,
    })),
    orderCount: c._count.orders,
    spent: spent._sum.customerShare ?? 0,
    balance: balance._sum.amount ?? 0,
    orders: c.orders,
    subscriptions: c.subscriptions,
    payments: c.payments,
    refunds,
    credits: c.credits,
    pendingCredits: pending,
    tickets: c.tickets,
    feedback: c.feedback,
    dataRequests: c.dataRequests,
    loginEvents: c.loginEvents.map((e) => ({ ...e, ip: pii ? e.ip : maskIp(e.ip), userAgent: pii ? e.userAgent : null })),
    prefs,
    timeline,
  };
}

export type CustomerProfile = NonNullable<Awaited<ReturnType<typeof customerProfile>>>;

const TIMELINE_ACTIONS = ["customer.", "credit.", "privacy.", "user.", "order.staff_create"];

/** Staff notes and staff changes on this customer, newest first (from the audit log). */
export async function customerTimeline(actor: Staff, userId: string) {
  need(actor, "customers.view");
  const rows = await db.auditLog.findMany({
    where: { OR: [{ entity: "User", entityId: userId }, { entity: "CreditRequest", after: { path: ["userId"], equals: userId } }], AND: [{ OR: TIMELINE_ACTIONS.map((a) => ({ action: { startsWith: a } })) }] },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, action: true, summary: true, reason: true, createdAt: true, approvedById: true, actor: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, action: r.action, summary: r.summary, reason: r.reason, at: r.createdAt, actor: r.actor?.name ?? "System", approved: Boolean(r.approvedById) }));
}

// ───────────────────────────── Staff edits ─────────────────────────────

export type CustomerEdit = {
  name?: string;
  locale?: string;
  diet?: string;
  spiceTolerance?: number;
  allergies?: string[];
  avoidOnionGarlic?: boolean;
  dietaryNotes?: string | null;
  phone?: string | null;
};

/**
 * Update the fields staff may change. Email (the sign-in identity) and passwords are never staff-editable.
 * Changing the phone needs `customers.pii` and clears its verified flag. Audited with a before/after of changed
 * fields only (phone masked in the audit trail).
 */
export async function updateCustomer(actor: Staff, id: string, input: CustomerEdit, reason?: string | null) {
  need(actor, "customers.edit");
  const u = await customerOr404(id);
  if (u.deletedAt) throw new CrmError("This customer's personal data was deleted");
  const data: Prisma.UserUpdateInput = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const set = <K extends keyof typeof u>(k: K, v: (typeof u)[K], shown: unknown = v, shownBefore: unknown = u[k]) => {
    if (JSON.stringify(u[k]) === JSON.stringify(v)) return;
    (data as Record<string, unknown>)[k as string] = v;
    before[k as string] = shownBefore;
    after[k as string] = shown;
  };
  if (input.name !== undefined) {
    const n = input.name.trim().replace(/\s+/g, " ");
    if (n.length < 2 || n.length > 80) throw new CrmError("Name must be 2–80 characters");
    set("name", n);
  }
  if (input.locale !== undefined) {
    if (input.locale !== "en" && input.locale !== "ne") throw new CrmError("Language must be English or Nepali");
    set("locale", input.locale);
  }
  if (input.diet !== undefined) {
    if (!DIETS.includes(input.diet as DietPreference)) throw new CrmError("Unknown diet");
    set("diet", input.diet as DietPreference);
  }
  if (input.spiceTolerance !== undefined) {
    if (!Number.isInteger(input.spiceTolerance) || input.spiceTolerance < 0 || input.spiceTolerance > 4) throw new CrmError("Spice level must be 0–4");
    set("spiceTolerance", input.spiceTolerance);
  }
  if (input.allergies !== undefined) {
    const codes = [...new Set(input.allergies.map((a) => a.trim().toUpperCase()).filter(Boolean))].sort();
    if (codes.length) {
      const known = new Set((await db.allergen.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((a) => a.code));
      const bad = codes.filter((c) => !known.has(c));
      if (bad.length) throw new CrmError(`Unknown allergen: ${bad.join(", ")}`);
    }
    set("allergies", codes, codes, [...u.allergies].sort());
  }
  if (input.avoidOnionGarlic !== undefined) set("avoidOnionGarlic", Boolean(input.avoidOnionGarlic));
  if (input.dietaryNotes !== undefined) {
    const n = (input.dietaryNotes ?? "").trim().slice(0, 500);
    set("dietaryNotes", n || null);
  }
  if (input.phone !== undefined) {
    need(actor, "customers.pii");
    const raw = (input.phone ?? "").trim();
    const phone = raw ? normalizeNepalPhone(raw) : null;
    if (raw && (!phone || !isNepalMobile(phone))) throw new CrmError("Enter a Nepal mobile number (98/97/96…)");
    if (phone !== u.phoneNumber) {
      if (phone && (await db.user.findFirst({ where: { phoneNumber: phone, NOT: { id } }, select: { id: true } }))) throw new CrmError("That mobile number is on another account");
      set("phoneNumber", phone, maskPhone(phone), maskPhone(u.phoneNumber));
      (data as Record<string, unknown>).phoneNumberVerified = false;
    }
  }
  const changed = Object.keys(after);
  if (!changed.length) return { changed };
  await db.user.update({ where: { id }, data });
  await audit({ actorId: actor.id, action: "customer.update", entity: "User", entityId: id, summary: `Updated ${changed.join(", ")}`, before, after, reason: reason?.trim() || null });
  return { changed };
}

// ───────────────────────────── Suspension ─────────────────────────────

/**
 * Suspend (isActive=false) or reactivate. Suspension deletes every session (signed out everywhere); Better Auth's
 * session hook then refuses new sign-ins and `getCurrentUser` returns null, so a suspended customer can't order.
 */
export async function setCustomerActive(actor: Staff, id: string, active: boolean, reason: string) {
  need(actor, "customers.edit", "customers.pii");
  const why = reason.trim();
  if (why.length < 3) throw new CrmError("Give a reason — it goes in the audit log");
  const u = await customerOr404(id);
  if (u.deletedAt) throw new CrmError("This customer's personal data was deleted; the account stays closed");
  if (u.isActive === active) return { changed: false, sessionsRevoked: 0 };
  const [, revoked] = await db.$transaction([db.user.update({ where: { id }, data: { isActive: active } }), db.session.deleteMany({ where: { userId: id } })]);
  await audit({
    actorId: actor.id,
    action: active ? "customer.reactivate" : "customer.suspend",
    entity: "User",
    entityId: id,
    summary: active ? "Reactivated" : `Suspended, ${revoked.count} session(s) signed out`,
    before: { isActive: u.isActive },
    after: { isActive: active },
    reason: why,
  });
  return { changed: true, sessionsRevoked: revoked.count };
}

/** Defence in depth for customer checkout: re-reads the account so a suspension mid-session blocks ordering at once. */
export async function assertCustomerCanOrder(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { isActive: true, deletedAt: true } });
  if (!u || !u.isActive || u.deletedAt) throw new CrmError("This account is suspended — contact us to sort it out");
}

// ───────────────────────────── Credit ─────────────────────────────

/** Most a single profile credit can be (paisa). Larger goodwill goes through refunds. */
export const CREDIT_MAX = 25_000_00;

function checkAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) throw new CrmError("Enter a positive amount");
  if (amount > CREDIT_MAX) throw new CrmError(`A single credit can't exceed Rs ${(CREDIT_MAX / 100).toLocaleString("en-IN")}`);
}

/** Direct credit by someone who may approve credit: they are recorded as the approver. */
export async function issueCredit(actor: Staff, userId: string, amount: number, note: string) {
  need(actor, "refunds.approve");
  checkAmount(amount);
  const why = note.trim();
  if (why.length < 3) throw new CrmError("A reason is required for every credit");
  const u = await customerOr404(userId);
  if (u.deletedAt) throw new CrmError("This customer's personal data was deleted");
  const row = await db.$transaction((tx) => addCredit(tx, { userId, amount, reason: "GOODWILL", actorId: actor.id, note: why.slice(0, 300) }));
  await audit({ actorId: actor.id, approvedById: actor.id, action: "credit.issue", entity: "User", entityId: userId, summary: `+Rs ${(amount / 100).toFixed(2)} goodwill credit`, reason: why, after: { amount, ledgerId: row.id } });
  return row;
}

/** Credit requested by staff who can't approve: waits for an approver (stored as an audit entry). */
export async function requestCredit(actor: Staff, userId: string, amount: number, note: string) {
  need(actor, "refunds.create");
  checkAmount(amount);
  const why = note.trim();
  if (why.length < 3) throw new CrmError("A reason is required for every credit");
  const u = await customerOr404(userId);
  if (u.deletedAt) throw new CrmError("This customer's personal data was deleted");
  const ctx = await getRequestContext();
  // Written directly (not via audit(), which swallows errors) because the row *is* the pending request.
  const row = await db.auditLog.create({
    data: {
      actorId: actor.id,
      action: "credit.request",
      entity: "User",
      entityId: userId,
      summary: `Requested +Rs ${(amount / 100).toFixed(2)} credit`,
      reason: why.slice(0, 300),
      after: { amount, note: why.slice(0, 300) },
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
    select: { id: true },
  });
  return { requestId: row.id };
}

export type PendingCredit = { id: string; amount: number; note: string; requestedBy: string; requestedById: string | null; at: Date };

export async function pendingCreditRequests(userId: string): Promise<PendingCredit[]> {
  const reqs = await db.auditLog.findMany({ where: { action: "credit.request", entity: "User", entityId: userId }, orderBy: { createdAt: "desc" }, take: 20, include: { actor: { select: { name: true } } } });
  if (!reqs.length) return [];
  const decided = new Set((await db.auditLog.findMany({ where: { entity: "CreditRequest", entityId: { in: reqs.map((r) => r.id) } }, select: { entityId: true } })).map((d) => d.entityId));
  return reqs
    .filter((r) => !decided.has(r.id))
    .map((r) => {
      const a = (r.after ?? {}) as { amount?: number; note?: string };
      return { id: r.id, amount: Number(a.amount ?? 0), note: String(a.note ?? r.reason ?? ""), requestedBy: r.actor?.name ?? "—", requestedById: r.actorId, at: r.createdAt };
    });
}

/**
 * Approve or reject a pending credit request. The approver must hold `refunds.approve` and can't approve their own
 * request. Exactly once: the decision and the ledger row are written in one transaction under a lock.
 */
export async function decideCreditRequest(approver: Staff, requestId: string, approve: boolean, note?: string | null) {
  need(approver, "refunds.approve");
  const req = await db.auditLog.findUnique({ where: { id: requestId } });
  if (!req || req.action !== "credit.request" || req.entity !== "User" || !req.entityId) throw new CrmError("Credit request not found");
  if (req.actorId === approver.id) throw new CrmError("Someone else has to approve a credit you requested");
  const a = (req.after ?? {}) as { amount?: number; note?: string };
  const amount = Number(a.amount ?? 0);
  checkAmount(amount);
  const userId = req.entityId;
  const ctx = await getRequestContext();
  return db.$transaction(async (tx) => {
    await lockUser(tx, `credit-request:${requestId}`);
    if (await tx.auditLog.findFirst({ where: { entity: "CreditRequest", entityId: requestId }, select: { id: true } })) throw new CrmError("This request was already decided");
    let ledgerId: string | null = null;
    if (approve) {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { deletedAt: true } });
      if (!u || u.deletedAt) throw new CrmError("This customer's personal data was deleted");
      ledgerId = (await addCredit(tx, { userId, amount, reason: "GOODWILL", actorId: req.actorId, note: String(a.note ?? "").slice(0, 300) || "Goodwill credit" })).id;
    }
    await tx.auditLog.create({
      data: {
        actorId: approver.id,
        approvedById: approve ? approver.id : null,
        action: approve ? "credit.approve" : "credit.reject",
        entity: "CreditRequest",
        entityId: requestId,
        summary: `${approve ? "Approved" : "Rejected"} +Rs ${(amount / 100).toFixed(2)} credit`,
        reason: note?.trim() || null,
        after: { userId, amount, requestedById: req.actorId, ledgerId },
        requestId: ctx.requestId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });
    return { approved: approve, ledgerId };
  });
}

// ───────────────────────────── Notes ─────────────────────────────

/** Timeline note (append-only, in the audit log). */
export async function addCustomerNote(actor: Staff, userId: string, text: string) {
  need(actor, "customers.edit");
  const body = text.trim().replace(/\s+\n/g, "\n");
  if (body.length < 2) throw new CrmError("Write the note first");
  if (body.length > 1000) throw new CrmError("Keep notes under 1,000 characters");
  await customerOr404(userId);
  await audit({ actorId: actor.id, action: "customer.note_added", entity: "User", entityId: userId, summary: body });
}

/** The pinned staff note shown at the top of the profile (User.internalNote). */
export async function setPinnedNote(actor: Staff, userId: string, text: string) {
  need(actor, "customers.edit");
  const u = await customerOr404(userId);
  const note = text.trim().slice(0, 2000) || null;
  if (note === u.internalNote) return;
  await db.user.update({ where: { id: userId }, data: { internalNote: note } });
  await audit({ actorId: actor.id, action: "customer.note", entity: "User", entityId: userId, before: { note: u.internalNote }, after: { note } });
}

// ───────────────────────────── Communication preferences ─────────────────────────────

/**
 * Staff record a customer's communication choices (e.g. asked by phone). A reason is required; marketing opt-in follows
 * the marketing email/SMS switches exactly like the customer's own settings page.
 */
export async function setCommunicationPrefs(actor: Staff, userId: string, prefs: Record<string, boolean>, reason: string) {
  need(actor, "customers.edit");
  const why = reason.trim();
  if (why.length < 3) throw new CrmError("Say who asked for the change");
  const u = await customerOr404(userId);
  if (u.deletedAt) throw new CrmError("This customer's personal data was deleted");
  const existing = await db.notificationPreference.findMany({ where: { userId } });
  const before: Record<string, boolean> = {};
  const after: Record<string, boolean> = {};
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  for (const topic of PREF_TOPICS)
    for (const channel of PREF_CHANNELS) {
      const key = `${topic}:${channel}`;
      const enabled = Boolean(prefs[key]);
      const old = existing.find((p) => p.topic === topic && p.channel === channel);
      const oldVal = old ? old.enabled : topic === "MARKETING" ? u.marketingOptIn && channel !== "SMS" : channel !== "SMS" || topic === "ORDER_UPDATES";
      if (oldVal !== enabled) {
        before[key] = oldVal;
        after[key] = enabled;
      }
      ops.push(db.notificationPreference.upsert({ where: { userId_topic_channel: { userId, topic, channel } }, create: { userId, topic, channel, enabled }, update: { enabled } }));
    }
  const marketingOptIn = Boolean(prefs["MARKETING:EMAIL"]) || Boolean(prefs["MARKETING:SMS"]);
  if (marketingOptIn !== u.marketingOptIn) {
    before.marketingOptIn = u.marketingOptIn;
    after.marketingOptIn = marketingOptIn;
  }
  ops.push(db.user.update({ where: { id: userId }, data: { marketingOptIn } }));
  await db.$transaction(ops);
  if (Object.keys(after).length) await audit({ actorId: actor.id, action: "customer.comm_prefs", entity: "User", entityId: userId, summary: "Communication preferences changed", before, after, reason: why });
  return { changed: Object.keys(after) };
}

// ───────────────────────────── Privacy & export ─────────────────────────────

/** Log a privacy request received by phone/email. */
export async function logPrivacyRequest(actor: Staff, userId: string, type: "EXPORT" | "DELETE", note?: string | null) {
  need(actor, "privacy.edit");
  await customerOr404(userId);
  const open = await db.dataRequest.findFirst({ where: { userId, type, status: "OPEN" } });
  if (open) throw new CrmError("There's already an open request of this type");
  const r = await db.dataRequest.create({ data: { userId, type, note: note?.trim() || "Logged by staff" } });
  await audit({ actorId: actor.id, action: "privacy.request", entity: "User", entityId: userId, summary: type });
  return r;
}

/** Complete an open privacy request from the profile through the existing privacy flow (DELETE anonymises). */
export async function processPrivacyRequest(actor: Staff, requestId: string, note?: string | null) {
  need(actor, "privacy.edit");
  const r = await db.dataRequest.findUnique({ where: { id: requestId }, include: { user: { select: { role: true } } } });
  if (!r || r.user.role !== "CUSTOMER") throw new CrmError("Request not found");
  return completeDataRequest(requestId, actor.id, note?.trim() || undefined);
}

/** Store first-touch attribution on a user once (never overwritten). Returns true when stored. */
export async function storeUserAttribution(userId: string, visitor: { first: Touch | null; last: Touch | null }) {
  const snap = userAttributionSnapshot(visitor);
  if (!snap) return false;
  const r = await db.user.updateMany({ where: { id: userId, acquisitionSource: null }, data: { acquisitionSource: snap.acquisitionSource, attribution: snap.attribution as Prisma.InputJsonValue } });
  return r.count > 0;
}

/** Campaign id for a utm_campaign value (Campaign.utmCampaign), if one is set up. */
export async function campaignIdFor(utmCampaign: string | null | undefined) {
  if (!utmCampaign) return null;
  const c = await db.campaign.findFirst({ where: { utmCampaign: { equals: utmCampaign, mode: "insensitive" } }, select: { id: true } });
  return c?.id ?? null;
}

const MASK_ADDRESS = (a: Record<string, unknown>) => ({ ...a, recipientName: a.recipientName ? `${String(a.recipientName).slice(0, 1)}•••` : a.recipientName, phone: maskPhone(a.phone as string), placeName: null, line1: "•••", landmark: null, instructions: null });

/**
 * Everything we hold about one customer (the privacy export), for staff with `customers.export`. Contact details are
 * masked unless the actor also has `customers.pii`. Always audited.
 */
export async function exportCustomerData(actor: Staff, userId: string) {
  need(actor, "customers.export");
  const pii = can(actor, "customers.pii");
  const u = await customerOr404(userId);
  const data = await exportUserData(userId);
  const out = {
    ...data,
    attribution: { acquisitionSource: u.acquisitionSource, snapshot: u.attribution },
    masked: !pii,
    ...(pii
      ? {}
      : {
          profile: { ...data.profile, email: maskEmail(data.profile.email), phone: maskPhone(data.profile.phone) },
          addresses: data.addresses.map(MASK_ADDRESS),
          orders: data.orders.map((o) => ({ ...o, address: "•••" })),
          supportTickets: data.supportTickets.map((t) => ({ ...t, messages: [] })),
        }),
  };
  await audit({ actorId: actor.id, action: "customer.export", entity: "User", entityId: userId, summary: pii ? "Customer data exported (full)" : "Customer data exported (contact details masked)" });
  return out;
}

