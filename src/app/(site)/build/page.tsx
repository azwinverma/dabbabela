import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getSection } from "@/lib/cms";
import { getCurrentUser } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { pick } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { dateOptions } from "@/lib/public";
import { builderGroups, type CustomPick } from "@/server/builder";
import { PageHero, EmptyState } from "@/components/site/Section";
import { Builder, type BuilderGroup } from "./Builder";

export const metadata: Metadata = {
  title: "Build a dabba",
  description: "Pick a base, a main, vegetables, sides and achar. See the price, diet and allergens as you build.",
  alternates: { canonical: "/build" },
};

export default async function BuildPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  const { locale, t } = await getI18n();
  const [intro, groups, user, dates, settings] = await Promise.all([getSection("build.intro", locale), builderGroups(), getCurrentUser(), dateOptions(14), getSettings()]);
  const existing = edit && user ? await db.customBox.findFirst({ where: { id: edit, userId: user.id } }) : null;
  const data: BuilderGroup[] = groups
    .filter((g) => g.options.length)
    .map((g) => ({
      id: g.id,
      name: pick(g, "name", locale),
      min: g.minSelect,
      max: g.maxSelect,
      options: g.options.map((o) => ({
        id: o.menuItem.id,
        name: pick(o.menuItem, "name", locale),
        description: pick(o.menuItem, "description", locale) || null,
        price: o.priceOverride ?? o.menuItem.price,
        diet: o.menuItem.diet,
        spice: o.menuItem.spiceLevel,
        image: o.menuItem.image,
        portion: o.menuItem.portionLabel,
        allergens: o.menuItem.allergens.map((a) => (locale === "ne" && a.allergen.nameNe ? a.allergen.nameNe : a.allergen.name)),
      })),
    }));

  return (
    <>
      <PageHero eyebrow={String(intro.eyebrow)} title={String(intro.title)} intro={String(intro.intro)} />
      <div className="container py-10">
        {data.length === 0 ? (
          <EmptyState title="Build-a-Dabba isn't open yet" text="The kitchen hasn't set up dishes for building yet. Try this week's menu." />
        ) : (
          <Builder
            groups={data}
            dates={dates}
            loggedIn={Boolean(user)}
            maxQty={settings.builderMaxQty}
            initial={existing ? { name: existing.name, picks: existing.items as unknown as CustomPick[] } : null}
            avoid={user?.allergies ?? []}
            labels={{ add: t.site.addToList, day: t.site.pickDay, noDays: t.site.noDays, sharedKitchen: t.site.sharedKitchen }}
          />
        )}
      </div>
    </>
  );
}
