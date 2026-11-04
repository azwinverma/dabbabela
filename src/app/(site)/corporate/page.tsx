import type { Metadata } from "next";
import Link from "next/link";
import { Check, FileText, Printer } from "lucide-react";
import { db } from "@/lib/db";
import { getSections } from "@/lib/cms";
import { getI18n } from "@/lib/i18n/server";
import { pick } from "@/lib/i18n";
import { rs } from "@/lib/money";
import { PageHero, SectionHeading } from "@/components/site/Section";
import { LinkButton } from "@/components/ui/Button";
import { Rider, Splatter } from "@/components/art/Graffiti";
import { LeadForm } from "./LeadForm";

export const metadata: Metadata = {
  title: "Lunch for teams",
  description: "Daily lunch for offices, shops, schools and project sites in Kathmandu. Company-paid, employee-paid or split billing with one monthly invoice.",
  alternates: { canonical: "/corporate" },
};

export default async function CorporatePage() {
  const { locale } = await getI18n();
  const [c, plans] = await Promise.all([
    getSections(["corporate.intro", "corporate.billing", "corporate.steps"], locale),
    db.mealPlan.findMany({ where: { isActive: true, isCorporate: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const intro = c["corporate.intro"];
  const billing = c["corporate.billing"];
  const steps = c["corporate.steps"];

  return (
    <>
      <PageHero eyebrow={intro.eyebrow} title={intro.title} intro={intro.intro} art={<Rider className="h-40 w-64" />}>
        <div className="mt-7 flex flex-wrap gap-3">
          <LinkButton href="#enquire" size="lg">Get a quote</LinkButton>
          <LinkButton href="/corporate/sample-menu" variant="outline" size="lg">
            <FileText className="h-4 w-4" aria-hidden /> Sample menu
          </LinkButton>
        </div>
      </PageHero>

      <section className="container py-16">
        <SectionHeading title={billing.title} />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {(billing.options as { title: string; text: string }[] | undefined)?.map((o, i) => (
            <div key={o.title} className="card p-6">
              <p className="font-display text-4xl font-extrabold text-besar-dark" aria-hidden>{String.fromCharCode(65 + i)}</p>
              <h3 className="mt-2 font-display text-xl font-bold">{o.title}</h3>
              <p className="mt-2 text-ink-soft">{o.text}</p>
            </div>
          ))}
        </div>
        <ul className="mt-8 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {["One monthly invoice with PAN/VAT details", "Admins see orders, spend and staff in one portal", "Each person picks their own dabba, veg or non-veg", "Delivered together to one hand-off point"].map((x) => (
            <li key={x} className="flex gap-2 rounded-xl bg-paper-card px-3 py-2.5">
              <Check className="h-4 w-4 shrink-0 text-saag" aria-hidden /> {x}
            </li>
          ))}
        </ul>
      </section>

      <section className="wall relative overflow-hidden text-paper">
        <Splatter className="absolute -left-10 bottom-0 h-56 w-56 opacity-25" seed={2} />
        <div className="container relative py-16">
          <SectionHeading title={steps.title} light />
          <ol className="mt-10 grid gap-6 md:grid-cols-4">
            {(steps.steps as { title: string; text: string }[] | undefined)?.map((s, i) => (
              <li key={s.title}>
                <span className="font-marker text-3xl text-besar">{i + 1}</span>
                <h3 className="mt-1 font-display text-lg font-bold">{s.title}</h3>
                <p className="mt-1 text-sm text-paper/80">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {plans.length > 0 && (
        <section className="container py-16">
          <SectionHeading title="Team plans" intro="Indicative pricing — the final rate depends on headcount, days and location, and is written into your agreement." />
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {plans.map((p) => (
              <div key={p.id} className="card p-6">
                <h3 className="font-display text-xl font-bold">{pick(p, "name", locale)}</h3>
                {p.tagline && <p className="mt-1 text-sm text-ink-soft">{p.tagline}</p>}
                <p className="mt-4 font-display text-3xl font-extrabold text-sindoor">
                  from {rs(p.pricePerMeal)} <span className="text-sm font-semibold text-ink-mute">per lunch</span>
                </p>
                <ul className="mt-4 space-y-1.5 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="h-4 w-4 shrink-0 text-saag" aria-hidden /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section id="enquire" className="container scroll-mt-24 py-16">
        <div className="grid gap-10 rounded-3xl border-2 border-ink bg-paper-card p-6 shadow-sticker md:grid-cols-[1fr_1.4fr] md:p-10">
          <div>
            <h2 className="font-display text-3xl font-extrabold">Tell us about your team</h2>
            <p className="mt-3 text-ink-soft">We'll call within one working day to talk through menus, delivery and billing, and set up a tasting if you'd like one.</p>
            <p className="mt-6 text-sm text-ink-soft">
              Already set up? Staff join with your company code when they{" "}
              <Link href="/register" className="font-semibold text-sindoor underline underline-offset-2">sign up</Link>. Team admins manage everything from the{" "}
              <Link href="/team" className="font-semibold text-sindoor underline underline-offset-2">team portal</Link>.
            </p>
            <Link href="/corporate/sample-menu" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold underline underline-offset-2">
              <Printer className="h-4 w-4" aria-hidden /> Print a sample menu for your team
            </Link>
          </div>
          <LeadForm />
        </div>
      </section>
    </>
  );
}
