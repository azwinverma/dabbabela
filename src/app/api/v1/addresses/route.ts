import { apiRoute } from "@/server/api/route";
import { created, readJson } from "@/server/api/http";
import { addressDto, addressInput, throwIfFailed } from "@/server/api/customer-dto";
import { saveAddress } from "@/server/addresses";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** The caller's saved addresses (not archived), default first, with the delivery zone they fall in. */
export const GET = apiRoute({ auth: "user" }, async ({ user }) => user.addresses.map(addressDto));

/** Add an address (max 10). The zone is linked from area/ward/municipality; `covered: false` = we don't deliver there yet. */
export const POST = apiRoute({ auth: "user", limit: "write" }, async ({ req, user }) => {
  const { isDefault, ...raw } = await readJson(req, addressInput);
  const r = await saveAddress(user, raw, { isDefault });
  throwIfFailed(r);
  const a = await db.address.findUniqueOrThrow({ where: { id: r.addressId! }, include: { zone: true } });
  return created({ message: r.message, covered: r.covered, address: addressDto(a) });
});
