import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { isLocale } from "@/lib/i18n";
import { getPreview } from "@/lib/cms/pages";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

/** Staff-only preview shell with a desktop / mobile toggle; the page itself renders in an iframe. */
export default async function PreviewShell({ params, searchParams }: { params: Promise<{ pageId: string }>; searchParams: Promise<{ v?: string; w?: string; locale?: string }> }) {
  await requirePermission("content.view");
  const { pageId } = await params;
  const sp = await searchParams;
  const locale = isLocale(sp.locale) ? sp.locale : "en";
  const p = await getPreview(pageId, { versionId: sp.v ?? null, locale });
  if (!p) notFound();
  const mobile = sp.w === "mobile";
  const qs = (o: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ v: sp.v, w: sp.w, locale, ...o })) if (v) u.set(k, v);
    return `?${u.toString()}`;
  };
  const frameQs = new URLSearchParams({ ...(sp.v ? { v: sp.v } : {}), locale }).toString();
  return (
    <div className="min-h-screen bg-ink/90 text-paper">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 text-sm">
        <Link href={`/admin/pages/cms/${p.page.id}`} className="font-semibold underline underline-offset-2">
          ← Back to editor
        </Link>
        <span className="font-mono text-xs text-paper/70">/{p.page.slug}</span>
        <span className="rounded-full bg-besar px-2 py-0.5 text-xs font-bold text-ink">
          {p.version ? `v${p.version.version} · ${p.version.status.toLowerCase()} · ${p.version.locale}` : "no content yet"}
        </span>
        <span className="ml-auto flex gap-1" role="group" aria-label="Preview width">
          <Link href={qs({ w: undefined })} className={cn("rounded-md px-3 py-1 font-semibold", !mobile ? "bg-paper text-ink" : "hover:bg-white/10")} aria-current={!mobile}>
            Desktop
          </Link>
          <Link href={qs({ w: "mobile" })} className={cn("rounded-md px-3 py-1 font-semibold", mobile ? "bg-paper text-ink" : "hover:bg-white/10")} aria-current={mobile}>
            Mobile
          </Link>
        </span>
        <span className="flex gap-1" role="group" aria-label="Language">
          <Link href={qs({ locale: "en", v: undefined })} className={cn("rounded-md px-2 py-1", locale === "en" ? "bg-paper text-ink" : "hover:bg-white/10")}>
            EN
          </Link>
          <Link href={qs({ locale: "ne", v: undefined })} className={cn("rounded-md px-2 py-1", locale === "ne" ? "bg-paper text-ink" : "hover:bg-white/10")}>
            NE
          </Link>
        </span>
      </div>
      <div className="flex justify-center p-4">
        <iframe
          title={`Preview of /${p.page.slug}`}
          src={`/preview/${p.page.id}/frame?${frameQs}`}
          className={cn("rounded-lg border-2 border-ink bg-paper", mobile ? "h-[780px] w-[390px]" : "h-[calc(100vh-7rem)] w-full max-w-[1280px]")}
        />
      </div>
    </div>
  );
}
