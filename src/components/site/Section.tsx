import { Scribble } from "@/components/art/Graffiti";
import { cn } from "@/lib/utils";

export function SectionHeading({
  eyebrow,
  title,
  intro,
  align = "left",
  light,
  className,
  as: Tag = "h2",
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  align?: "left" | "center";
  light?: boolean;
  className?: string;
  as?: "h1" | "h2";
}) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && <p className={cn("text-sm font-bold uppercase tracking-[0.14em]", light ? "text-besar" : "text-sindoor")}>{eyebrow}</p>}
      <Tag className={cn("mt-2 text-3xl font-extrabold leading-[1.05] md:text-[2.5rem]", light ? "text-paper" : "text-ink")}>{title}</Tag>
      <Scribble className={cn("mt-2 h-3 w-36", align === "center" && "mx-auto")} />
      {intro && <p className={cn("mt-4 text-[1.05rem] leading-relaxed", light ? "text-paper/80" : "text-ink-soft")}>{intro}</p>}
    </div>
  );
}

export function PageHero({ eyebrow, title, intro, children, art }: { eyebrow?: string; title: string; intro?: string; children?: React.ReactNode; art?: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b-2 border-ink">
      <div className="container relative grid gap-8 py-12 md:grid-cols-[1fr_auto] md:items-end md:py-16">
        <div>
          {eyebrow && <p className="text-sm font-bold uppercase tracking-[0.14em] text-sindoor">{eyebrow}</p>}
          <h1 className="mt-3 max-w-3xl text-4xl font-extrabold leading-[1.03] md:text-[3.4rem]">{title}</h1>
          {intro && <p className="mt-4 max-w-2xl text-lg leading-relaxed text-ink-soft">{intro}</p>}
          {children}
        </div>
        {art && <div aria-hidden className="hidden md:block">{art}</div>}
      </div>
    </section>
  );
}

/** Friendly empty state used across public pages. */
export function EmptyState({ title, text, children }: { title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-ink/25 bg-paper-card/60 px-6 py-10 text-center">
      <p className="font-display text-xl font-bold">{title}</p>
      {text && <p className="mx-auto mt-2 max-w-md text-ink-soft">{text}</p>}
      {children && <div className="mt-5 flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  );
}
