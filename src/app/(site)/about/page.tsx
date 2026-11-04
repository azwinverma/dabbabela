import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getSections } from "@/lib/cms";
import { getI18n } from "@/lib/i18n/server";
import { md } from "@/lib/markdown";
import { PageHero, SectionHeading } from "@/components/site/Section";
import { TiffinHero } from "@/components/art/TiffinHero";
import { PrayerFlags } from "@/components/art/Graffiti";

export const metadata: Metadata = {
  title: "Our kitchen",
  description: "Why Dabba Bela exists, how we cook each morning and how lunch reaches you.",
  alternates: { canonical: "/about" },
};

export default async function AboutPage() {
  const { locale, t } = await getI18n();
  const c = await getSections(["about.story", "about.process"], locale);
  const story = c["about.story"];
  const process = c["about.process"];
  return (
    <>
      <PageHero eyebrow={story.eyebrow} title={story.title} />
      <section className="container grid gap-12 pt-14 lg:grid-cols-[1.2fr_1fr]">
        <div className="prose-poko max-w-2xl" dangerouslySetInnerHTML={{ __html: md(String(story.body ?? "")) }} />
        <div className="lg:pt-6">
          {story.image ? (
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border-2 border-ink shadow-sticker-lg">
              <Image src={story.image} alt={story.imageAlt || ""} fill sizes="(min-width: 1024px) 40vw, 100vw" className="object-cover" />
            </div>
          ) : (
            <TiffinHero />
          )}
        </div>
      </section>
      <PrayerFlags className="mt-16" />
      <section className="container pt-12">
        <SectionHeading title={process.title} />
        <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {((process.steps ?? []) as { title: string; text: string }[]).map((v, i) => (
            <li key={v.title} className="border-l-4 border-sindoor pl-4">
              <span className="text-sm font-bold text-ink-mute">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="text-lg font-bold">{v.title}</h3>
              <p className="mt-1 text-ink-soft">{v.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-12 max-w-2xl text-sm text-ink-soft">
          {t.site.sharedKitchen}{" "}
          <Link href="/info/food-safety" className="font-semibold underline underline-offset-2">Food safety</Link> ·{" "}
          <Link href="/info/allergens" className="font-semibold underline underline-offset-2">{t.menu.allergens}</Link>
        </p>
      </section>
    </>
  );
}
