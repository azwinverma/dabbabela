"use server";
import type { BillingMode, MemberRole } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseRupees } from "@/lib/money";
import { normalizeNepalPhone } from "@/lib/phone";
import { randomCode, slugify } from "@/lib/utils";
import { fail, done, type ActionResult } from "@/lib/action";
import { findZone } from "@/server/coverage";
import {
  activateContract,
  assertCompanyAccess,
  cleanWeekdays,
  createContract,
  CorporateError,
  endContract,
  generateCompanyInvoice,
  issueCompanyInvoice,
  newContractVersion,
  setCompanyMenu,
  setDeliveryInstructions,
  updateContract,
  upsertDepartmentBudget,
  type ContractInput,
} from "@/server/corporate";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const int = (fd: FormData, k: string, min = 0, max = 100000) => {
  const n = parseInt(s(fd, k) || "0", 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
};
const intOrNull = (fd: FormData, k: string, max = 100000) => (s(fd, k) ? int(fd, k, 0, max) : null);
const moneyOrNull = (fd: FormData, k: string) => (s(fd, k) ? parseRupees(s(fd, k)) : null);
const msg = (e: unknown) => (e instanceof CorporateError ? e.message : e instanceof Error ? e.message : "Something went wrong");

/** Staff member with corporate permission and the company in their scope. */
async function staffFor(companyId: string, perm: "corporate.view" | "corporate.edit" | "invoices.edit" = "corporate.edit") {
  const user = await requirePermission(perm);
  assertCompanyAccess(user, companyId, perm);
  return user;
}

export async function saveCompanyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("corporate.edit");
  const id = s(fd, "id");
  if (id) {
    try {
      assertCompanyAccess(user, id, "corporate.edit");
    } catch (e) {
      return fail(msg(e));
    }
  }
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
  try {
    const user = await staffFor(id);
    const code = randomCode(6);
    await db.company.update({ where: { id }, data: { joinCode: code } });
    await audit({ actorId: user.id, action: "company.join_code", entity: "Company", entityId: id, summary: "Join code regenerated" });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function updateMemberAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const m = await db.companyMember.findUnique({ where: { id: s(fd, "memberId") } });
  if (!m) return fail("Member not found");
  let user;
  try {
    user = await staffFor(m.companyId);
  } catch (e) {
    return fail(msg(e));
  }
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
    ...(fd.has("eligibilityForm") ? { mealEligible: fd.get("mealEligible") === "on", eligibleDays: cleanWeekdays(fd.getAll("eligibleDays").map(String)) } : {}),
  };
  await db.companyMember.update({ where: { id: m.id }, data });
  await audit({ actorId: user.id, action: "company.member", entity: "CompanyMember", entityId: m.id, before: m, after: data });
  return done("Member updated");
}

export async function addLocationAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const companyId = s(fd, "companyId");
  let user;
  try {
    user = await staffFor(companyId);
  } catch (e) {
    return fail(msg(e));
  }
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
  const loc = await db.officeLocation.findUnique({ where: { id } });
  if (!loc) return { ok: false, message: "Not found" };
  try {
    const user = await staffFor(loc.companyId);
    await db.officeLocation.update({ where: { id }, data: { isActive: active } });
    await audit({ actorId: user.id, action: "company.location.toggle", entity: "OfficeLocation", entityId: id, after: { isActive: active } });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

// ───────────── contracts ─────────────

function contractInput(fd: FormData): ContractInput {
  const boxPrices: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    if (!k.startsWith("price_") || !String(v).trim()) continue;
    const p = parseRupees(String(v));
    if (p == null) throw new CorporateError("Negotiated prices must be rupee amounts");
    boxPrices[k.slice(6)] = p;
  }
  const pricePerMeal = s(fd, "pricePerMeal");
  if (pricePerMeal && parseRupees(pricePerMeal) == null) throw new CorporateError("Agreed price per meal must be rupees");
  return {
    title: s(fd, "title"),
    startsOn: s(fd, "startsOn"),
    endsOn: s(fd, "endsOn") || null,
    pricePerMeal: pricePerMeal ? parseRupees(pricePerMeal) : null,
    minMealsPerDay: intOrNull(fd, "minMealsPerDay"),
    minMealsPerMonth: intOrNull(fd, "minMealsPerMonth", 1_000_000),
    creditTermsDays: intOrNull(fd, "creditTermsDays", 1000),
    boxPrices,
    terms: s(fd, "terms") || null,
    documentUrl: s(fd, "documentUrl") || null,
  };
}

/** Create a contract (v1 draft), edit a draft, or (mode=version) draft the next version of an active one. */
export async function saveContractAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("corporate.edit");
  try {
    const input = contractInput(fd);
    const id = s(fd, "contractId");
    if (s(fd, "mode") === "version") {
      await newContractVersion(user, id, input);
      return done("New version drafted — activate it to take effect");
    }
    if (id) {
      await updateContract(user, id, input);
      return done("Contract saved");
    }
    await createContract(user, s(fd, "companyId"), input);
    return done("Contract drafted — activate it to take effect");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function activateContractAction(id: string) {
  const user = await requirePermission("corporate.edit");
  try {
    await activateContract(user, id);
    return { ok: true, message: "Activated" };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function endContractAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("corporate.edit");
  try {
    await endContract(user, s(fd, "contractId"), s(fd, "endsOn"), s(fd, "reason"));
    return done("Contract end date set");
  } catch (e) {
    return fail(msg(e));
  }
}

// ───────────── budgets, menu, delivery ─────────────

export async function saveBudgetAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const companyId = s(fd, "companyId");
  try {
    const user = await staffFor(companyId);
    const raw = s(fd, "amount");
    const amount = raw ? parseRupees(raw) : null;
    if (raw && amount == null) return fail("Budget must be rupees");
    await upsertDepartmentBudget(companyId, user.id, { department: s(fd, "department"), month: s(fd, "month"), amount });
    return done(amount == null ? "Budget removed" : "Budget saved");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function saveCompanyMenuAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("corporate.edit");
  try {
    const ids = fd.getAll("boxId").map(String);
    await setCompanyMenu(user, s(fd, "companyId"), ids);
    return done(ids.length ? `Company menu limited to ${ids.length} dabbas` : "Company sees the full menu");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function saveDeliveryInstructionsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const companyId = s(fd, "companyId");
  try {
    const user = await staffFor(companyId);
    await setDeliveryInstructions(companyId, user.id, s(fd, "deliveryInstructions") || null);
    return done("Delivery instructions saved");
  } catch (e) {
    return fail(msg(e));
  }
}

// ───────────── invoices ─────────────

export async function generateInvoiceAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("invoices.edit");
  try {
    const inv = await generateCompanyInvoice(user, { companyId: s(fd, "companyId"), periodStart: s(fd, "periodStart"), periodEnd: s(fd, "periodEnd"), grouping: s(fd, "grouping") === "DAY" ? "DAY" : "ORDER" });
    return done(`Draft ${inv.number} created`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function issueInvoiceAction(id: string) {
  const user = await requirePermission("invoices.edit");
  try {
    const inv = await issueCompanyInvoice(user, id);
    return { ok: true, message: `${inv.number} issued` };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}
