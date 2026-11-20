import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getSettings, saveSettings, type SiteSettings } from "@/lib/settings";
import { assertCan, CmsError, revalidateSite, type CmsActor } from "./access";
import { isSafeHref, isSafeImage } from "./urls";

/**
 * Branding slots (Setting key "branding"), limited to brand/BRAND_GUIDELINES.md:
 * - logos / favicon: media-library images (empty = the bundled Dabba Bela mark);
 * - colour preset: which approved palette colour carries the announcement bar and footer (no free colour picker);
 * - typography preset: combinations of the bundled fonts only.
 * Contact, hours and socials stay in the site settings record (same fields /admin/settings edits).
 */

export const COLOR_PRESETS = {
  classic: { label: "Classic — charcoal bar, charcoal footer", bar: "bg-ink text-paper", footer: "" },
  turmeric: { label: "Turmeric bar, charcoal footer", bar: "bg-besar text-ink", footer: "" },
  achar: { label: "Achar red bar, charcoal footer", bar: "bg-sindoor text-paper", footer: "" },
  saag: { label: "Saag green bar and footer", bar: "bg-saag text-paper", footer: "!bg-saag-dark" },
} as const;
export type ColorPreset = keyof typeof COLOR_PRESETS;

export const FONT_PRESETS = {
  standard: { label: "Plus Jakarta Sans headlines + DM Sans text (standard)", css: "" },
  soft: { label: "DM Sans for headlines and text (softer)", css: "html:root{--font-display:var(--font-body)}" },
} as const;
export type FontPreset = keyof typeof FONT_PRESETS;

export type Branding = { logoUrl: string; logoLightUrl: string; faviconUrl: string; colorPreset: ColorPreset; fontPreset: FontPreset };
export const DEFAULT_BRANDING: Branding = { logoUrl: "", logoLightUrl: "", faviconUrl: "", colorPreset: "classic", fontPreset: "standard" };

const KEY = "branding";

function merge(v: unknown): Branding {
  const s = (v && typeof v === "object" ? v : {}) as Partial<Branding>;
  return {
    logoUrl: isSafeImage(s.logoUrl) ? s.logoUrl : "",
    logoLightUrl: isSafeImage(s.logoLightUrl) ? s.logoLightUrl : "",
    faviconUrl: isSafeImage(s.faviconUrl) ? s.faviconUrl : "",
    colorPreset: s.colorPreset && s.colorPreset in COLOR_PRESETS ? s.colorPreset : "classic",
    fontPreset: s.fontPreset && s.fontPreset in FONT_PRESETS ? s.fontPreset : "standard",
  };
}

async function load(): Promise<Branding> {
  try {
    return merge((await db.setting.findUnique({ where: { key: KEY } }))?.value);
  } catch {
    return DEFAULT_BRANDING;
  }
}
const cached = unstable_cache(load, ["cms-branding-v1"], { tags: ["cms"], revalidate: 300 });

export async function getBranding(): Promise<Branding> {
  if (process.env.VITEST || process.env.SCRIPT_CONTEXT) return load();
  return cached();
}

export type BrandingInput = Partial<Branding> & {
  contact?: Partial<Pick<SiteSettings, "phone" | "whatsapp" | "email" | "address" | "hours" | "facebook" | "instagram" | "tiktok">>;
};

export async function saveBranding(actor: CmsActor, input: BrandingInput) {
  assertCan(actor, "content.publish");
  const before = await load();
  for (const k of ["logoUrl", "logoLightUrl", "faviconUrl"] as const) {
    const v = (input[k] ?? before[k]).trim();
    if (v && !isSafeImage(v)) throw new CmsError(`${k}: use an image from the media library`);
    if (/^https:/i.test(v) && !(await db.mediaAsset.findFirst({ where: { url: v }, select: { id: true } }))) throw new CmsError(`${k}: images must come from the media library`);
  }
  if (input.colorPreset && !(input.colorPreset in COLOR_PRESETS)) throw new CmsError("Pick one of the approved colour presets");
  if (input.fontPreset && !(input.fontPreset in FONT_PRESETS)) throw new CmsError("Pick one of the bundled font presets");
  const next = merge({ ...before, ...Object.fromEntries(Object.entries(input).filter(([k]) => k !== "contact")) });
  await db.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: next }, update: { value: next } });

  let contactBefore: Record<string, string> | undefined;
  let contactAfter: Record<string, string> | undefined;
  if (input.contact) {
    const c = input.contact;
    for (const k of ["facebook", "instagram", "tiktok"] as const) {
      const v = (c[k] ?? "").trim();
      if (v && !(isSafeHref(v) && v.startsWith("https://"))) throw new CmsError(`${k}: use the full https:// address`);
    }
    if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) throw new CmsError("Email address looks wrong");
    const s = await getSettings();
    const patch = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, String(v ?? "").trim().slice(0, 300)])) as Record<string, string>;
    contactBefore = Object.fromEntries(Object.keys(patch).map((k) => [k, String((s as unknown as Record<string, unknown>)[k] ?? "")]));
    contactAfter = patch;
    await saveSettings(patch as Partial<SiteSettings>);
  }
  await audit({ actorId: actor.id, action: "branding.update", entity: "Setting", entityId: KEY, before: { ...before, contact: contactBefore }, after: { ...next, contact: contactAfter } });
  revalidateSite();
  return next;
}
