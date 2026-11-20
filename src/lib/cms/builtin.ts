import type { Prisma, PrismaClient } from "@prisma/client";
import { db as defaultDb } from "@/lib/db";
import { getSection } from "@/lib/cms-store";
import { newBlockId, validateBlocks, type Block } from "./blocks";
import { HOME_SLUG } from "./pages";

/**
 * Built-in content for the brief's pages, created once per database (idempotent, Setting "cms.content.v1").
 * Existing copy is migrated, never overwritten: new block pages start from the *current* published section text,
 * policy pages are only created when missing, and the privacy policy gains the attribution-cookie paragraph with the
 * previous text kept as a PageRevision.
 *
 * Where each page from the brief lives (shown on /admin/pages):
 */
export const SITE_PAGE_MAP: { page: string; url: string; managedIn: string; href: string }[] = [
  { page: "Home", url: "/", managedIn: "Page sections (Home page group + order), plus page-builder blocks from the “home” page", href: "/admin/content" },
  { page: "About", url: "/about", managedIn: "Page sections → About", href: "/admin/content" },
  { page: "Our story", url: "/our-story", managedIn: "Page builder", href: "/admin/pages?tab=builder" },
  { page: "How it works", url: "/how-it-works", managedIn: "Page builder", href: "/admin/pages?tab=builder" },
  { page: "Meal plans intro", url: "/plans", managedIn: "Page sections → Plans page intro (prices are live from the plan catalogue)", href: "/admin/content/plans.intro" },
  { page: "Weekly menu intro", url: "/menu", managedIn: "Page sections → Menu page intro", href: "/admin/content/menu.intro" },
  { page: "Custom lunchbox intro", url: "/build", managedIn: "Page sections → Build-a-Dabba intro", href: "/admin/content/build.intro" },
  { page: "Corporate", url: "/corporate", managedIn: "Page sections → Teams", href: "/admin/content" },
  { page: "Contact", url: "/contact", managedIn: "Page sections → Contact intro; contact details in Navigation & branding", href: "/admin/content/contact.intro" },
  { page: "FAQ", url: "/faq", managedIn: "Page sections → FAQ intro; questions in FAQs", href: "/admin/faqs" },
  { page: "Nutrition info", url: "/info/nutrition", managedIn: "Policies & info pages", href: "/admin/pages?tab=policies" },
  { page: "Terms", url: "/info/terms", managedIn: "Policies & info pages", href: "/admin/pages?tab=policies" },
  { page: "Privacy", url: "/info/privacy", managedIn: "Policies & info pages", href: "/admin/pages?tab=policies" },
  { page: "Refund", url: "/info/refunds", managedIn: "Policies & info pages", href: "/admin/pages?tab=policies" },
  { page: "Delivery policy", url: "/info/delivery-policy", managedIn: "Policies & info pages", href: "/admin/pages?tab=policies" },
];

export const PRIVACY_COOKIE_MARK = "dabba_consent";
export const PRIVACY_COOKIE_SECTION = `## Cookies and how you found us

We use a few essential cookies to keep you signed in and to remember your cart. They don't depend on any choice.

If you choose **Allow** in the cookie notice, we also remember how you found us:

- \`dabba_consent\` — your choice (kept 180 days);
- \`dabba_ft\` — your first visit (90 days);
- \`dabba_lt\` — your latest visit (30 days).

They hold campaign (UTM) values, the host name of the website that sent you and the page you landed on — never what you type, and nothing about the rest of your browsing. When you sign up or order, this is stored on your account or order so we can tell which campaigns work.

Choose **No thanks** and none of it is stored; anything already in those cookies is deleted. You can change your mind at any time with **Cookie choices** at the bottom of every page.`;

const NEW_POLICY_PAGES = [
  {
    slug: "nutrition",
    title: "Nutrition information",
    titleNe: "पोषण जानकारी",
    body: `# Nutrition information\n\n> **Draft — needs review before launch.**\n\nWhere a dabba shows calories, protein, carbohydrate and fat, the numbers are **estimates** worked out from our recipe weights, and they're labelled that way. Portions are cooked and packed by hand, so a lunch can vary a little from day to day.\n\nWe don't make medical or health claims, and we don't publish numbers we haven't worked out.\n\n## Allergens\nEvery dish lists its allergens. See [Allergen information](/info/allergens) for what our kitchen handles.\n\n## Questions\nIf you follow a special diet, talk to us from the [contact page](/contact) before ordering.`,
  },
  {
    slug: "delivery-policy",
    title: "Delivery policy",
    titleNe: "डेलिभरी नीति",
    body: `# Delivery policy\n\n> **Draft — needs review before launch.**\n\n## Where and when\nWe deliver lunch on our delivery days to addresses inside our [delivery areas](/delivery-areas), in the lunch window you choose at checkout.\n\n## Fees\nThe delivery fee for your area is shown before you pay. Larger orders may get free delivery, as shown at checkout.\n\n## Hand-off\nPlease make sure someone can receive the dabba during your window. Riders may ask for the 4-digit delivery code shown in your account.\n\n## When we can't deliver\nIf a bandh, the weather or our own mistake stops a delivery, you choose between a later delivery or full credit. See the [cancellation & refund policy](/info/refunds).`,
  },
];

const b = (type: string, data: Record<string, unknown>): Block => ({ id: newBlockId(), type, visible: true, data });
type Db = PrismaClient | Prisma.TransactionClient;
type Marker = { pages?: string; policies?: string; privacy?: string; home?: string };
const MARKER = "cms.content.v1";

async function ourStoryBlocks(): Promise<Block[]> {
  const story = await getSection("about.story", "en");
  const process = await getSection("about.process", "en");
  const steps = Array.isArray(process.steps) ? (process.steps as { title: string; text: string }[]) : [];
  return [
    b("hero", { eyebrow: String(story.eyebrow ?? "Our kitchen"), title: String(story.title ?? "Why a dabba?"), subtitle: "", primaryLabel: "See this week's menu", primaryHref: "/menu", illustration: "tiffin" }),
    b("text", { heading: "", body: String(story.body ?? ""), width: "narrow" }),
    ...(steps.length
      ? [b("featureGrid", { heading: String(process.title ?? "A morning in our kitchen"), intro: "", columns: steps.length >= 4 ? "4" : "3", items: steps.slice(0, 12).map((s, i) => ({ title: s.title, text: s.text, icon: (["clock", "calendar", "utensils", "truck"] as const)[i % 4] })) })]
      : []),
    b("cta", { title: "Tomorrow's lunch, sorted today.", text: "Pick a day, pick a dabba. It takes about a minute.", buttonLabel: "Order lunch", buttonHref: "/menu", tone: "turmeric" }),
  ];
}

async function howItWorksBlocks(): Promise<Block[]> {
  const how = await getSection("home.how", "en");
  const plans = await getSection("home.plans", "en");
  const steps = Array.isArray(how.steps) ? (how.steps as { title: string; text: string }[]) : [];
  return [
    b("hero", { eyebrow: String(how.eyebrow ?? "How it works"), title: String(how.title ?? "Lunch sorted in three steps"), subtitle: "", primaryLabel: "See this week's menu", primaryHref: "/menu", secondaryLabel: "Plan my week", secondaryHref: "/plans", illustration: "rider" }),
    ...(steps.length ? [b("featureGrid", { heading: "", intro: "", columns: steps.length >= 4 ? "4" : "3", items: steps.slice(0, 12).map((s, i) => ({ title: s.title, text: s.text, icon: (["calendar", "utensils", "truck", "clock"] as const)[i % 4] })) })] : []),
    b("mealShowcase", { heading: "On the menu this week", intro: "", source: "thisWeek", category: "", limit: 6 }),
    b("pricingTable", { heading: String(plans.title ?? "Plan a week or a month"), intro: String(plans.intro ?? ""), plans: "", limit: 3 }),
    b("faq", { heading: "Before you order", category: "", limit: 6 }),
  ];
}

function valid(blocks: Block[]) {
  const r = validateBlocks(blocks);
  if (!r.ok) throw new Error(`Built-in blocks invalid: ${r.errors[0]?.message}`);
  return r.blocks as unknown as Prisma.InputJsonValue;
}

/** Idempotent. Safe to call on every admin visit and from the deploy-time foundation script. */
export async function ensureCmsContent(db: Db = defaultDb, now = new Date()) {
  const row = await db.setting.findUnique({ where: { key: MARKER } }).catch(() => null);
  const marker: Marker = (row?.value as Marker | null) ?? {};
  if (marker.pages && marker.policies && marker.privacy && marker.home) return { changed: false };
  const stamp = now.toISOString();
  const created: string[] = [];

  if (!marker.pages) {
    for (const [slug, title, titleNe, build] of [
      ["our-story", "Our story", "हाम्रो कथा", ourStoryBlocks],
      ["how-it-works", "How it works", "यसरी काम गर्छ", howItWorksBlocks],
    ] as const) {
      if (await db.cmsPage.findUnique({ where: { slug } })) continue;
      await db.cmsPage.create({
        data: { slug, title, titleNe, status: "PUBLISHED", showInNav: false, versions: { create: { locale: "en", version: 1, blocks: valid(await build()), status: "PUBLISHED", publishedAt: now } } },
      });
      created.push(`/${slug}`);
    }
    // Link them from the footer's Company column — only when that menu is DB-managed already (otherwise the
    // footer's built-in fallback would be replaced by just these two links).
    const company = await db.navItem.findMany({ where: { menu: "FOOTER_COMPANY" }, select: { href: true, sortOrder: true } });
    if (company.length) {
      let order = Math.max(...company.map((c) => c.sortOrder)) + 1;
      for (const [href, label, labelNe] of [
        ["/our-story", "Our story", "हाम्रो कथा"],
        ["/how-it-works", "How it works", "यसरी काम गर्छ"],
      ] as const)
        if (!company.some((c) => c.href === href)) await db.navItem.create({ data: { menu: "FOOTER_COMPANY", href, label, labelNe, sortOrder: order++ } });
    }
    marker.pages = stamp;
  }

  if (!marker.home) {
    if (!(await db.cmsPage.findUnique({ where: { slug: HOME_SLUG } })))
      await db.cmsPage.create({ data: { slug: HOME_SLUG, title: "Home page blocks", status: "DRAFT", noindex: true, versions: { create: { locale: "en", version: 1, blocks: [], status: "DRAFT" } } } });
    marker.home = stamp;
  }

  if (!marker.policies) {
    for (const p of NEW_POLICY_PAGES) {
      if (await db.page.findUnique({ where: { slug: p.slug } })) continue;
      const page = await db.page.create({ data: { ...p, published: true, showInFooter: true, needsLegalReview: true } });
      await db.pageRevision.create({ data: { pageId: page.id, title: page.title, body: page.body, bodyNe: null } });
      created.push(`/info/${p.slug}`);
    }
    marker.policies = stamp;
  }

  if (!marker.privacy) {
    const privacy = await db.page.findUnique({ where: { slug: "privacy" } });
    if (privacy && !privacy.body.includes(PRIVACY_COOKIE_MARK)) {
      await db.pageRevision.create({ data: { pageId: privacy.id, title: privacy.title, body: privacy.body, bodyNe: privacy.bodyNe, createdAt: privacy.updatedAt } });
      const body = `${privacy.body.trimEnd()}\n\n${PRIVACY_COOKIE_SECTION}\n`;
      await db.page.update({ where: { id: privacy.id }, data: { body, needsLegalReview: true } });
      await db.pageRevision.create({ data: { pageId: privacy.id, title: privacy.title, body, bodyNe: privacy.bodyNe } });
      created.push("privacy: cookie section");
    }
    // Only mark done once the privacy page exists (a fresh deploy may run this before the catalogue seed).
    if (privacy) marker.privacy = stamp;
  }

  await db.setting.upsert({ where: { key: MARKER }, create: { key: MARKER, value: marker }, update: { value: marker } });
  return { changed: created.length > 0, created };
}
