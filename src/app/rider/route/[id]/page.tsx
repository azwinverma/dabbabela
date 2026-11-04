import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { rs } from "@/lib/money";
import { whatsappLink, formatNepalPhone } from "@/lib/phone";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { StopActions } from "./StopActions";
import { finishRouteAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function RiderRoute({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("rider");
  const { id } = await params;
  const r = await db.deliveryRoute.findUnique({
    where: { id },
    include: { slot: { select: { label: true } }, assignments: { orderBy: { sequence: "asc" }, include: { order: { include: { items: { select: { name: true, quantity: true } }, payment: { select: { method: true } } } } } } },
  });
  if (!r || (user.role === "DELIVERY_AGENT" && r.riderId !== user.id)) notFound();
  const s = await getSettings();
  const open = r.assignments.filter((a) => a.order.status === "OUT_FOR_DELIVERY").length;
  return (
    <div>
      <Link href="/rider" className="text-sm font-semibold text-ink-mute">← Routes</Link>
      <h1 className="mt-1 font-display text-2xl font-extrabold">{r.name}</h1>
      <p className="mb-4 text-sm text-ink-mute">{r.slot?.label ?? "Any slot"} · {r.assignments.length} stops · cash collected {rs(r.cashCollected)}</p>
      {r.status === "PLANNED" && <p className="mb-4 rounded-xl bg-besar-light p-3 text-sm font-semibold">Waiting for dispatch to send this route out.</p>}
      <ol className="space-y-4">
        {r.assignments.map((a, i) => {
          const o = a.order;
          const cash = o.payment?.method === "CASH" && o.paymentStatus !== "PAID" ? o.customerShare : 0;
          const phone = formatNepalPhone(o.contactPhone) || o.contactPhone;
          return (
            <li key={a.id} className={`rounded-2xl border-2 bg-white p-4 ${o.status === "OUT_FOR_DELIVERY" ? "border-ink" : "border-ink-line opacity-80"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-ink-mute">STOP {i + 1}</p>
                  <p className="font-display text-lg font-bold leading-tight">{o.placeName ?? o.addressLine}</p>
                  <p className="text-sm">{o.addressLine}, {o.area}{o.ward ? `-${o.ward}` : ""}</p>
                  {o.landmark && <p className="text-sm text-ink-mute">Near {o.landmark}</p>}
                  {o.instructions && <p className="mt-1 rounded bg-paper px-2 py-1 text-sm italic">{o.instructions}</p>}
                </div>
                <span className="font-mono text-xl font-extrabold">#{o.code}</span>
              </div>
              <p className="mt-2 text-sm"><b>{o.contactName}</b> · {o.items.map((it) => `${it.quantity}× ${it.name}`).join(", ")}</p>
              {cash > 0 && <p className="mt-1 text-base font-bold text-sindoor">Collect cash: {rs(cash)}</p>}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a href={`tel:${o.contactPhone}`} className="flex h-12 items-center justify-center rounded-xl border-2 border-ink font-bold">Call {phone}</a>
                <a href={whatsappLink(o.contactPhone, `Namaste, this is your Dabba Bela rider with order #${o.code}.`)} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center rounded-xl border-2 border-saag font-bold text-saag-dark">WhatsApp</a>
              </div>
              {o.status === "OUT_FOR_DELIVERY" ? (
                <StopActions orderId={o.id} needOtp={s.flags.deliveryOtp && user.role === "DELIVERY_AGENT"} needPhoto={s.flags.deliveryPhoto && user.role === "DELIVERY_AGENT"} cash={cash} />
              ) : (
                <p className="mt-3 text-center text-sm font-bold uppercase tracking-wide text-ink-mute">{o.status.replace(/_/g, " ").toLowerCase()}</p>
              )}
            </li>
          );
        })}
      </ol>
      {r.status === "OUT" && (
        <div className="mt-6">
          {open ? <p className="text-center text-sm text-ink-mute">{open} stop(s) still open.</p> : <ConfirmAction action={finishRouteAction.bind(null, r.id)} label="Finish route" variant="primary" size="lg" className="w-full" confirm="Finish this route? Hand all cash to dispatch." />}
        </div>
      )}
    </div>
  );
}
