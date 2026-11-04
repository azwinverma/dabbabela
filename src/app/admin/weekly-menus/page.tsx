import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { addDays, formatDay, isoDate, todayKTM, weekStartOf, WEEKDAYS } from "@/lib/dates";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, Callout } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { createWeekMenu } from "./actions";

const TONE = { DRAFT: "warn", PUBLISHED: "good", ARCHIVED: "neutral" } as const;

export default async function WeeklyMenusPage() {
  await requirePermission("menu.view");
  const thisWeek = weekStartOf(todayKTM());
  const menus = await db.weeklyMenu.findMany({
    orderBy: [{ isDefault: "desc" }, { weekStart: "desc" }, { updatedAt: "desc" }],
    include: { kitchen: { select: { name: true } }, days: { include: { items: { where: { isPrimary: true }, include: { box: { select: { name: true } } } } } } },
    take: 80,
  });
  const standing = menus.find((m) => m.isDefault && m.status === "PUBLISHED");
  const upcoming = [0, 1, 2, 3].map((i) => addDays(thisWeek, i * 7));
  const covered = new Set(menus.filter((m) => m.weekStart && m.status === "PUBLISHED").map((m) => isoDate(m.weekStart!)));

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
                <p className="text-xs text-ink-mute">{covered.has(w) ? "Own menu published" : standing ? "Using the standing rotation" : "Nothing published"}</p>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Plan a specific week">
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
            <SubmitButton size="sm">Create draft</SubmitButton>
          </ActionForm>
        </Panel>
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
                <Badge tone={TONE[m.status]}>{m.status.toLowerCase()}</Badge>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
