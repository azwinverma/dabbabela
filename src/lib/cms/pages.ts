import type { CmsPage, CmsPageVersion, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { log } from "@/lib/logger";
import type { Locale } from "@/lib/i18n";
import { blockImages, renderableBlocks, validateBlocks, type Block } from "./blocks";
import { assertCan, CmsError, revalidateCms, type CmsActor } from "./access";
import { isSafeImage, isSitePath } from "./urls";

/**
 * Page builder storage: CmsPage + immutable-once-published CmsPageVersion rows, per locale.
 *
 * - Draft: at most one DRAFT version per page+locale, edited in place (`content.edit`).
 * - Publish now / schedule (`content.publish`): the draft becomes PUBLISHED (publishedAt = now) or SCHEDULED (publishAt).
 * - Read time: the live version is the PUBLISHED-or-due-SCHEDULED version with the latest effective time, so a
 *   scheduled version goes live at its time without a cron. `publishDuePages()` (WP-16 cron) just tidies statuses.
 * - Restore = copy an older version's blocks into a new version and publish it, so history is never rewritten.
 *
 * Page status: DRAFT (never live) · SCHEDULED (first publish pending) · PUBLISHED · ARCHIVED (taken off the site).
 */

export const LIVE_PAGE_STATUSES = ["PUBLISHED", "SCHEDULED"];

/** First path segments owned by fixed routes (fixed routes win; a CMS page there would never be reachable). */
export const RESERVED_SLUGS = new Set([
  "about", "account", "admin", "api", "boxes", "build", "checkout", "contact", "corporate", "delivery-areas", "faq", "forgot-password",
  "info", "journal", "login", "menu", "pay", "plans", "preview", "register", "reset-password", "rider", "setup", "team", "thank-you",
  "sitemap.xml", "robots.txt", "opengraph-image", "icon", "favicon.ico", "_next",
]);
/** The page whose blocks can be placed on the home page (via Page sections → Home page order); not routed on its own. */
export const HOME_SLUG = "home";

export function cleanSlug(raw: string) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((seg) => seg.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean)
    .join("/");
}

export function slugProblem(slug: string): string | null {
  if (!slug) return "Add a URL slug";
  if (slug.length > 120) return "Slug is too long";
  if (slug.split("/").length > 3) return "At most three levels (a/b/c)";
  if (RESERVED_SLUGS.has(slug.split("/")[0]!)) return `"/${slug.split("/")[0]}" is a built-in page — pick another URL`;
  return null;
}

type PageMeta = { title: string; titleNe?: string | null; slug: string; showInNav?: boolean };

export async function createPage(actor: CmsActor, input: PageMeta, initialBlocks: Block[] = []) {
  assertCan(actor, "content.edit");
  const slug = cleanSlug(input.slug || input.title);
  const problem = slugProblem(slug);
  if (problem) throw new CmsError(problem);
  const title = input.title.trim().slice(0, 160);
  if (!title) throw new CmsError("Add a title");
  if (await db.cmsPage.findUnique({ where: { slug } })) throw new CmsError("That URL is already used by another page");
  const page = await db.cmsPage.create({
    data: {
      slug,
      title,
      titleNe: input.titleNe?.trim() || null,
      showInNav: Boolean(input.showInNav),
      versions: { create: { locale: "en", version: 1, blocks: initialBlocks as unknown as Prisma.InputJsonValue, status: "DRAFT", actorId: actor.id } },
    },
  });
  await audit({ actorId: actor.id, action: "cms_page.create", entity: "CmsPage", entityId: page.id, summary: `/${slug}` });
  return page;
}

export async function updatePageMeta(actor: CmsActor, pageId: string, input: PageMeta) {
  assertCan(actor, "content.edit");
  const before = await db.cmsPage.findUniqueOrThrow({ where: { id: pageId } });
  const slug = cleanSlug(input.slug || before.slug);
  if (slug !== before.slug) {
    if (before.slug === HOME_SLUG) throw new CmsError("The home blocks page keeps its URL");
    const problem = slugProblem(slug);
    if (problem) throw new CmsError(problem);
    if (await db.cmsPage.findFirst({ where: { slug, NOT: { id: pageId } } })) throw new CmsError("That URL is already used by another page");
  }
  const title = input.title.trim().slice(0, 160);
  if (!title) throw new CmsError("Add a title");
  const page = await db.$transaction(async (tx) => {
    const p = await tx.cmsPage.update({ where: { id: pageId }, data: { slug, title, titleNe: input.titleNe?.trim() || null, showInNav: Boolean(input.showInNav) } });
    // A live page that moves keeps its old links working.
    if (slug !== before.slug && LIVE_PAGE_STATUSES.includes(before.status)) {
      const from = `/${before.slug}`;
      await tx.redirect.upsert({ where: { from }, create: { from, to: `/${slug}`, permanent: true }, update: { to: `/${slug}` } });
      await tx.redirect.updateMany({ where: { to: from }, data: { to: `/${slug}` } }); // no chains
      await tx.redirect.deleteMany({ where: { from: `/${slug}` } }); // the page itself now answers there
    }
    return p;
  });
  await audit({ actorId: actor.id, action: "cms_page.update", entity: "CmsPage", entityId: pageId, summary: `/${slug}`, before: { slug: before.slug, title: before.title }, after: { slug, title } });
  revalidateCms([`/${before.slug}`, `/${slug}`]);
  return page;
}

export type SeoInput = { seoTitle?: string; seoDescription?: string; ogImage?: string; canonicalUrl?: string; noindex?: boolean };

export async function updatePageSeo(actor: CmsActor, pageId: string, input: SeoInput) {
  assertCan(actor, "seo.edit");
  const before = await db.cmsPage.findUniqueOrThrow({ where: { id: pageId } });
  const ogImage = (input.ogImage ?? "").trim();
  if (ogImage && !isSafeImage(ogImage)) throw new CmsError("OG image must be from the media library");
  if (ogImage) await assertLibraryImages([ogImage]);
  const canonical = (input.canonicalUrl ?? "").trim();
  if (canonical && !isSitePath(canonical) && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(canonical)) throw new CmsError("Canonical must be a site path (/our-story) or an https:// URL");
  const data = {
    seoTitle: (input.seoTitle ?? "").trim().slice(0, 70) || null,
    seoDescription: (input.seoDescription ?? "").trim().slice(0, 300) || null,
    ogImage: ogImage || null,
    canonicalUrl: canonical || null,
    noindex: Boolean(input.noindex),
  };
  const page = await db.cmsPage.update({ where: { id: pageId }, data });
  await audit({ actorId: actor.id, action: "cms_page.seo", entity: "CmsPage", entityId: pageId, summary: `/${page.slug}`, before: { seoTitle: before.seoTitle, seoDescription: before.seoDescription, ogImage: before.ogImage, canonicalUrl: before.canonicalUrl, noindex: before.noindex }, after: data });
  revalidateCms([`/${page.slug}`, "/sitemap.xml"]);
  return page;
}

/** https images must be in the MediaAsset library (bundled /paths are fine). */
async function assertLibraryImages(urls: string[]) {
  const remote = [...new Set(urls.filter((u) => /^https:/i.test(u)))];
  if (!remote.length) return;
  const found = await db.mediaAsset.findMany({ where: { url: { in: remote } }, select: { url: true } });
  const known = new Set(found.map((f) => f.url));
  const missing = remote.filter((u) => !known.has(u));
  if (missing.length) throw new CmsError(`Images must come from the media library: ${missing[0]}`);
}

async function latestVersion(pageId: string, locale: Locale) {
  return db.cmsPageVersion.findFirst({ where: { pageId, locale }, orderBy: { version: "desc" } });
}

/** Save blocks as the draft for this locale (validated; invalid content is refused with readable errors). */
export async function saveDraft(actor: CmsActor, pageId: string, locale: Locale, input: unknown) {
  assertCan(actor, "content.edit");
  const res = validateBlocks(input);
  if (!res.ok) throw new CmsError(res.errors.map((e) => (e.index >= 0 ? `Block ${e.index + 1}: ${e.message}` : e.message)).join("; "));
  await assertLibraryImages(blockImages(res.blocks));
  const page = await db.cmsPage.findUniqueOrThrow({ where: { id: pageId } });
  const draft = await db.cmsPageVersion.findFirst({ where: { pageId, locale, status: "DRAFT" }, orderBy: { version: "desc" } });
  const blocks = res.blocks as unknown as Prisma.InputJsonValue;
  const v = draft
    ? await db.cmsPageVersion.update({ where: { id: draft.id }, data: { blocks, actorId: actor.id } })
    : await db.cmsPageVersion.create({ data: { pageId, locale, version: ((await latestVersion(pageId, locale))?.version ?? 0) + 1, blocks, status: "DRAFT", actorId: actor.id } });
  await audit({ actorId: actor.id, action: "cms_page.draft", entity: "CmsPage", entityId: pageId, summary: `/${page.slug} (${locale}) draft v${v.version}` });
  return v;
}

export async function discardDraft(actor: CmsActor, pageId: string, locale: Locale) {
  assertCan(actor, "content.edit");
  const r = await db.cmsPageVersion.deleteMany({ where: { pageId, locale, status: "DRAFT" } });
  if (r.count) await audit({ actorId: actor.id, action: "cms_page.discard", entity: "CmsPage", entityId: pageId, summary: locale });
  return r.count;
}

/**
 * Publish this locale's draft now, or schedule it (`publishAt` in the future).
 * Returns the version that was published/scheduled.
 */
export async function publishDraft(actor: CmsActor, pageId: string, locale: Locale, opts: { publishAt?: Date | null; now?: Date } = {}) {
  assertCan(actor, "content.publish");
  const draft = await db.cmsPageVersion.findFirst({ where: { pageId, locale, status: "DRAFT" }, orderBy: { version: "desc" } });
  if (!draft) throw new CmsError("There is no draft to publish — save one first");
  // Re-validate what's stored (it might predate a schema tightening).
  const res = validateBlocks(draft.blocks);
  if (!res.ok) throw new CmsError(`The draft has invalid blocks: ${res.errors[0]?.message}`);
  return goLive(actor, draft, opts, "cms_page.publish");
}

async function goLive(actor: CmsActor, version: CmsPageVersion, opts: { publishAt?: Date | null; now?: Date }, action: string, reason?: string) {
  const now = opts.now ?? new Date();
  const scheduled = opts.publishAt && opts.publishAt.getTime() > now.getTime() ? opts.publishAt : null;
  const out = await db.$transaction(async (tx) => {
    const page = await tx.cmsPage.findUniqueOrThrow({ where: { id: version.pageId } });
    let v: CmsPageVersion;
    if (scheduled) {
      v = await tx.cmsPageVersion.update({ where: { id: version.id }, data: { status: "SCHEDULED", publishAt: scheduled, publishedAt: null, actorId: actor.id } });
      if (page.status === "DRAFT" || page.status === "ARCHIVED") await tx.cmsPage.update({ where: { id: page.id }, data: { status: "SCHEDULED" } });
    } else {
      await tx.cmsPageVersion.updateMany({ where: { pageId: version.pageId, locale: version.locale, status: "PUBLISHED", NOT: { id: version.id } }, data: { status: "SUPERSEDED" } });
      v = await tx.cmsPageVersion.update({ where: { id: version.id }, data: { status: "PUBLISHED", publishedAt: now, publishAt: null, actorId: actor.id } });
      await tx.cmsPage.update({ where: { id: page.id }, data: { status: "PUBLISHED" } });
    }
    return { page, v };
  });
  await audit({
    actorId: actor.id,
    action: scheduled ? "cms_page.schedule" : action,
    entity: "CmsPage",
    entityId: out.page.id,
    summary: `/${out.page.slug} (${version.locale}) v${version.version}${scheduled ? ` at ${scheduled.toISOString()}` : ""}`,
    reason: reason ?? null,
  });
  revalidateCms([`/${out.page.slug}`, "/sitemap.xml", ...(out.page.slug === HOME_SLUG ? ["/"] : [])]);
  return out.v;
}

/** Re-publish an older version (copied into a new version so history stays intact). */
export async function restoreVersion(actor: CmsActor, versionId: string, opts: { now?: Date } = {}) {
  assertCan(actor, "content.publish");
  const old = await db.cmsPageVersion.findUniqueOrThrow({ where: { id: versionId } });
  const res = validateBlocks(old.blocks);
  if (!res.ok) throw new CmsError(`That version has blocks that are no longer valid: ${res.errors[0]?.message}`);
  // Any open draft for this locale is replaced by the restored content.
  await db.cmsPageVersion.deleteMany({ where: { pageId: old.pageId, locale: old.locale, status: "DRAFT" } });
  const next = ((await latestVersion(old.pageId, old.locale as Locale))?.version ?? 0) + 1;
  const copy = await db.cmsPageVersion.create({
    data: { pageId: old.pageId, locale: old.locale, version: next, blocks: res.blocks as unknown as Prisma.InputJsonValue, status: "DRAFT", actorId: actor.id },
  });
  return goLive(actor, copy, { now: opts.now }, "cms_page.rollback", `restored v${old.version}`);
}

export async function cancelSchedule(actor: CmsActor, versionId: string) {
  assertCan(actor, "content.publish");
  const v = await db.cmsPageVersion.findUniqueOrThrow({ where: { id: versionId }, include: { page: true } });
  if (v.status !== "SCHEDULED") throw new CmsError("That version isn't scheduled");
  // Back to being the draft (dropping any newer draft would lose work, so keep the newest as draft).
  const newerDraft = await db.cmsPageVersion.findFirst({ where: { pageId: v.pageId, locale: v.locale, status: "DRAFT" } });
  await db.cmsPageVersion.update({ where: { id: v.id }, data: newerDraft ? { status: "SUPERSEDED", publishAt: null } : { status: "DRAFT", publishAt: null } });
  if (v.page.status === "SCHEDULED") {
    const live = await db.cmsPageVersion.count({ where: { pageId: v.pageId, status: { in: ["PUBLISHED", "SCHEDULED"] } } });
    if (!live) await db.cmsPage.update({ where: { id: v.pageId }, data: { status: "DRAFT" } });
  }
  await audit({ actorId: actor.id, action: "cms_page.unschedule", entity: "CmsPage", entityId: v.pageId, summary: `/${v.page.slug} (${v.locale}) v${v.version}` });
}

/** Take a page off the site (its versions stay; publishing again brings it back). */
export async function unpublishPage(actor: CmsActor, pageId: string) {
  assertCan(actor, "content.publish");
  const page = await db.cmsPage.update({ where: { id: pageId }, data: { status: "ARCHIVED" } });
  await audit({ actorId: actor.id, action: "cms_page.unpublish", entity: "CmsPage", entityId: pageId, summary: `/${page.slug}` });
  revalidateCms([`/${page.slug}`, "/sitemap.xml"]);
  return page;
}

export async function republishPage(actor: CmsActor, pageId: string) {
  assertCan(actor, "content.publish");
  const live = await db.cmsPageVersion.count({ where: { pageId, status: "PUBLISHED" } });
  if (!live) throw new CmsError("No published version yet — publish a draft instead");
  const page = await db.cmsPage.update({ where: { id: pageId }, data: { status: "PUBLISHED" } });
  await audit({ actorId: actor.id, action: "cms_page.republish", entity: "CmsPage", entityId: pageId, summary: `/${page.slug}` });
  revalidateCms([`/${page.slug}`, "/sitemap.xml"]);
  return page;
}

export async function deletePage(actor: CmsActor, pageId: string) {
  assertCan(actor, "content.publish");
  const page = await db.cmsPage.findUniqueOrThrow({ where: { id: pageId } });
  if (page.status === "PUBLISHED" || page.status === "SCHEDULED") throw new CmsError("Unpublish the page before deleting it");
  if (page.slug === HOME_SLUG) throw new CmsError("The home blocks page can't be deleted (hide it in the home layout instead)");
  await db.cmsPage.delete({ where: { id: pageId } });
  await audit({ actorId: actor.id, action: "cms_page.delete", entity: "CmsPage", entityId: pageId, summary: `/${page.slug}`, before: { slug: page.slug, title: page.title } });
  revalidateCms([`/${page.slug}`, "/sitemap.xml"]);
}

// ───────────────────────────── reads ─────────────────────────────

const effectiveAt = (v: Pick<CmsPageVersion, "status" | "publishedAt" | "publishAt">) => (v.status === "PUBLISHED" ? v.publishedAt : v.publishAt);

/** The version visitors see right now for one locale (read-time check of scheduled versions). */
export async function liveVersion(pageId: string, locale: string, now = new Date()) {
  const rows = await db.cmsPageVersion.findMany({
    where: {
      pageId,
      locale,
      OR: [
        { status: "PUBLISHED", publishedAt: { lte: now } },
        { status: "SCHEDULED", publishAt: { lte: now } },
      ],
    },
  });
  rows.sort((a, b) => (effectiveAt(b)?.getTime() ?? 0) - (effectiveAt(a)?.getTime() ?? 0) || b.version - a.version);
  return rows[0] ?? null;
}

export type PublicPage = { page: CmsPage; version: CmsPageVersion; blocks: Block[]; locale: string };

/** Published page for visitors, or null (drafts, archived pages and future schedules are never public). */
export async function getPublicPage(slug: string, locale: Locale = "en", now = new Date()): Promise<PublicPage | null> {
  const page = await db.cmsPage.findUnique({ where: { slug: cleanSlug(slug) } }).catch(() => null);
  if (!page || !LIVE_PAGE_STATUSES.includes(page.status)) return null;
  let version = await liveVersion(page.id, locale, now);
  let used: string = locale;
  if (!version && locale !== "en") {
    version = await liveVersion(page.id, "en", now);
    used = "en";
  }
  if (!version) return null;
  const blocks = renderableBlocks(version.blocks, (e) => log.warn("cms.block_skipped", { page: page.slug, version: version!.version, ...e }));
  return { page, version, blocks, locale: used };
}

/** Staff preview: a specific version, or this locale's draft, else the live version. Callers must check permission. */
export async function getPreview(pageId: string, opts: { versionId?: string | null; locale?: Locale } = {}) {
  const page = await db.cmsPage.findUnique({ where: { id: pageId } });
  if (!page) return null;
  const locale = opts.locale ?? "en";
  const version = opts.versionId
    ? await db.cmsPageVersion.findFirst({ where: { id: opts.versionId, pageId } })
    : ((await db.cmsPageVersion.findFirst({ where: { pageId, locale, status: "DRAFT" }, orderBy: { version: "desc" } })) ?? (await liveVersion(pageId, locale)));
  if (!version) return { page, version: null, blocks: [] as Block[] };
  return { page, version, blocks: renderableBlocks(version.blocks) };
}

export async function pageWithVersions(pageId: string) {
  return db.cmsPage.findUnique({ where: { id: pageId }, include: { versions: { orderBy: [{ locale: "asc" }, { version: "desc" }] } } });
}

export async function listPages() {
  return db.cmsPage.findMany({ orderBy: [{ updatedAt: "desc" }], include: { versions: { select: { locale: true, status: true, version: true, publishAt: true, publishedAt: true } } } });
}

/** Published, indexable pages for the sitemap (home blocks page excluded — it lives on "/"). */
export async function sitemapPages(now = new Date()) {
  const pages = await db.cmsPage.findMany({ where: { status: { in: LIVE_PAGE_STATUSES }, noindex: false, NOT: { slug: HOME_SLUG } } });
  const out: { slug: string; updatedAt: Date }[] = [];
  for (const p of pages) {
    const v = await liveVersion(p.id, "en", now);
    if (v) out.push({ slug: p.slug, updatedAt: effectiveAt(v) ?? p.updatedAt });
  }
  return out;
}

/** Pages flagged "show in navigation" that are live (for the nav editor's suggestions). */
export async function navCandidatePages() {
  return db.cmsPage.findMany({ where: { status: { in: LIVE_PAGE_STATUSES }, NOT: { slug: HOME_SLUG } }, select: { slug: true, title: true, titleNe: true, showInNav: true }, orderBy: { title: "asc" } });
}

/**
 * Scheduled publish hook (for WP-16's cron). Visibility never depends on it (read-time check); it records due
 * SCHEDULED versions as PUBLISHED and supersedes the version they replace. Idempotent.
 */
export async function publishDuePages(now = new Date()) {
  const due = await db.cmsPageVersion.findMany({ where: { status: "SCHEDULED", publishAt: { lte: now } }, orderBy: { publishAt: "asc" }, include: { page: true } });
  let published = 0;
  for (const v of due) {
    const done = await db.$transaction(async (tx) => {
      const flipped = await tx.cmsPageVersion.updateMany({ where: { id: v.id, status: "SCHEDULED" }, data: { status: "PUBLISHED", publishedAt: v.publishAt } });
      if (!flipped.count) return false;
      await tx.cmsPageVersion.updateMany({
        where: { pageId: v.pageId, locale: v.locale, status: "PUBLISHED", NOT: { id: v.id }, publishedAt: { lte: v.publishAt! } },
        data: { status: "SUPERSEDED" },
      });
      if (v.page.status === "SCHEDULED") await tx.cmsPage.update({ where: { id: v.pageId }, data: { status: "PUBLISHED" } });
      return true;
    });
    if (done) {
      published++;
      await audit({ action: "cms_page.publish_scheduled", entity: "CmsPage", entityId: v.pageId, summary: `/${v.page.slug} (${v.locale}) v${v.version}` });
      revalidateCms([`/${v.page.slug}`, ...(v.page.slug === HOME_SLUG ? ["/"] : [])]);
    }
  }
  return { published };
}
