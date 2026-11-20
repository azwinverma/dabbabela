import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: <T,>(fn: T) => fn }));

import { db } from "@/lib/db";
import { md } from "@/lib/markdown";
import { validateBlocks, renderableBlocks, BLOCK_DEFS, type Block } from "@/lib/cms/blocks";
import { isSafeHref } from "@/lib/cms/urls";
import type { CmsActor } from "@/lib/cms/access";
import {
  createPage,
  getPublicPage,
  publishDraft,
  publishDuePages,
  restoreVersion,
  saveDraft,
  updatePageMeta,
  updatePageSeo,
  unpublishPage,
} from "@/lib/cms/pages";
import { getNav, saveNavItem } from "@/lib/cms/nav";
import { resolveRedirect, saveRedirect } from "@/lib/cms/redirects";
import { cmsMetadata } from "@/lib/cms/seo";
import { ensureCmsContent, PRIVACY_COOKIE_MARK } from "@/lib/cms/builtin";
import { restorePolicyRevision, savePolicyPage } from "@/lib/cms/policies";
import { getBranding, saveBranding } from "@/lib/cms/branding";
import sitemap from "@/app/sitemap";

let owner: CmsActor;
let editor: CmsActor; // content.edit only (custom grants on a SUPPORT base role) — no publish, no SEO, no nav
const hero = (title: string, extra: Record<string, unknown> = {}) => ({ type: "hero", data: { title, ...extra } });
const text = (body: string) => ({ type: "text", data: { body } });
const slug = (s: string) => `wp14-${s}-${Date.now().toString(36)}`;

beforeAll(async () => {
  const o = await db.user.findUniqueOrThrow({ where: { email: "owner@test.local" } });
  owner = { id: o.id, role: "SUPER_ADMIN" };
  const e = await db.user.create({ data: { name: "WP14 Editor", email: `wp14.editor.${Date.now()}@test.local`, role: "SUPPORT" } });
  editor = { id: e.id, role: "SUPPORT", customGrants: ["content.view", "content.edit"] };
});

describe("block schemas", () => {
  it("accepts every block's defaults except those that need content", () => {
    for (const d of BLOCK_DEFS) {
      if (["image", "gallery", "partners"].includes(d.type)) continue; // need a real image / items
      const r = validateBlocks([{ type: d.type, data: d.defaults }]);
      expect(r.ok, `${d.type}: ${JSON.stringify(!r.ok && r.errors)}`).toBe(true);
    }
  });

  it("rejects unsafe content and URLs", () => {
    const bad = [
      { type: "cta", data: { title: "x", buttonLabel: "Go", buttonHref: "javascript:alert(1)" } },
      { type: "cta", data: { title: "x", buttonLabel: "Go", buttonHref: "//evil.example/x" } },
      { type: "hero", data: { title: "<script>alert(1)</script>" } },
      { type: "hero", data: { title: "ok", primaryLabel: "x", primaryHref: "data:text/html,<b>x</b>" } },
      { type: "image", data: { src: "javascript:alert(1)", alt: "x" } },
      { type: "image", data: { src: "http://insecure.example/a.jpg", alt: "x" } },
      { type: "image", data: { src: "/brand/x.svg", alt: "" } }, // alt text required
      { type: "banner", data: { text: "Hi", linkLabel: "x", linkHref: "vbscript:x" } },
      { type: "stats", data: { items: [{ metric: "typedInNumber", label: "100% happy" }] } }, // only named metrics
      { type: "rawHtml", data: { html: "<iframe>" } },
      { type: "text", data: { heading: "<img src=x onerror=alert(1)>", body: "x" } },
    ];
    for (const b of bad) expect(validateBlocks([b]).ok, JSON.stringify(b)).toBe(false);
    expect(isSafeHref("/menu")).toBe(true);
    expect(isSafeHref("https://dabbabela.com.np/x")).toBe(true);
    expect(isSafeHref("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeHref("/\\evil")).toBe(false);
  });

  it("escapes script injection in markdown and skips invalid blocks on render", () => {
    const html = md("Hello <script>alert(1)</script> [x](javascript:alert(1))");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    const blocks = renderableBlocks([hero("Fine"), { type: "cta", data: { title: "x", buttonLabel: "y", buttonHref: "javascript:x" } }, { ...text("hidden"), visible: false }, { type: "nope", data: {} }]);
    expect(blocks.map((b) => b.type)).toEqual(["hero"]);
  });
});

describe("draft → publish → schedule → restore", () => {
  it("drafts are never public; publishing makes the page visible", async () => {
    const s = slug("pub");
    const page = await createPage(owner, { title: "WP14 page", slug: s });
    await saveDraft(owner, page.id, "en", [hero("Draft only")]);
    expect(await getPublicPage(s)).toBeNull();
    await publishDraft(owner, page.id, "en");
    const live = await getPublicPage(s);
    expect(live?.blocks[0]?.data.title).toBe("Draft only");
    // A newer draft doesn't change what visitors see.
    await saveDraft(owner, page.id, "en", [hero("Second draft")]);
    expect((await getPublicPage(s))?.blocks[0]?.data.title).toBe("Draft only");
    // Nepali falls back to English until a Nepali version is published.
    expect((await getPublicPage(s, "ne"))?.locale).toBe("en");
    await saveDraft(owner, page.id, "ne", [hero("नेपाली")]);
    await publishDraft(owner, page.id, "ne");
    expect((await getPublicPage(s, "ne"))?.blocks[0]?.data.title).toBe("नेपाली");
    expect((await getPublicPage(s, "en"))?.blocks[0]?.data.title).toBe("Draft only");
    // Unpublished pages disappear.
    await unpublishPage(owner, page.id);
    expect(await getPublicPage(s)).toBeNull();
  });

  it("scheduled versions become visible at their time (read-time check); publishDuePages is idempotent", async () => {
    const s = slug("sched");
    const page = await createPage(owner, { title: "Scheduled", slug: s });
    await saveDraft(owner, page.id, "en", [hero("Later")]);
    const at = new Date(Date.now() + 3600_000);
    const v = await publishDraft(owner, page.id, "en", { publishAt: at });
    expect(v.status).toBe("SCHEDULED");
    expect(await getPublicPage(s, "en", new Date())).toBeNull();
    const after = new Date(at.getTime() + 1000);
    expect((await getPublicPage(s, "en", after))?.blocks[0]?.data.title).toBe("Later");
    expect((await sitemap()).some((e) => e.url.endsWith(`/${s}`))).toBe(false); // not yet live
    const first = await publishDuePages(after);
    expect(first.published).toBeGreaterThanOrEqual(1);
    expect((await db.cmsPageVersion.findUniqueOrThrow({ where: { id: v.id } })).status).toBe("PUBLISHED");
    expect((await db.cmsPage.findUniqueOrThrow({ where: { id: page.id } })).status).toBe("PUBLISHED");
    const again = await publishDuePages(after);
    expect(await db.cmsPageVersion.count({ where: { pageId: page.id, status: "PUBLISHED" } })).toBe(1);
    expect(again.published).toBe(0);
  });

  it("restores an older version as a new published version", async () => {
    const s = slug("restore");
    const page = await createPage(owner, { title: "Restore", slug: s });
    await saveDraft(owner, page.id, "en", [hero("Version one")]);
    const v1 = await publishDraft(owner, page.id, "en");
    await saveDraft(owner, page.id, "en", [hero("Version two")]);
    await publishDraft(owner, page.id, "en");
    expect((await getPublicPage(s))?.blocks[0]?.data.title).toBe("Version two");
    const v3 = await restoreVersion(owner, v1.id);
    expect(v3.version).toBe(3);
    expect(v3.status).toBe("PUBLISHED");
    const live = await getPublicPage(s);
    expect(live?.version.id).toBe(v3.id);
    expect(live?.blocks[0]?.data.title).toBe("Version one");
    expect((await db.cmsPageVersion.findUniqueOrThrow({ where: { id: v1.id } })).status).toBe("SUPERSEDED"); // history kept
    expect(await db.auditLog.count({ where: { entity: "CmsPage", entityId: page.id, action: "cms_page.rollback" } })).toBe(1);
  });

  it("refuses unsafe blocks and images outside the media library on save", async () => {
    const page = await createPage(owner, { title: "Unsafe", slug: slug("unsafe") });
    await expect(saveDraft(owner, page.id, "en", [{ type: "cta", data: { title: "x", buttonLabel: "y", buttonHref: "javascript:alert(1)" } }])).rejects.toThrow(/Block 1/);
    const url = `https://cdn.example.com/wp14-${Date.now()}.jpg`;
    const img: Block[] = [{ id: "img1", type: "image", visible: true, data: { src: url, alt: "Dal bhat" } }];
    await expect(saveDraft(owner, page.id, "en", img)).rejects.toThrow(/media library/);
    await db.mediaAsset.create({ data: { url, name: "x.jpg", type: "image/jpeg", size: 1 } });
    await expect(saveDraft(owner, page.id, "en", img)).resolves.toBeTruthy();
    await expect(createPage(owner, { title: "Menu clash", slug: "menu" })).rejects.toThrow(/built-in/);
  });
});

describe("permission split", () => {
  it("content.edit can draft but not publish, restore, change SEO or navigation", async () => {
    const s = slug("perm");
    const page = await createPage(editor, { title: "Editor's page", slug: s });
    await expect(saveDraft(editor, page.id, "en", [hero("By editor")])).resolves.toBeTruthy();
    await expect(publishDraft(editor, page.id, "en")).rejects.toThrow("FORBIDDEN:content.publish");
    expect(await getPublicPage(s)).toBeNull();
    const v = await publishDraft(owner, page.id, "en");
    await expect(restoreVersion(editor, v.id)).rejects.toThrow("FORBIDDEN:content.publish");
    await expect(updatePageSeo(editor, page.id, { noindex: true })).rejects.toThrow("FORBIDDEN:seo.edit");
    await expect(saveNavItem(editor, null, { menu: "HEADER", label: "X", href: "/x" })).rejects.toThrow("FORBIDDEN:content.publish");
    await expect(saveRedirect(editor, null, { from: "/a-old", to: "/a-new" })).rejects.toThrow("FORBIDDEN:seo.edit");
    await expect(saveBranding(editor, { colorPreset: "saag" })).rejects.toThrow("FORBIDDEN:content.publish");
    const pol = await db.page.findUniqueOrThrow({ where: { slug: "terms" } });
    await expect(savePolicyPage(editor, pol.id, { title: pol.title, slug: pol.slug, body: "changed", published: true, showInFooter: true, needsLegalReview: true })).rejects.toThrow("FORBIDDEN:content.publish");
  });
});

describe("navigation, redirects, SEO, sitemap", () => {
  it("reads navigation from the database per locale", async () => {
    const header = await getNav("HEADER", "en");
    expect(header?.length).toBe(5); // backfilled from the old hardcoded links
    expect((await getNav("HEADER", "ne"))?.[0]?.label).toBe("यो हप्ताको मेनु");
    const item = await saveNavItem(owner, null, { menu: "FOOTER_LEGAL", label: "Cookie policy", labelNe: "कुकी नीति", href: "/info/privacy#cookies" });
    expect((await getNav("FOOTER_LEGAL", "en"))?.map((l) => l.label)).toContain("Cookie policy");
    expect((await getNav("FOOTER_LEGAL", "ne"))?.map((l) => l.label)).toContain("कुकी नीति");
    await saveNavItem(owner, item.id, { menu: "FOOTER_LEGAL", label: "Cookie policy", href: "/info/privacy#cookies", visible: false });
    expect((await getNav("FOOTER_LEGAL", "en"))?.map((l) => l.label)).not.toContain("Cookie policy");
    await expect(saveNavItem(owner, null, { menu: "HEADER", label: "Bad", href: "javascript:alert(1)" })).rejects.toThrow(/Link/);
    expect(await db.auditLog.count({ where: { entity: "NavItem", entityId: item.id } })).toBe(2);
  });

  it("resolves redirects (normalised, counted) and refuses loops, chains and built-in paths", async () => {
    const from = `/old-${Date.now().toString(36)}`;
    await saveRedirect(owner, null, { from: `${from.toUpperCase()}/`, to: "/our-story" });
    const r = await resolveRedirect(`${from}/?utm_source=x`);
    expect(r).toEqual({ to: "/our-story", permanent: true });
    expect((await db.redirect.findUniqueOrThrow({ where: { from } })).hits).toBe(1);
    expect(await resolveRedirect("/never-heard-of-it")).toBeNull();
    await expect(saveRedirect(owner, null, { from: "/loop-a", to: "/loop-a" })).rejects.toThrow(/itself/);
    await expect(saveRedirect(owner, null, { from: "/chain", to: from })).rejects.toThrow(/already redirects/);
    await expect(saveRedirect(owner, null, { from: "/menu", to: "/x" })).rejects.toThrow(/built-in/);
    await expect(saveRedirect(owner, null, { from: "/x-evil", to: "javascript:alert(1)" })).rejects.toThrow();
  });

  it("renaming a live page keeps the old URL working", async () => {
    const s = slug("move");
    const page = await createPage(owner, { title: "Mover", slug: s });
    await saveDraft(owner, page.id, "en", [hero("Moving")]);
    await publishDraft(owner, page.id, "en");
    await updatePageMeta(owner, page.id, { title: "Mover", slug: `${s}-new` });
    expect(await resolveRedirect(`/${s}`, { countHit: false })).toEqual({ to: `/${s}-new`, permanent: true });
    expect(await getPublicPage(`${s}-new`)).not.toBeNull();
  });

  it("sitemap lists published pages only and honours noindex", async () => {
    const pub = slug("site-pub");
    const draft = slug("site-draft");
    const hidden = slug("site-noindex");
    const p1 = await createPage(owner, { title: "Pub", slug: pub });
    await saveDraft(owner, p1.id, "en", [hero("Pub")]);
    await publishDraft(owner, p1.id, "en");
    const p2 = await createPage(owner, { title: "Draft", slug: draft });
    await saveDraft(owner, p2.id, "en", [hero("Draft")]);
    const p3 = await createPage(owner, { title: "Hidden", slug: hidden });
    await saveDraft(owner, p3.id, "en", [hero("Hidden")]);
    await publishDraft(owner, p3.id, "en");
    const seo = await updatePageSeo(owner, p3.id, { noindex: true, seoTitle: "Hidden page", canonicalUrl: "/elsewhere" });
    const urls = (await sitemap()).map((e) => e.url);
    expect(urls.some((u) => u.endsWith(`/${pub}`))).toBe(true);
    expect(urls.some((u) => u.endsWith(`/${draft}`))).toBe(false);
    expect(urls.some((u) => u.endsWith(`/${hidden}`))).toBe(false);
    expect(urls.some((u) => u.endsWith("/home"))).toBe(false);
    const meta = cmsMetadata(seo, [], "en");
    expect(meta.robots).toEqual({ index: false, follow: true });
    expect(meta.alternates?.canonical).toBe("/elsewhere");
    expect(meta.title).toBe("Hidden page");
    expect((await getPublicPage(hidden))?.page.noindex).toBe(true); // still reachable, just not indexed
  });
});

describe("built-in content, policies, branding", () => {
  it("creates the brief's pages once, migrating existing copy, and adds the privacy cookie section with history", async () => {
    await ensureCmsContent();
    const story = await getPublicPage("our-story");
    expect(story?.blocks.some((b) => b.type === "text" && String(b.data.body).includes("dabbawalas"))).toBe(true); // from about.story
    expect(await getPublicPage("how-it-works")).not.toBeNull();
    for (const s of ["nutrition", "delivery-policy"]) expect((await db.page.findUniqueOrThrow({ where: { slug: s } })).needsLegalReview).toBe(true);
    const privacy = await db.page.findUniqueOrThrow({ where: { slug: "privacy" }, include: { revisions: true } });
    expect(privacy.body).toContain(PRIVACY_COOKIE_MARK);
    expect(privacy.body).toContain("dabba_lt");
    expect(privacy.body).toContain("What we collect"); // original text kept
    expect(privacy.revisions.length).toBe(2); // previous text + new text
    const home = await db.cmsPage.findUniqueOrThrow({ where: { slug: "home" } });
    expect(home.status).toBe("DRAFT");
    expect(await getPublicPage("home")).toBeNull();
    expect((await ensureCmsContent()).changed).toBe(false); // idempotent
    expect(await db.cmsPage.count({ where: { slug: "our-story" } })).toBe(1);
  });

  it("records policy revisions and restores an older one", async () => {
    const p = await db.page.findUniqueOrThrow({ where: { slug: "refunds" } });
    const original = p.body;
    await savePolicyPage(owner, p.id, { title: p.title, slug: p.slug, body: `${original}\n\nExtra line.`, published: true, showInFooter: true, needsLegalReview: true });
    const revs = await db.pageRevision.findMany({ where: { pageId: p.id }, orderBy: { createdAt: "asc" } });
    expect(revs.length).toBe(2);
    expect(revs[0]!.body).toBe(original);
    await restorePolicyRevision(owner, revs[0]!.id);
    expect((await db.page.findUniqueOrThrow({ where: { id: p.id } })).body).toBe(original);
    expect(await db.pageRevision.count({ where: { pageId: p.id } })).toBe(3);
    // Unpublished drafts are fine for content.edit.
    const draft = await savePolicyPage(editor, null, { title: `WP14 draft ${Date.now()}`, body: "text", published: false, showInFooter: false, needsLegalReview: true });
    expect(draft.published).toBe(false);
  });

  it("limits branding to approved presets and library images, and audits it", async () => {
    await expect(saveBranding(owner, { colorPreset: "neonPink" as never })).rejects.toThrow(/approved/);
    await expect(saveBranding(owner, { logoUrl: "https://elsewhere.example/logo.png" })).rejects.toThrow(/media library/);
    await saveBranding(owner, { colorPreset: "saag", fontPreset: "soft", contact: { hours: "Sun – Fri · 7–3" } });
    const b = await getBranding();
    expect(b.colorPreset).toBe("saag");
    expect(b.fontPreset).toBe("soft");
    expect(((await db.setting.findUniqueOrThrow({ where: { key: "site" } })).value as { hours: string }).hours).toBe("Sun – Fri · 7–3");
    expect(await db.auditLog.count({ where: { action: "branding.update" } })).toBeGreaterThanOrEqual(1);
    await saveBranding(owner, { colorPreset: "classic", fontPreset: "standard" });
  });
});
