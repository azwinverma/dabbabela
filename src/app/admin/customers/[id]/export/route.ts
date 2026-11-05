import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { CrmError, exportCustomerData } from "@/server/crm";

export const dynamic = "force-dynamic";

/** One customer's data (privacy export shape) as JSON. Permission-checked, masked per customers.pii, audited (crm.ts). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  if (!can(user, "customers.export")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const data = await exportCustomerData(user, id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="dabbabela-customer-${id}.json"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof CrmError) return NextResponse.json({ error: e.message }, { status: 404 });
    throw e;
  }
}
