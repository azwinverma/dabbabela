import "server-only";
import type { Page } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { slugify } from "@/lib/utils";
import { assertCan, CmsError, revalidateSite, type CmsActor } from "./access";

/**
 * Policy and info pages (`Page`, served at /info/<slug>, markdown rendered with raw HTML escaped).
 * Every content change records a `PageRevision`; the first change also records the content it replaced, so nothing
 * is ever lost. Drafting an unpublished page needs `content.edit`; changing what's live (a published page, the
 * published flag, a restore) needs `content.publish`.
 */

export type PolicyInput = {
  title: string;
  slug?: string;
  body: string;
  titleNe?: string | null;
  bodyNe?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  published: boolean;
  showInFooter: boolean;
  needsLegalReview: boolean;
};

const snapshot = (p: Pick<Page, "title" | "body" | "bodyNe">) => ({ title: p.title, body: p.body, bodyNe: p.bodyNe });
const sameContent = (a: Pick<Page, "title" | "body" | "bodyNe">, b: Pick<Page, "title" | "body" | "bodyNe">) => a.title === b.title && a.body === b.body && (a.bodyNe ?? null) === (b.bodyNe ?? null);

export async function savePolicyPage(actor: CmsActor, id: string | null, input: PolicyInput, opts: { reason?: string } = {}) {
  assertCan(actor, "content.edit");
  const title = input.title.trim().slice(0, 160);
  if (!title) throw new CmsError("Title is required");
  const slug = slugify(input.slug?.trim() || title);
  if (!slug) throw new CmsError("Add a slug");
  if (await db.page.findFirst({ where: { slug, NOT: id ? { id } : undefined } })) throw new CmsError("Slug already used");
  const before = id ? await db.page.findUniqueOrThrow({ where: { id } }) : null;
  if (before?.published || input.published) assertCan(actor, "content.publish"); // touches what's live
  const data = {
    title,
    slug,
    body: input.body.slice(0, 100_000),
    titleNe: input.titleNe?.trim() || null,
    bodyNe: input.bodyNe?.trim() ? input.bodyNe.slice(0, 100_000) : null,
    seoTitle: input.seoTitle?.trim() || null,
    seoDescription: input.seoDescription?.trim() || null,
    published: input.published,
    showInFooter: input.showInFooter,
    needsLegalReview: input.needsLegalReview,
  };
  const page = await db.$transaction(async (tx) => {
    const p = id ? await tx.page.update({ where: { id }, data }) : await tx.page.create({ data });
    if (!before || !sameContent(before, p)) {
      if (before && !(await tx.pageRevision.count({ where: { pageId: p.id } }))) await tx.pageRevision.create({ data: { pageId: p.id, ...snapshot(before), actorId: null, createdAt: before.updatedAt } });
      await tx.pageRevision.create({ data: { pageId: p.id, ...snapshot(p), actorId: actor.id } });
    }
    return p;
  });
  await audit({ actorId: actor.id, action: id ? "page.update" : "page.create", entity: "Page", entityId: page.id, summary: page.title, reason: opts.reason ?? null, before, after: data });
  revalidateSite();
  return page;
}

export async function restorePolicyRevision(actor: CmsActor, revisionId: string) {
  assertCan(actor, "content.publish");
  const rev = await db.pageRevision.findUniqueOrThrow({ where: { id: revisionId }, include: { page: true } });
  const p = rev.page;
  return savePolicyPage(
    actor,
    p.id,
    { title: rev.title, slug: p.slug, body: rev.body, bodyNe: rev.bodyNe, titleNe: p.titleNe, seoTitle: p.seoTitle, seoDescription: p.seoDescription, published: p.published, showInFooter: p.showInFooter, needsLegalReview: p.needsLegalReview },
    { reason: `restored revision from ${rev.createdAt.toISOString()}` },
  );
}

export async function deletePolicyPage(actor: CmsActor, id: string) {
  assertCan(actor, "content.publish");
  const p = await db.page.delete({ where: { id } });
  await audit({ actorId: actor.id, action: "page.delete", entity: "Page", entityId: id, summary: p.title, before: snapshot(p) });
  revalidateSite();
}

export async function policyRevisions(pageId: string) {
  return db.pageRevision.findMany({ where: { pageId }, orderBy: { createdAt: "desc" }, take: 50 });
}
