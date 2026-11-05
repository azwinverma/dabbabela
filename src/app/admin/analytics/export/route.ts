import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { ExportDenied, exportAnalyticsCsv } from "@/server/analytics/export";

export const dynamic = "force-dynamic";

/** GET /admin/analytics/export?basis=…&<filters> → CSV (permission-checked, PII-masked, audited). */
export async function GET(req: Request) {
  const user = await requireStaff();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  try {
    const out = await exportAnalyticsCsv(user, sp);
    return new NextResponse(out.body, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ExportDenied) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
