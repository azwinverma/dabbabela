import { apiRoute } from "@/server/api/route";
import { customerSelfExport } from "@/server/privacy";

export const dynamic = "force-dynamic";

/**
 * Download everything we hold about the caller (same JSON as Account → Privacy → Download my data), wrapped in
 * `{ data }`. No secrets. Audited as `privacy.export`.
 */
export const GET = apiRoute({ auth: "user", limit: "write" }, async ({ user }) => customerSelfExport(user.id));
