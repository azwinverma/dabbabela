import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";
import { CATEGORY_LABEL, DIET_LABEL } from "@/lib/labels";
import { rs, rupeesInput } from "@/lib/money";
import { DIET_RULES, dietSatisfies, isDietRule } from "@/server/builder";
import { PageHeader, Panel, Callout } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Checkbox } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { addOption, addPortion, addRule, availabilityForm, deleteGroup, deleteRule, removeOption, removePortion, saveBuilderLimits, saveGroup, setOptionAvailability } from "./actions";

const RULE_OPTS = [{ value: "", label: "No diet rule" }, ...Object.entries(DIET_RULES).map(([value, r]) => ({ value, label: r.label }))];

export default async function BuilderPage() {
  const user = await requirePermission("menu.view");
  const canEdit = can(user, "menu.edit");
  const [groups, dishes, rules, kitchens, s] = await Promise.all([
    db.customizationGroup.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        options: {
          orderBy: { sortOrder: "asc" },
          include: {
            menuItem: { include: { recipe: { select: { currentVersionId: true } } } },
            portions: { orderBy: { sortOrder: "asc" } },
            kitchenAvailability: { where: { isAvailable: false }, include: { kitchen: { select: { name: true } } } },
          },
        },
      },
    }),
    db.menuItem.findMany({ where: { isActive: true }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.comboRule.findMany({ include: { itemA: true, itemB: true }, orderBy: { kind: "asc" } }),
    db.kitchen.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    getSettings(),
  ]);
  const catOpts = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }));
  const dishOpts = dishes.map((d) => ({ value: d.id, label: `${d.name} · ${rs(d.price)} · ${DIET_LABEL[d.diet].label}` }));
  const kitchenOpts = kitchens.map((k) => ({ value: k.id, label: k.name }));
  const required = groups.filter((g) => g.isActive && g.minSelect > 0);

  return (
    <>
      <PageHeader
        title="Build-a-Dabba rules"
        description="The steps customers go through, which dishes they can pick, portion sizes, diet rules, per-kitchen availability and combinations the kitchen won't make. Prices are always recalculated on the server."
      />
      {required.length === 0 && <Callout tone="warn" className="mb-4">No step is required — a customer could build a dabba of just achar. Make at least one step (e.g. base or main) require a pick, and keep a minimum price.</Callout>}
      {!canEdit && <Callout className="mb-4">You can view these rules. Ask an admin for “Dishes, dabbas & weekly menus → Edit” to change them.</Callout>}
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {groups.map((g) => {
            const rule = isDietRule(g.dietRule) ? DIET_RULES[g.dietRule] : null;
            return (
              <Panel key={g.id} title={`${g.sortOrder}. ${g.name}`} actions={canEdit ? <ConfirmAction action={deleteGroup.bind(null, g.id)} label="Delete step" variant="ghost" confirm={`Delete the step "${g.name}"?`} /> : null} className={g.isActive ? "" : "opacity-70"}>
                <ActionForm action={saveGroup.bind(null, g.id)} className="grid gap-3 sm:grid-cols-6 sm:items-end">
                  <Input name="name" label="Step" defaultValue={g.name} className="sm:col-span-2" />
                  <Input name="nameNe" label="नेपाली" defaultValue={g.nameNe ?? ""} className="lang-ne" />
                  <Select name="category" label="Category" defaultValue={g.category} options={catOpts} />
                  <Input name="minSelect" type="number" min={0} label="Min" defaultValue={g.minSelect} hint={g.minSelect > 0 ? "Required" : "Optional"} />
                  <Input name="maxSelect" type="number" min={1} label="Max" defaultValue={g.maxSelect} />
                  <Select name="dietRule" label="Diet rule" defaultValue={g.dietRule ?? ""} options={RULE_OPTS} className="sm:col-span-3" />
                  <Input name="sortOrder" type="number" label="Order" defaultValue={g.sortOrder} />
                  <Checkbox name="isActive" label="Active" defaultChecked={g.isActive} className="pb-2" />
                  {canEdit && <SubmitButton size="sm" variant="dark">Save step</SubmitButton>}
                </ActionForm>
                <ul className="mt-4 space-y-2">
                  {g.options.map((o) => {
                    const hidden = !o.menuItem.isActive || !o.menuItem.allowCustom;
                    const breaksRule = rule?.scope === "GROUP" && !dietSatisfies(o.menuItem.diet, rule.level);
                    const base = o.priceOverride ?? o.menuItem.price;
                    return (
                      <li key={o.id} className={`rounded-lg border px-3 py-2 text-sm ${hidden || breaksRule ? "border-dashed border-sindoor/50" : "border-ink-line"}`}>
                        <details>
                          <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                            <span className="font-medium">{o.menuItem.name}</span>
                            <span className="tabular-nums text-ink-mute">{rs(base)}</span>
                            <span className="text-xs text-ink-mute">{DIET_LABEL[o.menuItem.diet].label}</span>
                            {o.isDefault && <span className="text-xs font-semibold text-saag">default</span>}
                            {o.portions.length > 0 && <span className="text-xs text-ink-mute">· {o.portions.length} portion{o.portions.length > 1 ? "s" : ""}</span>}
                            {o.menuItem.dailyLimit != null && <span className="text-xs text-ink-mute">· limit {o.menuItem.dailyLimit}/day</span>}
                            {!o.menuItem.recipe?.currentVersionId && <span className="text-xs text-ink-mute">· no recipe (stock not checked)</span>}
                            {o.kitchenAvailability.length > 0 && <span className="text-xs font-semibold text-sindoor">off at {o.kitchenAvailability.map((k) => k.kitchen.name).join(", ")}</span>}
                            {hidden && <span className="text-xs text-sindoor">hidden (dish inactive or not for building)</span>}
                            {breaksRule && <span className="text-xs font-semibold text-sindoor">breaks this step&apos;s diet rule — hidden from customers</span>}
                          </summary>
                          <div className="mt-3 grid gap-4 md:grid-cols-2">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wide text-ink-mute">Portions</p>
                              <ul className="mt-1 space-y-1">
                                {o.portions.length === 0 && <li className="text-xs text-ink-mute">One size. Add portions to let customers pick Regular / Large.</li>}
                                {o.portions.map((p, i) => (
                                  <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                                    <span>
                                      <b>{p.label}</b> · ×{p.qtyMultiplier} · {p.priceDelta === 0 ? "same price" : `${p.priceDelta > 0 ? "+" : "−"}${rs(Math.abs(p.priceDelta))}`} = {rs(Math.max(0, base + p.priceDelta))}
                                      {i === 0 && <span className="ml-1 text-ink-mute">(default)</span>}
                                    </span>
                                    {canEdit && <ConfirmAction action={removePortion.bind(null, p.id)} label="✕" variant="ghost" className="h-6 px-1" />}
                                  </li>
                                ))}
                              </ul>
                              {canEdit && (
                                <ActionForm action={addPortion.bind(null, o.id)} resetOnSuccess className="mt-2 grid grid-cols-3 gap-2 sm:items-end">
                                  <Input name="label" label="Portion" placeholder="Large" />
                                  <Input name="qtyMultiplier" label="Size ×" inputMode="decimal" defaultValue="1" />
                                  <Input name="priceDelta" label="± Rs" inputMode="decimal" placeholder="30 or -10" />
                                  <SubmitButton size="sm" variant="outline" className="col-span-3">Add portion</SubmitButton>
                                </ActionForm>
                              )}
                            </div>
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wide text-ink-mute">Kitchen availability</p>
                              <ul className="mt-1 space-y-1">
                                {o.kitchenAvailability.length === 0 && <li className="text-xs text-ink-mute">On at every kitchen.</li>}
                                {o.kitchenAvailability.map((k) => (
                                  <li key={k.id} className="flex items-center justify-between gap-2 text-xs">
                                    <span>
                                      Off at <b>{k.kitchen.name}</b>
                                      {k.note && <span className="text-ink-mute"> — {k.note}</span>}
                                    </span>
                                    {canEdit && <ConfirmAction action={setOptionAvailability.bind(null, o.id, k.kitchenId, true, null)} label="Turn on" variant="ghost" className="h-6 px-2" />}
                                  </li>
                                ))}
                              </ul>
                              {canEdit && kitchens.length > 0 && (
                                <ActionForm action={availabilityForm.bind(null, o.id)} resetOnSuccess className="mt-2 grid grid-cols-2 gap-2 sm:items-end">
                                  <Select name="kitchenId" label="Kitchen" options={kitchenOpts} placeholder="Choose…" />
                                  <input type="hidden" name="state" value="off" />
                                  <Input name="note" label="Why (opt.)" placeholder="No tandoor" />
                                  <SubmitButton size="sm" variant="outline" className="col-span-2">Switch off here</SubmitButton>
                                </ActionForm>
                              )}
                              {canEdit && (
                                <div className="mt-3">
                                  <ConfirmAction action={removeOption.bind(null, o.id)} label="Remove from step" variant="ghost" confirm={`Remove ${o.menuItem.name} from "${g.name}"?`} />
                                </div>
                              )}
                            </div>
                          </div>
                        </details>
                      </li>
                    );
                  })}
                  {g.options.length === 0 && <li className="text-xs text-ink-mute">No dishes in this step yet.</li>}
                </ul>
                {canEdit && (
                  <ActionForm action={addOption.bind(null, g.id)} resetOnSuccess className="mt-3 grid gap-2 sm:grid-cols-[1fr_120px_auto_auto] sm:items-end">
                    <Select
                      name="menuItemId"
                      label="Add dish"
                      options={dishOpts.filter((d) => !g.options.some((o) => o.menuItemId === d.value) && (rule?.scope !== "GROUP" || dietSatisfies(dishes.find((x) => x.id === d.value)!.diet, rule.level)))}
                      placeholder="Choose…"
                    />
                    <Input name="priceOverride" label="Price Rs (opt.)" inputMode="decimal" />
                    <Checkbox name="isDefault" label="Default" className="pb-2" />
                    <SubmitButton size="sm" variant="outline">Add</SubmitButton>
                  </ActionForm>
                )}
              </Panel>
            );
          })}
          {canEdit && (
            <Panel title="Add a step">
              <ActionForm action={saveGroup.bind(null, null)} resetOnSuccess className="grid gap-3 sm:grid-cols-6 sm:items-end">
                <Input name="name" label="Step name" className="sm:col-span-2" placeholder="Pick a base" />
                <Select name="category" label="Category" options={catOpts} />
                <Input name="minSelect" type="number" min={0} label="Min" defaultValue={0} />
                <Input name="maxSelect" type="number" min={1} label="Max" defaultValue={1} />
                <Input name="sortOrder" type="number" label="Order" defaultValue={groups.length} />
                <Select name="dietRule" label="Diet rule" defaultValue="" options={RULE_OPTS} className="sm:col-span-4" />
                <input type="hidden" name="isActive" value="on" />
                <SubmitButton size="sm" className="sm:col-span-2">Add step</SubmitButton>
              </ActionForm>
            </Panel>
          )}
        </div>
        <div className="space-y-4">
          <Panel title="Limits">
            <ActionForm action={saveBuilderLimits} className="space-y-3">
              <Input name="builderMinPrice" label="Minimum dabba price (Rs)" defaultValue={rupeesInput(s.builderMinPrice)} hint="A custom dabba is never charged less than this, so impossibly cheap combinations can't be ordered." />
              <Input name="builderMaxQty" type="number" min={1} max={5} label="Max portions of one dish" defaultValue={s.builderMaxQty} />
              {canEdit && <SubmitButton size="sm">Save limits</SubmitButton>}
            </ActionForm>
            <p className="mt-3 text-xs text-ink-mute">Daily production limits are set per dish under Dishes &amp; recipes; the builder respects them at checkout. Ingredient stock is checked against the kitchen&apos;s inventory and shown to customers as a soft warning.</p>
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
                  {canEdit && <ConfirmAction action={deleteRule.bind(null, r.id)} label="✕" variant="ghost" className="h-7 px-2" />}
                </li>
              ))}
            </ul>
            {canEdit && (
              <ActionForm action={addRule} resetOnSuccess className="space-y-2">
                <Select name="itemAId" label="Dish" options={dishOpts} placeholder="Choose…" />
                <Select name="kind" label="Rule" options={[{ value: "EXCLUDE", label: "can't go with" }, { value: "REQUIRE", label: "requires" }]} />
                <Select name="itemBId" label="Other dish" options={dishOpts} placeholder="Choose…" />
                <Input name="message" label="Message to customer" placeholder="Fried rice already fills the base" />
                <SubmitButton size="sm" variant="outline">Add rule</SubmitButton>
              </ActionForm>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
