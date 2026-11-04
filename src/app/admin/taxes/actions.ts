"use server";

import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dateOnly } from "@/lib/dates";
import { done, fail, type ActionResult } from "@/lib/action";
import { guarded } from "../_kit/guard";
import { f, FieldError } from "../_kit/form";

export async function saveTaxRule(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("pricing.edit", async (user) => {
    const name = f.str(fd, "name", 60);
    if (!name) throw new FieldError("name", "Name is required");
    const ratePct = f.num(fd, "rate", -1);
    if (ratePct < 0 || ratePct > 50) throw new FieldError("rate", "Rate must be 0–50%");
    const effectiveFrom = f.date(fd, "effectiveFrom");
    if (!effectiveFrom) throw new FieldError("effectiveFrom", "Pick a start date");
    const effectiveTo = f.date(fd, "effectiveTo");
    if (effectiveTo && effectiveTo < effectiveFrom) throw new FieldError("effectiveTo", "Ends before it starts");
    const isActive = f.bool(fd, "isActive");
    if (isActive && f.str(fd, "registered") !== "yes") throw new FieldError("registered", "Confirm the business is VAT-registered before charging VAT");
    const data = { name, rateBps: Math.round(ratePct * 100), inclusive: f.bool(fd, "inclusive"), isActive, effectiveFrom: dateOnly(effectiveFrom), effectiveTo: effectiveTo ? dateOnly(effectiveTo) : null };
    const before = id ? await db.taxRule.findUnique({ where: { id } }) : null;
    const r = id ? await db.taxRule.update({ where: { id }, data }) : await db.taxRule.create({ data });
    await audit({ actorId: user.id, action: id ? "tax.update" : "tax.create", entity: "TaxRule", entityId: r.id, summary: `${name} ${ratePct}%`, before, after: data });
    return done("Tax rule saved — applies to new orders only");
  }, ["/admin/taxes"]);
}

export async function deleteTaxRule(id: string): Promise<ActionResult> {
  return guarded("pricing.edit", async (user) => {
    const r = await db.taxRule.findUnique({ where: { id } });
    if (!r) return fail("Not found");
    if (r.isActive) return fail("Deactivate it first");
    await db.taxRule.delete({ where: { id } });
    await audit({ actorId: user.id, action: "tax.delete", entity: "TaxRule", entityId: id, before: r });
    return done("Deleted");
  }, ["/admin/taxes"]);
}
