"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { isStaffRole } from "@/lib/permissions";
import { done, fail, type ActionResult } from "@/lib/action";
import { globalSearch, type SearchHit } from "./search";
import { deleteView, listSavedViews, saveView, type SavedViewDTO } from "./saved-views";

/** Kit server actions: global search and saved views. Each re-checks the session; search filters by permission. */
async function staff() {
  const user = await getCurrentUser();
  return user && isStaffRole(user.role) ? user : null;
}

export async function adminSearchAction(q: string): Promise<SearchHit[]> {
  const user = await staff();
  if (!user) return [];
  return globalSearch(user, q);
}

export async function listViewsAction(module: string): Promise<SavedViewDTO[]> {
  const user = await staff();
  if (!user) return [];
  return listSavedViews(user.id, module);
}

export async function saveViewAction(module: string, basePath: string, name: string, params: Record<string, string>): Promise<ActionResult> {
  const user = await staff();
  if (!user) return fail("Sign in again");
  try {
    await saveView(user.id, module, name, params);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Couldn't save the view");
  }
  if (basePath.startsWith("/admin")) revalidatePath(basePath);
  return done("View saved");
}

export async function deleteViewAction(id: string, basePath: string): Promise<ActionResult> {
  const user = await staff();
  if (!user) return fail("Sign in again");
  const ok = await deleteView(user.id, String(id));
  if (basePath.startsWith("/admin")) revalidatePath(basePath);
  return ok ? done("View deleted") : fail("View not found");
}
