"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { bool, intOr, str } from "@/lib/utils";

export async function saveFaq(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("content");
  const question = str(fd.get("question"));
  const answer = str(fd.get("answer"));
  if (!question || !answer) return fail("Question and answer are required");
  const data = { question, answer, questionNe: str(fd.get("questionNe")) || null, answerNe: str(fd.get("answerNe")) || null, category: str(fd.get("category")) || "General", published: bool(fd.get("published")), sortOrder: intOr(fd.get("sortOrder")) };
  const f = id ? await db.faq.update({ where: { id }, data }) : await db.faq.create({ data });
  await audit(user.id, id ? "update" : "create", "Faq", f.id, f.question);
  revalidatePath("/admin/faqs");
  revalidatePath("/", "layout");
  return done("Saved", "/admin/faqs");
}

export async function toggleFaq(id: string) {
  const user = await requirePermission("content");
  const f = await db.faq.findUnique({ where: { id } });
  if (!f) return { ok: false, message: "Not found" };
  await db.faq.update({ where: { id }, data: { published: !f.published } });
  await audit(user.id, f.published ? "unpublish" : "publish", "Faq", id, f.question);
  revalidatePath("/admin/faqs");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteFaq(id: string) {
  const user = await requirePermission("content");
  const f = await db.faq.delete({ where: { id } });
  await audit(user.id, "delete", "Faq", id, f.question);
  revalidatePath("/admin/faqs");
  revalidatePath("/", "layout");
  return { ok: true };
}
