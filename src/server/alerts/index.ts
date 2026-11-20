import "server-only";
import type { Alert, Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ktmNow } from "@/lib/dates";
import { log } from "@/lib/logger";
import { can, isStaffRole } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { emailConfigured } from "@/server/notify/email";
import { renderTemplate } from "@/server/notify";
import { SEVERITY_PRIORITY, type AlertStatus, type Detector, type DetectorCtx, type Finding, type Severity } from "./types";
import { missingSelections, planRenewals, unpaidOrders } from "./detectors/orders";
import { overCapacity, production } from "./detectors/kitchen";
import { inventory } from "./detectors/inventory";
import { delayedDeliveries, failedDeliveries, refundSpike, wasteSpike } from "./detectors/operations";
import { duplicatePayments, reconciliation } from "./detectors/finance";
import { corporateAccounts, corporateInvoices, corporateShortfall } from "./detectors/corporate";
import { integrations, paymentMismatch } from "./detectors/integrations";
import { security } from "./detectors/security";
import { approvals } from "./detectors/approvals";

export * from "./types";

/** Every detector, in run order. `source` on an Alert is the detector name. */
export const DETECTORS: Detector[] = [
  unpaidOrders,
  planRenewals,
  missingSelections,
  overCapacity,
  inventory,
  production,
  delayedDeliveries,
  failedDeliveries,
  refundSpike,
  wasteSpike,
  corporateInvoices,
  corporateAccounts,
  corporateShortfall,
  duplicatePayments,
  reconciliation,
  integrations,
  paymentMismatch,
  security,
  approvals,
];

export const DETECTOR_LABEL: Record<string, string> = Object.fromEntries(DETECTORS.map((d) => [d.name, d.label]));

export class AlertError extends Error {}

export type AlertActor = { id: string; role: Role | string; customGrants?: readonly string[] | null; kitchenIds?: string[] | null };

function need(actor: AlertActor, perm: "alerts.view" | "alerts.edit") {
  if (!can(actor, perm)) throw new AlertError("You don't have permission to do that");
}

const AUTO_RESOLVE_NOTE = "Auto-resolved: the condition cleared";

/** Engine-owned keys kept in Alert.data across detector updates. */
type AlertMeta = { kitchenId?: string | null; kitchenScope?: string; href?: string | null; reopenedAt?: string; escalatedAt?: string; escalatedTo?: string[] };

function metaOf(a: Pick<Alert, "data">): AlertMeta {
  return a.data && typeof a.data === "object" && !Array.isArray(a.data) ? (a.data as AlertMeta) : {};
}

function json(v: unknown) {
  return JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;
}

export async function detectorContext(now = new Date()): Promise<DetectorCtx> {
  const t = ktmNow(now);
  const kitchens = await db.kitchen.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: { code: "asc" } });
  return { now, today: t.date, time: t.time, kitchens };
}

export type ApplyResult = { found: number; raised: number; reopened: number; updated: number; resolved: number };

/**
 * Upsert one detector's findings by dedupe key.
 * - new key → OPEN alert;
 * - open/acknowledged → refresh message, severity, data, lastSeenAt (status and owner untouched);
 * - resolved + condition detector → re-opened (count + 1, ack/resolution cleared);
 * - resolved + event detector → left alone (same event);
 * - condition detector: open alerts of this source that weren't found again are auto-resolved.
 */
export async function applyFindings(detector: Pick<Detector, "name" | "mode">, findings: Finding[], now = new Date()): Promise<ApplyResult> {
  const byKey = new Map<string, Finding>();
  for (const f of findings) {
    const k = `${detector.name}:${f.key}`.slice(0, 500);
    if (!byKey.has(k)) byKey.set(k, f);
  }
  const keys = [...byKey.keys()];
  const existing = new Map((keys.length ? await db.alert.findMany({ where: { dedupeKey: { in: keys } } }) : []).map((a) => [a.dedupeKey, a]));
  const res: ApplyResult = { found: keys.length, raised: 0, reopened: 0, updated: 0, resolved: 0 };

  for (const [dedupeKey, f] of byKey) {
    const ex = existing.get(dedupeKey);
    const base = {
      type: f.type,
      severity: f.severity,
      priority: f.priority ?? SEVERITY_PRIORITY[f.severity],
      entity: f.entity ?? null,
      entityId: f.entityId ?? null,
      message: f.message.slice(0, 1000),
    };
    const data = { ...(f.data ?? {}), kitchenId: f.kitchenId ?? null, kitchenScope: f.kitchenId ?? "*", href: f.href ?? null };
    if (!ex) {
      try {
        await db.alert.create({ data: { ...base, source: detector.name, dedupeKey, data: json(data), firstSeenAt: now, lastSeenAt: now } });
        res.raised++;
      } catch (e) {
        if (!(e instanceof Error && e.message.includes("Unique constraint"))) throw e; // a concurrent run raised it
      }
      continue;
    }
    if (ex.status === "RESOLVED") {
      if (detector.mode === "event") continue;
      const flipped = await db.alert.updateMany({
        where: { id: ex.id, status: "RESOLVED" },
        data: { ...base, status: "OPEN", count: { increment: 1 }, lastSeenAt: now, ackAt: null, ackById: null, resolvedAt: null, resolvedById: null, resolutionNote: null, data: json({ ...data, reopenedAt: now.toISOString() }) },
      });
      res.reopened += flipped.count;
      continue;
    }
    const meta = metaOf(ex);
    await db.alert.update({ where: { id: ex.id }, data: { ...base, lastSeenAt: now, data: json({ ...data, reopenedAt: meta.reopenedAt, escalatedAt: meta.escalatedAt, escalatedTo: meta.escalatedTo }) } });
    res.updated++;
  }

  if (detector.mode === "condition") {
    const cleared = await db.alert.updateMany({
      where: { source: detector.name, status: { not: "RESOLVED" }, ...(keys.length ? { dedupeKey: { notIn: keys } } : {}) },
      data: { status: "RESOLVED", resolvedAt: now, resolvedById: null, resolutionNote: AUTO_RESOLVE_NOTE },
    });
    res.resolved = cleared.count;
  }
  return res;
}

export type DetectorRun = ApplyResult & { name: string; error?: string };

/** Detectors that react to a day lock (run right after the cut-off job and after a manual lock in Admin → Kitchen). */
export const CUTOFF_DETECTORS = ["unpaid-orders", "missing-selections", "over-capacity", "production"];

/**
 * Run detectors (all, or `only`) and persist their findings. A detector that throws is reported and its alerts
 * are left as they are (never auto-resolved on a failed read). Idempotent: re-running with the same data changes
 * nothing but `lastSeenAt`.
 */
export async function runDetectors(opts: { now?: Date; only?: string[] } = {}) {
  const ctx = await detectorContext(opts.now);
  const runs: DetectorRun[] = [];
  for (const d of DETECTORS) {
    if (opts.only && !opts.only.includes(d.name)) continue;
    try {
      const findings = await d.run(ctx);
      runs.push({ name: d.name, ...(await applyFindings(d, findings, ctx.now)) });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      log.error("alerts.detector_failed", { detector: d.name, error });
      runs.push({ name: d.name, found: 0, raised: 0, reopened: 0, updated: 0, resolved: 0, error: error.slice(0, 300) });
    }
  }
  const sum = (k: keyof ApplyResult) => runs.reduce((a, r) => a + r[k], 0);
  return { at: ctx.now.toISOString(), raised: sum("raised"), reopened: sum("reopened"), resolved: sum("resolved"), open: sum("found"), failed: runs.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`), detectors: runs };
}

// ───────────── staff actions ─────────────

async function scopedIds(actor: AlertActor, ids: string[]) {
  const uniq = [...new Set(ids.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 40))].slice(0, 500);
  if (!uniq.length) throw new AlertError("Pick at least one alert");
  const rows = await db.alert.findMany({ where: { id: { in: uniq } } });
  const scope = actor.kitchenIds;
  return scope ? rows.filter((a) => !metaOf(a).kitchenId || scope.includes(metaOf(a).kitchenId!)) : rows;
}

/** OPEN → ACKNOWLEDGED ("someone is on it"). Audited per alert. */
export async function acknowledgeAlerts(actor: AlertActor, ids: string[]) {
  need(actor, "alerts.edit");
  const rows = (await scopedIds(actor, ids)).filter((a) => a.status === "OPEN");
  const now = new Date();
  let changed = 0;
  for (const a of rows) {
    const r = await db.alert.updateMany({ where: { id: a.id, status: "OPEN" }, data: { status: "ACKNOWLEDGED", ackAt: now, ackById: actor.id } });
    if (!r.count) continue;
    changed++;
    await audit({ actorId: actor.id, action: "alert.acknowledge", entity: "Alert", entityId: a.id, summary: a.message.slice(0, 200), before: { status: a.status }, after: { status: "ACKNOWLEDGED" } });
  }
  return { changed };
}

/** Assign (or clear with null) the owner. The owner must be active staff who can see alerts. Audited. */
export async function assignAlerts(actor: AlertActor, ids: string[], ownerId: string | null) {
  need(actor, "alerts.edit");
  let ownerName: string | null = null;
  if (ownerId) {
    const u = await db.user.findUnique({ where: { id: ownerId }, select: { name: true, role: true, isActive: true, deletedAt: true, staffRole: { select: { permissions: true } } } });
    if (!u || !u.isActive || u.deletedAt || !isStaffRole(u.role) || !can({ role: u.role, customGrants: u.staffRole?.permissions ?? [] }, "alerts.view")) throw new AlertError("Assign alerts to an active staff member who can see the alerts center");
    ownerName = u.name;
  }
  const rows = (await scopedIds(actor, ids)).filter((a) => a.status !== "RESOLVED" && a.ownerId !== ownerId);
  for (const a of rows) {
    await db.alert.update({ where: { id: a.id }, data: { ownerId } });
    await audit({ actorId: actor.id, action: "alert.assign", entity: "Alert", entityId: a.id, summary: `${ownerName ?? "Unassigned"}: ${a.message.slice(0, 160)}`, before: { ownerId: a.ownerId }, after: { ownerId } });
  }
  return { changed: rows.length };
}

/** Resolve with a note (required). Audited with the note as the reason. */
export async function resolveAlerts(actor: AlertActor, ids: string[], note: string) {
  need(actor, "alerts.edit");
  const text = (note ?? "").trim().slice(0, 1000);
  if (text.length < 3) throw new AlertError("Add a resolution note (what was done)");
  const rows = (await scopedIds(actor, ids)).filter((a) => a.status !== "RESOLVED");
  const now = new Date();
  let changed = 0;
  for (const a of rows) {
    const r = await db.alert.updateMany({ where: { id: a.id, status: { not: "RESOLVED" } }, data: { status: "RESOLVED", resolvedAt: now, resolvedById: actor.id, resolutionNote: text } });
    if (!r.count) continue;
    changed++;
    await audit({ actorId: actor.id, action: "alert.resolve", entity: "Alert", entityId: a.id, summary: a.message.slice(0, 200), reason: text, before: { status: a.status }, after: { status: "RESOLVED" } });
  }
  return { changed };
}

/** Re-open a resolved alert (resolved by mistake). Audited. */
export async function reopenAlert(actor: AlertActor, id: string, reason: string) {
  need(actor, "alerts.edit");
  const text = (reason ?? "").trim().slice(0, 500);
  if (text.length < 3) throw new AlertError("Say why it's being re-opened");
  const [a] = await scopedIds(actor, [id]);
  if (!a || a.status !== "RESOLVED") throw new AlertError("Only resolved alerts can be re-opened");
  await db.alert.update({ where: { id: a.id }, data: { status: "OPEN", count: { increment: 1 }, ackAt: null, ackById: null, resolvedAt: null, resolvedById: null, resolutionNote: null, data: json({ ...metaOf(a), reopenedAt: new Date().toISOString(), escalatedAt: undefined, escalatedTo: undefined }) } });
  await audit({ actorId: actor.id, action: "alert.reopen", entity: "Alert", entityId: a.id, summary: a.message.slice(0, 200), reason: text, before: { status: "RESOLVED" }, after: { status: "OPEN" } });
  return { changed: 1 };
}

// ───────────── reads ─────────────

export type AlertFilters = { status?: AlertStatus | "ACTIVE" | "ALL"; severity?: Severity; source?: string; owner?: string; q?: string; kitchenId?: string };
export const ALERT_SORTS = ["lastSeenAt", "firstSeenAt", "priority", "severity", "count"] as const;
export type AlertSort = (typeof ALERT_SORTS)[number];

/** Kitchen-scoped staff see alerts of their kitchens plus alerts that aren't about one kitchen (`kitchenScope` "*"). */
function kitchenWhere(ids: string[]): Prisma.AlertWhereInput {
  return { OR: ["*", ...ids].map((id) => ({ data: { path: ["kitchenScope"], equals: id } })) };
}

export function alertWhere(actor: Pick<AlertActor, "kitchenIds">, f: AlertFilters): Prisma.AlertWhereInput {
  const and: Prisma.AlertWhereInput[] = [];
  if (!f.status || f.status === "ACTIVE") and.push({ status: { not: "RESOLVED" } });
  else if (f.status !== "ALL") and.push({ status: f.status });
  if (f.severity) and.push({ severity: f.severity });
  if (f.source) and.push({ source: f.source });
  if (f.owner === "none") and.push({ ownerId: null });
  else if (f.owner) and.push({ ownerId: f.owner });
  if (f.q) and.push({ OR: [{ message: { contains: f.q, mode: "insensitive" } }, { type: { contains: f.q.toUpperCase() } }, { entityId: f.q }, { id: f.q }] });
  if (f.kitchenId) and.push({ data: { path: ["kitchenId"], equals: f.kitchenId } });
  if (actor.kitchenIds) and.push(kitchenWhere(actor.kitchenIds));
  return { AND: and };
}

export async function listAlerts(actor: AlertActor, f: AlertFilters, state: { page: number; per: number; sort: AlertSort; dir: "asc" | "desc" }) {
  need(actor, "alerts.view");
  const where = alertWhere(actor, f);
  const orderBy: Prisma.AlertOrderByWithRelationInput[] =
    state.sort === "severity" || state.sort === "priority" ? [{ priority: state.dir === "desc" ? "asc" : "desc" }, { lastSeenAt: "desc" }] : [{ [state.sort]: state.dir }, { id: "asc" }];
  const [rows, total, counts] = await Promise.all([
    db.alert.findMany({ where, orderBy, skip: (state.page - 1) * state.per, take: state.per }),
    db.alert.count({ where }),
    db.alert.groupBy({ by: ["severity"], where: alertWhere(actor, { status: "ACTIVE" }), _count: { _all: true } }),
  ]);
  const people = [...new Set(rows.flatMap((r) => [r.ownerId, r.ackById, r.resolvedById]).filter((x): x is string => Boolean(x)))];
  const names = new Map((people.length ? await db.user.findMany({ where: { id: { in: people } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  return {
    rows: rows.map((r) => ({ ...r, meta: metaOf(r), ownerName: r.ownerId ? names.get(r.ownerId) ?? "—" : null, ackByName: r.ackById ? names.get(r.ackById) ?? "—" : null, resolvedByName: r.resolvedById ? names.get(r.resolvedById) ?? "—" : r.resolvedAt ? "System" : null })),
    total,
    active: Object.fromEntries(counts.map((c) => [c.severity, c._count._all])) as Partial<Record<Severity, number>>,
  };
}

export type AlertRow = Awaited<ReturnType<typeof listAlerts>>["rows"][number];

/** Staff who can own alerts (assignee picker). */
export async function alertAssignees() {
  const staff = await db.user.findMany({ where: { isActive: true, deletedAt: null, role: { not: "CUSTOMER" } }, select: { id: true, name: true, role: true, staffRole: { select: { permissions: true } } }, orderBy: { name: "asc" } });
  return staff.filter((u) => isStaffRole(u.role) && can({ role: u.role, customGrants: u.staffRole?.permissions ?? [] }, "alerts.view")).map((u) => ({ id: u.id, name: u.name, role: u.role }));
}

// ───────────── escalation ─────────────

export const ESCALATION_KEY = "alerts.escalation";
export type EscalationRules = {
  /** Escalate CRITICAL alerts still OPEN (not acknowledged) after this many minutes; null = never. */
  criticalAfterMinutes: number | null;
  /** Same for WARNING alerts; null = never (default). */
  warningAfterMinutes: number | null;
  /** Roles notified when the alert has no owner (SUPER_ADMIN always included). */
  roles: Role[];
  /** Also email Settings → notify email. */
  notifyEmail: boolean;
};
export const DEFAULT_ESCALATION: EscalationRules = { criticalAfterMinutes: 30, warningAfterMinutes: null, roles: ["OWNER"], notifyEmail: true };

const minutesOrNull = (v: unknown) => (v === null ? null : typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10_080 ? Math.round(v) : undefined);

export async function getEscalationRules(): Promise<EscalationRules> {
  const row = await db.setting.findUnique({ where: { key: ESCALATION_KEY } });
  const v = (row?.value ?? {}) as Partial<EscalationRules>;
  return {
    criticalAfterMinutes: minutesOrNull(v.criticalAfterMinutes) === undefined ? DEFAULT_ESCALATION.criticalAfterMinutes : (minutesOrNull(v.criticalAfterMinutes) as number | null),
    warningAfterMinutes: minutesOrNull(v.warningAfterMinutes) === undefined ? DEFAULT_ESCALATION.warningAfterMinutes : (minutesOrNull(v.warningAfterMinutes) as number | null),
    roles: Array.isArray(v.roles) ? (v.roles.filter((r) => isStaffRole(r)) as Role[]) : DEFAULT_ESCALATION.roles,
    notifyEmail: typeof v.notifyEmail === "boolean" ? v.notifyEmail : DEFAULT_ESCALATION.notifyEmail,
  };
}

export async function saveEscalationRules(actor: AlertActor, input: EscalationRules) {
  need(actor, "alerts.edit");
  const clean: EscalationRules = {
    criticalAfterMinutes: minutesOrNull(input.criticalAfterMinutes) ?? null,
    warningAfterMinutes: minutesOrNull(input.warningAfterMinutes) ?? null,
    roles: [...new Set(input.roles.filter((r) => isStaffRole(r) && r !== "SUPER_ADMIN"))] as Role[],
    notifyEmail: Boolean(input.notifyEmail),
  };
  const before = await getEscalationRules();
  await db.setting.upsert({ where: { key: ESCALATION_KEY }, create: { key: ESCALATION_KEY, value: clean }, update: { value: clean } });
  await audit({ actorId: actor.id, action: "alert.escalation_rules", entity: "Setting", entityId: ESCALATION_KEY, summary: "Alert escalation rules", before, after: clean });
  return clean;
}

/**
 * Escalate alerts still OPEN (not acknowledged) past the rule's threshold: one email per recipient through the
 * durable outbox (dedupe key per alert occurrence + recipient, so re-runs never queue twice) plus an in-app
 * notification. Recipients: the assigned owner, else active staff in the configured roles + super admins, plus
 * Settings → notify email. With no email provider configured the messages stay in the outbox and are marked
 * SKIPPED by the sender — the result says so (`emailConfigured: false`).
 */
export async function escalateAlerts(opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const rules = await getEscalationRules();
  const limit: Partial<Record<Severity, number>> = {};
  if (rules.criticalAfterMinutes != null) limit.CRITICAL = rules.criticalAfterMinutes;
  if (rules.warningAfterMinutes != null) limit.WARNING = rules.warningAfterMinutes;
  const severities = Object.keys(limit) as Severity[];
  const result = { escalated: 0, queued: 0, notified: 0, emailConfigured: emailConfigured(), alerts: [] as string[] };
  if (!severities.length) return result;

  const open = await db.alert.findMany({ where: { status: "OPEN", severity: { in: severities } }, orderBy: { firstSeenAt: "asc" }, take: 500 });
  const due = open.filter((a) => {
    const meta = metaOf(a);
    const since = meta.reopenedAt ? new Date(meta.reopenedAt) : a.firstSeenAt;
    if (meta.escalatedAt && new Date(meta.escalatedAt) >= since) return false;
    return now.getTime() - since.getTime() >= (limit[a.severity as Severity] ?? Infinity) * 60_000;
  });
  if (!due.length) return result;

  const settings = await getSettings();
  const roleStaff = await db.user.findMany({ where: { isActive: true, deletedAt: null, role: { in: ["SUPER_ADMIN", ...rules.roles] } }, select: { id: true, email: true, name: true } });
  for (const a of due) {
    const meta = metaOf(a);
    const occurrence = (meta.reopenedAt ? new Date(meta.reopenedAt) : a.firstSeenAt).getTime();
    let people = roleStaff;
    if (a.ownerId) {
      const owner = await db.user.findFirst({ where: { id: a.ownerId, isActive: true, deletedAt: null }, select: { id: true, email: true, name: true } });
      if (owner) people = [owner];
    }
    const emails = new Map<string, string | null>(); // email → userId
    for (const p of people) if (p.email && !p.email.endsWith("@phone.dabbabela.local")) emails.set(p.email.toLowerCase(), p.id);
    if (rules.notifyEmail && settings.notifyEmail && !a.ownerId && !emails.has(settings.notifyEmail.toLowerCase())) emails.set(settings.notifyEmail.toLowerCase(), null);

    const link = `${(process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "")}/admin/alerts?status=OPEN&q=${encodeURIComponent(a.id)}`;
    const mins = Math.round((now.getTime() - occurrence) / 60_000);
    // Template "alert.escalation" (overridable in Admin → Notifications); outbox rows below keep their own dedupe.
    const vars = { severity: a.severity, message: a.message.slice(0, 120), minutes: mins, source: a.source };
    const email = (await renderTemplate("alert.escalation", "EMAIL", vars, { link: link || "/admin/alerts" }))!;
    const inApp = (await renderTemplate("alert.escalation", "IN_APP", vars, { link: "/admin/alerts" }))!;
    const subject = email.subject;
    const html = email.body;
    const sentTo: string[] = [];
    for (const [to, userId] of emails) {
      try {
        await db.outboundMessage.create({ data: { channel: "EMAIL", to, templateKey: "alert.escalation", subject, body: html, dedupeKey: `alert-escalate:${a.id}:${occurrence}:${to}` } });
        result.queued++;
        sentTo.push(to);
        if (userId) {
          await db.notification.create({ data: { userId, type: "alert.escalation", title: inApp.subject.slice(0, 200), body: inApp.body, link: "/admin/alerts" } });
          result.notified++;
        }
      } catch (e) {
        if (!(e instanceof Error && e.message.includes("Unique constraint"))) throw e; // already queued for this occurrence
      }
    }
    await db.alert.update({ where: { id: a.id }, data: { data: json({ ...meta, escalatedAt: now.toISOString(), escalatedTo: [...new Set([...(meta.escalatedTo ?? []), ...sentTo])] }) } });
    result.escalated++;
    result.alerts.push(a.id);
  }
  return result;
}
