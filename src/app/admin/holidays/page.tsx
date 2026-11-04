import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { dateOnly, formatDay, isoDate, isValidISODate, todayKTM } from "@/lib/dates";
import { rs } from "@/lib/money";
import { ORDER_STATUS } from "@/lib/labels";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, Callout } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { addHoliday, deleteHoliday, runDisruption } from "./actions";

const KIND_OPTS = [
  { value: "HOLIDAY", label: "Public holiday / festival" },
  { value: "BANDH", label: "Bandh / strike" },
  { value: "WEATHER", label: "Weather / road closure" },
  { value: "CLOSURE", label: "Kitchen closure" },
];

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ disrupt?: string; kitchen?: string; past?: string }> }) {
  await requirePermission("rules");
  const sp = await searchParams;
  const today = todayKTM();
  const [holidays, kitchens] = await Promise.all([
    db.holiday.findMany({ where: sp.past ? {} : { date: { gte: dateOnly(today) } }, orderBy: { date: "asc" }, include: { kitchen: { select: { name: true } } }, take: 200 }),
    db.kitchen.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  const kitchenOpts = [{ value: "", label: "All kitchens" }, ...kitchens.map((k) => ({ value: k.id, label: k.name }))];
  const date = sp.disrupt && isValidISODate(sp.disrupt) ? sp.disrupt : null;
  const affected = date
    ? await db.order.findMany({
        where: { deliveryDate: dateOnly(date), status: { in: ["PENDING_PAYMENT", "SCHEDULED", "CONFIRMED", "PREPARING"] }, ...(sp.kitchen ? { kitchenId: sp.kitchen } : {}) },
        include: { user: { select: { name: true } }, items: { select: { name: true, quantity: true } } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  return (
    <>
      <PageHeader title="Closures & disruptions" description="Closed days can't be booked, and plans skip them automatically. If something happens on a day that already has orders, run a disruption so every customer is moved or credited — and told." />
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Reason</Th>
                <Th>Kind</Th>
                <Th>Kitchen</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {holidays.length === 0 && <EmptyRow colSpan={5}>No upcoming closures. Add Dashain, Tihar and other public holidays here.</EmptyRow>}
              {holidays.map((h) => (
                <tr key={h.id} className={isoDate(h.date) < today ? "opacity-60" : ""}>
                  <Td className="font-semibold">{formatDay(isoDate(h.date), "long")}</Td>
                  <Td>{h.name}</Td>
                  <Td>
                    <Badge tone={h.kind === "HOLIDAY" ? "info" : "warn"}>{h.kind.toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-xs">{h.kitchen?.name ?? "All"}</Td>
                  <Td className="text-right">{isoDate(h.date) >= today && <ConfirmAction action={deleteHoliday.bind(null, h.id)} label="Re-open" variant="ghost" confirm="Re-open this day for orders?" />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Link href={sp.past ? "/admin/holidays" : "/admin/holidays?past=1"} className="text-xs font-semibold text-ink-mute hover:text-ink">
            {sp.past ? "Hide past closures" : "Show past closures"}
          </Link>

          {date && (
            <Panel title={`Disruption on ${formatDay(date, "long")} — ${affected.length} order(s) affected`}>
              {affected.length === 0 ? (
                <Callout tone="good">No live orders that day. You can simply add a closure.</Callout>
              ) : (
                <>
                  <div className="max-h-80 overflow-y-auto">
                    <table className="w-full text-sm">
                      <tbody>
                        {affected.map((o) => (
                          <tr key={o.id} className="border-b border-ink-line/40">
                            <td className="py-1.5 pr-2 font-mono text-xs">{o.number}</td>
                            <td className="py-1.5 pr-2">{o.user.name}</td>
                            <td className="py-1.5 pr-2 text-xs text-ink-mute">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</td>
                            <td className="py-1.5 pr-2 text-xs">{o.subscriptionId ? "plan" : "single"}</td>
                            <td className="py-1.5 pr-2">
                              <Badge tone={ORDER_STATUS[o.status].tone}>{ORDER_STATUS[o.status].label}</Badge>
                            </td>
                            <td className="py-1.5 text-right tabular-nums">{rs(o.customerShare)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <ActionForm action={runDisruption} className="mt-4 grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="date" value={date} />
                    <input type="hidden" name="kitchenId" value={sp.kitchen ?? ""} />
                    <Input name="reason" label="Reason (customers see this)" placeholder="Nepal bandh" className="sm:col-span-2" />
                    <Select name="kind" label="Kind" options={KIND_OPTS} defaultValue="BANDH" />
                    <Select
                      name="outcome"
                      label="What happens to orders"
                      options={[
                        { value: "MOVE", label: "Move to the next service day (plans: add to end)" },
                        { value: "CREDIT", label: "Cancel and credit paid amounts" },
                      ]}
                    />
                    <label className="flex items-start gap-2 text-sm sm:col-span-2">
                      <input type="checkbox" name="confirm" value="yes" className="mt-0.5 accent-sindoor" />
                      I understand this closes {date}, changes {affected.length} order(s) and notifies those customers. Moves that don't fit next-day capacity are credited instead.
                    </label>
                    <SubmitButton variant="primary" pendingText="Working…">Run disruption</SubmitButton>
                  </ActionForm>
                </>
              )}
            </Panel>
          )}
        </div>
        <div className="space-y-6">
          <Panel title="Add a closure">
            <ActionForm action={addHoliday} resetOnSuccess className="space-y-3">
              <Input name="date" type="date" label="Date" min={today} />
              <Input name="name" label="Name" placeholder="Tihar — Laxmi Puja" />
              <Select name="kind" label="Kind" options={KIND_OPTS} />
              <Select name="kitchenId" label="Kitchen" options={kitchenOpts} />
              <SubmitButton size="sm">Close this day</SubmitButton>
            </ActionForm>
          </Panel>
          <Panel title="Handle a disruption">
            <form className="space-y-3" action="/admin/holidays">
              <Input name="disrupt" type="date" label="Date with orders" min={today} defaultValue={date ?? ""} />
              <Select name="kitchen" label="Kitchen" options={kitchenOpts} defaultValue={sp.kitchen ?? ""} />
              <button className="h-9 rounded-xl border-2 border-ink px-3 text-sm font-semibold hover:bg-ink hover:text-paper">Preview affected orders</button>
            </form>
          </Panel>
        </div>
      </div>
    </>
  );
}
