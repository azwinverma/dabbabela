import type { Role } from "@prisma/client";
import { revalidatePath, revalidateTag } from "next/cache";
import { can, type Permission } from "@/lib/permissions";

/** Who is acting. Same shape as CurrentUser (custom-role grants included) so server checks match the admin. */
export type CmsActor = { id: string; role: Role | string; customGrants?: readonly string[] | null };

export class CmsError extends Error {}

/** Server-side permission check for every CMS mutation (actions call these functions; tests call them directly). */
export function assertCan(actor: CmsActor, perm: Permission) {
  if (!can(actor, perm)) throw new CmsError(`FORBIDDEN:${perm}`);
}

/** Revalidate public pages after a CMS change. Safe outside Next (scripts, tests). */
export function revalidateCms(paths: string[] = []) {
  try {
    revalidateTag("cms");
    for (const p of paths) revalidatePath(p);
  } catch {
    /* outside a Next request */
  }
}

export function revalidateSite() {
  try {
    revalidateTag("cms");
    revalidatePath("/", "layout");
  } catch {
    /* outside a Next request */
  }
}
