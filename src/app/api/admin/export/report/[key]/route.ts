import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { ReportDenied, ReportNotFound, exportReport } from "@/server/reports-center";

export const dynamic = "force-dynamic";

/** GET /api/admin/export/report/<key>?format=csv|xlsx&<filters> — permission-checked, kitchen-scoped, PII-masked, audited. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const user = await requireStaff();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const format = sp.format === "xlsx" ? "xlsx" : "csv";
  try {
    const out = await exportReport(user, key, sp, format);
    return new NextResponse(typeof out.body === "string" ? out.body : new Uint8Array(out.body), {
      headers: { "Content-Type": out.contentType, "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ReportNotFound) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof ReportDenied) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
