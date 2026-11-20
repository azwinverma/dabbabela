"use server";

import { done, fail, type ActionResult } from "@/lib/action";
import type { CurrentUser } from "@/lib/auth";
import { can, type Permission } from "@/lib/permissions";
import { isLocale } from "@/lib/i18n";
import { CmsError } from "@/lib/cms/access";
import {
  cancelSchedule,
  createPage,
  deletePage,
  discardDraft,
  publishDraft,
  republishPage,
  restoreVersion,
  saveDraft,
  unpublishPage,
  updatePageMeta,
  updatePageSeo,
} from "@/lib/cms/pages";
import { guarded } from "../../_kit/guard";
import { f } from "../../_kit/form";

const FRIENDLY: Record<string, string> = {
  "content.edit": "You need the content edit permission",
  "content.publish": "You can save drafts; publishing needs the content publish permission",
  "seo.edit": "SEO settings need the SEO edit permission",
};

/** guarded() + readable CMS errors. Every store function re-checks the permission it needs. */
async function run(perm: Permission, fn: (user: CurrentUser) => Promise<ActionResult>, paths: string[] = []) {
  return guarded(
    perm,
    async (user) => {
      try {
        return await fn(user);
      } catch (e) {
        if (e instanceof CmsError) {
          const m = /^FORBIDDEN:(.+)$/.exec(e.message);
          return fail(m ? (FRIENDLY[m[1]!] ?? "Not allowed") : e.message);
        }
        throw e;
      }
    },
    ["/admin/pages", ...paths],
  );
}

/** Datetime-local input ("YYYY-MM-DDTHH:mm") read as Kathmandu time. */
function ktmDateTime(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00+05:45`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function createCmsPageAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("content.edit", async (user) => {
    const page = await createPage(user, { title: f.str(fd, "title", 160), titleNe: f.opt(fd, "titleNe", 160), slug: f.str(fd, "slug", 160) });
    return done("Page created — add blocks, then publish", `/admin/pages/cms/${page.id}`);
  });
}

export async function savePageMetaAction(pageId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    "content.edit",
    async (user) => {
      await updatePageMeta(user, pageId, { title: f.str(fd, "title", 160), titleNe: f.opt(fd, "titleNe", 160), slug: f.str(fd, "slug", 160), showInNav: f.bool(fd, "showInNav") });
      return done("Page details saved");
    },
    [`/admin/pages/cms/${pageId}`],
  );
}

export async function savePageSeoAction(pageId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run(
    "seo.edit",
    async (user) => {
      await updatePageSeo(user, pageId, {
        seoTitle: f.str(fd, "seoTitle", 200),
        seoDescription: f.str(fd, "seoDescription", 400),
        ogImage: f.str(fd, "ogImage", 500),
        canonicalUrl: f.str(fd, "canonicalUrl", 300),
        noindex: f.bool(fd, "noindex"),
      });
      return done("SEO saved");
    },
    [`/admin/pages/cms/${pageId}`],
  );
}

/** Called by the block editor: save the draft, then optionally publish now or schedule it. */
export async function saveBlocksAction(pageId: string, locale: string, blocksJson: string, intent: "draft" | "publish" | "schedule", publishAt?: string): Promise<ActionResult> {
  return run(
    "content.edit",
    async (user) => {
      if (!isLocale(locale)) return fail("Unknown language");
      if (intent !== "draft" && !can(user, "content.publish")) return fail(FRIENDLY["content.publish"]!);
      let blocks: unknown;
      try {
        blocks = JSON.parse(blocksJson);
      } catch {
        return fail("Couldn't read the blocks");
      }
      let when: Date | null = null;
      if (intent === "schedule") {
        when = ktmDateTime(publishAt ?? "");
        if (!when || when.getTime() <= Date.now()) return fail("Pick a future date and time (Kathmandu time)");
      }
      const v = await saveDraft(user, pageId, locale, blocks);
      if (intent === "draft") return done(`Draft saved (v${v.version}) — not live yet`);
      const live = await publishDraft(user, pageId, locale, { publishAt: when });
      return done(live.status === "SCHEDULED" ? `Scheduled v${live.version} for ${publishAt?.replace("T", " ")} (Kathmandu)` : `Published v${live.version} — live now`);
    },
    [`/admin/pages/cms/${pageId}`],
  );
}

export async function discardDraftAction(pageId: string, locale: string): Promise<ActionResult> {
  return run(
    "content.edit",
    async (user) => {
      if (!isLocale(locale)) return fail("Unknown language");
      const n = await discardDraft(user, pageId, locale);
      return done(n ? "Draft discarded" : "No draft to discard");
    },
    [`/admin/pages/cms/${pageId}`],
  );
}

export async function restoreVersionAction(pageId: string, versionId: string): Promise<ActionResult> {
  return run(
    "content.publish",
    async (user) => {
      const v = await restoreVersion(user, versionId);
      return done(`Restored — live as v${v.version}`);
    },
    [`/admin/pages/cms/${pageId}`],
  );
}

export async function cancelScheduleAction(pageId: string, versionId: string): Promise<ActionResult> {
  return run(
    "content.publish",
    async (user) => {
      await cancelSchedule(user, versionId);
      return done("Schedule cancelled");
    },
    [`/admin/pages/cms/${pageId}`],
  );
}

export async function unpublishPageAction(pageId: string): Promise<ActionResult> {
  return run(
    "content.publish",
    async (user) => {
      await unpublishPage(user, pageId);
      return done("Taken off the site");
    },
    [`/admin/pages/cms/${pageId}`],
  );
}

export async function republishPageAction(pageId: string): Promise<ActionResult> {
  return run(
    "content.publish",
    async (user) => {
      await republishPage(user, pageId);
      return done("Back on the site");
    },
    [`/admin/pages/cms/${pageId}`],
  );
}

export async function deletePageAction(pageId: string): Promise<ActionResult> {
  return run("content.publish", async (user) => {
    await deletePage(user, pageId);
    return done("Page deleted", "/admin/pages");
  });
}
