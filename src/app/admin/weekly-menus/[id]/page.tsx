import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { addDays, formatDay, isoDate, WEEKDAYS } from "@/lib/dates";
import { rupeesInput } from "@/lib/money";
import { boxFacts, boxInclude } from "@/server/menu";
import { PageHeader, Callout } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { WeekEditor } from "../WeekEditor";
import { deleteMenu, duplicateMenu, saveMenuDays, setMenuStatus } from "../actions";

export default async function MenuEditPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("menu.view");
  const { id } = await params;
  const [menu, boxes, kitchens] = await Promise.all([
    db.weeklyMenu.findUnique({ where: { id }, include: { days: { include: { items: { orderBy: { sortOrder: "asc" } } } } } }),
    db.lunchBox.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: boxInclude }),
    db.kitchen.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  if (!menu) notFound();
  const ws = menu.weekStart ? isoDate(menu.weekStart) : null;
  const dates = ws ? Object.fromEntries(WEEKDAYS.map((d, i) => [d, formatDay(addDays(ws, i))])) : null;
  const initial = WEEKDAYS.map((day) => {
    const d = menu.days.find((x) => x.day === day);
    return {
      day,
      isClosed: d ? d.isClosed : !menu.isDefault ? false : true,
      note: d?.note ?? "",
      items: (d?.items ?? []).map((i) => ({ boxId: i.boxId, isPrimary: i.isPrimary, capacity: i.capacity != null ? String(i.capacity) : "", soldOut: i.soldOut, priceOverride: i.priceOverride != null ? rupeesInput(i.priceOverride) : "" })),
    };
  });
  const nextWeek = ws ? addDays(ws, 7) : addDays(isoDate(new Date()), 7);

  return (
    <>
      <PageHeader
        title={menu.title}
        back={{ href: "/admin/weekly-menus", label: "Weekly menus" }}
        description={menu.isDefault ? "Standing rotation — used for every week without its own menu." : `Week of ${dates?.SUN}`}
        actions={
          <>
            <Badge tone={menu.status === "PUBLISHED" ? "good" : menu.status === "DRAFT" ? "warn" : "neutral"}>{menu.status.toLowerCase()}</Badge>
            {menu.status !== "PUBLISHED" && <ConfirmAction action={setMenuStatus.bind(null, menu.id, "PUBLISHED")} label="Publish" variant="primary" confirm="Publish this menu? Booked rotation meals that are still editable will be re-assigned to the chef's picks and customers notified." />}
            {menu.status === "PUBLISHED" && <ConfirmAction action={setMenuStatus.bind(null, menu.id, "DRAFT")} label="Unpublish" confirm="Take this menu offline?" />}
            {menu.status !== "ARCHIVED" && !menu.isDefault && <ConfirmAction action={setMenuStatus.bind(null, menu.id, "ARCHIVED")} label="Archive" variant="ghost" />}
            <ConfirmAction action={duplicateMenu.bind(null, menu.id, nextWeek)} label={`Copy to week of ${formatDay(nextWeek)}`} variant="ghost" />
            {!menu.isDefault && menu.status !== "PUBLISHED" && <ConfirmAction action={deleteMenu.bind(null, menu.id)} label="Delete" variant="danger" confirm="Delete this draft?" />}
          </>
        }
      />
      {menu.status === "PUBLISHED" && (
        <Callout tone="warn" className="mb-4">
          This menu is live. Saving re-assigns booked rotation meals (before their cut-off) and notifies those customers. Locked days and customers' own picks are never changed.
        </Callout>
      )}
      <WeekEditor
        boxes={boxes.map((b) => ({ id: b.id, name: b.name, isVeg: boxFacts(b).isVeg, price: rupeesInput(b.price), isActive: b.isActive }))}
        kitchens={kitchens}
        initial={initial}
        meta={{ title: menu.title, note: menu.note ?? "", kitchenId: menu.kitchenId }}
        dates={dates}
        save={saveMenuDays.bind(null, menu.id)}
      />
    </>
  );
}
