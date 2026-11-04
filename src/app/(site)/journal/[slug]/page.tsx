import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getI18n } from "@/lib/i18n/server";
import { pick } from "@/lib/i18n";
import { md } from "@/lib/markdown";
import { formatStamp } from "@/lib/dates";
import { JsonLd } from "@/components/site/JsonLd";

type Params = Promise<{ slug: string }>;
const load = (slug: string) => db.post.findFirst({ where: { slug, published: true, publishedAt: { lte: new Date() } } });

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: "Not found" };
  return { title: p.title, description: p.excerpt ?? undefined, alternates: { canonical: `/journal/${p.slug}` }, openGraph: { type: "article", ...(p.coverImage ? { images: [p.coverImage] } : {}) } };
}

export default async function PostPage({ params }: { params: Params }) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const { locale, t } = await getI18n();
  const title = pick(p, "title", locale);
  const body = pick(p, "body", locale);
  return (
    <article className="container max-w-3xl py-12">
      <JsonLd data={{ "@context": "https://schema.org", "@type": "BlogPosting", headline: p.title, datePublished: p.publishedAt?.toISOString(), author: { "@type": "Organization", name: p.author ?? "Dabba Bela" }, ...(p.coverImage ? { image: p.coverImage } : {}) }} />
      <Link href="/journal" className="text-sm font-semibold text-sindoor underline underline-offset-2">← {t.nav.journal}</Link>
      <h1 className="mt-4 text-4xl font-extrabold leading-tight md:text-5xl">{title}</h1>
      <p className="mt-3 text-sm text-ink-mute">
        {p.author ?? "Dabba Bela"}
        {p.publishedAt ? ` · ${formatStamp(p.publishedAt).split(",")[0]}` : ""}
      </p>
      {p.coverImage && (
        <div className="relative mt-8 aspect-[16/9] overflow-hidden rounded-2xl border-2 border-ink">
          <Image src={p.coverImage} alt="" fill priority sizes="(min-width: 768px) 768px, 100vw" className="object-cover" />
        </div>
      )}
      <div className="prose-poko mt-8" dangerouslySetInnerHTML={{ __html: md(body) }} />
    </article>
  );
}
