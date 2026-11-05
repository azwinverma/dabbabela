import "server-only";
import { db } from "@/lib/db";
import { cleanViewName, isValidModule, parseView, serializeView } from "./params";

/** Saved filters (SavedView): private to one staff member, per admin page (`module`, e.g. "audit", "orders"). */
export type SavedViewDTO = { id: string; name: string; query: Record<string, string> };

export const MAX_VIEWS_PER_MODULE = 20;

export async function listSavedViews(userId: string, module: string): Promise<SavedViewDTO[]> {
  if (!isValidModule(module)) return [];
  const rows = await db.savedView.findMany({ where: { userId, module }, orderBy: { createdAt: "asc" }, take: MAX_VIEWS_PER_MODULE });
  return rows.map((r) => ({ id: r.id, name: r.name, query: parseView(r.query) }));
}

/** Create, or overwrite the user's view with the same name on that page. */
export async function saveView(userId: string, module: string, name: string, params: Record<string, unknown>): Promise<SavedViewDTO> {
  if (!isValidModule(module)) throw new Error("Unknown page");
  const clean = cleanViewName(name);
  if (!clean) throw new Error("Give the view a name");
  const query = serializeView(params);
  const existing = await db.savedView.findFirst({ where: { userId, module, name: clean } });
  if (existing) {
    const r = await db.savedView.update({ where: { id: existing.id }, data: { query } });
    return { id: r.id, name: r.name, query };
  }
  const count = await db.savedView.count({ where: { userId, module } });
  if (count >= MAX_VIEWS_PER_MODULE) throw new Error(`You can keep up to ${MAX_VIEWS_PER_MODULE} views per page — delete one first`);
  const r = await db.savedView.create({ data: { userId, module, name: clean, query } });
  return { id: r.id, name: r.name, query };
}

/** Delete only the caller's own view (no IDOR across users). Returns whether a row was removed. */
export async function deleteView(userId: string, id: string): Promise<boolean> {
  const res = await db.savedView.deleteMany({ where: { id, userId } });
  return res.count > 0;
}
