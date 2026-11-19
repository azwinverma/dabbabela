"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { done, fail, type ActionResult } from "@/lib/action";
import { str } from "@/lib/utils";
import { parsePin, PinError, saveAddressPin } from "@/server/customer-dashboard";

/** Set or remove the optional map pin on one of the signed-in customer's addresses (WP-18 / WP-13 request). */
export async function saveAddressPinAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Faccount%2Faddresses");
  const addressId = str(fd.get("addressId"));
  const clear = str(fd.get("intent")) === "clear";
  try {
    const pin = clear ? null : parsePin(fd.get("lat"), fd.get("lng"));
    if (!clear && !pin) return fail("Enter both latitude and longitude, or use “Remove pin”", { lat: "Required", lng: "Required" });
    await saveAddressPin(user.id, addressId, pin);
  } catch (e) {
    if (e instanceof PinError) return fail(e.message);
    return fail("Couldn't save the pin — try again");
  }
  revalidatePath("/account/addresses");
  revalidatePath("/checkout");
  return done(clear ? "Pin removed" : "Pin saved");
}
