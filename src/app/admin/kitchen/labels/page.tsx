import QRCode from "qrcode";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { dateOnly, formatDay, isoDate } from "@/lib/dates";
import { DIET_LABEL } from "@/lib/labels";
import { allergenWarning, KITCHEN_STATUSES } from "@/server/kitchen";
import { PageHeader } from "@/components/admin/ui";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { PrintButton } from "@/components/admin/ops/PrintButton";
import { pickDate, pickKitchen } from "@/components/admin/ops/scope";
import { markPrintedAction } from "../actions";

export const metadata = { title: "Dabba labels" };

/** First name + initial only on the label (privacy at a reception desk). */
function alias(name: string) {
  const [first, ...rest] = name.trim().split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first;
}

export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ kitchen?: string; date?: string; order?: string; slot?: string }> }) {
  const user = await requirePermission("kitchen.view");
  const sp = await searchParams;
  const { kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return null;
  const date = pickDate(sp.date);
  const orders = await db.order.findMany({
    where: sp.order ? { id: sp.order, ...(user.kitchenId ? { kitchenId: user.kitchenId } : {}) } : { kitchenId: kitchen.id, deliveryDate: dateOnly(date), status: { in: KITCHEN_STATUSES }, ...(sp.slot ? { slotLabel: sp.slot } : {}) },
    include: { items: true, user: { select: { name: true } } },
    orderBy: [{ slotLabel: "asc" }, { area: "asc" }, { placeName: "asc" }],
  });
  const labels = await Promise.all(
    orders.flatMap((o) =>
      o.items.flatMap((it) =>
        Array.from({ length: it.quantity }, async (_, n) => ({
          key: `${it.id}-${n}`,
          o,
          it,
          n: n + 1,
          qr: await QRCode.toString(`DB:${o.number}:${o.code}`, { type: "svg", margin: 0, errorCorrectionLevel: "M" }),
          warn: allergenWarning({ allergenNote: o.allergenNote, items: [it] }),
        })),
      ),
    ),
  );
  return (
    <div>
      <PageHeader
        back={{ href: `/admin/kitchen?kitchen=${kitchen.id}&date=${date}`, label: "Kitchen" }}
        title="Dabba labels"
        description={`${labels.length} labels · A4, 3 × 7 grid. Print at 100% scale.`}
        actions={
          <>
            <PrintButton />
            {orders.length > 0 && <ConfirmAction action={markPrintedAction.bind(null, orders.map((o) => o.id))} label="Mark printed" />}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3 print:gap-0">
        {labels.map(({ key, o, it, n, qr, warn }) => (
          <article key={key} className="flex h-[38mm] break-inside-avoid gap-2 overflow-hidden rounded-lg border-2 border-ink bg-white p-2 text-[11px] leading-tight print:rounded-none print:border">
            <div className="flex w-[22mm] shrink-0 flex-col items-center">
              <div className="h-[20mm] w-[20mm]" dangerouslySetInnerHTML={{ __html: qr }} />
              <p className="mt-1 font-mono text-sm font-extrabold">#{o.code}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-extrabold">{alias(o.user.name)}</p>
              <p className="truncate">{o.placeName ?? o.addressLine}</p>
              <p className="truncate text-ink-mute">{o.area} · {o.slotLabel ?? "any slot"} · {formatDay(isoDate(o.deliveryDate))}</p>
              <p className="mt-0.5 truncate font-semibold">
                {it.name} {it.quantity > 1 ? `(${n}/${it.quantity})` : ""} · <span className={DIET_LABEL[it.diet].veg ? "text-saag-dark" : "text-sindoor"}>{DIET_LABEL[it.diet].short.toUpperCase()}</span>
              </p>
              {(warn.customerNote || warn.contains.length > 0) && (
                <p className="mt-0.5 rounded bg-ink px-1 py-0.5 font-bold text-white">
                  {warn.customerNote ? `⚠ ${warn.customerNote}` : `Contains: ${warn.contains.join(", ").toLowerCase()}`}
                </p>
              )}
              <p className="mt-0.5 text-[9px] text-ink-mute">Shared kitchen: may contain traces of other allergens.</p>
            </div>
          </article>
        ))}
        {!labels.length && <p className="text-sm text-ink-mute">No labels for this selection.</p>}
      </div>
    </div>
  );
}
