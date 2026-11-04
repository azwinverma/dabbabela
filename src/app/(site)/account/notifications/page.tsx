import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatStamp } from "@/lib/dates";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { markNotificationsReadAction } from "@/lib/actions/account";
import { PREF_CHANNELS, PREF_TOPICS } from "@/lib/actions/account-constants";
import { PrefsForm } from "./PrefsForm";

export default async function NotificationsPage() {
  const user = await requireUser("/account/notifications");
  const [items, prefs] = await Promise.all([
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 60 }),
    db.notificationPreference.findMany({ where: { userId: user.id } }),
  ]);
  const map: Record<string, boolean> = {};
  for (const t of PREF_TOPICS)
    for (const c of PREF_CHANNELS) {
      const p = prefs.find((x) => x.topic === t && x.channel === c);
      map[`${t}:${c}`] = p ? p.enabled : t === "MARKETING" ? user.marketingOptIn && c !== "SMS" : c !== "SMS" || t === "ORDER_UPDATES";
    }
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section>
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-2xl font-extrabold">Notifications</h2>
          {unread > 0 && (
            <ActionForm action={markNotificationsReadAction} showMessage={false}>
              <SubmitButton size="sm" variant="ghost">Mark all read</SubmitButton>
            </ActionForm>
          )}
        </div>
        {items.length === 0 ? (
          <p className="mt-4 text-sm text-ink-mute">Nothing yet — order updates will show up here.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {items.map((n) => (
              <li key={n.id} className={`rounded-xl border-2 px-4 py-3 ${n.readAt ? "border-ink-line bg-white" : "border-ink bg-besar-light/60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p>
                    {n.body && <p className="text-sm text-ink-soft">{n.body}</p>}
                    <p className="mt-1 text-xs text-ink-mute">{formatStamp(n.createdAt)}</p>
                  </div>
                  {!n.readAt && (
                    <ActionForm action={markNotificationsReadAction} showMessage={false}>
                      <input type="hidden" name="id" value={n.id} />
                      <SubmitButton size="sm" variant="ghost">Read</SubmitButton>
                    </ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <aside className="rounded-2xl border-2 border-ink bg-paper-card p-5">
        <h3 className="text-lg font-extrabold">How we reach you</h3>
        <div className="mt-3">
          <PrefsForm prefs={map} />
        </div>
      </aside>
    </div>
  );
}
