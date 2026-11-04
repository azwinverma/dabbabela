import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getI18n } from "@/lib/i18n/server";
import { pick } from "@/lib/i18n";
import { md } from "@/lib/markdown";
import { formatStamp } from "@/lib/dates";

type Params = Promise<{ slug: string }>;
const load = (slug: string) => db.page.findFirst({ where: { slug, published: true } });

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: "Not found" };
  return { title: p.seoTitle || p.title, description: p.seoDescription ?? undefined, alternates: { canonical: `/info/${p.slug}` } };
}

export default async function InfoPage({ params }: { params: Params }) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const { locale, t } = await getI18n();
  const body = pick(p, "body", locale);
  // Drop a leading "# Title" from the markdown — the page renders its own h1.
  const content = body.replace(/^#\s+.+\n+/, "");
  return (
    <article className="container max-w-3xl py-12">
      {p.needsLegalReview && (
        <p role="note" className="mb-6 rounded-xl border-2 border-besar bg-besar-light px-4 py-3 text-sm font-semibold text-besar-dark">
          {t.site.draftNotice}
        </p>
      )}
      <h1 className="text-4xl font-extrabold leading-tight md:text-5xl">{pick(p, "title", locale)}</h1>
      <p className="mt-2 text-sm text-ink-mute">Updated {formatStamp(p.updatedAt).split(",")[0]}</p>
      <div className="prose-poko mt-8" dangerouslySetInnerHTML={{ __html: md(content) }} />
    </article>
  );
}
