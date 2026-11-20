import type { Permission } from "@/lib/permissions";
import type { AnalyticsFilters } from "@/server/analytics/filters";

/**
 * Reports center (WP-10). One `ReportDef` per report: what it shows, who may see / export it, which filters apply,
 * its columns, and a `run()` that computes the page of rows plus whole-result totals in the database, reusing the
 * analytics / finance / inventory / kitchen / corporate / dispatch / marketing functions (metrics are never redefined).
 */

/** text · int · num (decimal) · money (paisa) · pct (ratio 0–1) · date (YYYY-MM-DD) · email / phone (masked without customers.pii). */
export type ColKind = "text" | "int" | "num" | "money" | "pct" | "date" | "email" | "phone";
export type Col = { key: string; label: string; kind?: ColKind };
export type Cell = string | number | boolean | null | undefined;
export type Row = Record<string, Cell>;

export type FilterKey = "range" | "kitchen" | "company" | "ctype" | "status";
/** A report-specific select (e.g. ?by=rider|zone). The first option is the default. */
export type Choice = { name: string; label: string; options: { value: string; label: string }[] };

export type ReportUser = {
  id: string;
  role: string;
  customGrants?: readonly string[] | null;
  kitchenId?: string | null;
  kitchenIds?: string[] | null;
  scopes?: { kitchenId: string | null; companyId: string | null }[];
};

export type SP = Record<string, string | undefined>;

export type Ctx = {
  user: ReportUser;
  /** Parsed against the user's kitchen scope (analytics parser). */
  f: AnalyticsFilters;
  sp: SP;
  /** Company scope for staff limited to some companies; null = all. */
  companyIds: string[] | null;
  /** Resolved choice values (default = first option). */
  choice: Record<string, string>;
  today: string;
};

export type Paging = { page: number; per: number; all: boolean };

export type Summary = { label: string; value: Cell; kind?: ColKind; note?: string };

export type ReportResult = {
  rows: Row[];
  /** Rows matching the filters (all pages). */
  count: number;
  /** Whole-result totals keyed by column (rendered as the footer row and appended to exports). */
  totals?: Row;
  summary?: Summary[];
  notes?: string[];
  /** Columns can depend on choices (e.g. a different breakdown). */
  columns?: Col[];
};

export type ReportGroup = "Sales & revenue" | "Orders" | "Customers & plans" | "Menu & costing" | "Kitchen & stock" | "Delivery" | "Money owed" | "People & marketing";

export type ReportDef = {
  key: string;
  title: string;
  group: ReportGroup;
  description: string;
  /** How the numbers are computed and what they reconcile with. */
  definition: string;
  /** All must be held to view (reports.view is always required too). */
  view: Permission[];
  /** All must be held to export (reports.export is always required too). */
  exportPerms: Permission[];
  filters: FilterKey[];
  choices?: Choice[];
  columns: Col[];
  defaultDays?: number;
  /** Not date-ranged (a snapshot right now). */
  snapshot?: boolean;
  run: (ctx: Ctx, paging: Paging) => Promise<ReportResult>;
};
