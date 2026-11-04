import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { dateOnly, formatDay, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function RiderHome() {
  const user = await requirePermission("rider");
  const today = todayKTM();
  const routes = await db.deliveryRoute.findMany({
    where: { date: dateOnly(today), ...(user.role === "DELIVERY_AGENT" ? { riderId: user.id } : user.kitchenId ? { kitchenId: user.kitchenId } : {}) },
    include: { slot: { select: { label: true } }, rider: { select: { name: true } }, assignments: { include: { order: { select: { status: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return (
    <div>
      <h1 className="font-display text-2xl font-extrabold">Today&apos;s routes</h1>
      <p className="mb-5 text-sm text-ink-mute">{formatDay(today, "full")}</p>
      <ul className="space-y-3">
        {routes.map((r) => {
          const done = r.assignments.filter((a) => ["DELIVERED", "FAILED_DELIVERY", "CANCELLED"].includes(a.order.status)).length;
          return (
            <li key={r.id}>
              <Link href={`/rider/route/${r.id}`} className="block rounded-2xl border-2 border-ink bg-white p-4 shadow-sticker active:translate-y-0.5 active:shadow-none">
                <div className="flex items-center justify-between">
                  <span className="font-display text-xl font-bold">{r.name}</span>
                  <span className="rounded-full bg-ink px-3 py-1 text-xs font-bold uppercase text-paper">{r.status === "PLANNED" ? "waiting" : r.status.toLowerCase()}</span>
                </div>
                <p className="mt-1 text-sm text-ink-mute">
                  {r.slot?.label ?? "Any slot"} · {done}/{r.assignments.length} stops done{user.role !== "DELIVERY_AGENT" ? ` · ${r.rider?.name ?? "no rider"}` : ""}
                </p>
                {r.cashCollected > 0 && <p className="mt-1 text-sm font-semibold">Cash on you: {rs(r.cashCollected)}</p>}
              </Link>
            </li>
          );
        })}
      </ul>
      {!routes.length && <p className="rounded-2xl border-2 border-dashed border-ink-line p-8 text-center text-ink-mute">No routes for you today yet. Dispatch will assign one.</p>}
    </div>
  );
}
