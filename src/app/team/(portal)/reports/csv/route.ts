import { NextResponse } from "next/server";
import { requireCompanyAdmin } from "@/lib/auth";
import { addDays, isValidISODate, todayKTM } from "@/lib/dates";
import { csv, money } from "@/server/reports";
import { teamReport } from "@/server/team";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { user, company } = await requireCompanyAdmin();
  const url = new URL(req.url);
  const to = isValidISODate(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : todayKTM();
  const from = isValidISODate(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : addDays(to, -29);
  const rows = await teamReport(company.id, from, to);
  await audit({ actorId: user.id, action: "team.report_export", entity: "Company", entityId: company.id, summary: `Team report CSV ${from} → ${to} (${rows.length} rows)` });
  const body = csv([
    ["Date", "Order", "Name", "Email", "Department", "Cost centre", "Employee #", "Lunch", "Meals", "Status", "Discount (Rs)", "Company share (Rs)", "Company adjustments (Rs)", "Staff share (Rs)", "Invoiced"],
    ...rows.map((r) => [r.date, r.number, r.name, r.email, r.department, r.costCenter, r.employeeCode, r.items, r.meals, r.status, money(r.discount), money(r.companyShare), money(r.companyAdjustments), money(r.employeeShare), r.invoiced ? "yes" : "no"]),
  ]);
  return new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="team-lunches-${from}-to-${to}.csv"`, "Cache-Control": "no-store" } });
}
