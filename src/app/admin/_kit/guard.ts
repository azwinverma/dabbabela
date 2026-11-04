import "server-only";
import { revalidatePath } from "next/cache";
import { requirePermission, type CurrentUser } from "@/lib/auth";
import type { Permission } from "@/lib/permissions";
import { fail, type ActionResult } from "@/lib/action";
import { log } from "@/lib/logger";
import { FieldError } from "./form";

/**
 * Wrap an admin server action: permission check (redirects if missing), readable errors,
 * revalidation. Use inside "use server" files.
 */
export async function guarded(perm: Permission, fn: (user: CurrentUser) => Promise<ActionResult>, revalidate?: string | string[]): Promise<ActionResult> {
  const user = await requirePermission(perm);
  try {
    const res = await fn(user);
    for (const p of [revalidate ?? []].flat()) revalidatePath(p);
    return res;
  } catch (e) {
    if (e instanceof FieldError) return fail(e.message, { [e.field]: e.message });
    if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Unique constraint")) return fail("That already exists — use a different name/code.");
    if (msg.includes("Foreign key constraint")) return fail("It's still in use elsewhere, so it can't be deleted. Archive it instead.");
    log.warn("admin.action_failed", { perm, error: msg });
    return fail(msg.length < 220 ? msg : "Something went wrong. Please try again.");
  }
}
