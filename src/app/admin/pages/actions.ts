"use server";

import { done, fail, type ActionResult } from "@/lib/action";
import type { CurrentUser } from "@/lib/auth";
import type { Permission } from "@/lib/permissions";
import { CmsError } from "@/lib/cms/access";
import { deletePolicyPage, restorePolicyRevision, savePolicyPage } from "@/lib/cms/policies";
import { guarded } from "../_kit/guard";
import { f } from "../_kit/form";

async function run(perm: Permission, fn: (user: CurrentUser) => Promise<ActionResult>, paths: string[] = []) {
  return guarded(
    perm,
    async (user) => {
      try {
        return await fn(user);
      } catch (e) {
        if (e instanceof CmsError) return fail(e.message.startsWith("FORBIDDEN:content.publish") ? "Changing a live page needs the content publish permission — save it unpublished, or ask a publisher" : e.message.startsWith("FORBIDDEN") ? "Not allowed" : e.message);
        throw e;
      }
    },
    ["/admin/pages", ...paths],
  );
}

export async function savePage(id: string | null, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("content.edit", async (user) => {
    const title = f.str(fd, "title", 160);
    if (!title) return fail("Title is required", { title: "Required" });
    const p = await savePolicyPage(user, id, {
      title,
      slug: f.str(fd, "slug", 160),
      body: f.str(fd, "body", 100_000),
      titleNe: f.opt(fd, "titleNe", 160),
      bodyNe: f.opt(fd, "bodyNe", 100_000),
      seoTitle: f.opt(fd, "seoTitle", 200),
      seoDescription: f.opt(fd, "seoDescription", 400),
      published: f.bool(fd, "published"),
      showInFooter: f.bool(fd, "showInFooter"),
      needsLegalReview: f.bool(fd, "needsLegalReview"),
    });
    return done("Page saved", id ? undefined : `/admin/pages/${p.id}`);
  }, id ? [`/admin/pages/${id}`] : []);
}

export async function deletePage(id: string): Promise<ActionResult> {
  return run("content.publish", async (user) => {
    await deletePolicyPage(user, id);
    return done("Page deleted", "/admin/pages?tab=policies");
  });
}

export async function restorePageRevision(id: string, revisionId: string): Promise<ActionResult> {
  return run(
    "content.publish",
    async (user) => {
      await restorePolicyRevision(user, revisionId);
      return done("Revision restored");
    },
    [`/admin/pages/${id}`],
  );
}
