import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { addDays, formatDay, formatStamp, isoDate, WEEKDAYS } from "@/lib/dates";
import { rupeesInput } from "@/lib/money";
import { boxFacts, boxInclude, diffSnapshots, type MenuSnapshot } from "@/server/menu";
import { PageHeader, Panel, Callout } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { WeekEditor } from "../WeekEditor";
import { cancelScheduleAction, deleteMenu, duplicateMenu, saveMenuDays, scheduleMenuAction, setMenuStatus } from "../actions";

const KIND_LABEL: Record<string, string> = { STANDARD: "standard", SEASONAL: "seasonal", PROMO: "promo" };
const ktmLocal = (d: Date) => new Date(d.getTime() + (5 * 60 + 45) * 60_000).toISOString().slice(0, 16);

export default async function MenuEditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("menu.view");
  const canEdit = can(user, "menu.edit");
  const canPublish = can(user, "menu.publish");
  const { id } = await params;
  const [menu, boxes, kitchens] = await Promise.all([
    db.weeklyMenu.findUnique({
      where: { id },
      include: {
        days: { include: { items: { orderBy: { sortOrder: "asc" } } } },
        revisions: { orderBy: { version: "desc" }, take: 30 },
        kitchen: { select: { name: true } },
      },
    }),
    db.lunchBox.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: boxInclude }),
    db.kitchen.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  if (!menu) notFound();
  const actors = await db.user.findMany({ where: { id: { in: menu.revisions.map((r) => r.actorId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  const actorName = new Map(actors.map((a) => [a.id, a.name]));
  const ws = menu.weekStart ? isoDate(menu.weekStart) : null;
  const dates = ws ? Object.fromEntries(WEEKDAYS.map((d, i) => [d, formatDay(addDays(ws, i))])) : null;
  const initial = WEEKDAYS.map((day) => {
    const d = menu.days.find((x) => x.day === day);
    return {
      day,
      isClosed: d ? d.isClosed : !menu.isDefault ? false : true,
      note: d?.note ?? "",
      cutoffOverride: d?.cutoffOverride ?? "",
      items: (d?.items ?? []).map((i) => ({
        boxId: i.boxId,
        isPrimary: i.isPrimary,
        capacity: i.capacity != null ? String(i.capacity) : "",
        soldOut: i.soldOut,
        priceOverride: i.priceOverride != null ? rupeesInput(i.priceOverride) : "",
        replacementBoxId: i.replacementBoxId ?? "",
      })),
    };
  });
  const nextWeek = ws ? addDays(ws, 7) : addDays(isoDate(new Date()), 7);
  const now = new Date();
  const scheduled = menu.status === "DRAFT" && menu.publishAt;
  const scheduledLive = scheduled && menu.publishAt! <= now;
  const live = menu.status === "PUBLISHED" || scheduledLive;
  const revs = menu.revisions;

  return (
    <>
      <PageHeader
        title={menu.title}
        back={{ href: "/admin/weekly-menus", label: "Weekly menus" }}
        description={`${menu.isDefault ? "Standing rotation — used for every week without its own menu." : `Week of ${dates?.SUN}`} · ${menu.kitchen?.name ?? "All kitchens"} · ${KIND_LABEL[menu.kind] ?? menu.kind} · version ${menu.version}`}
        actions={
          <>
            <Badge tone={live ? "good" : menu.status === "DRAFT" ? "warn" : "neutral"}>{scheduled ? (scheduledLive ? "live (scheduled)" : "scheduled") : menu.status.toLowerCase()}</Badge>
            <Link href={`/admin/preview/menu/${menu.id}`} className={buttonClass("ghost", "sm")} target="_blank">
              Preview as customer
            </Link>
            {canPublish && menu.status !== "PUBLISHED" && <ConfirmAction action={setMenuStatus.bind(null, menu.id, "PUBLISHED")} label="Publish now" variant="primary" confirm="Publish this menu? Booked rotation meals that are still editable will be re-assigned to the chef's picks and customers notified." />}
            {canPublish && live && <ConfirmAction action={setMenuStatus.bind(null, menu.id, "DRAFT")} label="Unpublish" confirm="Take this menu offline? This is refused while booked orders depend on it." />}
            {canPublish && menu.status !== "ARCHIVED" && !menu.isDefault && <ConfirmAction action={setMenuStatus.bind(null, menu.id, "ARCHIVED")} label="Archive" variant="ghost" />}
            {canEdit && <ConfirmAction action={duplicateMenu.bind(null, menu.id, nextWeek)} label={`Copy to week of ${formatDay(nextWeek)}`} variant="ghost" />}
            {canEdit && !menu.isDefault && !live && <ConfirmAction action={deleteMenu.bind(null, menu.id)} label="Delete" variant="danger" confirm="Delete this draft?" />}
          </>
        }
      />
      {live && (
        <Callout tone="warn" className="mb-4">
          This menu is live. Saving publishes the change straight away (a new revision), re-assigns booked rotation meals before their cut-off and notifies those customers. Locked days and customers' own picks are never changed.
        </Callout>
      )}
      {canPublish && menu.status !== "PUBLISHED" && (
        <Panel title="Scheduled publishing" className="mb-4">
          {scheduled ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>
                {scheduledLive ? "Live since" : "Goes live"} <b>{formatStamp(menu.publishAt!)}</b> (Kathmandu).{" "}
                {scheduledLive ? "Customers see it now; the next job run finalises it (revision + rotation re-sync). Publish now to finalise immediately." : "It appears on the site automatically at that time."}
              </span>
              {!scheduledLive && <ConfirmAction action={cancelScheduleAction.bind(null, menu.id)} label="Cancel schedule" variant="ghost" />}
            </div>
          ) : (
            <ActionForm action={scheduleMenuAction.bind(null, menu.id)} className="flex flex-wrap items-end gap-3">
              <label>
                <span className="label">Publish at (Kathmandu time)</span>
                <input type="datetime-local" name="publishAt" min={ktmLocal(now)} className="field" required />
              </label>
              <SubmitButton size="sm">Schedule</SubmitButton>
            </ActionForm>
          )}
        </Panel>
      )}
      <WeekEditor
        boxes={boxes.map((b) => ({ id: b.id, name: b.name, isVeg: boxFacts(b).isVeg, price: rupeesInput(b.price), isActive: b.isActive, isVisible: b.isVisible, maxDailyQty: b.maxDailyQty }))}
        kitchens={kitchens}
        initial={initial}
        meta={{ title: menu.title, note: menu.note ?? "", kitchenId: menu.kitchenId, kind: menu.kind }}
        dates={dates}
        save={saveMenuDays.bind(null, menu.id)}
        canEdit={canEdit}
      />
      <Panel title="Revision history" className="mt-6">
        {revs.length === 0 ? (
          <p className="text-sm text-ink-mute">No revisions yet. One is saved on every publish, schedule, live edit and unpublish.</p>
        ) : (
          <ol className="space-y-2">
            {revs.map((r, i) => {
              const prev = revs[i + 1];
              const diff = diffSnapshots(prev ? (prev.snapshot as unknown as MenuSnapshot) : null, r.snapshot as unknown as MenuSnapshot);
              return (
                <li key={r.id} className="rounded-lg border border-ink-line/60 px-3 py-2 text-sm">
                  <details>
                    <summary className="cursor-pointer">
                      <b>v{r.version}</b> · {r.action.toLowerCase()} · {formatStamp(r.createdAt)} · {r.actorId ? (actorName.get(r.actorId) ?? "staff") : "scheduled job"}{" "}
                      <span className="text-xs text-ink-mute">({prev ? `${diff.length} change(s) vs v${prev.version}` : "first"})</span>
                    </summary>
                    {diff.length === 0 ? (
                      <p className="mt-2 text-xs text-ink-mute">No menu changes (status only).</p>
                    ) : (
                      <ul className="mt-2 space-y-0.5 text-xs">
                        {diff.map((c, j) => (
                          <li key={j}>
                            <b className="inline-block w-12">{c.scope}</b> {c.change}
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </>
  );
}
