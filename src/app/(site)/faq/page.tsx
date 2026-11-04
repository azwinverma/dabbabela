import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { getSection } from "@/lib/cms";
import { getI18n } from "@/lib/i18n/server";
import { pick } from "@/lib/i18n";
import { PageHero, EmptyState } from "@/components/site/Section";
import { JsonLd } from "@/components/site/JsonLd";

export const metadata: Metadata = { title: "FAQ", description: "Answers about ordering, plans, delivery areas, allergens and payment.", alternates: { canonical: "/faq" } };

export default async function FaqPage() {
  const { locale, t } = await getI18n();
  const [intro, faqs] = await Promise.all([getSection("faq.intro", locale), db.faq.findMany({ where: { published: true }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }] })]);
  const cats = [...new Set(faqs.map((f) => f.category))];
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map((f) => ({ "@type": "Question", name: pick(f, "question", locale), acceptedAnswer: { "@type": "Answer", text: pick(f, "answer", locale) } })),
        }}
      />
      <PageHero eyebrow={String(intro.eyebrow)} title={String(intro.title)} intro={String(intro.intro)} />
      <div className="container grid gap-10 py-12 lg:grid-cols-[220px_1fr]">
        {faqs.length === 0 ? (
          <div className="lg:col-span-2">
            <EmptyState title={t.common.none} />
          </div>
        ) : (
          <>
            <nav aria-label="Topics" className="lg:sticky lg:top-6 lg:self-start">
              <ul className="flex flex-wrap gap-2 lg:flex-col">
                {cats.map((c) => (
                  <li key={c}>
                    <a href={`#${c.toLowerCase()}`} className="rounded-full px-3 py-1.5 text-sm font-semibold hover:bg-ink/5">{c}</a>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="space-y-12">
              {cats.map((c) => (
                <section key={c} id={c.toLowerCase()} className="scroll-mt-24">
                  <h2 className="font-display text-2xl font-extrabold">{c}</h2>
                  <div className="mt-4 divide-y-2 divide-ink/10 border-y-2 border-ink">
                    {faqs
                      .filter((f) => f.category === c)
                      .map((f) => (
                        <details key={f.id} className="group py-4">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-bold">
                            {pick(f, "question", locale)}
                            <span aria-hidden className="text-2xl text-sindoor transition group-open:rotate-45">+</span>
                          </summary>
                          <p className="mt-2 whitespace-pre-line leading-relaxed text-ink-soft">{pick(f, "answer", locale)}</p>
                        </details>
                      ))}
                  </div>
                </section>
              ))}
              <p className="text-ink-soft">
                Still stuck? <Link href="/contact" className="font-semibold text-sindoor underline underline-offset-2">{t.nav.contact}</Link>
              </p>
            </div>
          </>
        )}
      </div>
    </>
  );
}
