import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { DayPicker } from "@/components/admin/ops/DayPicker";
import { dateOnly, formatDay, formatStamp } from "@/lib/dates";
import { DIET_LABEL } from "@/lib/labels";
import { KITCHEN_STATUSES } from "@/server/kitchen";
import { PageHeader } from "@/components/admin/ui";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { PrintButton } from "@/components/admin/ops/PrintButton";
import { pickDate, pickKitchen } from "@/components/admin/ops/scope";
import { markPrintedAction } from "../actions";

export const metadata = { title: "Kitchen tickets" };

type Comp = { name: string; qty: number; substitutedFrom?: string };

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ kitchen?: string; date?: string; slot?: string; show?: string }> }) {
  const user = await requirePermission("kitchen.view");
  const sp = await searchParams;
  const { kitchens, kitchen } = await pickKitchen(user, sp.kitchen);
  if (!kitchen) return null;
  const date = pickDate(sp.date);
  const all = await db.order.findMany({
    where: { kitchenId: kitchen.id, deliveryDate: dateOnly(date), status: { in: KITCHEN_STATUSES } },
    include: { items: { include: { customizations: true } }, ticket: true },
    orderBy: [{ slotLabel: "asc" }, { area: "asc" }],
  });
  const slots = [...new Set(all.map((o) => o.slotLabel ?? "Any time"))];
  const slot = sp.slot && slots.includes(sp.slot) ? sp.slot : "";
  const unprintedOnly = sp.show === "unprinted";
  const orders = all.filter((o) => (!slot || (o.slotLabel ?? "Any time") === slot) && (!unprintedOnly || !o.ticket?.printedAt));
  const unprinted = all.filter((o) => !o.ticket?.printedAt).length;
  const canEdit = can(user, "kitchen.edit");
  return (
    <div>
      <PageHeader
        back={{ href: `/admin/kitchen?kitchen=${kitchen.id}&date=${date}`, label: "Kitchen" }}
        title="Kitchen order tickets"
        description={`${orders.length} of ${all.length} tickets · ${unprinted} not printed · ${formatDay(date, "full")}`}
        actions={
          <>
            <PrintButton />
            {orders.length > 0 && canEdit && <ConfirmAction action={markPrintedAction.bind(null, orders.map((o) => o.id))} label={`Mark ${orders.length} printed`} />}
          </>
        }
      />
      <DayPicker path="/admin/kitchen/tickets" date={date} kitchenId={kitchen.id} kitchens={kitchens}>
        <label className="text-xs font-semibold text-ink-mute">
          Slot
          <select name="slot" defaultValue={slot} className="field mt-1 w-40">
            <option value="">All slots</option>
            {slots.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-mute">
          Show
          <select name="show" defaultValue={unprintedOnly ? "unprinted" : ""} className="field mt-1 w-36">
            <option value="">All tickets</option>
            <option value="unprinted">Not printed</option>
          </select>
        </label>
      </DayPicker>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:grid-cols-3">
        {orders.map((o) => (
          <article key={o.id} className="break-inside-avoid rounded-lg border-2 border-dashed border-ink bg-white p-3 font-mono text-xs">
            <div className="flex justify-between text-base font-bold">
              <span>#{o.code}</span>
              <span>{o.slotLabel ?? "—"}</span>
            </div>
            <p>{o.number}</p>
            <hr className="my-2 border-ink" />
            {o.items.map((it) => (
              <div key={it.id} className="mb-2">
                <p className="text-sm font-bold">
                  {it.quantity}× {it.name} [{DIET_LABEL[it.diet].short}]
                </p>
                {(Array.isArray(it.components) ? (it.components as Comp[]) : []).map((c, i) => (
                  <p key={i}>
                    · {c.qty > 1 ? `${c.qty}× ` : ""}
                    {c.name}
                    {c.substitutedFrom ? ` (not ${c.substitutedFrom})` : ""}
                  </p>
                ))}
              </div>
            ))}
            {o.allergenNote && <p className="mt-1 bg-ink px-1 font-bold text-white">ALLERGY: {o.allergenNote}</p>}
            {o.kitchenNote && <p className="mt-1">NOTE: {o.kitchenNote}</p>}
            <p className="mt-2 text-[10px] text-ink-mute">{o.ticket?.printedAt ? `printed ${formatStamp(o.ticket.printedAt)}${o.ticket.reprintCount ? ` · reprint ${o.ticket.reprintCount}` : ""}` : "not printed yet"}</p>
          </article>
        ))}
        {!orders.length && <p className="text-sm text-ink-mute">No tickets for this day.</p>}
      </div>
    </div>
  );
}
