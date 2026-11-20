import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { dict, isLocale } from "@/lib/i18n";
import { getPreview } from "@/lib/cms/pages";
import { Blocks } from "@/lib/cms/render";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

/** The previewed page body (draft or a given version). Staff only; never cached or indexed. */
export default async function PreviewFrame({ params, searchParams }: { params: Promise<{ pageId: string }>; searchParams: Promise<{ v?: string; locale?: string }> }) {
  await requirePermission("content.view");
  const { pageId } = await params;
  const sp = await searchParams;
  const locale = isLocale(sp.locale) ? sp.locale : "en";
  const p = await getPreview(pageId, { versionId: sp.v ?? null, locale });
  if (!p) notFound();
  const hasHero = p.blocks[0]?.type === "hero";
  return (
    <div className={cn("grain min-h-screen", locale === "ne" && "lang-ne")}>
      <p role="status" className="bg-besar py-1.5 text-center text-xs font-bold text-ink">
        Preview — not public
      </p>
      {!hasHero && (
        <div className="container max-w-3xl pt-12">
          <h1 className="text-4xl font-extrabold leading-tight md:text-5xl">{locale === "ne" && p.page.titleNe ? p.page.titleNe : p.page.title}</h1>
        </div>
      )}
      {p.blocks.length ? <Blocks blocks={p.blocks} locale={locale} t={dict(locale)} firstIsTitle={hasHero} /> : <p className="container py-16 text-ink-mute">No blocks yet.</p>}
    </div>
  );
}
