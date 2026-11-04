"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { bool, lines, slugify, str } from "@/lib/utils";

export async function savePost(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("content.edit");
  const title = str(fd.get("title"));
  if (!title) return fail("Title is required", { title: "Required" });
  const slug = slugify(str(fd.get("slug")) || title);
  if (await db.post.findFirst({ where: { slug, NOT: id ? { id } : undefined } })) return fail("Slug already used", { slug: "Taken" });
  const existing = id ? await db.post.findUnique({ where: { id } }) : null;
  const published = bool(fd.get("published"));
  const data = {
    title,
    slug,
    excerpt: str(fd.get("excerpt")) || null,
    body: str(fd.get("body")),
    titleNe: str(fd.get("titleNe")) || null,
    bodyNe: str(fd.get("bodyNe")) || null,
    coverImage: str(fd.get("coverImage")) || null,
    tags: lines(fd.get("tags")),
    author: str(fd.get("author")) || null,
    published,
    publishedAt: published ? (existing?.publishedAt ?? new Date()) : existing?.publishedAt ?? null,
  };
  const p = id ? await db.post.update({ where: { id }, data }) : await db.post.create({ data });
  await audit(user.id, id ? "update" : "create", "Post", p.id, `${p.title}${published ? " (published)" : " (draft)"}`);
  revalidatePath("/admin/blog");
  revalidatePath("/", "layout");
  return done(published ? "Saved and live" : "Draft saved", id ? undefined : `/admin/blog/${p.id}`);
}

export async function deletePost(id: string) {
  const user = await requirePermission("content.edit");
  const p = await db.post.delete({ where: { id } });
  await audit(user.id, "delete", "Post", id, p.title);
  revalidatePath("/admin/blog");
  revalidatePath("/", "layout");
  return { ok: true };
}
