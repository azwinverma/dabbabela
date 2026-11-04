import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatDay } from "@/lib/dates";
import { bomNeed, forecast, round3 } from "@/server/kitchen";
import { PageHeader } from "@/components/admin/ui";
import { PrintButton } from "@/components/admin/ops/PrintButton";
import { pickDate, pickKitchen } from "@/components/admin/ops/scope";

export const metadata = { title: "Prep sheets" };

export default async function PrepPage({ searchParams }: { searchParams: Promise<{ kitchen?: string; date?: string; buffer?: string }> }) {
  const user = await requirePermission("kitchen");
  const sp = await searchParams;
  const { kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return null;
  const date = pickDate(sp.date);
  const buffer = Math.max(0, Math.min(30, parseInt(sp.buffer ?? "5", 10) || 0));
  const f = await forecast(kitchen.id, date, buffer);
  const recipes = await db.recipe.findMany({
    where: { menuItemId: { in: f.dishes.map((d) => d.menuItemId) } },
    include: { currentVersion: { include: { ingredients: { include: { ingredient: true } } } } },
  });
  const rby = new Map(recipes.map((r) => [r.menuItemId, r.currentVersion]));
  const stations = [...new Set(f.dishes.map((d) => d.station))];
  return (
    <div>
      <PageHeader back={{ href: `/admin/kitchen?kitchen=${kitchen.id}&date=${date}`, label: "Kitchen" }} title="Station prep sheets" description={`${kitchen.name} · ${formatDay(date, "full")} · ${f.meals} meals · ${buffer}% buffer`} actions={<PrintButton />} />
      <div className="grid gap-5 md:grid-cols-2 print:block">
        {stations.map((st) => (
          <section key={st} className="break-inside-avoid rounded-xl border-2 border-ink bg-white p-4 print:mb-4 print:break-after-page">
            <h2 className="font-display text-xl font-extrabold">{st}</h2>
            <p className="mb-3 text-xs text-ink-mute">{formatDay(date, "full")} · {kitchen.name}</p>
            {f.dishes
              .filter((d) => d.station === st)
              .map((d) => {
                const v = rby.get(d.menuItemId);
                const qty = v ? bomNeed(v.ingredients, v.yieldPortions, d.total) : [];
                return (
                  <div key={d.menuItemId} className="mb-4 border-t border-ink-line pt-3 first:border-0 first:pt-0">
                    <p className="flex justify-between text-base font-bold">
                      <span>{d.name}</span>
                      <span className="tabular-nums">{d.total} portions</span>
                    </p>
                    {v ? (
                      <table className="mt-1 w-full text-sm">
                        <tbody>
                          {v.ingredients.map((l, i) => (
                            <tr key={l.id} className="border-b border-ink-line/40">
                              <td className="py-1">{l.ingredient.name}</td>
                              <td className="py-1 text-right tabular-nums">
                                {round3(qty[i])} {l.ingredient.unit.toLowerCase()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-xs font-semibold text-sindoor">No costed recipe — add one under Dishes & recipes.</p>
                    )}
                    {v?.method && <p className="mt-1 whitespace-pre-line text-xs text-ink-soft">{v.method}</p>}
                    {v && <p className="mt-1 text-[11px] text-ink-mute">Recipe v{v.version} (yield {v.yieldPortions}) · gross quantities incl. trim waste</p>}
                  </div>
                );
              })}
          </section>
        ))}
        {!stations.length && <p className="text-sm text-ink-mute">Nothing to prep for this day.</p>}
      </div>
    </div>
  );
}
