import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { log } from "@/lib/logger";
import { isNepalMobile, normalizeNepalPhone } from "@/lib/phone";
import { claimReferral } from "./marketing";

/**
 * Sign-up rules shared by the web register form (src/lib/actions/auth.ts) and the mobile API (POST /api/v1/auth/sign-up):
 * validation, phone/company-code pre-checks before the account exists, and the after-sign-up steps.
 */

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().refine((p) => isNepalMobile(p), "Enter a Nepal mobile number (98/97/96…)"),
  password: z.string().min(8, "Use at least 8 characters").max(128),
  companyCode: z.string().trim().max(20).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export type RegisterCheck =
  | { ok: true; phone: string; company: { id: string; requireApproval: boolean } | null }
  | { ok: false; message: string; field: "phone" | "companyCode"; hint: string };

/** Checks that need the database, before the Better Auth account is created. */
export async function preRegisterCheck(d: Pick<RegisterInput, "phone" | "companyCode">): Promise<RegisterCheck> {
  const phone = normalizeNepalPhone(d.phone)!;
  if (await db.user.findUnique({ where: { phoneNumber: phone } })) return { ok: false, message: "That mobile number is already on another account", field: "phone", hint: "Already registered" };
  const company = d.companyCode ? await db.company.findFirst({ where: { joinCode: d.companyCode.toUpperCase(), isActive: true }, select: { id: true, requireApproval: true } }) : null;
  if (d.companyCode && !company) return { ok: false, message: "We don't recognise that company code", field: "companyCode", hint: "Check with your office admin" };
  return { ok: true, phone, company };
}

/** After the account exists: phone, company membership, referral claim (each best effort, never blocks sign-up). */
export async function afterRegister(userId: string, opts: { phone: string; company: { id: string; requireApproval: boolean } | null; ref?: string | null }) {
  try {
    await db.user.update({ where: { id: userId }, data: { phoneNumber: opts.phone } });
  } catch {
    // race on the unique phone — account still created, they can add it later
  }
  if (opts.company) {
    await db.companyMember.create({ data: { companyId: opts.company.id, userId, status: opts.company.requireApproval ? "PENDING" : "ACTIVE" } }).catch(() => null);
  }
  const ref = (opts.ref ?? "").trim().slice(0, 20);
  if (ref) {
    const r = await claimReferral(userId, ref).catch((e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) log.info("register.referral_not_claimed", { userId, error: r.error });
  }
}
