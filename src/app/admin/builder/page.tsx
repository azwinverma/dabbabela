import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { CATEGORY_LABEL } from "@/lib/labels";
import { rs, rupeesInput } from "@/lib/money";
import { PageHeader, Panel, Callout } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Checkbox } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { addOption, addRule, deleteGroup, deleteRule, removeOption, saveBuilderLimits, saveGroup } from "./actions";

export default async function BuilderPage() {
  await requirePermission("menu.view");
  const [groups, dishes, rules, s] = await Promise.all([
    db.customizationGroup.findMany({ orderBy: { sortOrder: "asc" }, include: { options: { orderBy: { sortOrder: "asc" }, include: { menuItem: true } } } }),
    db.menuItem.findMany({ where: { isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.comboRule.findMany({ include: { itemA: true, itemB: true }, orderBy: { kind: "asc" } }),
    getSettings(),
  ]);
  const catOpts = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }));
  const dishOpts = dishes.map((d) => ({ value: d.id, label: `${d.name} · ${rs(d.price)}` }));
  const required = groups.filter((g) => g.isActive && g.minSelect > 0);

  return (
    <>
      <PageHeader title="Build-a-Dabba rules" description="The steps customers go through, which dishes they can pick, and combinations the kitchen won't make. Prices are always recalculated on the server." />
      {required.length === 0 && <Callout tone="warn" className="mb-4">No step is required — a customer could build a dabba of just achar. Make at least one step (e.g. base or main) require a pick, and keep a minimum price.</Callout>}
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {groups.map((g) => (
            <Panel key={g.id} title={`${g.sortOrder}. ${g.name}`} actions={<ConfirmAction action={deleteGroup.bind(null, g.id)} label="Delete step" variant="ghost" confirm={`Delete the step "${g.name}"?`} />} className={g.isActive ? "" : "opacity-70"}>
              <ActionForm action={saveGroup.bind(null, g.id)} className="grid gap-3 sm:grid-cols-6 sm:items-end">
                <Input name="name" label="Step" defaultValue={g.name} className="sm:col-span-2" />
                <Input name="nameNe" label="नेपाली" defaultValue={g.nameNe ?? ""} className="lang-ne" />
                <Select name="category" label="Category" defaultValue={g.category} options={catOpts} />
                <Input name="minSelect" type="number" min={0} label="Min" defaultValue={g.minSelect} />
                <Input name="maxSelect" type="number" min={0} label="Max" defaultValue={g.maxSelect} />
                <Input name="sortOrder" type="number" label="Order" defaultValue={g.sortOrder} />
                <Checkbox name="isActive" label="Active" defaultChecked={g.isActive} className="sm:col-span-3" />
                <SubmitButton size="sm" variant="dark" className="sm:col-span-2">Save step</SubmitButton>
              </ActionForm>
              <ul className="mt-4 flex flex-wrap gap-2">
                {g.options.map((o) => (
                  <li key={o.id} className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${o.menuItem.isActive && o.menuItem.allowCustom ? "border-ink-line" : "border-dashed border-sindoor/50 text-ink-mute"}`}>
                    <span className="font-medium">{o.menuItem.name}</span>
                    <span className="tabular-nums text-ink-mute">{rs(o.priceOverride ?? o.menuItem.price)}</span>
                    {o.isDefault && <span className="font-semibold text-saag">default</span>}
                    {(!o.menuItem.isActive || !o.menuItem.allowCustom) && <span>hidden</span>}
                    <ConfirmAction action={removeOption.bind(null, o.id)} label="✕" variant="ghost" className="h-6 px-1" />
                  </li>
                ))}
                {g.options.length === 0 && <li className="text-xs text-ink-mute">No dishes in this step yet.</li>}
              </ul>
              <ActionForm action={addOption.bind(null, g.id)} resetOnSuccess className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px_auto_auto] sm:items-end">
                <Select name="menuItemId" label="Add dish" options={dishOpts.filter((d) => !g.options.some((o) => o.menuItemId === d.value))} placeholder="Choose…" />
                <Input name="priceOverride" label="Price Rs (opt.)" inputMode="decimal" />
                <Checkbox name="isDefault" label="Default" className="pb-2" />
                <SubmitButton size="sm" variant="outline">Add</SubmitButton>
              </ActionForm>
            </Panel>
          ))}
          <Panel title="Add a step">
            <ActionForm action={saveGroup.bind(null, null)} resetOnSuccess className="grid gap-3 sm:grid-cols-6 sm:items-end">
              <Input name="name" label="Step name" className="sm:col-span-2" placeholder="Pick a base" />
              <Select name="category" label="Category" options={catOpts} />
              <Input name="minSelect" type="number" min={0} label="Min" defaultValue={0} />
              <Input name="maxSelect" type="number" min={0} label="Max" defaultValue={1} />
              <Input name="sortOrder" type="number" label="Order" defaultValue={groups.length} />
              <input type="hidden" name="isActive" value="on" />
              <SubmitButton size="sm" className="sm:col-span-2">Add step</SubmitButton>
            </ActionForm>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel title="Limits">
            <ActionForm action={saveBuilderLimits} className="space-y-3">
              <Input name="builderMinPrice" label="Minimum dabba price (Rs)" defaultValue={rupeesInput(s.builderMinPrice)} hint="A custom dabba is never charged less than this, so impossibly cheap combinations can't be ordered." />
              <Input name="builderMaxQty" type="number" min={1} max={5} label="Max portions of one dish" defaultValue={s.builderMaxQty} />
              <SubmitButton size="sm">Save limits</SubmitButton>
            </ActionForm>
          </Panel>
          <Panel title="Combination rules">
            <ul className="mb-4 space-y-2 text-sm">
              {rules.length === 0 && <li className="text-ink-mute">No rules.</li>}
              {rules.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-2 rounded-lg border border-ink-line/60 px-3 py-2">
                  <span>
                    <b>{r.itemA.name}</b> {r.kind === "EXCLUDE" ? "never with" : "needs"} <b>{r.itemB.name}</b>
                    {r.message && <span className="block text-xs text-ink-mute">“{r.message}”</span>}
                  </span>
                  <ConfirmAction action={deleteRule.bind(null, r.id)} label="✕" variant="ghost" className="h-7 px-2" />
                </li>
              ))}
            </ul>
            <ActionForm action={addRule} resetOnSuccess className="space-y-2">
              <Select name="itemAId" label="Dish" options={dishOpts} placeholder="Choose…" />
              <Select name="kind" label="Rule" options={[{ value: "EXCLUDE", label: "can't go with" }, { value: "REQUIRE", label: "requires" }]} />
              <Select name="itemBId" label="Other dish" options={dishOpts} placeholder="Choose…" />
              <Input name="message" label="Message to customer" placeholder="Fried rice already fills the base" />
              <SubmitButton size="sm" variant="outline">Add rule</SubmitButton>
            </ActionForm>
          </Panel>
        </div>
      </div>
    </>
  );
}
