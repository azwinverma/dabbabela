import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayKTM } from "@/lib/dates";
import { flatParams } from "@/app/admin/_kit/params";
import { exportCustomerDirectory, parseCustomerFilters } from "@/server/crm";

export const dynamic = "force-dynamic";

/** Customer directory CSV with the current filters. Permission-checked, masked per customers.pii, audited (crm.ts). */
export async function GET(req: Request) {
  const user = await requireStaff();
  if (!can(user, "customers.export")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const filters = parseCustomerFilters(flatParams(new URL(req.url).searchParams));
  const out = await exportCustomerDirectory(user, filters);
  return new NextResponse(out.csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="dabbabela-customers-${todayKTM()}.csv"`, "Cache-Control": "no-store" },
  });
}
