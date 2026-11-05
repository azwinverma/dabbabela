import Link from "next/link";
import { db } from "@/lib/db";
import { addDays, todayKTM } from "@/lib/dates";
import { DIET_LABEL, ORDER_PAYMENT_STATUS, ORDER_STATUS } from "@/lib/labels";
import { DIETS, NONE, ORDER_PAYMENT_STATUSES, ORDER_STATUSES, qs, userScope, type AnalyticsFilters, type Scoped } from "@/server/analytics/filters";

/** Options for the global filter bar, limited to the staff member's kitchen scope. */
export async function filterOptions(user: Scoped) {
  const scope = userScope(user);
  const [kitchens, zones, companies, plans] = await Promise.all([
    db.kitchen.findMany({ where: { isActive: true, ...(scope ? { id: { in: scope } } : {}) }, orderBy: { createdAt: "asc" }, select: { id: true, name: true } }),
    db.deliveryZone.findMany({ where: scope ? { kitchenId: { in: scope } } : {}, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.mealPlan.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  return { kitchens, zones, companies, plans };
}
export type FilterOptions = Awaited<ReturnType<typeof filterOptions>>;

const Sel = ({ name, label, value, children }: { name: string; label: string; value?: string; children: React.ReactNode }) => (
  <label className="text-xs font-semibold text-ink-soft">
    {label}
    <select name={name} defaultValue={value ?? ""} className="field mt-1 w-40">
      {children}
    </select>
  </label>
);

/** GET form carrying every global filter. `hidden` keeps extra params (e.g. the drill-down basis). */
export function AnalyticsFilterBar({ f, opts, action, hidden = {}, compact = false }: { f: AnalyticsFilters; opts: FilterOptions; action: string; hidden?: Record<string, string | undefined>; compact?: boolean }) {
  const today = todayKTM();
  const kitchen = f.kitchenIds?.length === 1 ? f.kitchenIds[0] : "";
  const presets = [
    ["Today", today, today],
    ["7 days", addDays(today, -6), today],
    ["30 days", addDays(today, -29), today],
    ["Month to date", `${today.slice(0, 7)}-01`, today],
    ["Year to date", `${today.slice(0, 4)}-01-01`, today],
  ] as const;
  const active = [f.zoneId, f.companyId, f.customerType, f.diet, f.planId, f.paymentStatus, f.orderStatus, f.categoryId, f.channel, f.method].filter(Boolean).length;
  return (
    <form action={action} className="mb-5 rounded-xl border border-ink-line/80 bg-white p-3 shadow-card print:hidden">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {f.categoryId && <input type="hidden" name="category" value={f.categoryId} />}
      {f.channel && <input type="hidden" name="channel" value={f.channel} />}
      {f.method && <input type="hidden" name="method" value={f.method} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-ink-soft">
          From
          <input type="date" name="from" defaultValue={f.from} className="field mt-1 w-40" />
        </label>
        <label className="text-xs font-semibold text-ink-soft">
          To
          <input type="date" name="to" defaultValue={f.to} className="field mt-1 w-40" />
        </label>
        {opts.kitchens.length > 1 && (
          <Sel name="kitchen" label="Kitchen" value={kitchen}>
            <option value="">All my kitchens</option>
            {opts.kitchens.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </Sel>
        )}
        {!compact && (
          <>
            <Sel name="zone" label="Zone" value={f.zoneId}>
              <option value="">All zones</option>
              {opts.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
              <option value={NONE}>No zone recorded</option>
            </Sel>
            <Sel name="ctype" label="Customer type" value={f.customerType}>
              <option value="">Everyone</option>
              <option value="INDIVIDUAL">Individual</option>
              <option value="CORPORATE">Corporate (company)</option>
            </Sel>
            <Sel name="company" label="Company" value={f.companyId}>
              <option value="">All companies</option>
              {opts.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NONE}>Individual customers</option>
            </Sel>
            <Sel name="diet" label="Meal type" value={f.diet}>
              <option value="">Any</option>
              {DIETS.map((d) => (
                <option key={d} value={d}>
                  {DIET_LABEL[d].label}
                </option>
              ))}
            </Sel>
            <Sel name="plan" label="Plan" value={f.planId}>
              <option value="">Plans and single orders</option>
              <option value={NONE}>Single orders only</option>
              {opts.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Sel>
            <Sel name="pay" label="Payment status" value={f.paymentStatus}>
              <option value="">Any</option>
              {ORDER_PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ORDER_PAYMENT_STATUS[s].label}
                </option>
              ))}
            </Sel>
            <Sel name="status" label="Order status" value={f.orderStatus}>
              <option value="">Any</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ORDER_STATUS[s].label}
                </option>
              ))}
            </Sel>
          </>
        )}
        <button className="h-[38px] rounded-lg bg-ink px-4 text-sm font-semibold text-paper">Apply</button>
        {active > 0 && (
          <Link href={`${action}?${qs({ from: f.from, to: f.to, kitchenIds: kitchen ? [kitchen] : null }, hidden)}`} className="h-[38px] rounded-lg border border-ink-line px-3 py-2 text-sm font-semibold text-ink-soft hover:border-ink">
            Clear {active} filter{active > 1 ? "s" : ""}
          </Link>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-xs">
        {presets.map(([l, from, to]) => (
          <Link key={l} href={`${action}?${qs({ ...f, from, to }, hidden)}`} className="rounded-full border border-ink-line bg-white px-2.5 py-1 font-semibold text-ink-soft hover:border-ink">
            {l}
          </Link>
        ))}
      </div>
    </form>
  );
}
