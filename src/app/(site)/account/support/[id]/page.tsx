import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatStamp } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ReplyForm } from "./ReplyForm";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/account/support/${id}`);
  const t = await db.supportTicket.findFirst({
    where: { id, userId: user.id },
    include: { messages: { where: { internal: false }, orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, role: true } } } }, order: { select: { id: true, number: true } } },
  });
  if (!t) notFound();
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link href="/account/support" className="text-sm font-semibold text-ink-soft underline">← Help</Link>
        <h2 className="mt-2 text-2xl font-extrabold">{t.subject}</h2>
        <p className="text-sm text-ink-mute">
          {t.number} · {t.status.toLowerCase()}
          {t.order && (
            <>
              {" "}· order <Link href={`/account/orders/${t.order.id}`} className="underline">#{t.order.number}</Link>
            </>
          )}
        </p>
      </div>
      <ol className="space-y-3">
        {t.messages.map((m) => {
          const mine = m.authorId === user.id;
          return (
            <li key={m.id} className={cn("max-w-[85%] rounded-2xl border-2 px-4 py-3", mine ? "ml-auto border-ink bg-besar-light" : "border-ink-line bg-white")}>
              <p className="text-xs font-bold text-ink-mute">{mine ? "You" : "Dabba Bela team"} · {formatStamp(m.createdAt)}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
            </li>
          );
        })}
      </ol>
      {t.status !== "CLOSED" ? <ReplyForm ticketId={t.id} /> : <p className="text-sm text-ink-mute">This conversation is closed. Start a new one if you need us.</p>}
    </div>
  );
}
