import "server-only";
import { audit } from "@/lib/audit";
import { can, type PermissionSubject } from "@/lib/permissions";
import { maskEmail, maskPhone, formatNepalPhone } from "@/lib/phone";
import { csv } from "@/server/reports";
import { filterParams, parseFilters, type Scoped } from "./filters";
import { DRILL_BASES, drill, drillCsvRows, isDrillBasis } from "./transactions";

export class ExportDenied extends Error {}

/**
 * CSV export of the records behind a metric. Requires analytics.view + analytics.export; contact details are
 * masked unless the user holds customers.pii; every export is audited with its filters and row count.
 */
export async function exportAnalyticsCsv(user: PermissionSubject & Scoped & { id: string }, sp: Record<string, string | undefined>) {
  if (!can(user, "analytics.view") || !can(user, "analytics.export")) throw new ExportDenied("You don't have permission to export analytics");
  const basis = isDrillBasis(sp.basis) ? sp.basis : "recognised";
  const f = parseFilters(sp, user);
  const full = can(user, "customers.pii");
  const r = await drill(basis, f, { all: true });
  const rows = drillCsvRows(basis, r, {
    email: (e) => (full ? (e ?? "") : maskEmail(e)),
    phone: (p) => (full ? formatNepalPhone(p) || p || "" : maskPhone(p)),
  });
  await audit({
    actorId: user.id,
    action: "analytics.export",
    entity: "Analytics",
    entityId: basis,
    summary: `${DRILL_BASES[basis].label}: ${r.rows.length} rows${r.rows.length < r.count ? ` (capped, ${r.count} matched)` : ""}${full ? "" : " · PII masked"}`,
    after: { filters: filterParams(f, { basis }), rows: r.rows.length, matched: r.count, piiMasked: !full },
  });
  return { filename: `dabbabela-${basis}-${f.from}-to-${f.to}.csv`, body: csv(rows), rows: r.rows.length };
}
