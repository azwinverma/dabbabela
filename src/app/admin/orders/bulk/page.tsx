import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { formatDay, weekdayOf } from "@/lib/dates";
import { rs } from "@/lib/money";
import { PageHeader, Panel, Callout } from "@/components/admin/ui";
import { Field } from "@/components/admin/Filters";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { kitchenWhere } from "@/components/admin/ops/scope";
import { orderableDates } from "@/server/calendar";
import { getOffersForDates } from "@/server/menu";
import { defaultKitchenId } from "@/server/orders";
import { one, type SearchParamsRecord } from "../../_kit/params";
import { bulkOrderAction } from "../actions";

export const metadata = { title: "Corporate bulk order" };
const BASE = "/admin/orders/bulk";

/** Staff bulk order for a company: one order per ticked employee for one day, each with the company split. */
export default async function BulkOrderPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requirePermission("orders.create");
  const sp = await searchParams;
  const settings = await getSettings();
  const companies = await db.company.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, billingMode: true, subsidyPct: true, zone: { select: { kitchenId: true } } } });
  const company = companies.find((c) => c.id === one(sp, "company")) ?? null;
  const kitchenId = company?.zone?.kitchenId ?? (await defaultKitchenId());
  const dates = await orderableDates(settings, 14, kitchenId);
  const date = one(sp, "date") && dates.includes(one(sp, "date")!) ? one(sp, "date")! : dates[0];
  const [members, offer, slots] = await Promise.all([
    company
      ? db.companyMember.findMany({ where: { companyId: company.id, status: "ACTIVE" }, include: { user: { select: { name: true } }, officeLocation: { select: { name: true } } }, orderBy: [{ department: "asc" }, { user: { name: "asc" } }] })
      : Promise.resolve([]),
    date ? getOffersForDates([date], kitchenId).then((m) => m.get(date)) : Promise.resolve(undefined),
    db.deliverySlot.findMany({ where: { isActive: true, ...kitchenWhere(user) }, orderBy: [{ kitchenId: "asc" }, { sortOrder: "asc" }], select: { id: true, label: true, kitchen: { select: { name: true } } } }),
  ]);
  const menu = offer && !offer.closed ? offer.items.filter((i) => !i.soldOut) : [];
  const day = date ? weekdayOf(date) : null;

  return (
    <div className="max-w-5xl">
      <PageHeader
        back={{ href: "/admin/orders", label: "Orders" }}
        title="Corporate bulk order"
        description="One order per employee for one day. Each order carries the company's split, allowance and negotiated prices; the company's part is invoiced, the employee's part is collected as chosen."
      />
      <Panel title="Company and day" className="mb-5">
        <form method="get" action={BASE} className="flex flex-wrap items-end gap-2">
          <Field label="Company" htmlFor="company">
            <select id="company" name="company" defaultValue={company?.id ?? ""} className="field w-auto">
              <option value="">Pick…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Day" htmlFor="date">
            <select id="date" name="date" defaultValue={date} className="field w-auto">
              {dates.map((d) => (
                <option key={d} value={d}>
                  {formatDay(d, "full")}
                </option>
              ))}
            </select>
          </Field>
          <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Load</button>
        </form>
        {company && (
          <p className="mt-2 text-xs text-ink-mute">
            Billing: {company.billingMode.replace(/_/g, " ").toLowerCase()}
            {company.billingMode === "SPLIT" ? ` (${company.subsidyPct}% company)` : ""}
          </p>
        )}
      </Panel>

      {company && date && (
        <Panel title={`Employees · ${formatDay(date, "full")}`}>
          {!menu.length ? (
            <Callout tone="warn">Nothing is on the menu for that day.</Callout>
          ) : !members.length ? (
            <Callout tone="info">This company has no active employees.</Callout>
          ) : (
            <ActionForm action={bulkOrderAction} className="space-y-4">
              <input type="hidden" name="companyId" value={company.id} />
              <input type="hidden" name="date" value={date} />
              {/* Deterministic per company-day: re-submitting after a reload replays instead of duplicating. */}
              <input type="hidden" name="idempotencyKey" value={`${company.id}:${date}`} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Default dabba" htmlFor="boxId">
                  <select id="boxId" name="boxId" className="field" defaultValue={menu[0].box.id}>
                    {menu.map((i) => (
                      <option key={i.box.id} value={i.box.id}>
                        {i.box.name} ({rs(i.price)} list)
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Delivery window" htmlFor="slotId">
                  <select id="slotId" name="slotId" className="field" defaultValue="">
                    <option value="">Office default / any</option>
                    {slots.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label} · {s.kitchen.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Employee share paid by" htmlFor="memberMethod">
                  <select id="memberMethod" name="memberMethod" className="field" defaultValue="CASH">
                    <option value="CASH">Cash at hand-off</option>
                    <option value="WALLET">Employee wallet credit</option>
                  </select>
                </Field>
              </div>
              <div className="overflow-x-auto rounded-xl border border-ink-line/80">
                <table className="w-full min-w-[640px] text-sm">
                  <caption className="sr-only">Employees</caption>
                  <thead>
                    <tr className="bg-paper/60 text-left text-[11px] font-bold uppercase tracking-wide text-ink-mute">
                      <th scope="col" className="px-3 py-2">Order</th>
                      <th scope="col" className="px-3 py-2">Employee</th>
                      <th scope="col" className="px-3 py-2">Dabba</th>
                      <th scope="col" className="px-3 py-2">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => {
                      const eligible = m.mealEligible && (!m.eligibleDays.length || (day && m.eligibleDays.includes(day)));
                      return (
                        <tr key={m.id} className="border-t border-ink-line/40">
                          <td className="px-3 py-2">
                            <input type="checkbox" name="member" value={m.id} defaultChecked={Boolean(eligible)} disabled={!eligible} className="h-4 w-4 accent-sindoor" aria-label={`Order for ${m.user.name}`} />
                          </td>
                          <td className="px-3 py-2">
                            <b>{m.user.name}</b>
                            <span className="block text-xs text-ink-mute">{[m.department, m.officeLocation?.name, !eligible ? "not eligible this day" : null].filter(Boolean).join(" · ")}</span>
                          </td>
                          <td className="px-3 py-2">
                            <select name={`box:${m.id}`} defaultValue="" className="field w-auto" aria-label={`Dabba for ${m.user.name}`}>
                              <option value="">Default</option>
                              {menu.map((i) => (
                                <option key={i.box.id} value={i.box.id}>
                                  {i.box.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input type="number" name={`qty:${m.id}`} min={1} max={25} defaultValue={1} className="field w-20" aria-label={`Quantity for ${m.user.name}`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Field label="Note for the kitchen / rider" htmlFor="notes">
                <input id="notes" name="notes" className="field" maxLength={500} />
              </Field>
              <SubmitButton variant="dark" size="sm" pendingText="Placing orders…" confirm="Place an order for every ticked employee?">
                Place orders
              </SubmitButton>
              <p className="text-xs text-ink-mute">Re-submitting the same choices for the same day never duplicates an employee&apos;s order (add extra dabbas from the order page). Each order is priced and capacity-checked on the server.</p>
            </ActionForm>
          )}
        </Panel>
      )}
    </div>
  );
}
