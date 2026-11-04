"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { bool, slugify, str } from "@/lib/utils";

export async function savePage(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("content");
  const title = str(fd.get("title"));
  if (!title) return fail("Title is required", { title: "Required" });
  const slug = slugify(str(fd.get("slug")) || title);
  if (await db.page.findFirst({ where: { slug, NOT: id ? { id } : undefined } })) return fail("Slug already used", { slug: "Taken" });
  const data = {
    title,
    slug,
    body: str(fd.get("body")),
    titleNe: str(fd.get("titleNe")) || null,
    bodyNe: str(fd.get("bodyNe")) || null,
    needsLegalReview: bool(fd.get("needsLegalReview")),
    seoTitle: str(fd.get("seoTitle")) || null,
    seoDescription: str(fd.get("seoDescription")) || null,
    published: bool(fd.get("published")),
    showInFooter: bool(fd.get("showInFooter")),
  };
  const before = id ? await db.page.findUnique({ where: { id } }) : null;
  const p = id ? await db.page.update({ where: { id }, data }) : await db.page.create({ data });
  await audit({ actorId: user.id, action: id ? "page.update" : "page.create", entity: "Page", entityId: p.id, summary: p.title, before, after: data });
  revalidatePath("/admin/pages");
  revalidatePath("/", "layout");
  return done("Page saved", id ? undefined : `/admin/pages/${p.id}`);
}

export async function deletePage(id: string) {
  const user = await requirePermission("content");
  const p = await db.page.delete({ where: { id } });
  await audit(user.id, "delete", "Page", id, p.title);
  revalidatePath("/admin/pages");
  revalidatePath("/", "layout");
  return { ok: true };
}
