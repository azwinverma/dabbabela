import { apiRoute } from "@/server/api/route";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The allergen list (codes used in menu items, Build-a-Dabba options and the customer's `allergies`). */
export const GET = apiRoute({ auth: "public", limit: "read" }, async () => {
  const rows = await db.allergen.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return rows.map((a) => ({ code: a.code, name: a.name, nameNe: a.nameNe }));
});
