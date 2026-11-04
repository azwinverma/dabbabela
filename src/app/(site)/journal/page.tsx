import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { db } from "@/lib/db";
import { getSection } from "@/lib/cms";
import { getI18n } from "@/lib/i18n/server";
import { pick } from "@/lib/i18n";
import { formatStamp } from "@/lib/dates";
import { PageHero, EmptyState } from "@/components/site/Section";

export const metadata: Metadata = { title: "Journal", description: "Notes from the Dabba Bela kitchen: menus, sourcing and how we cook.", alternates: { canonical: "/journal" } };

export default async function JournalPage() {
  const { locale, t } = await getI18n();
  const [intro, posts] = await Promise.all([
    getSection("journal.intro", locale),
    db.post.findMany({ where: { published: true, publishedAt: { lte: new Date() } }, orderBy: { publishedAt: "desc" }, take: 50 }),
  ]);
  return (
    <>
      <PageHero eyebrow={String(intro.eyebrow)} title={String(intro.title)} intro={String(intro.intro)} />
      <div className="container py-12">
        {posts.length === 0 ? (
          <EmptyState title={t.common.none} />
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => (
              <article key={p.id} className="card group overflow-hidden">
                <Link href={`/journal/${p.slug}`} className="block">
                  {p.coverImage && (
                    <div className="relative aspect-[16/10] border-b-2 border-ink">
                      <Image src={p.coverImage} alt="" fill sizes="(min-width: 1024px) 33vw, 100vw" className="object-cover" />
                    </div>
                  )}
                  <div className="p-5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-ink-mute">
                      {p.publishedAt ? formatStamp(p.publishedAt).split(",")[0] : ""}
                      {p.tags.length ? ` · ${p.tags.join(", ")}` : ""}
                    </p>
                    <h2 className="mt-2 font-display text-xl font-bold leading-tight group-hover:text-sindoor">{pick(p, "title", locale)}</h2>
                    {p.excerpt && <p className="mt-2 text-sm text-ink-soft">{p.excerpt}</p>}
                  </div>
                </Link>
              </article>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
