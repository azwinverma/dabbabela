import { apiRoute } from "@/server/api/route";
import { iso } from "@/server/api/http";
import { scopedKitchens, staffNeeds2fa } from "@/server/api/auth";
import { appFlags } from "@/server/api/dto";
import { activeCompany } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { can, isStaffRole, permissionsFor, ROLE_LABEL } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Who am I: account, role, effective granular permissions, kitchen scope, which app sections to show, staff 2FA state
 * and the feature flags the app needs. Call after sign-in and on app start; the app must still handle 401/403 per call.
 */
export const GET = apiRoute({ auth: "user" }, async ({ user }) => {
  const settings = await getSettings();
  const staff = isStaffRole(user.role);
  const company = activeCompany(user);
  const kitchens = staff ? await scopedKitchens(user) : [];
  const needs2fa = staffNeeds2fa(user, settings);
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email.endsWith("@phone.dabbabela.local") ? null : user.email,
      phone: user.phoneNumber,
      phoneVerified: Boolean(user.phoneNumberVerified),
      locale: user.locale,
      role: user.role,
      roleLabel: ROLE_LABEL[user.role],
      isStaff: staff,
      createdAt: iso(user.createdAt),
    },
    permissions: permissionsFor(user),
    kitchenScope: { all: user.kitchenIds === null, kitchenIds: user.kitchenIds, kitchens },
    company: company ? { id: company.id, name: company.name, billingMode: company.billingMode, memberRole: user.membership!.role, department: user.membership!.department } : null,
    membershipStatus: user.membership?.status ?? null,
    twoFactor: { enabled: Boolean(user.twoFactorEnabled), required: staff && settings.flags.staff2fa, setupRequired: needs2fa },
    /** Role-aware sections of the one app. Staff sections are hidden until 2FA setup is done. */
    apps: {
      customer: true,
      rider: !needs2fa && can(user, "rider.view"),
      kitchen: !needs2fa && can(user, "kitchen.view"),
      dispatcher: !needs2fa && can(user, "dispatch.view"),
    },
    flags: appFlags(settings),
  };
});
