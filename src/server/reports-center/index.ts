import "server-only";
import { audit } from "@/lib/audit";
import { todayKTM } from "@/lib/dates";
import { can, type Permission } from "@/lib/permissions";
import { formatNepalPhone, maskEmail, maskPhone } from "@/lib/phone";
import { filterParams, parseFilters } from "@/server/analytics/filters";
import { companyScope } from "@/server/corporate";
import { csv, money } from "@/server/reports";
import { EXPORT_CAP } from "./common";
import { buildXlsx, type XlsxCell } from "./xlsx";
import { annualSales, dailySales, mealProfitability, monthlySales, revenueByCorporate, revenueByKitchen, revenueByMeal, weeklySales } from "./sales";
import { cancellations, orderStatus, refunds } from "./orders";
import { customerLifetimeValue, popularMeals, retention, subscriptionRenewals } from "./customers";
import { deliveryPerformanceReport, ingredientConsumption, inventoryValuation, kitchenProduction, recipeCosting, stockWastage, supplierPurchases } from "./operations";
import { corporateBilling, outstandingPayments } from "./money";
import { campaignPerformanceReport, complaintsFeedback, employeeActivity } from "./people";
import { walletTopupsReport } from "./wallet";
import type { Cell, Col, Ctx, Paging, ReportDef, ReportGroup, ReportResult, ReportUser, Row, SP } from "./types";

export type { Col, ReportDef, ReportResult, Row, SP } from "./types";

/** The 27 reports of brief §16 plus wallet top-ups (Phase 2A), in catalogue order. */
export const REPORT_LIST: ReportDef[] = [
  dailySales,
  weeklySales,
  monthlySales,
  annualSales,
  revenueByMeal,
  revenueByKitchen,
  revenueByCorporate,
  orderStatus,
  cancellations,
  refunds,
  subscriptionRenewals,
  retention,
  customerLifetimeValue,
  popularMeals,
  mealProfitability,
  recipeCosting,
  ingredientConsumption,
  inventoryValuation,
  stockWastage,
  supplierPurchases,
  kitchenProduction,
  deliveryPerformanceReport,
  corporateBilling,
  outstandingPayments,
  walletTopupsReport,
  employeeActivity,
  campaignPerformanceReport,
  complaintsFeedback,
];

export const REPORTS: Record<string, ReportDef> = Object.fromEntries(REPORT_LIST.map((r) => [r.key, r]));
export const GROUP_ORDER: ReportGroup[] = ["Sales & revenue", "Orders", "Customers & plans", "Menu & costing", "Kitchen & stock", "Delivery", "Money owed", "People & marketing"];

export class ReportNotFound extends Error {}
export class ReportDenied extends Error {}

const all = (user: ReportUser, perms: Permission[]) => perms.every((p) => can(user, p));
export const canViewReport = (user: ReportUser, def: ReportDef) => can(user, "reports.view") && all(user, def.view);
export const canExportReport = (user: ReportUser, def: ReportDef) => canViewReport(user, def) && can(user, "reports.export") && all(user, def.exportPerms);

/** Reports this user may open, grouped for the catalogue. */
export function catalogue(user: ReportUser) {
  return GROUP_ORDER.map((g) => ({ group: g, reports: REPORT_LIST.filter((r) => r.group === g && canViewReport(user, r)) })).filter((g) => g.reports.length);
}

export function getReport(key: string) {
  const def = REPORTS[key];
  if (!def) throw new ReportNotFound(`Unknown report "${key}"`);
  return def;
}

export function buildCtx(user: ReportUser, def: ReportDef, sp: SP): Ctx {
  const f = parseFilters(sp, user, def.defaultDays ?? 30);
  // Filters a report doesn't offer are dropped, so a stray URL param can't silently narrow (or mislabel) it.
  if (!def.filters.includes("company")) f.companyId = undefined;
  if (!def.filters.includes("ctype")) f.customerType = undefined;
  if (!def.filters.includes("status")) f.orderStatus = undefined;
  Object.assign(f, { zoneId: undefined, diet: undefined, planId: undefined, paymentStatus: undefined, categoryId: undefined, channel: undefined, method: undefined });
  const choice: Record<string, string> = {};
  for (const c of def.choices ?? []) {
    const v = sp[c.name];
    choice[c.name] = c.options.some((o) => o.value === v) ? v! : c.options[0].value;
  }
  return { user, f, sp, companyIds: companyScope({ role: user.role, scopes: user.scopes }), choice, today: todayKTM() };
}

export function parsePaging(sp: SP): Paging {
  const page = Math.min(10_000, Math.max(1, parseInt(sp.page ?? "1", 10) || 1));
  const perRaw = parseInt(sp.per ?? "", 10);
  const per = [25, 50, 100].includes(perRaw) ? perRaw : 50;
  return { page, per, all: false };
}

export type Masker = { email: (v: Cell) => Cell; phone: (v: Cell) => Cell };

export function maskerFor(user: ReportUser): Masker & { full: boolean } {
  const full = can(user, "customers.pii");
  return {
    full,
    email: (v) => (v == null || v === "" ? v : full ? v : maskEmail(String(v))),
    phone: (v) => (v == null || v === "" ? v : full ? formatNepalPhone(String(v)) || v : maskPhone(String(v))),
  };
}

function maskRows(rows: Row[], cols: Col[], m: Masker) {
  const pii = cols.filter((c) => c.kind === "email" || c.kind === "phone");
  if (!pii.length) return rows;
  return rows.map((r) => {
    const out = { ...r };
    for (const c of pii) out[c.key] = c.kind === "email" ? m.email(r[c.key]) : m.phone(r[c.key]);
    return out;
  });
}

export type RunOutput = ReportResult & { def: ReportDef; ctx: Ctx; columns: Col[]; paging: Paging; piiMasked: boolean };

/** Run a report for display (one page) or export (`all`). Permission-checked; PII masked without customers.pii. */
export async function runReport(user: ReportUser, key: string, sp: SP, opts: { all?: boolean } = {}): Promise<RunOutput> {
  const def = getReport(key);
  if (!canViewReport(user, def)) throw new ReportDenied("You don't have permission to view this report");
  const ctx = buildCtx(user, def, sp);
  const paging = opts.all ? { page: 1, per: EXPORT_CAP, all: true } : parsePaging(sp);
  const r = await def.run(ctx, paging);
  const columns = r.columns ?? def.columns;
  const m = maskerFor(user);
  return { ...r, rows: maskRows(r.rows, columns, m), totals: r.totals, def, ctx, columns, paging, piiMasked: !m.full };
}

/** Query params that reproduce a report view (filters + choices), for links, saved views and exports. */
export function reportParams(out: Pick<RunOutput, "def" | "ctx">): Record<string, string> {
  const base = filterParams(out.ctx.f);
  if (out.def.snapshot) {
    delete base.from;
    delete base.to;
  }
  return { ...base, ...out.ctx.choice };
}

// ───────────── export ─────────────

const cellText = (c: Col, v: Cell): string | number | null | undefined | boolean => {
  if (v == null) return v;
  if (c.kind === "money" && typeof v === "number") return money(v);
  if (c.kind === "pct" && typeof v === "number") return `${(v * 100).toFixed(1)}%`;
  return v;
};
const cellXlsx = (c: Col, v: Cell): XlsxCell => {
  if (v == null) return v;
  if (c.kind === "money" && typeof v === "number") return { money: v };
  if (c.kind === "pct" && typeof v === "number") return { pct: v };
  return v;
};

export type ExportFormat = "csv" | "xlsx";

/**
 * CSV / XLSX of the whole filtered result (capped at EXPORT_CAP rows), with the totals row appended.
 * Requires reports.view + reports.export + the report's own export keys; PII masked without customers.pii; audited.
 */
export async function exportReport(user: ReportUser & { id: string }, key: string, sp: SP, format: ExportFormat) {
  const def = getReport(key);
  if (!canExportReport(user, def)) throw new ReportDenied("You don't have permission to export this report");
  const out = await runReport(user, key, sp, { all: true });
  const header = out.columns.map((c) => (c.kind === "money" ? `${c.label} (Rs)` : c.label));
  const body = out.rows.map((r) => out.columns.map((c) => r[c.key]));
  const totals = out.totals ? out.columns.map((c) => out.totals![c.key]) : null;
  const { from, to } = out.ctx.f;
  const stamp = def.snapshot ? out.ctx.today : `${from}-to-${to}`;
  const filename = `dabbabela-${def.key}-${stamp}.${format}`;
  let file: string | Buffer;
  if (format === "xlsx") {
    const rows = body.map((r) => r.map((v, i) => cellXlsx(out.columns[i], v)));
    if (totals) rows.push(totals.map((v, i) => cellXlsx(out.columns[i], v)));
    file = buildXlsx(def.title, header, rows);
  } else {
    const rows = body.map((r) => r.map((v, i) => cellText(out.columns[i], v)));
    if (totals) rows.push(totals.map((v, i) => cellText(out.columns[i], v)));
    file = csv([header, ...rows]);
  }
  const params = reportParams(out);
  await audit({
    actorId: user.id,
    action: "report.export",
    entity: "Report",
    entityId: def.key,
    summary: `${def.title} (${format.toUpperCase()}): ${out.rows.length} rows${out.rows.length < out.count ? ` (capped, ${out.count} matched)` : ""}${out.piiMasked ? " · PII masked" : ""}`,
    after: { format, filters: params, rows: out.rows.length, matched: out.count, piiMasked: out.piiMasked },
  });
  return {
    filename,
    body: file,
    rows: out.rows.length,
    contentType: format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8",
  };
}
