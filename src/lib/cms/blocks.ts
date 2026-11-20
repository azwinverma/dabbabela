import { z } from "zod";
import type { Field } from "../cms";
import { isSafeHref, isSafeImage } from "./urls";

/**
 * Page-builder block registry (client-safe: no DB, no React).
 * Every block = { type, label, description, fields (editor), defaults, schema (zod) }. Blocks are validated when a
 * draft is saved and again when a page renders; unknown or invalid blocks are skipped (and logged) on render.
 *
 * Safety: no raw HTML or JS anywhere. Plain text fields refuse HTML tags; markdown is rendered by `md()` with raw HTML
 * escaped; links pass `isSafeHref`, images `isSafeImage` (+ the MediaAsset library check at save time); live data
 * (meals, plan prices, testimonials, FAQs, stats) is read from the database at render time, never typed in.
 */

const TAG = /<\s*\/?\s*[a-z!?]/i;
const plain = (max = 300, required?: string) =>
  z
    .string()
    .trim()
    .min(required ? 1 : 0, required)
    .max(max, `Keep it under ${max} characters`)
    .refine((v) => !TAG.test(v), "HTML isn't allowed here — use plain text")
    .refine((v) => !/javascript\s*:/i.test(v), "Scripts aren't allowed");
const optText = (max = 300) => plain(max).optional().default("");
const markdown = z.string().max(20000);
const href = z.string().refine(isSafeHref, "Use a site path (/menu), https://, mailto: or tel: link");
const optHref = z.union([z.literal(""), href]).optional().default("");
const image = z.string().refine(isSafeImage, "Use an image from the media library (https://…) or a bundled /path.svg");
const optImage = z.union([z.literal(""), image]).optional().default("");
const tone = z.enum(["turmeric", "achar", "charcoal", "saag"]).default("turmeric");

export const TONES = [
  { value: "turmeric", label: "Turmeric (charcoal text)" },
  { value: "achar", label: "Achar red" },
  { value: "charcoal", label: "Charcoal" },
  { value: "saag", label: "Saag green" },
];

/** Brand art set (src/components/art). */
export const ILLUSTRATIONS = ["tiffin", "rider", "momo", "chili", "leaf", "mountains", "prayerFlags", "splatter"] as const;
export const FEATURE_ICONS = ["check", "clock", "leaf", "truck", "users", "heart", "utensils", "calendar", "map", "shield"] as const;
/** Named live metrics — stats blocks never show typed-in numbers. */
export const METRICS = {
  dabbasOnMenu: "Dabbas on the menu",
  deliveryAreas: "Delivery areas (localities)",
  deliveryZones: "Delivery zones",
  mealPlans: "Meal plans on offer",
  mealsDelivered: "Lunches delivered",
  teamsServed: "Teams we feed",
} as const;
export type MetricKey = keyof typeof METRICS;

const opts = (vals: readonly string[], labels?: Record<string, string>) => vals.map((v) => ({ value: v, label: labels?.[v] ?? v }));

const t = (name: string, label: string, help?: string): Field => ({ name, label, type: "text", help });
const ta = (name: string, label: string, help?: string): Field => ({ name, label, type: "textarea", help });
const url = (name: string, label: string): Field => ({ name, label, type: "url" });
const img = (name: string, label: string, help?: string): Field => ({ name, label, type: "image", help });
const sel = (name: string, label: string, options: { value: string; label: string }[], help?: string): Field => ({ name, label, type: "select", options, help });
const num = (name: string, label: string, help?: string): Field => ({ name, label, type: "number", help });

export type BlockDef = {
  type: string;
  label: string;
  description: string;
  fields: Field[];
  defaults: Record<string, unknown>;
  schema: z.ZodTypeAny;
};

function def<S extends z.ZodTypeAny>(d: Omit<BlockDef, "schema"> & { schema: S }): BlockDef {
  return d;
}

export const BLOCK_DEFS: BlockDef[] = [
  def({
    type: "hero",
    label: "Hero",
    description: "Big title at the top of a page, with optional buttons and a photo or brand illustration.",
    fields: [
      t("eyebrow", "Small line above the title"),
      t("title", "Title"),
      ta("subtitle", "Supporting text"),
      t("primaryLabel", "Main button label"),
      url("primaryHref", "Main button link"),
      t("secondaryLabel", "Second button label"),
      url("secondaryHref", "Second button link"),
      img("image", "Photo (optional)", "Leave empty to show the illustration."),
      t("imageAlt", "Photo description (alt text)"),
      sel("illustration", "Illustration", opts(ILLUSTRATIONS)),
    ],
    defaults: { eyebrow: "", title: "Page title", subtitle: "", primaryLabel: "", primaryHref: "", secondaryLabel: "", secondaryHref: "", image: "", imageAlt: "", illustration: "tiffin" },
    schema: z.object({
      eyebrow: optText(120),
      title: plain(160, "Add a title"),
      subtitle: optText(600),
      primaryLabel: optText(60),
      primaryHref: optHref,
      secondaryLabel: optText(60),
      secondaryHref: optHref,
      image: optImage,
      imageAlt: optText(200),
      illustration: z.enum(ILLUSTRATIONS).default("tiffin"),
    }),
  }),
  def({
    type: "text",
    label: "Text",
    description: "Heading and markdown text. Raw HTML is shown as text.",
    fields: [t("heading", "Heading (optional)"), { name: "body", label: "Text", type: "markdown" }, sel("width", "Width", opts(["narrow", "wide"]))],
    defaults: { heading: "", body: "Write something here.", width: "narrow" },
    schema: z.object({ heading: optText(160), body: markdown, width: z.enum(["narrow", "wide"]).default("narrow") }),
  }),
  def({
    type: "image",
    label: "Image",
    description: "One photo from the media library, with a description for screen readers.",
    fields: [img("src", "Image"), t("alt", "Description (alt text)", "Required — say what the photo shows."), t("caption", "Caption (optional)")],
    defaults: { src: "", alt: "", caption: "" },
    schema: z.object({ src: image, alt: plain(200, "Describe the image"), caption: optText(200) }),
  }),
  def({
    type: "cta",
    label: "Call to action",
    description: "A coloured panel with a title and one button.",
    fields: [t("title", "Title"), ta("text", "Text"), t("buttonLabel", "Button label"), url("buttonHref", "Button link"), sel("tone", "Colour", TONES)],
    defaults: { title: "Tomorrow's lunch, sorted today.", text: "", buttonLabel: "Order lunch", buttonHref: "/menu", tone: "turmeric" },
    schema: z.object({ title: plain(160, "Required"), text: optText(400), buttonLabel: plain(60, "Required"), buttonHref: href, tone }),
  }),
  def({
    type: "featureGrid",
    label: "Feature grid",
    description: "Two to four columns of short points with an icon.",
    fields: [
      t("heading", "Heading"),
      ta("intro", "Intro"),
      sel("columns", "Columns", opts(["2", "3", "4"])),
      { name: "items", label: "Items", type: "list", itemLabel: "Item", fields: [t("title", "Title"), ta("text", "Text"), sel("icon", "Icon", opts(FEATURE_ICONS))] },
    ],
    defaults: { heading: "", intro: "", columns: "3", items: [{ title: "Point", text: "Say something specific.", icon: "check" }] },
    schema: z.object({
      heading: optText(160),
      intro: optText(600),
      columns: z.enum(["2", "3", "4"]).default("3"),
      items: z.array(z.object({ title: plain(120, "Required"), text: optText(500), icon: z.enum(FEATURE_ICONS).default("check") })).min(1).max(12),
    }),
  }),
  def({
    type: "mealShowcase",
    label: "Meal showcase",
    description: "Live dabbas from the menu — featured ones, this week's menu or one category. Prices and photos stay current.",
    fields: [
      t("heading", "Heading"),
      ta("intro", "Intro"),
      sel("source", "Which dabbas", [
        { value: "featured", label: "Featured dabbas" },
        { value: "thisWeek", label: "On this week's menu" },
        { value: "category", label: "One category" },
      ]),
      t("category", "Category slug (for 'One category')"),
      num("limit", "How many (1–12)"),
    ],
    defaults: { heading: "On the menu", intro: "", source: "featured", category: "", limit: 6 },
    schema: z.object({
      heading: optText(160),
      intro: optText(600),
      source: z.enum(["featured", "thisWeek", "category"]).default("featured"),
      category: z.string().regex(/^[a-z0-9-]*$/, "Use the category slug").max(80).optional().default(""),
      limit: z.coerce.number().int().min(1).max(12).default(6),
    }),
  }),
  def({
    type: "pricingTable",
    label: "Pricing table",
    description: "Live plan prices from the plan catalogue (never typed in).",
    fields: [t("heading", "Heading"), ta("intro", "Intro"), t("plans", "Plan slugs (comma separated; empty = all public plans)"), num("limit", "How many (1–6)")],
    defaults: { heading: "Plans", intro: "", plans: "", limit: 3 },
    schema: z.object({
      heading: optText(160),
      intro: optText(600),
      plans: z.string().regex(/^[a-z0-9,\s-]*$/, "Plan slugs, comma separated").max(300).optional().default(""),
      limit: z.coerce.number().int().min(1).max(6).default(3),
    }),
  }),
  def({
    type: "testimonials",
    label: "Testimonials",
    description: "Published testimonials with recorded consent only.",
    fields: [t("heading", "Heading"), num("limit", "How many (1–9)")],
    defaults: { heading: "What people say", limit: 3 },
    schema: z.object({ heading: optText(160), limit: z.coerce.number().int().min(1).max(9).default(3) }),
  }),
  def({
    type: "faq",
    label: "FAQ accordion",
    description: "Published FAQs, optionally one category.",
    fields: [t("heading", "Heading"), t("category", "Category (empty = all)"), num("limit", "How many (1–30)")],
    defaults: { heading: "Questions", category: "", limit: 6 },
    schema: z.object({ heading: optText(160), category: optText(60), limit: z.coerce.number().int().min(1).max(30).default(6) }),
  }),
  def({
    type: "partners",
    label: "Partner showcase",
    description: "Logos or names of partners and suppliers (only with their permission).",
    fields: [t("heading", "Heading"), { name: "items", label: "Partners", type: "list", itemLabel: "Partner", fields: [t("name", "Name"), img("logo", "Logo (optional)"), url("href", "Link (optional)")] }],
    defaults: { heading: "Who we work with", items: [] },
    schema: z.object({
      heading: optText(160),
      items: z.array(z.object({ name: plain(120, "Required"), logo: optImage, href: optHref })).max(24),
    }),
  }),
  def({
    type: "banner",
    label: "Promo banner",
    description: "A thin coloured strip with a short message and an optional link.",
    fields: [t("text", "Message"), t("linkLabel", "Link label"), url("linkHref", "Link"), sel("tone", "Colour", TONES)],
    defaults: { text: "Order by 9:30 AM for lunch the same day.", linkLabel: "", linkHref: "", tone: "turmeric" },
    schema: z.object({ text: plain(240, "Required"), linkLabel: optText(60), linkHref: optHref, tone }),
  }),
  def({
    type: "gallery",
    label: "Gallery",
    description: "A grid of photos from the media library.",
    fields: [t("heading", "Heading"), { name: "images", label: "Photos", type: "list", itemLabel: "Photo", fields: [img("src", "Image"), t("alt", "Description (alt text)"), t("caption", "Caption")] }],
    defaults: { heading: "", images: [] },
    schema: z.object({
      heading: optText(160),
      images: z.array(z.object({ src: image, alt: plain(200, "Describe each photo"), caption: optText(200) })).max(24),
    }),
  }),
  def({
    type: "illustration",
    label: "Illustration",
    description: "One piece of the brand art set, with an optional caption.",
    fields: [sel("art", "Illustration", opts(ILLUSTRATIONS)), t("caption", "Caption"), sel("align", "Align", opts(["center", "left", "right"]))],
    defaults: { art: "rider", caption: "", align: "center" },
    schema: z.object({ art: z.enum(ILLUSTRATIONS), caption: optText(200), align: z.enum(["center", "left", "right"]).default("center") }),
  }),
  def({
    type: "stats",
    label: "Stats",
    description: "Live numbers from a named metric — never typed in.",
    fields: [
      t("heading", "Heading"),
      { name: "items", label: "Numbers", type: "list", itemLabel: "Number", fields: [sel("metric", "Metric", Object.entries(METRICS).map(([value, label]) => ({ value, label }))), t("label", "Label shown")] },
    ],
    defaults: { heading: "", items: [{ metric: "dabbasOnMenu", label: "dabbas on the menu" }] },
    schema: z.object({
      heading: optText(160),
      items: z.array(z.object({ metric: z.enum(Object.keys(METRICS) as [MetricKey, ...MetricKey[]]), label: plain(80, "Required") })).min(1).max(6),
    }),
  }),
];

export const BLOCK_MAP: Record<string, BlockDef> = Object.fromEntries(BLOCK_DEFS.map((b) => [b.type, b]));
export const BLOCK_TYPES = BLOCK_DEFS.map((b) => b.type);

export type Block = { id: string; type: string; visible: boolean; data: Record<string, unknown> };

const envelope = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).optional(),
  type: z.string(),
  visible: z.boolean().optional().default(true),
  data: z.record(z.unknown()).optional().default({}),
});

export function newBlockId() {
  return `b${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export type BlockError = { index: number; type: string; message: string };

/** Strict validation for saving: any invalid block fails the whole save with readable errors. */
export function validateBlocks(input: unknown): { ok: true; blocks: Block[] } | { ok: false; errors: BlockError[] } {
  if (!Array.isArray(input)) return { ok: false, errors: [{ index: -1, type: "", message: "Blocks must be a list" }] };
  if (input.length > 60) return { ok: false, errors: [{ index: -1, type: "", message: "A page can have at most 60 blocks" }] };
  const out: Block[] = [];
  const errors: BlockError[] = [];
  const seen = new Set<string>();
  input.forEach((raw, index) => {
    const env = envelope.safeParse(raw);
    if (!env.success) return errors.push({ index, type: "", message: "Malformed block" });
    const d = BLOCK_MAP[env.data.type];
    if (!d) return errors.push({ index, type: env.data.type, message: `Unknown block type "${env.data.type}"` });
    const parsed = d.schema.safeParse(env.data.data);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return errors.push({ index, type: d.type, message: `${d.label}: ${first?.path.join(".") || "content"} — ${first?.message ?? "invalid"}` });
    }
    let id = env.data.id ?? newBlockId();
    if (seen.has(id)) id = newBlockId();
    seen.add(id);
    out.push({ id, type: d.type, visible: env.data.visible, data: parsed.data as Record<string, unknown> });
  });
  return errors.length ? { ok: false, errors } : { ok: true, blocks: out };
}

/** Lenient parse for rendering: keeps valid visible blocks, skips (and reports) the rest. */
export function renderableBlocks(input: unknown, onSkip?: (e: BlockError) => void): Block[] {
  if (!Array.isArray(input)) return [];
  const out: Block[] = [];
  input.forEach((raw, index) => {
    const res = validateBlocks([raw]);
    if (!res.ok) return onSkip?.({ ...res.errors[0]!, index });
    const b = res.blocks[0]!;
    if (b.visible) out.push(b);
  });
  return out;
}

/** Every image URL inside a block list (for the MediaAsset library check). */
export function blockImages(blocks: Block[]): string[] {
  const urls: string[] = [];
  for (const b of blocks) {
    const d = b.data as Record<string, unknown>;
    for (const k of ["image", "src", "logo"]) if (typeof d[k] === "string" && d[k]) urls.push(d[k] as string);
    for (const list of ["images", "items"]) {
      const arr = d[list];
      if (Array.isArray(arr)) for (const r of arr) for (const k of ["src", "logo"]) if (r && typeof r[k] === "string" && r[k]) urls.push(r[k]);
    }
  }
  return urls;
}

export function blockFromDefaults(type: string): Block {
  const d = BLOCK_MAP[type];
  if (!d) throw new Error(`Unknown block type "${type}"`);
  return { id: newBlockId(), type, visible: true, data: structuredClone(d.defaults) };
}
