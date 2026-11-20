import { apiRoute } from "@/server/api/route";
import { throwIfFailed } from "@/server/api/customer-dto";
import { setDefaultAddress } from "@/server/addresses";

export const dynamic = "force-dynamic";

/** Make this the default delivery address. Another customer's address → 404. */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", limit: "write" }, async ({ user, params }) => {
  const r = await setDefaultAddress(user, params.id);
  throwIfFailed(r);
  return { message: r.message };
});
