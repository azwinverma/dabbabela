import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { todayKTM } from "@/lib/dates";
import { customerSelfExport } from "@/server/privacy";

export const dynamic = "force-dynamic";

/** The signed-in customer's own data as JSON (no secrets: no password hashes, tokens or session ids). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Log in first" }, { status: 401 });
  const body = await customerSelfExport(user.id);
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dabba-bela-my-data-${todayKTM()}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
