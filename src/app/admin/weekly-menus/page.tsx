import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { addDays, formatDay, formatStamp, isoDate, todayKTM, weekStartOf, WEEKDAYS } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, Callout } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { createWeekMenu } from "./actions";

const TONE = { DRAFT: "warn", PUBLISHED: "good", ARCHIVED: "neutral" } as const;

export default async function WeeklyMenusPage() {
  const user = await requirePermission("menu.view");
  const canEdit = can(user, "menu.edit");
  const thisWeek = weekStartOf(todayKTM());
  const now = new Date();
  const kitchens = await db.kitchen.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  const menus = await db.weeklyMenu.findMany({
    orderBy: [{ isDefault: "desc" }, { weekStart: "desc" }, { updatedAt: "desc" }],
    include: { kitchen: { select: { name: true } }, days: { include: { items: { where: { isPrimary: true }, include: { box: { select: { name: true } } } } } } },
    take: 80,
  });
  const standing = menus.find((m) => m.isDefault && m.status === "PUBLISHED");
  const upcoming = [0, 1, 2, 3].map((i) => addDays(thisWeek, i * 7));
  const isLive = (m: (typeof menus)[number]) => m.status === "PUBLISHED" || (m.status === "DRAFT" && m.publishAt != null && m.publishAt <= now);
  const covered = new Set(menus.filter((m) => m.weekStart && isLive(m)).map((m) => isoDate(m.weekStart!)));
  const pending = new Map(menus.filter((m) => m.weekStart && m.status === "DRAFT" && m.publishAt && m.publishAt > now).map((m) => [isoDate(m.weekStart!), m.publishAt!]));

  return (
    <>
      <PageHeader title="Weekly menus" description="The standing rotation runs every week. A week-specific menu overrides it day by day; days it doesn't define fall back to the rotation." />
      {!standing && <Callout tone="bad" className="mb-4" title="No live standing rotation">Customers will see closed days for any week without its own menu. Publish the standing rotation.</Callout>}
      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_340px]">
        <Panel title="Next four weeks">
          <ul className="grid gap-2 sm:grid-cols-2">
            {upcoming.map((w) => (
              <li key={w} className="rounded-lg border border-ink-line/60 px-3 py-2 text-sm">
                <p className="font-semibold">Week of {formatDay(w)}</p>
                <p className="text-xs text-ink-mute">
                  {covered.has(w) ? "Own menu published" : standing ? "Using the standing rotation" : "Nothing published"}
                  {pending.has(w) && ` · own menu scheduled ${formatStamp(pending.get(w)!)}`}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
        {canEdit && <Panel title="Plan a specific week">
          <ActionForm action={createWeekMenu} className="space-y-3">
            <label className="block">
              <span className="label">Any date in the week</span>
              <input type="date" name="weekOf" defaultValue={addDays(thisWeek, 7)} className="field" required />
            </label>
            <label className="block">
              <span className="label">Start from</span>
              <select name="copyFrom" className="field" defaultValue={standing?.id ?? ""}>
                <option value="">Blank week</option>
                {menus
                  .filter((m) => m.status !== "ARCHIVED")
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Kind</span>
                <select name="kind" className="field" defaultValue="">
                  <option value="">Same as source</option>
                  <option value="STANDARD">Standard</option>
                  <option value="SEASONAL">Seasonal</option>
                  <option value="PROMO">Promotional</option>
                </select>
              </label>
              <label className="block">
                <span className="label">Kitchen</span>
                <select name="kitchenId" className="field" defaultValue="">
                  <option value="">Same as source</option>
                  <option value="all">All kitchens</option>
                  {kitchens.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <SubmitButton size="sm">Create draft</SubmitButton>
          </ActionForm>
        </Panel>}
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Menu</Th>
            <Th>Week</Th>
            <Th>Chef's picks</Th>
            <Th>Kitchen</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {menus.length === 0 && <EmptyRow colSpan={5}>No menus yet.</EmptyRow>}
          {menus.map((m) => (
            <tr key={m.id}>
              <Td>
                <Link href={`/admin/weekly-menus/${m.id}`} className="font-semibold hover:text-sindoor">
                  {m.title}
                </Link>
                {m.isDefault && <span className="ml-2 text-xs font-semibold text-besar-dark">standing rotation</span>}
                {m.kind !== "STANDARD" && <span className="ml-2 text-xs font-semibold text-sindoor">{m.kind.toLowerCase()}</span>}
              </Td>
              <Td className="text-sm">{m.weekStart ? formatDay(isoDate(m.weekStart)) : "Every week"}</Td>
              <Td className="max-w-md text-xs text-ink-mute">
                {WEEKDAYS.map((d) => {
                  const day = m.days.find((x) => x.day === d);
                  if (!day) return null;
                  return (
                    <span key={d} className="mr-2 inline-block">
                      <b className="text-ink">{d}</b> {day.isClosed ? "closed" : (day.items[0]?.box.name ?? "—")}
                    </span>
                  );
                })}
              </Td>
              <Td className="text-xs">{m.kitchen?.name ?? "All kitchens"}</Td>
              <Td>
                {m.status === "DRAFT" && m.publishAt ? (
                  <Badge tone={m.publishAt <= now ? "good" : "warn"}>{m.publishAt <= now ? "live (scheduled)" : `scheduled ${formatStamp(m.publishAt)}`}</Badge>
                ) : (
                  <Badge tone={TONE[m.status]}>{m.status.toLowerCase()}</Badge>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
