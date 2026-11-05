import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { addDays, isValidISODate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { expiringLotAlerts, lateDeliveryAlerts, lowStockAlerts, stockDiscrepancyAlerts, stockValuation, unexpectedConsumptionAlerts, type InventoryAlert } from "@/server/inventory";
import { PageHeader, Panel, StatCard } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { pickKitchen } from "@/components/admin/ops/scope";
import { InventoryTabs } from "../_components/InventoryTabs";
import { KitchenSwitch } from "../_components/KitchenSwitch";

export const metadata = { title: "Stock health" };

const TONE = { info: "neutral", warning: "warn", critical: "bad" } as const;

function href(a: InventoryAlert, qs: string) {
  if (a.entity === "PurchaseOrder") return `/admin/inventory/purchases/${a.entityId}`;
  if (a.entity === "StockLot") return `/admin/inventory/lots?${qs}&days=7`;
  return `/admin/inventory/ingredients/${a.entityId}?${qs}`;
}

function AlertList({ title, rows, qs, empty }: { title: string; rows: InventoryAlert[]; qs: string; empty: string }) {
  return (
    <Panel title={`${title} (${rows.length})`}>
      {rows.length ? (
        <ul className="space-y-1.5 text-sm">
          {rows.map((a) => (
            <li key={a.dedupeKey} className="flex items-start justify-between gap-2">
              <Link href={href(a, qs)} className="hover:text-sindoor">{a.message}</Link>
              <Badge tone={TONE[a.severity]}>{a.severity}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-mute">{empty}</p>
      )}
    </Panel>
  );
}

/** Inventory health for one kitchen: the same read functions the alerts center (WP-16) calls. */
export default async function HealthPage({ searchParams }: { searchParams: Promise<{ kitchen?: string; from?: string; to?: string }> }) {
  const user = await requirePermission("inventory.view");
  const sp = await searchParams;
  const { kitchens, kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return null;
  const to = sp.to && isValidISODate(sp.to) ? sp.to : todayKTM();
  const from = sp.from && isValidISODate(sp.from) ? sp.from : addDays(to, -7);
  const k = [kitchen.id];
  const [low, expiring, consumption, discrepancies, late, valuation] = await Promise.all([lowStockAlerts(k), expiringLotAlerts(k, 3), unexpectedConsumptionAlerts(k, from, to), stockDiscrepancyAlerts(k), lateDeliveryAlerts(k), stockValuation(k)]);
  const qs = `kitchen=${kitchen.id}`;
  return (
    <div>
      <PageHeader title="Stock health" description="Low stock, expiry, unexpected consumption, ledger discrepancies and late deliveries for this kitchen." />
      <KitchenSwitch kitchens={kitchens} current={kitchen.id} />
      <InventoryTabs current="health" qs={qs} />
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatCard label="Stock value" value={rs(valuation.total)} sub={`lots ${rs(valuation.rows.reduce((a, r) => a + r.lotValue, 0))} · unlotted ${rs(valuation.rows.reduce((a, r) => a + r.unlottedValue, 0))}`} />
        <StatCard label="Low stock" value={low.length} tone={low.length ? "warn" : "good"} />
        <StatCard label="Expiring / expired" value={expiring.length} tone={expiring.length ? "warn" : "good"} />
        <StatCard label="Late deliveries" value={late.length} tone={late.length ? "warn" : "good"} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <AlertList title="Low stock" rows={low} qs={qs} empty="Everything is above its reorder point." />
        <AlertList title="Expiring lots (≤ 3 days)" rows={expiring} qs={qs} empty="Nothing expiring soon." />
        <div>
          <form className="mb-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="kitchen" value={kitchen.id} />
            <label className="text-xs font-semibold text-ink-mute">From<input type="date" name="from" defaultValue={from} className="field mt-1" /></label>
            <label className="text-xs font-semibold text-ink-mute">To<input type="date" name="to" defaultValue={to} className="field mt-1" /></label>
            <button className="h-[38px] rounded-lg border border-ink-line px-3 text-sm font-semibold">Check</button>
          </form>
          <AlertList title="Unexpected consumption (> 15% over recipe)" rows={consumption} qs={qs} empty="Usage is in line with recipes for this range." />
        </div>
        <AlertList title="Shortages & discrepancies" rows={discrepancies} qs={qs} empty="Ledger and lots agree; no negative stock." />
        <AlertList title="Late supplier deliveries" rows={late} qs={qs} empty="No purchase order is overdue." />
      </div>
    </div>
  );
}
