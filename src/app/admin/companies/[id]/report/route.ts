import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { maskEmail } from "@/lib/phone";
import { addDays, isValidISODate, todayKTM } from "@/lib/dates";
import { csv, money } from "@/server/reports";
import { assertCompanyAccess, companyOrderReport, CorporateForbidden } from "@/server/corporate";

export const dynamic = "force-dynamic";

/** GET /admin/companies/[id]/report?from&to → corporate order report CSV (corporate.view + scope; emails masked without customers.pii; audited). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  try {
    assertCompanyAccess(user, id, "corporate.view");
  } catch (e) {
    if (e instanceof CorporateForbidden) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
  const url = new URL(req.url);
  const to = isValidISODate(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : todayKTM();
  const from = isValidISODate(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : addDays(to, -29);
  const pii = can(user, "customers.pii");
  const rows = await companyOrderReport(id, from, to);
  const body = csv([
    ["Date", "Order", "Name", "Email", "Department", "Cost centre", "Employee #", "Lunch", "Meals", "Status", "Discount (Rs)", "Company share (Rs)", "Company adjustments (Rs)", "Staff share (Rs)", "Invoiced"],
    ...rows.map((r) => [r.date, r.number, r.name, pii ? r.email : maskEmail(r.email), r.department, r.costCenter, r.employeeCode, r.items, r.meals, r.status, money(r.discount), money(r.companyShare), money(r.companyAdjustments), money(r.employeeShare), r.invoiced ? "yes" : "no"]),
  ]);
  await audit({ actorId: user.id, action: "company.report_export", entity: "Company", entityId: id, summary: `${rows.length} rows ${from}..${to}` });
  return new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="company-orders-${from}-to-${to}.csv"`, "Cache-Control": "no-store" } });
}
