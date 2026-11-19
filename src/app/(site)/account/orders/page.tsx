import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/ui/Button";
import { getSettings } from "@/lib/settings";
import { format } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { accountDict } from "@/lib/i18n/account";
import { dashboardDict } from "@/lib/i18n/dashboard";
import { hasCustomerAction, mealWindows } from "@/server/customer-dashboard";
import { OrderRow } from "../OrderRow";
import { MealActions } from "../MealActions";

const PAGE = 20;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/account/orders");
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const where = { userId: user.id };
  const [orders, total] = await Promise.all([
    db.order.findMany({ where, include: { items: { select: { name: true, quantity: true } } }, orderBy: [{ deliveryDate: "desc" }, { createdAt: "desc" }], skip: (page - 1) * PAGE, take: PAGE }),
    db.order.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);
  const t = accountDict(locale).account;
  const d = dashboardDict(locale);
  // Per-day cut-off (menu day + company override, else global), same rule as the skip/cancel actions.
  const windows = await mealWindows(orders, settings);
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-2xl font-extrabold">All orders</h2>
        <span className="flex flex-wrap items-center gap-3 text-sm text-ink-mute">
          <Link href="/account/orders/calendar" className="font-semibold text-sindoor underline underline-offset-2">{d.home.calendar}</Link>
          <Link href="/account/payments" className="font-semibold text-sindoor underline underline-offset-2">{d.home.payments}</Link>
          <span>{total} total</span>
        </span>
      </div>
      {orders.length === 0 ? (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-ink-line p-8 text-center">
          <p className="text-ink-soft">You haven't ordered yet.</p>
          <LinkButton href="/menu" className="mt-4">See the menu</LinkButton>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {orders.map((o) => (
            <OrderRow
              key={o.id}
              o={o}
              actions={
                windows.get(o.id)?.open && hasCustomerAction(o) ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <MealActions orderId={o.id} kind={o.source === "SUBSCRIPTION" ? "plan" : "single"} status={o.status} open credited={o.paymentStatus === "REFUNDED"} labels={t} />
                    <span className="text-xs text-ink-mute">{format(d.home.changesUntil, { time: windows.get(o.id)!.cutoff })}</span>
                  </div>
                ) : undefined
              }
            />
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav className="mt-6 flex flex-wrap gap-2" aria-label="Pages">
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <Link key={p} href={`/account/orders?page=${p}`} aria-current={p === page ? "page" : undefined} className={cn("rounded-lg border-2 px-3 py-1 text-sm font-bold", p === page ? "border-ink bg-ink text-paper" : "border-ink-line")}>
              {p}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
