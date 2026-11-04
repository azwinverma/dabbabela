"use server";
import type { LeadStatus } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseRupees } from "@/lib/money";
import { dateOnly, isValidISODate } from "@/lib/dates";
import { randomCode, slugify } from "@/lib/utils";
import { fail, done, type ActionResult } from "@/lib/action";
import { LEAD_STATUS } from "@/lib/labels";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveLeadAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("leads");
  const id = s(fd, "id");
  const lead = await db.corporateLead.findUnique({ where: { id } });
  if (!lead) return fail("Lead not found");
  const status = s(fd, "status");
  const quote = s(fd, "quotePerMeal");
  if (quote && parseRupees(quote) == null) return fail("Quote must be rupees, e.g. 175");
  const follow = s(fd, "nextFollowUp");
  const valid = s(fd, "quoteValidUntil");
  const addNote = s(fd, "addNote");
  const data = {
    status: (status in LEAD_STATUS ? status : lead.status) as LeadStatus,
    quotePerMeal: quote ? parseRupees(quote) : null,
    quoteValidUntil: isValidISODate(valid) ? dateOnly(valid) : null,
    nextFollowUp: isValidISODate(follow) ? dateOnly(follow) : null,
    notes: addNote ? [lead.notes, `${new Date().toISOString().slice(0, 10)} ${user.name}: ${addNote}`].filter(Boolean).join("\n") : lead.notes,
  };
  await db.corporateLead.update({ where: { id }, data });
  await audit({ actorId: user.id, action: "lead.update", entity: "CorporateLead", entityId: id, before: { status: lead.status, quotePerMeal: lead.quotePerMeal }, after: { status: data.status, quotePerMeal: data.quotePerMeal } });
  return done("Saved");
}

export async function setLeadStatusAction(id: string, status: LeadStatus) {
  const user = await requirePermission("leads");
  await db.corporateLead.update({ where: { id }, data: { status } });
  await audit({ actorId: user.id, action: "lead.status", entity: "CorporateLead", entityId: id, after: { status } });
  return { ok: true };
}

/** Won lead → company account (discount and quote carried over as notes; billing set on the company page). */
export async function convertLeadAction(id: string) {
  const user = await requirePermission("corporate");
  const lead = await db.corporateLead.findUnique({ where: { id } });
  if (!lead) return { ok: false, message: "Lead not found" };
  if (lead.companyId) return { ok: false, message: "Already converted" };
  let slug = slugify(lead.companyName) || `company-${randomCode(4).toLowerCase()}`;
  if (await db.company.findUnique({ where: { slug } })) slug = `${slug}-${randomCode(4).toLowerCase()}`;
  const company = await db.company.create({
    data: {
      name: lead.companyName,
      slug,
      contactPerson: lead.contactName,
      contactEmail: lead.email,
      contactPhone: lead.phone,
      joinCode: randomCode(6),
      notes: [lead.location && `Location: ${lead.location}`, lead.headcount && `Headcount: ${lead.headcount}`, lead.quotePerMeal && `Quoted Rs ${lead.quotePerMeal / 100}/meal`, lead.message].filter(Boolean).join("\n") || null,
    },
  });
  await db.corporateLead.update({ where: { id }, data: { companyId: company.id, status: "WON" } });
  await audit({ actorId: user.id, action: "lead.convert", entity: "CorporateLead", entityId: id, summary: `→ company ${company.name}` });
  return { ok: true, message: `Company created — set billing on ${company.name}'s page` };
}
