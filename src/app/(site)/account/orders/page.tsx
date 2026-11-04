import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";
import { LinkButton } from "@/components/ui/Button";
import { OrderRow } from "../OrderRow";

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
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-2xl font-extrabold">All orders</h2>
        <span className="text-sm text-ink-mute">{total} total</span>
      </div>
      {orders.length === 0 ? (
        <div className="mt-6 rounded-2xl border-2 border-dashed border-ink-line p-8 text-center">
          <p className="text-ink-soft">You haven't ordered yet.</p>
          <LinkButton href="/menu" className="mt-4">See the menu</LinkButton>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {orders.map((o) => (
            <OrderRow key={o.id} o={o} />
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
