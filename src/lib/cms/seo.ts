import type { Metadata } from "next";
import type { CmsPage } from "@prisma/client";
import type { Locale } from "@/lib/i18n";
import type { Block } from "./blocks";

/** Per-page SEO for CMS pages: title, description, OG image, canonical, noindex. */
export function cmsMetadata(page: CmsPage, blocks: Block[], locale: Locale): Metadata {
  const title = page.seoTitle || (locale === "ne" && page.titleNe ? page.titleNe : page.title);
  const firstText = blocks.find((b) => b.type === "hero" && b.data.subtitle)?.data.subtitle as string | undefined;
  const description = page.seoDescription || (firstText ? firstText.slice(0, 160) : undefined);
  const canonical = page.canonicalUrl || `/${page.slug}`;
  const heroImage = blocks.find((b) => b.type === "hero" && b.data.image)?.data.image as string | undefined;
  const og = page.ogImage || heroImage;
  return {
    title,
    description,
    alternates: { canonical },
    robots: page.noindex ? { index: false, follow: true } : undefined,
    openGraph: { title, description, url: canonical, type: "website", ...(og ? { images: [og] } : {}) },
  };
}

/** Structured data for a CMS page: WebPage + breadcrumbs, and FAQPage when it shows FAQs. */
export function cmsJsonLd(page: CmsPage, base: string, locale: Locale, faqs: { question: string; answer: string }[] = []) {
  const url = `${base}/${page.slug}`;
  const name = locale === "ne" && page.titleNe ? page.titleNe : page.title;
  const out: Record<string, unknown>[] = [
    { "@context": "https://schema.org", "@type": "WebPage", name, url, inLanguage: locale === "ne" ? "ne-NP" : "en-NP", ...(page.seoDescription ? { description: page.seoDescription } : {}) },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
        { "@type": "ListItem", position: 2, name, item: url },
      ],
    },
  ];
  if (faqs.length)
    out.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
    });
  return out;
}

export function siteBase() {
  return (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3100")).replace(/\/$/, "");
}
