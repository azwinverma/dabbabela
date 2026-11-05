import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getI18n } from "@/lib/i18n/server";
import { addDays, formatDay, isoDate, isValidISODate, todayKTM, weekStartOf } from "@/lib/dates";
import { getPublicWeek } from "@/lib/public";
import { PageHeader, Callout } from "@/components/admin/ui";
import { MenuDays } from "@/app/(site)/menu/MenuDays";

/** Staff-only: a draft (or any) menu rendered exactly as customers would see it once live. */
export default async function MenuPreviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ week?: string }> }) {
  await requirePermission("menu.view");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const menu = await db.weeklyMenu.findUnique({ where: { id }, select: { id: true, title: true, status: true, isDefault: true, weekStart: true, kitchenId: true, publishAt: true } });
  if (!menu) notFound();
  const { locale, t } = await getI18n();
  // A week menu previews its own week; the standing rotation previews the week chosen (default: next week).
  const week = menu.weekStart ? isoDate(menu.weekStart) : sp.week && isValidISODate(sp.week) ? weekStartOf(sp.week) : addDays(weekStartOf(todayKTM()), 7);
  const data = await getPublicWeek(week, locale, menu.kitchenId, { previewMenuId: menu.id });

  return (
    <>
      <PageHeader
        title={`Preview: ${menu.title}`}
        back={{ href: `/admin/weekly-menus/${menu.id}`, label: "Back to editor" }}
        description={`Week of ${formatDay(week)} – ${formatDay(addDays(week, 6))}. Ordering is disabled here.`}
      />
      {menu.status !== "PUBLISHED" && (
        <Callout tone="info" className="mb-4">
          This menu is <b>{menu.status.toLowerCase()}</b>
          {menu.publishAt ? " (scheduled)" : ""}. Customers don't see it yet. Hidden, archived and kitchen-unavailable dabbas are left out, and sold-out counts use real bookings.
        </Callout>
      )}
      {menu.isDefault && (
        <nav className="mb-4 flex gap-3 text-sm" aria-label="Preview week">
          <Link href={`?week=${addDays(week, -7)}`} className="font-semibold text-sindoor underline">← Previous week</Link>
          <Link href={`?week=${addDays(week, 7)}`} className="font-semibold text-sindoor underline">Next week →</Link>
        </nav>
      )}
      <div className="rounded-2xl border-2 border-ink bg-paper p-4 md:p-8">
        <MenuDays days={data.days} t={t} locale={locale} keep={() => true} isPast={data.isPast} allergies={[]} preview />
      </div>
    </>
  );
}
