import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Checkbox } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { deleteCategory, moveCategory, saveCategory } from "./actions";

export default async function CategoriesPage() {
  const user = await requirePermission("menu.view");
  const canEdit = can(user, "menu.edit");
  const cats = await db.mealCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { boxes: true } } } });

  return (
    <>
      <PageHeader title="Meal categories" description="Customer-facing groups for dabbas (shown as filters on the menu). Order here is the order on the site." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Category</Th>
              <Th>URL name</Th>
              <Th>Dabbas</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {cats.length === 0 && <EmptyRow colSpan={6}>No categories yet.</EmptyRow>}
            {cats.map((c, i) => (
              <tr key={c.id} className={c.isActive ? "" : "opacity-60"}>
                <Td>
                  {canEdit ? (
                    <span className="flex gap-1">
                      <ConfirmAction action={moveCategory.bind(null, c.id, -1)} label={<span aria-label={`Move ${c.name} up`}>▲</span>} variant="ghost" className={i === 0 ? "invisible" : ""} />
                      <ConfirmAction action={moveCategory.bind(null, c.id, 1)} label={<span aria-label={`Move ${c.name} down`}>▼</span>} variant="ghost" className={i === cats.length - 1 ? "invisible" : ""} />
                    </span>
                  ) : (
                    <span className="text-xs text-ink-mute">{i + 1}</span>
                  )}
                </Td>
                <Td>
                  {canEdit ? (
                    <details>
                      <summary className="cursor-pointer font-semibold">
                        {c.name} {c.nameNe && <span className="lang-ne text-xs text-ink-mute">{c.nameNe}</span>}
                      </summary>
                      <ActionForm action={saveCategory.bind(null, c.id)} className="mt-2 grid gap-2 sm:grid-cols-2">
                        <Input name="name" label="Name" defaultValue={c.name} required />
                        <Input name="nameNe" label="नाम (Nepali)" defaultValue={c.nameNe ?? ""} className="lang-ne" />
                        <Input name="slug" label="URL name" defaultValue={c.slug} />
                        <Input name="sortOrder" type="number" label="Sort order" defaultValue={c.sortOrder} />
                        <Checkbox name="isActive" label="Shown on the site" defaultChecked={c.isActive} />
                        <SubmitButton size="sm">Save</SubmitButton>
                      </ActionForm>
                    </details>
                  ) : (
                    <span className="font-semibold">{c.name}</span>
                  )}
                </Td>
                <Td className="text-xs text-ink-mute">{c.slug}</Td>
                <Td className="text-sm">{c._count.boxes}</Td>
                <Td>
                  <Badge tone={c.isActive ? "good" : "neutral"}>{c.isActive ? "shown" : "hidden"}</Badge>
                </Td>
                <Td className="text-right">{canEdit && c._count.boxes === 0 && <ConfirmAction action={deleteCategory.bind(null, c.id)} label="Delete" variant="ghost" confirm={`Delete ${c.name}?`} />}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {canEdit && (
          <Panel title="Add a category">
            <ActionForm action={saveCategory.bind(null, null)} resetOnSuccess className="space-y-3">
              <Input name="name" label="Name" placeholder="e.g. Rice bowls" required />
              <Input name="nameNe" label="नाम (Nepali)" className="lang-ne" />
              <Input name="slug" label="URL name" hint="Leave blank to generate from the name" />
              <Checkbox name="isActive" label="Shown on the site" defaultChecked />
              <SubmitButton size="sm">Add category</SubmitButton>
            </ActionForm>
          </Panel>
        )}
      </div>
    </>
  );
}
