import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { exportOrdersCsv, OrderForbidden } from "@/server/orders-admin";

export const dynamic = "force-dynamic";

/** GET /admin/orders/export?<list filters> → CSV (orders.export checked, PII masked without customers.pii, audited). */
export async function GET(req: Request) {
  const user = await requireStaff();
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  try {
    const out = await exportOrdersCsv(user, sp);
    return new NextResponse(out.body, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof OrderForbidden) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
