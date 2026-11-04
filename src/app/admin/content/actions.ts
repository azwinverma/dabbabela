"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/permissions";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { done, fail, type ActionResult } from "@/lib/action";
import { SECTION_MAP, type Field } from "@/lib/cms";
import { discardDraft, publishSection, rollbackSection, saveDraft, saveHomeLayout, type HomeBlock } from "@/lib/cms-store";
import { isLocale, type Locale } from "@/lib/i18n";
import { guarded } from "../_kit/guard";

/** Coerce editor input to the field schema. Strings are length-capped; markdown is rendered escaped on the site. */
function clean(fields: Field[], input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const fl of fields) {
    const v = input?.[fl.name];
    switch (fl.type) {
      case "boolean":
        out[fl.name] = Boolean(v);
        break;
      case "number":
        out[fl.name] = Number.isFinite(Number(v)) ? Number(v) : 0;
        break;
      case "list":
        out[fl.name] = Array.isArray(v) ? v.slice(0, 50).map((row) => clean(fl.fields ?? [], (row ?? {}) as Record<string, unknown>)) : [];
        break;
      case "url": {
        const s = typeof v === "string" ? v.trim().slice(0, 500) : "";
        out[fl.name] = /^(\/|https?:\/\/|mailto:|tel:|#)/i.test(s) || s === "" ? s : "";
        break;
      }
      default:
        out[fl.name] = typeof v === "string" ? v.slice(0, 20000) : "";
    }
  }
  return out;
}

/** Nepali rows only keep what was translated, so everything else falls back to English. */
function sparse(data: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== "" && v !== null && !(Array.isArray(v) && v.length === 0)));
}

export async function saveSectionAction(key: string, locale: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("content.edit", async (user) => {
    const def = SECTION_MAP[key];
    if (!def || !isLocale(locale)) return fail("Unknown section");
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(String(fd.get("data") ?? "{}"));
    } catch {
      return fail("Couldn't read the form");
    }
    let data = clean(def.fields, raw);
    if (locale === "ne") data = sparse(data);
    const intent = String(fd.get("intent") ?? "draft");
    if (intent === "publish" && !can(user, "content.publish")) return fail("You can save drafts; publishing needs the content publish permission");
    await saveDraft(key, locale as Locale, data, user.id);
    if (intent === "publish") {
      const before = await db.contentSection.findUnique({ where: { key_locale: { key, locale } } });
      const v = await publishSection(key, locale as Locale, user.id);
      await audit({ actorId: user.id, action: "cms.publish", entity: "ContentSection", entityId: `${key}|${locale}`, summary: `${def.label} (${locale}) v${v}`, before: before?.data, after: data });
      revalidatePath("/", "layout");
      return done(`Published (version ${v}) — live on the site now`);
    }
    await audit({ actorId: user.id, action: "cms.draft", entity: "ContentSection", entityId: `${key}|${locale}`, summary: `${def.label} (${locale}) draft` });
    return done("Draft saved — not live yet. Review it below, then publish.");
  }, [`/admin/content/${key}`, "/admin/content"]);
}

export async function discardDraftAction(key: string, locale: string): Promise<ActionResult> {
  return guarded("content.edit", async (user) => {
    if (!isLocale(locale)) return fail("Unknown locale");
    await discardDraft(key, locale);
    await audit({ actorId: user.id, action: "cms.discard", entity: "ContentSection", entityId: `${key}|${locale}` });
    return done("Draft discarded");
  }, [`/admin/content/${key}`]);
}

export async function rollbackAction(key: string, locale: string, revisionId: string): Promise<ActionResult> {
  return guarded("content.publish", async (user) => {
    if (!isLocale(locale)) return fail("Unknown locale");
    const v = await rollbackSection(key, locale, revisionId, user.id);
    await audit({ actorId: user.id, action: "cms.rollback", entity: "ContentSection", entityId: `${key}|${locale}`, summary: `Rolled back → v${v}`, reason: `revision ${revisionId}` });
    revalidatePath("/", "layout");
    return done(`Rolled back — now live as version ${v}`);
  }, [`/admin/content/${key}`]);
}

export async function saveLayoutAction(blocks: HomeBlock[]): Promise<ActionResult> {
  return guarded("content.publish", async (user) => {
    await saveHomeLayout(blocks);
    await audit({ actorId: user.id, action: "cms.home_layout", entity: "Setting", entityId: "home.layout", after: blocks });
    revalidatePath("/");
    return done("Home page layout saved");
  }, ["/admin/content"]);
}
