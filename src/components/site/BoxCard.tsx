import Image from "next/image";
import Link from "next/link";
import type { Diet } from "@prisma/client";
import { Flame } from "lucide-react";
import { BoxArt } from "@/components/art/BoxArt";
import { AddToBox } from "./AddToBox";
import { rs } from "@/lib/money";
import { cn } from "@/lib/utils";
import { DIET_LABEL } from "@/lib/labels";
import type { PublicBox } from "@/lib/public";
import type { Dictionary } from "@/lib/i18n";

export type { PublicBox };

/** Indian/Nepali-style veg mark: green square-dot = veg, red = contains meat/egg. */
export function VegDot({ veg, className }: { veg: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border-2", veg ? "border-saag" : "border-sindoor", className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", veg ? "bg-saag" : "bg-sindoor")} />
    </span>
  );
}

export function DietBadge({ diet, t, verified }: { diet: Diet; t?: Dictionary; verified?: boolean }) {
  const d = DIET_LABEL[diet];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold", d.veg ? "bg-saag-light text-saag-dark" : "bg-sindoor-light text-sindoor-dark")}>
      <VegDot veg={d.veg} className="h-3.5 w-3.5" />
      {t?.diet[diet] ?? d.label}
      {verified === false && <span className="sr-only"> (preparation not yet verified)</span>}
    </span>
  );
}

export function SpiceMeter({ level, className }: { level: number; className?: string }) {
  const labels = ["Not spicy", "Mild", "Medium", "Hot", "Very hot"];
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} title={labels[level] ?? ""}>
      <span className="sr-only">Spice: {labels[level]}</span>
      {[1, 2, 3, 4].map((i) => (
        <Flame key={i} aria-hidden className={cn("h-3.5 w-3.5", i <= level ? "fill-sindoor text-sindoor" : "text-ink/20")} />
      ))}
    </span>
  );
}

export function AllergenChips({ allergens, t, highlight = [] }: { allergens: PublicBox["allergens"]; t: Dictionary; highlight?: string[] }) {
  if (!allergens.length) return <p className="text-xs text-ink-mute">{t.menu.noAllergens}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t.menu.allergens}>
      {allergens.map((a) => (
        <li
          key={a.code}
          className={cn(
            "rounded-md border px-1.5 py-0.5 text-[0.72rem] font-semibold",
            highlight.includes(a.code) ? "border-sindoor bg-sindoor text-white" : a.mayContain ? "border-dashed border-ink/30 text-ink-mute" : "border-ink/25 text-ink-soft",
          )}
        >
          {a.mayContain ? `${t.menu.mayContain}: ` : ""}
          {a.name}
        </li>
      ))}
    </ul>
  );
}

export function NutritionLine({ n, t }: { n: PublicBox["nutrition"]; t: Dictionary }) {
  if (!n) return null;
  return (
    <p className="text-xs text-ink-mute">
      ≈ {n.calories} kcal · {n.proteinG} g protein{" "}
      <span className="rounded bg-ink/5 px-1 font-semibold uppercase tracking-wide">{n.source === "VERIFIED" ? t.common.verified : t.common.estimated}</span>
    </p>
  );
}

/** Real photo when one has been uploaded; otherwise the hand-drawn dabba illustration. */
export function BoxImage({
  box,
  className,
  sizes = "(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw",
  priority,
}: {
  box: { name: string; image: string | null; accent: string; tagline?: string | null };
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <div className={cn("relative aspect-[24/17] overflow-hidden bg-paper-deep", className)}>
      {box.image ? (
        <Image src={box.image} alt={box.name} fill sizes={sizes} priority={priority} className="object-cover" />
      ) : (
        <BoxArt name={`${box.name} ${box.tagline ?? ""}`} accent={box.accent} />
      )}
    </div>
  );
}

export function BoxCard({
  box,
  t,
  eyebrow,
  date,
  dates,
  disabledReason,
  soldOut,
  highlightAllergens = [],
}: {
  box: PublicBox;
  t: Dictionary;
  eyebrow?: string;
  date?: string;
  dates?: { value: string; label: string; price?: number; soldOut?: boolean }[];
  disabledReason?: string | null;
  soldOut?: boolean;
  highlightAllergens?: string[];
}) {
  return (
    <article className={cn("card group flex h-full flex-col overflow-hidden shadow-card transition", soldOut ? "opacity-70" : "hover:-translate-y-0.5 hover:shadow-sticker")}>
      <Link href={`/boxes/${box.slug}`} className="relative block border-b-2 border-ink" aria-label={`${box.name} — ${t.site.viewDabba}`}>
        <BoxImage box={box} />
        {eyebrow && <span className="absolute left-3 top-3 rounded-full border-2 border-ink bg-paper-card px-2.5 py-0.5 text-[0.7rem] font-bold uppercase tracking-wider">{eyebrow}</span>}
        {box.isSpecial && <span className="absolute right-3 top-3 rotate-3 rounded-md border-2 border-ink bg-besar px-2 py-0.5 font-marker text-sm">{t.site.special}</span>}
        {soldOut && <span className="absolute inset-x-0 bottom-0 bg-ink/85 py-1.5 text-center text-sm font-bold uppercase tracking-widest text-paper">{t.common.soldOut}</span>}
      </Link>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-bold leading-tight">
            <Link href={`/boxes/${box.slug}`} className="hover:text-sindoor">
              {box.name}
            </Link>
          </h3>
          <span className="shrink-0 font-display text-lg font-extrabold text-sindoor">{rs(box.price)}</span>
        </div>
        {box.tagline && <p className="text-sm text-ink-soft">{box.tagline}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <DietBadge diet={box.diet} t={t} verified={box.dietVerified} />
          <SpiceMeter level={box.spice} />
        </div>
        <AllergenChips allergens={box.allergens} t={t} highlight={highlightAllergens} />
        <NutritionLine n={box.nutrition} t={t} />
        <div className="mt-auto pt-2">
          <AddToBox box={{ id: box.id, name: box.name, price: box.price, accent: box.accent, image: box.image }} date={date} dates={dates} disabledReason={soldOut ? t.common.soldOut : disabledReason} compact labels={{ add: t.site.addToList, added: t.site.added, checkout: t.site.checkout, day: t.site.pickDay, none: t.site.noDays }} />
        </div>
      </div>
    </article>
  );
}
