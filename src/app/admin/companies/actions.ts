"use server";
import type { BillingMode, MemberRole } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseRupees } from "@/lib/money";
import { normalizeNepalPhone } from "@/lib/phone";
import { isValidISODate, dateOnly } from "@/lib/dates";
import { randomCode, slugify } from "@/lib/utils";
import { fail, done, type ActionResult } from "@/lib/action";
import { findZone } from "@/server/coverage";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const int = (fd: FormData, k: string, min = 0, max = 100000) => {
  const n = parseInt(s(fd, k) || "0", 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
};
const moneyOrNull = (fd: FormData, k: string) => (s(fd, k) ? parseRupees(s(fd, k)) : null);

export async function saveCompanyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("corporate");
  const id = s(fd, "id");
  const name = s(fd, "name");
  if (!name) return fail("Company name is required", { name: "Required" });
  const billingMode = (["EMPLOYEE_PAID", "COMPANY_PAID", "SPLIT"].includes(s(fd, "billingMode")) ? s(fd, "billingMode") : "EMPLOYEE_PAID") as BillingMode;
  const cutoff = s(fd, "cutoffOverride");
  if (cutoff && !/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) return fail("Cut-off must look like 10:00", { cutoffOverride: "HH:MM" });
  const phone = s(fd, "contactPhone");
  if (phone && !normalizeNepalPhone(phone)) return fail("That phone number doesn't look Nepali", { contactPhone: "Invalid" });
  for (const k of ["subsidyCap", "monthlyAllowance", "creditLimit"]) if (s(fd, k) && parseRupees(s(fd, k)) == null) return fail(`Check the ${k} amount`, { [k]: "Rupees, e.g. 100" });
  const data = {
    name,
    legalName: s(fd, "legalName") || null,
    contactPerson: s(fd, "contactPerson") || null,
    contactEmail: s(fd, "contactEmail").toLowerCase() || null,
    contactPhone: phone ? normalizeNepalPhone(phone) : null,
    billingAddress: s(fd, "billingAddress") || null,
    panVat: s(fd, "panVat") || null,
    zoneId: s(fd, "zoneId") || null,
    billingMode,
    subsidyPct: billingMode === "SPLIT" ? int(fd, "subsidyPct", 0, 100) : billingMode === "COMPANY_PAID" ? 100 : 0,
    subsidyCap: billingMode === "SPLIT" ? moneyOrNull(fd, "subsidyCap") : null,
    monthlyAllowance: billingMode === "EMPLOYEE_PAID" ? null : moneyOrNull(fd, "monthlyAllowance"),
    discountPct: int(fd, "discountPct", 0, 50),
    freeDelivery: fd.get("freeDelivery") === "on",
    invoiceTermsDays: int(fd, "invoiceTermsDays", 0, 120),
    creditLimit: moneyOrNull(fd, "creditLimit"),
    requireApproval: fd.get("requireApproval") === "on",
    cutoffOverride: cutoff || null,
    isActive: fd.get("isActive") !== "off",
    notes: s(fd, "notes") || null,
  };
  if (id) {
    const before = await db.company.findUnique({ where: { id } });
    if (!before) return fail("Not found");
    await db.company.update({ where: { id }, data });
    await audit({ actorId: user.id, action: "company.update", entity: "Company", entityId: id, before, after: data, reason: s(fd, "reason") || null });
    return done("Saved");
  }
  let slug = slugify(name) || `company-${randomCode(4).toLowerCase()}`;
  if (await db.company.findUnique({ where: { slug } })) slug = `${slug}-${randomCode(4).toLowerCase()}`;
  const c = await db.company.create({ data: { ...data, slug, joinCode: randomCode(6) } });
  await audit({ actorId: user.id, action: "company.create", entity: "Company", entityId: c.id, after: data });
  return done("Company created", `/admin/companies/${c.id}`);
}

export async function regenerateCodeAction(id: string) {
  const user = await requirePermission("corporate");
  const code = randomCode(6);
  await db.company.update({ where: { id }, data: { joinCode: code } });
  await audit({ actorId: user.id, action: "company.join_code", entity: "Company", entityId: id, summary: "Join code regenerated" });
  return { ok: true };
}

export async function updateMemberAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("corporate");
  const m = await db.companyMember.findUnique({ where: { id: s(fd, "memberId") } });
  if (!m) return fail("Member not found");
  const status = s(fd, "status") as "PENDING" | "ACTIVE" | "REMOVED";
  const role = s(fd, "role") as MemberRole;
  const locId = s(fd, "officeLocationId") || null;
  if (locId && !(await db.officeLocation.findFirst({ where: { id: locId, companyId: m.companyId } }))) return fail("Unknown office location");
  const allowance = s(fd, "allowanceOverride");
  if (allowance && parseRupees(allowance) == null) return fail("Allowance must be rupees");
  const data = {
    status: ["PENDING", "ACTIVE", "REMOVED"].includes(status) ? status : m.status,
    role: role === "ADMIN" ? ("ADMIN" as const) : ("MEMBER" as const),
    department: s(fd, "department") || null,
    costCenter: s(fd, "costCenter") || null,
    employeeCode: s(fd, "employeeCode") || null,
    officeLocationId: locId,
    allowanceOverride: allowance ? parseRupees(allowance) : null,
  };
  await db.companyMember.update({ where: { id: m.id }, data });
  await audit({ actorId: user.id, action: "company.member", entity: "CompanyMember", entityId: m.id, before: m, after: data });
  return done("Member updated");
}

export async function addLocationAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("corporate");
  const companyId = s(fd, "companyId");
  const name = s(fd, "name");
  const area = s(fd, "area");
  const line1 = s(fd, "line1");
  if (!name || !area || !line1) return fail("Name, street/building and area are required");
  const ward = s(fd, "ward") ? parseInt(s(fd, "ward"), 10) : null;
  const zone = await findZone({ area, ward });
  const phone = s(fd, "receiverPhone");
  const loc = await db.officeLocation.create({
    data: { companyId, name, line1, area, ward: Number.isFinite(ward) ? ward : null, landmark: s(fd, "landmark") || null, zoneId: zone?.id ?? null, slotId: s(fd, "slotId") || null, receiverName: s(fd, "receiverName") || null, receiverPhone: phone ? normalizeNepalPhone(phone) : null },
  });
  await audit({ actorId: user.id, action: "company.location", entity: "OfficeLocation", entityId: loc.id, after: loc });
  return done(zone ? `Added — delivered from ${zone.name}` : `Added, but ${area} isn't in a delivery zone yet. Add the area to a zone before staff can order.`);
}

export async function toggleLocationAction(id: string, active: boolean) {
  const user = await requirePermission("corporate");
  await db.officeLocation.update({ where: { id }, data: { isActive: active } });
  await audit({ actorId: user.id, action: "company.location.toggle", entity: "OfficeLocation", entityId: id, after: { isActive: active } });
  return { ok: true };
}

export async function saveContractAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("corporate");
  const title = s(fd, "title");
  const startsOn = s(fd, "startsOn");
  if (!title || !isValidISODate(startsOn)) return fail("Title and start date are required");
  const endsOn = s(fd, "endsOn");
  const data = {
    companyId: s(fd, "companyId"),
    title,
    startsOn: dateOnly(startsOn),
    endsOn: isValidISODate(endsOn) ? dateOnly(endsOn) : null,
    pricePerMeal: moneyOrNull(fd, "pricePerMeal"),
    minMealsPerDay: s(fd, "minMealsPerDay") ? int(fd, "minMealsPerDay", 0, 10000) : null,
    terms: s(fd, "terms") || null,
    documentUrl: s(fd, "documentUrl") || null,
    status: ["DRAFT", "ACTIVE", "ENDED"].includes(s(fd, "status")) ? s(fd, "status") : "DRAFT",
  };
  const id = s(fd, "contractId");
  const c = id ? await db.corporateContract.update({ where: { id }, data }) : await db.corporateContract.create({ data });
  await audit({ actorId: user.id, action: id ? "contract.update" : "contract.create", entity: "CorporateContract", entityId: c.id, after: data });
  return done("Contract saved");
}
