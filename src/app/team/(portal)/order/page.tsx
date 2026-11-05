import { requireCompanyAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { rs } from "@/lib/money";
import { formatDay } from "@/lib/dates";
import { orderableDates } from "@/server/calendar";
import { boxFacts } from "@/server/menu";
import { eligibilityProblem } from "@/server/corporate";
import { teamMenu, teamBudgets } from "@/server/team";
import { DIET_LABEL } from "@/lib/labels";
import { Panel } from "@/components/admin/ui";
import { Empty } from "@/components/admin/finance/kit";
import { TeamOrderForm } from "../TeamForms";

export const metadata = { title: "Order for the team" };

export default async function TeamOrder({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { company } = await requireCompanyAdmin();
  const settings = await getSettings();
  const dates = await orderableDates({ ...settings, orderCutoff: company.cutoffOverride || settings.orderCutoff }, 12);
  const sp = await searchParams;
  const date = sp.date && dates.includes(sp.date) ? sp.date : dates[0];
  const [menu, members, slots, budgets] = await Promise.all([
    date ? teamMenu(company.id, date) : Promise.resolve(null),
    db.companyMember.findMany({ where: { companyId: company.id, status: "ACTIVE" }, include: { user: { select: { name: true } }, officeLocation: { select: { name: true } } }, orderBy: { user: { name: "asc" } } }),
    db.deliverySlot.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true } }),
    date ? teamBudgets(company.id, date.slice(0, 7)) : Promise.resolve([]),
  ]);
  const boxes = (menu?.items ?? [])
    .filter((i) => !i.soldOut)
    .map((i) => {
      const f = boxFacts(i.box as Parameters<typeof boxFacts>[0]);
      const price = i.price !== i.listPrice ? `${rs(i.price)} (your price; menu ${rs(i.listPrice)})` : rs(i.price);
      return { id: i.box.id, name: i.box.name, label: `${price} · ${DIET_LABEL[f.diet].label}${i.box.tagline ? ` · ${i.box.tagline}` : ""}` };
    });
  const budgeted = budgets.filter((b) => b.budget != null);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl font-bold">Order for the team</h1>
        <p className="text-sm text-ink-mute">
          One dabba per person, each on their own order so the company/staff split and allowance apply per person. Staff shares (if any) are paid in cash at hand-off. Orders close at {company.cutoffOverride || settings.orderCutoff} on the day.
        </p>
      </div>
      {!dates.length ? (
        <Empty>No delivery days are open for ordering right now.</Empty>
      ) : (
        <>
          <form className="flex flex-wrap gap-1.5" aria-label="Delivery date">
            {dates.map((d) => (
              <button key={d} name="date" value={d} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${d === date ? "border-ink bg-ink text-paper" : "border-ink-line bg-white hover:border-ink"}`}>
                {formatDay(d)}
              </button>
            ))}
          </form>
          <Panel title={`Lunch for ${formatDay(date!, "full")}`}>
            {!boxes.length ? (
              <Empty>{menu?.closed ? "The kitchen is closed that day." : menu?.limited ? "Nothing from your company menu is on that day." : "Nothing left on the menu that day."}</Empty>
            ) : !members.length ? (
              <Empty>Approve or invite people first.</Empty>
            ) : (
              <TeamOrderForm key={date} date={date!} boxes={boxes} slots={slots} members={members.map((m) => ({ id: m.id, name: m.user.name, department: m.department, office: m.officeLocation?.name ?? null, ineligible: eligibilityProblem(m, date!) }))} />
            )}
          </Panel>
          {budgeted.length > 0 && (
            <Panel title={`Department budgets · ${date!.slice(0, 7)}`}>
              <ul className="grid gap-1 text-sm sm:grid-cols-2">
                {budgeted.map((b) => (
                  <li key={b.department} className={b.over || (b.remaining ?? 0) <= 0 ? "font-semibold text-sindoor" : ""}>
                    {b.department}: {rs(Math.max(0, b.remaining ?? 0))} left of {rs(b.budget)}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
