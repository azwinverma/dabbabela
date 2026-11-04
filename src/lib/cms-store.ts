import { unstable_cache, revalidateTag } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { SECTION_MAP, SECTIONS } from "./cms";
import type { Locale } from "./i18n";

/**
 * CMS storage. Each section has published `data` and an optional unpublished `draft`, per locale.
 * Publishing writes an immutable ContentRevision; rollback re-publishes an older revision.
 * Nepali (ne) content falls back field-by-field to English, then to code defaults.
 */
type Data = Record<string, unknown>;

const loadAll = unstable_cache(
  async (): Promise<Record<string, Data>> => {
    try {
      const rows = await db.contentSection.findMany({ select: { key: true, locale: true, data: true } });
      return Object.fromEntries(rows.map((r) => [`${r.key}|${r.locale}`, (r.data ?? {}) as Data]));
    } catch {
      return {};
    }
  },
  ["cms-sections-v2"],
  { tags: ["cms"], revalidate: 300 },
);

async function all() {
  if (process.env.VITEST || process.env.SCRIPT_CONTEXT) {
    const rows = await db.contentSection.findMany({ select: { key: true, locale: true, data: true } });
    return Object.fromEntries(rows.map((r) => [`${r.key}|${r.locale}`, (r.data ?? {}) as Data]));
  }
  return loadAll();
}

const clean = (d: Data) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== "" && v !== null && v !== undefined));

export async function getSection<T extends Data = Data>(key: string, locale: Locale = "en"): Promise<T> {
  const store = await all();
  const def = SECTION_MAP[key]?.defaults ?? {};
  const en = store[`${key}|en`] ?? {};
  const ne = locale === "ne" ? clean(store[`${key}|ne`] ?? {}) : {};
  return { ...def, ...en, ...ne } as T;
}

export async function getSections(keys: string[], locale: Locale = "en") {
  const out: Record<string, Data> = {};
  for (const k of keys) out[k] = await getSection(k, locale);
  return out as Record<string, Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Draft-aware read for the admin editor and ?preview=1 (staff only — callers must check permission). */
export async function getSectionForEdit(key: string, locale: Locale) {
  const row = await db.contentSection.findUnique({ where: { key_locale: { key, locale } }, include: { revisions: { orderBy: { version: "desc" }, take: 20 } } });
  const def = SECTION_MAP[key]?.defaults ?? {};
  return {
    published: { ...(locale === "en" ? def : {}), ...((row?.data as Data) ?? {}) },
    draft: (row?.draft as Data | null) ?? null,
    version: row?.version ?? 0,
    publishedAt: row?.publishedAt ?? null,
    revisions: row?.revisions ?? [],
  };
}

export async function saveDraft(key: string, locale: Locale, data: Data, userId: string) {
  if (!SECTION_MAP[key]) throw new Error("Unknown section");
  await db.contentSection.upsert({
    where: { key_locale: { key, locale } },
    create: { key, locale, data: (locale === "en" ? SECTION_MAP[key].defaults : {}) as Prisma.InputJsonValue, draft: data as Prisma.InputJsonValue, version: 0, updatedBy: userId },
    update: { draft: data as Prisma.InputJsonValue, updatedBy: userId },
  });
}

/** Publish the draft (or the given data) and record a revision. */
export async function publishSection(key: string, locale: Locale, userId: string, data?: Data, action: "PUBLISH" | "ROLLBACK" = "PUBLISH") {
  if (!SECTION_MAP[key]) throw new Error("Unknown section");
  const row = await db.contentSection.findUnique({ where: { key_locale: { key, locale } } });
  const next = (data ?? (row?.draft as Data | null) ?? (row?.data as Data | null)) as Data | null;
  if (!next) throw new Error("Nothing to publish");
  const version = (row?.version ?? 0) + 1;
  await db.$transaction(async (tx) => {
    const s = await tx.contentSection.upsert({
      where: { key_locale: { key, locale } },
      create: { key, locale, data: next as Prisma.InputJsonValue, draft: undefined, version, publishedAt: new Date(), updatedBy: userId },
      update: { data: next as Prisma.InputJsonValue, draft: null as unknown as Prisma.InputJsonValue, version, publishedAt: new Date(), updatedBy: userId },
    });
    await tx.contentRevision.create({ data: { sectionId: s.id, version, data: next as Prisma.InputJsonValue, action, actorId: userId } });
  });
  try {
    revalidateTag("cms");
  } catch {
    /* outside Next */
  }
  return version;
}

export async function discardDraft(key: string, locale: Locale) {
  await db.contentSection.updateMany({ where: { key, locale }, data: { draft: null as unknown as Prisma.InputJsonValue } });
}

export async function rollbackSection(key: string, locale: Locale, revisionId: string, userId: string) {
  const rev = await db.contentRevision.findUniqueOrThrow({ where: { id: revisionId }, include: { section: true } });
  if (rev.section.key !== key || rev.section.locale !== locale) throw new Error("Revision doesn't belong to this section");
  return publishSection(key, locale, userId, rev.data as Data, "ROLLBACK");
}

// ───────────── home page layout (order + visibility of blocks) ─────────────

export type HomeBlock = { key: string; visible: boolean };
/** Lazy: cms.ts re-exports from this module, so SECTIONS must not be read at import time. */
export function homeBlockKeys() {
  return SECTIONS.filter((s) => s.key.startsWith("home.")).map((s) => s.key);
}

export async function getHomeLayout(): Promise<HomeBlock[]> {
  const row = await db.setting.findUnique({ where: { key: "home.layout" } }).catch(() => null);
  const saved = (row?.value as HomeBlock[] | undefined) ?? [];
  const keys = homeBlockKeys();
  const known = saved.filter((b) => keys.includes(b.key));
  for (const k of keys) if (!known.find((b) => b.key === k)) known.push({ key: k, visible: true });
  return known;
}

export async function saveHomeLayout(blocks: HomeBlock[]) {
  const keys = homeBlockKeys();
  const clean = blocks.filter((b) => keys.includes(b.key)).map((b) => ({ key: b.key, visible: Boolean(b.visible) }));
  await db.setting.upsert({ where: { key: "home.layout" }, create: { key: "home.layout", value: clean }, update: { value: clean } });
  try {
    revalidateTag("cms");
  } catch {
    /* outside Next */
  }
}
