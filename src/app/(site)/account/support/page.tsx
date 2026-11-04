import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { formatDay, formatStamp, isoDate } from "@/lib/dates";
import { whatsappLink } from "@/lib/phone";
import { Badge } from "@/components/ui/Badge";
import { NewTicket } from "./NewTicket";

const TONE: Record<string, "warn" | "info" | "good" | "neutral"> = { OPEN: "warn", PENDING: "info", RESOLVED: "good", CLOSED: "neutral" };
const LABEL: Record<string, string> = { OPEN: "Waiting for us", PENDING: "We replied", RESOLVED: "Resolved", CLOSED: "Closed" };

export default async function SupportPage() {
  const user = await requireUser("/account/support");
  const [tickets, orders, s] = await Promise.all([
    db.supportTicket.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 50 }),
    db.order.findMany({ where: { userId: user.id }, orderBy: { deliveryDate: "desc" }, take: 15, include: { items: { select: { name: true }, take: 1 } } }),
    getSettings(),
  ]);
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section>
        <h2 className="text-2xl font-extrabold">Help</h2>
        {tickets.length === 0 ? (
          <p className="mt-4 text-sm text-ink-mute">No conversations yet.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link href={`/account/support/${t.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-ink-line bg-white px-4 py-3 hover:border-ink">
                  <span>
                    <span className="font-semibold">{t.subject}</span>
                    <span className="block text-xs text-ink-mute">
                      {t.number} · updated {formatStamp(t.updatedAt)}
                    </span>
                  </span>
                  <Badge tone={TONE[t.status] ?? "neutral"}>{LABEL[t.status] ?? t.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <aside className="space-y-4">
        <div className="rounded-2xl border-2 border-ink bg-paper-card p-5">
          <h3 className="text-lg font-extrabold">Ask us something</h3>
          <div className="mt-3">
            <NewTicket orders={orders.map((o) => ({ id: o.id, label: `${formatDay(isoDate(o.deliveryDate))} · ${o.items[0]?.name ?? "Order"} (#${o.number})` }))} />
          </div>
        </div>
        {(s.whatsapp || s.phone) && (
          <div className="rounded-2xl border-2 border-ink-line bg-white p-5 text-sm">
            <p className="font-bold">Urgent, about today's lunch?</p>
            {s.phone && <p className="mt-1">Call {s.phone}</p>}
            {s.whatsapp && (
              <a href={whatsappLink(s.whatsapp, "Namaste, about my Dabba Bela order:")} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block font-semibold text-saag underline">
                Message us on WhatsApp
              </a>
            )}
            <p className="mt-1 text-xs text-ink-mute">{s.hours}</p>
          </div>
        )}
      </aside>
    </div>
  );
}
