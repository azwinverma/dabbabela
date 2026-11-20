import type { Metadata } from "next";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getI18n } from "@/lib/i18n/server";
import { pick } from "@/lib/i18n";
import { siteUrl } from "@/lib/site-url";
import { getPublicPage, HOME_SLUG } from "@/lib/cms/pages";
import { resolveRedirect } from "@/lib/cms/redirects";
import { cmsJsonLd, cmsMetadata } from "@/lib/cms/seo";
import { Blocks, faqRows } from "@/lib/cms/render";
import { JsonLd } from "@/components/site/JsonLd";

/**
 * Catch-all for paths no fixed route answers: a published page-builder page, else a Redirect, else 404.
 * Drafts, archived pages and future schedules never render here (staff use /preview/<id>).
 */
type Params = Promise<{ slug: string[] }>;

const joined = (slug: string[]) => slug.map((s) => decodeURIComponent(s)).join("/");

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const slug = joined((await params).slug);
  if (slug === HOME_SLUG) return { title: "Not found" };
  const { locale } = await getI18n();
  const found = await getPublicPage(slug, locale);
  if (!found) return { title: "Not found", robots: { index: false } };
  return cmsMetadata(found.page, found.blocks, locale);
}

export default async function CmsRoute({ params }: { params: Params }) {
  const slug = joined((await params).slug);
  const { locale, t } = await getI18n();
  const found = slug === HOME_SLUG ? null : await getPublicPage(slug, locale);
  if (!found) {
    const r = await resolveRedirect(`/${slug}`);
    if (r) {
      if (r.permanent) permanentRedirect(r.to);
      redirect(r.to);
    }
    notFound();
  }
  const faqBlocks = found.blocks.filter((b) => b.type === "faq");
  const faqs = (await Promise.all(faqBlocks.map((b) => faqRows(b.data)))).flat().map((f) => ({ question: pick(f, "question", locale), answer: pick(f, "answer", locale) }));
  const base = await siteUrl();
  const hasHero = found.blocks[0]?.type === "hero";
  const title = locale === "ne" && found.page.titleNe ? found.page.titleNe : found.page.title;
  return (
    <>
      <JsonLd data={cmsJsonLd(found.page, base, locale, faqs)} />
      {!hasHero && (
        <div className="container max-w-3xl pt-12">
          <h1 className="text-4xl font-extrabold leading-tight md:text-5xl">{title}</h1>
        </div>
      )}
      <Blocks blocks={found.blocks} locale={locale} t={t} firstIsTitle={hasHero} />
    </>
  );
}
