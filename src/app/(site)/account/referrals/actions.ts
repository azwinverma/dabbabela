"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { done, fail, type ActionResult } from "@/lib/action";
import { claimReferral } from "@/server/marketing";

export async function claimReferralAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requireUser("/account/referrals");
  const code = typeof fd.get("code") === "string" ? (fd.get("code") as string).trim().slice(0, 40) : "";
  if (!code) return fail("Enter your friend's code", { code: "Enter your friend's code" });
  const r = await claimReferral(user.id, code);
  if (!r.ok) return fail(r.error, { code: r.error });
  revalidatePath("/account/referrals");
  return done(`Linked! Enter ${code.toUpperCase()} as the coupon on your first order to get your welcome discount.`);
}
