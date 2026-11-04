"use server";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseRupees } from "@/lib/money";
import { fail, done, type ActionResult } from "@/lib/action";
import { marketingSpend, SPEND_KEY } from "@/server/reports";

export async function saveSpendAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("analytics.view");
  const ym = String(fd.get("ym") ?? "");
  if (!/^\d{4}-\d{2}$/.test(ym)) return fail("Pick a month");
  const amount = parseRupees(String(fd.get("amount") ?? ""));
  if (amount == null || amount < 0) return fail("Enter the amount spent in rupees");
  const before = await marketingSpend();
  const value = { ...before, [ym]: amount };
  await db.setting.upsert({ where: { key: SPEND_KEY }, create: { key: SPEND_KEY, value }, update: { value } });
  await audit({ actorId: user.id, action: "marketing.spend", entity: "Setting", entityId: SPEND_KEY, before: { [ym]: before[ym] ?? null }, after: { [ym]: amount } });
  return done("Saved");
}
