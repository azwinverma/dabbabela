import type { Prisma } from "@prisma/client";

/** What getCurrentUser loads for a user — shared so staff-on-behalf flows (team orders) and tests build the same shape. */
export const CURRENT_USER_INCLUDE = {
  membership: { include: { company: true, officeLocation: true } },
  addresses: { where: { archivedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], include: { zone: true } },
  staffRole: { select: { id: true, key: true, name: true, permissions: true } },
  scopes: { select: { kitchenId: true, companyId: true } },
} satisfies Prisma.UserInclude;

export type LoadedUser = Prisma.UserGetPayload<{ include: typeof CURRENT_USER_INCLUDE }>;

/**
 * Kitchens a staff member is limited to: User.kitchenId (primary) ∪ StaffScope kitchen rows.
 * null = unscoped (all kitchens).
 */
export function kitchenScope(user: { kitchenId: string | null; scopes?: { kitchenId: string | null }[] }): string[] | null {
  const ids = new Set<string>();
  if (user.kitchenId) ids.add(user.kitchenId);
  for (const s of user.scopes ?? []) if (s.kitchenId) ids.add(s.kitchenId);
  return ids.size ? [...ids] : null;
}

export function toCurrentUser(u: LoadedUser, sessionId: string) {
  return { ...u, sessionId, customGrants: u.staffRole?.permissions ?? [], kitchenIds: kitchenScope(u) };
}
