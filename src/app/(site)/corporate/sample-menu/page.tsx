import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings";
import { addDays, formatDay, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { getPublicWeek, resolveWeek } from "@/lib/public";
import { DIET_LABEL } from "@/lib/labels";
import { Logo } from "@/components/brand/Logo";
import { PrintButton } from "./PrintButton";

export const metadata: Metadata = { title: "Sample team menu", robots: { index: false } };

/** Printable / save-as-PDF sample menu built from the live published weeks. */
export default async function SampleMenuPage() {
  const { locale, t } = await getI18n();
  const s = await getSettings();
  const start = resolveWeek(todayKTM());
  const weeks = await Promise.all([getPublicWeek(start, locale), getPublicWeek(addDays(start, 7), locale)]);

  return (
    <div className="container max-w-4xl py-10 print:max-w-none print:py-0">
      <div className="no-print mb-6 flex items-center justify-between gap-4">
        <p className="text-sm text-ink-soft">Use your browser's print dialog to save this as a PDF.</p>
        <PrintButton />
      </div>
      <div className="rounded-2xl border-2 border-ink bg-white p-8 print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-6 border-b-2 border-ink pb-4">
          <Logo />
          <div className="text-right text-sm">
            <p className="font-display text-lg font-bold">Sample team menu</p>
            <p className="text-ink-mute">Prepared {formatDay(todayKTM(), "long")}</p>
          </div>
        </header>
        {weeks.map((w) => (
          <section key={w.weekStart} className="mt-6 break-inside-avoid">
            <h2 className="font-display text-xl font-extrabold">
              {t.menu.weekOf} {formatDay(w.weekStart)} – {formatDay(addDays(w.weekStart, 6))}
            </h2>
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink/30 text-xs uppercase tracking-wider text-ink-mute">
                  <th className="py-2 pr-3">Day</th>
                  <th className="py-2 pr-3">Dabbas</th>
                  <th className="py-2">Price</th>
                </tr>
              </thead>
              <tbody>
                {w.days.map((d) => (
                  <tr key={d.date} className="border-b border-ink/10 align-top">
                    <td className="py-2 pr-3 font-semibold">{t.days[d.day]}</td>
                    <td className="py-2 pr-3">
                      {d.closed ? (
                        <span className="text-ink-mute">{d.closure ?? t.common.closed}</span>
                      ) : (
                        d.items.map((i) => (
                          <p key={i.box.id}>
                            <span className="font-semibold">{i.box.name}</span> — {i.box.items.map((x) => x.name).join(", ")}{" "}
                            <span className="text-ink-mute">({DIET_LABEL[i.box.diet].short})</span>
                          </p>
                        ))
                      )}
                    </td>
                    <td className="py-2">{d.items.map((i) => <p key={i.box.id}>{rs(i.box.price)}</p>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        <footer className="mt-8 border-t-2 border-ink pt-4 text-xs leading-relaxed text-ink-soft">
          <p>Menus rotate weekly and may change. Team pricing depends on headcount and days; ask us for a quote. {t.site.sharedKitchen}</p>
          <p className="mt-2">
            {s.brandName}
            {s.phone ? ` · ${s.phone}` : ""}
            {s.email ? ` · ${s.email}` : ""}
          </p>
        </footer>
      </div>
    </div>
  );
}
