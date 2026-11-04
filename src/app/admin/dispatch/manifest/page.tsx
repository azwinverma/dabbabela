import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { formatDay, isoDate } from "@/lib/dates";
import { rs } from "@/lib/money";
import { PageHeader } from "@/components/admin/ui";
import { PrintButton } from "@/components/admin/ops/PrintButton";
import { piiFor } from "@/components/admin/ops/scope";

export const metadata = { title: "Route manifest" };

export default async function ManifestPage({ searchParams }: { searchParams: Promise<{ route?: string }> }) {
  const user = await requirePermission("dispatch");
  const { route: id } = await searchParams;
  const r = id ? await db.deliveryRoute.findUnique({ where: { id }, include: { rider: { select: { name: true, phoneNumber: true } }, kitchen: { select: { name: true } }, slot: { select: { label: true } }, assignments: { orderBy: { sequence: "asc" }, include: { order: { include: { items: true, payment: { select: { method: true } } } } } } } }) : null;
  if (!r || (user.kitchenId && r.kitchenId !== user.kitchenId)) notFound();
  const pii = piiFor(user.role);
  const cash = r.assignments.filter((a) => a.order.payment?.method === "CASH" && a.order.paymentStatus !== "PAID").reduce((s, a) => s + a.order.customerShare, 0);
  return (
    <div>
      <PageHeader back={{ href: `/admin/dispatch?kitchen=${r.kitchenId}&date=${isoDate(r.date)}`, label: "Dispatch" }} title={`Manifest — ${r.name}`} description={`${r.kitchen.name} · ${formatDay(isoDate(r.date), "full")} · ${r.slot?.label ?? "any slot"} · rider ${r.rider?.name ?? "unassigned"} ${r.rider?.phoneNumber ?? ""} · cash to collect ${rs(cash)}`} actions={<PrintButton />} />
      <table className="w-full border-collapse bg-white text-sm">
        <thead>
          <tr className="border-b-2 border-ink text-left">
            <th className="p-2">#</th><th className="p-2">Code</th><th className="p-2">Drop</th><th className="p-2">Receiver</th><th className="p-2">Dabbas</th><th className="p-2 text-right">Cash</th><th className="p-2">Signed</th>
          </tr>
        </thead>
        <tbody>
          {r.assignments.map((a, i) => (
            <tr key={a.id} className="border-b border-ink-line align-top">
              <td className="p-2">{i + 1}</td>
              <td className="p-2 font-mono font-bold">#{a.order.code}</td>
              <td className="p-2"><b>{a.order.placeName ?? a.order.addressLine}</b><div className="text-xs">{a.order.area}{a.order.landmark ? ` · ${a.order.landmark}` : ""}</div>{a.order.instructions && <div className="text-xs italic">{a.order.instructions}</div>}</td>
              <td className="p-2">{a.order.contactName}<div className="text-xs">{pii.phone(a.order.contactPhone)}</div></td>
              <td className="p-2 text-xs">{a.order.items.map((it) => `${it.quantity}× ${it.name}`).join(", ")}</td>
              <td className="p-2 text-right">{a.order.payment?.method === "CASH" && a.order.paymentStatus !== "PAID" ? rs(a.order.customerShare) : "—"}</td>
              <td className="w-24 p-2" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
