import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { FinanceDenied, FinanceError } from "@/server/finance/common";
import { exportJournal } from "@/server/finance/journal";

export const dynamic = "force-dynamic";

/** GET /admin/settlements/journal?from&to → journal CSV (expenses.export; audited). */
export async function GET(req: Request) {
  const user = await requireStaff();
  const sp = new URL(req.url).searchParams;
  try {
    const out = await exportJournal(user, sp.get("from") ?? "", sp.get("to") ?? "");
    return new NextResponse(out.body, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof FinanceDenied) return NextResponse.json({ error: e.message }, { status: 403 });
    if (e instanceof FinanceError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
