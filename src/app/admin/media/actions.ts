"use server";

import { del } from "@vercel/blob";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { guarded } from "../_kit/guard";
import { f } from "../_kit/form";

/** Where is this URL used? (dabbas, dishes, posts, testimonials, CMS sections, settings) */
async function usages(url: string) {
  const [boxes, dishes, posts, tests, cms, settings] = await Promise.all([
    db.lunchBox.count({ where: { image: url } }),
    db.menuItem.count({ where: { image: url } }),
    db.post.count({ where: { coverImage: url } }),
    db.testimonial.count({ where: { avatar: url } }),
    db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "ContentSection" WHERE data::text LIKE ${"%" + url + "%"} OR COALESCE(draft::text, '') LIKE ${"%" + url + "%"}`,
    db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "Setting" WHERE value::text LIKE ${"%" + url + "%"}`,
  ]);
  const out: string[] = [];
  if (boxes) out.push(`${boxes} dabba(s)`);
  if (dishes) out.push(`${dishes} dish(es)`);
  if (posts) out.push(`${posts} post(s)`);
  if (tests) out.push(`${tests} testimonial(s)`);
  if (Number(cms[0]?.n ?? 0)) out.push("website sections");
  if (Number(settings[0]?.n ?? 0)) out.push("settings");
  return out;
}

export async function saveMediaMeta(id: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("media.edit", async (user) => {
    const data = { alt: f.opt(fd, "alt", 200), credit: f.opt(fd, "credit", 200), isPlaceholder: f.bool(fd, "isPlaceholder") };
    await db.mediaAsset.update({ where: { id }, data });
    await audit({ actorId: user.id, action: "media.update", entity: "MediaAsset", entityId: id, after: data });
    return done("Saved");
  }, ["/admin/media"]);
}

export async function deleteMedia(id: string): Promise<ActionResult> {
  return guarded("media.edit", async (user) => {
    const m = await db.mediaAsset.findUnique({ where: { id } });
    if (!m) return fail("Not found");
    const used = await usages(m.url);
    if (used.length) return fail(`Still used in ${used.join(", ")}. Replace it there first.`);
    try {
      if (m.url.includes(".blob.vercel-storage.com") && process.env.BLOB_READ_WRITE_TOKEN) await del(m.url);
      else if (m.url.startsWith("/uploads/") && process.env.NODE_ENV !== "production") {
        const file = path.join(process.cwd(), "public", path.normalize(m.url).replace(/^(\.\.(\/|\\|$))+/, ""));
        if (file.startsWith(path.join(process.cwd(), "public", "uploads"))) await unlink(file).catch(() => {});
      }
    } catch (e) {
      return fail(`Could not remove the file: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    await db.mediaAsset.delete({ where: { id } });
    await audit({ actorId: user.id, action: "media.delete", entity: "MediaAsset", entityId: id, summary: m.name, before: m });
    return done("Deleted");
  }, ["/admin/media"]);
}
