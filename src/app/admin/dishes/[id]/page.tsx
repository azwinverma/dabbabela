import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { CATEGORY_LABEL, DIET_LABEL } from "@/lib/labels";
import { rs, rupeesInput } from "@/lib/money";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Panel, Callout, Table, Th, Td } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Select, Checkbox } from "@/components/ui/Fields";
import { ImageField } from "@/components/admin/ImageField";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { RecipeEditor } from "../RecipeEditor";
import { deleteDish, restoreRecipeVersion, saveDish, saveRecipe } from "../actions";
import { setKitchenAvailability } from "../../boxes/actions";

export default async function DishPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("menu.view");
  const { id } = await params;
  const isNew = id === "new";
  const [dish, allergens, ingredients] = await Promise.all([
    isNew
      ? null
      : db.menuItem.findUnique({
          where: { id },
          include: {
            allergens: true,
            boxItems: { include: { box: { select: { id: true, name: true } } } },
            recipe: {
              include: {
                versions: { orderBy: { version: "desc" }, include: { ingredients: { include: { ingredient: true } } } },
              },
            },
          },
        }),
    db.allergen.findMany({ orderBy: { sortOrder: "asc" } }),
    db.ingredient.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, costPerUnit: true, allergenCodes: true } }),
  ]);
  if (!isNew && !dish) notFound();
  const has = new Map((dish?.allergens ?? []).map((a) => [a.allergenId, a.mayContain]));
  const current = dish?.recipe?.versions.find((v) => v.id === dish.recipe?.currentVersionId) ?? null;
  const ingAllergens = [...new Set((current?.ingredients ?? []).flatMap((l) => l.ingredient.allergenCodes))];
  const declared = new Set(allergens.filter((a) => has.get(a.id) === false).map((a) => a.code));
  const missing = ingAllergens.filter((c) => !declared.has(c));
  const canRecipe = can(user, "recipes.edit");

  return (
    <>
      <PageHeader title={isNew ? "New dish" : dish!.name} back={{ href: "/admin/dishes", label: "Dishes" }} actions={!isNew && <ConfirmAction action={deleteDish.bind(null, dish!.id)} label="Delete" variant="danger" confirm="Delete this dish permanently? (Only possible if no dabba uses it.)" />} />
      {missing.length > 0 && (
        <Callout tone="bad" className="mb-4" title="Allergen check">
          The current recipe uses ingredients containing <b>{missing.join(", ").toLowerCase()}</b>, but the dish doesn’t declare {missing.length > 1 ? "them" : "it"}. Tick them below.
        </Callout>
      )}
      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <ActionForm action={saveDish.bind(null, isNew ? null : dish!.id)} className="space-y-6">
          <>
            <>
              <Panel title="Basics">
                <div className="grid gap-4 md:grid-cols-2">
                  <Input name="name" label="Name (English)" defaultValue={dish?.name} required />
                  <Input name="nameNe" label="नाम (Nepali)" defaultValue={dish?.nameNe ?? ""} className="lang-ne" />
                  <Select name="category" label="Category" defaultValue={dish?.category ?? "MAIN"} options={Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ value, label }))} />
                  <Input name="station" label="Kitchen station" defaultValue={dish?.station ?? ""} hint="Groups the prep sheet, e.g. Wok, Dal & rice" />
                  <Textarea name="description" label="Description" defaultValue={dish?.description ?? ""} rows={3} />
                  <Textarea name="descriptionNe" label="विवरण (Nepali)" defaultValue={dish?.descriptionNe ?? ""} rows={3} />
                  <Input name="portionLabel" label="Portion" defaultValue={dish?.portionLabel ?? ""} placeholder="1 bowl (≈250 g)" />
                  <Input name="prepMinutes" type="number" min={0} label="Prep minutes" defaultValue={dish?.prepMinutes ?? ""} />
                </div>
                <div className="mt-4">
                  <ImageField name="image" label="Photo" defaultValue={dish?.image} hint="Use real photos of this dish. Without one, the site shows our illustration." />
                </div>
              </Panel>

              <Panel title="Diet & allergens">
                <div className="grid gap-4 md:grid-cols-3">
                  <Select name="diet" label="Diet" defaultValue={dish?.diet ?? "VEG"} options={Object.entries(DIET_LABEL).map(([value, d]) => ({ value, label: d.label }))} />
                  <Select name="spiceLevel" label="Spice" defaultValue={String(dish?.spiceLevel ?? 1)} options={["None", "Mild", "Medium", "Hot", "Very hot"].map((l, i) => ({ value: String(i), label: l }))} />
                  <div className="space-y-2 pt-5">
                    <Checkbox name="dietVerified" label="Diet verified by kitchen" defaultChecked={dish?.dietVerified ?? false} hint="e.g. confirmed no egg wash" />
                    <Checkbox name="hasOnionGarlic" label="Contains onion / garlic" defaultChecked={dish?.hasOnionGarlic ?? true} />
                  </div>
                </div>
                <fieldset className="mt-4">
                  <legend className="label">Allergens — contains / may contain (shared equipment)</legend>
                  <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                    {allergens.map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-ink-line/50 px-2.5 py-1.5 text-sm">
                        <span>
                          {a.name} <span className="lang-ne text-xs text-ink-mute">{a.nameNe}</span>
                        </span>
                        <span className="flex gap-3 text-xs">
                          <label className="flex items-center gap-1">
                            <input type="checkbox" name="allergen" value={a.id} defaultChecked={has.get(a.id) === false} className="accent-sindoor" /> contains
                          </label>
                          <label className="flex items-center gap-1">
                            <input type="checkbox" name="mayContain" value={a.id} defaultChecked={has.get(a.id) === true} className="accent-besar" /> may
                          </label>
                        </span>
                      </div>
                    ))}
                  </div>
                </fieldset>
              </Panel>

              <Panel title="Nutrition (per portion)">
                <p className="mb-3 text-sm text-ink-mute">Only shown publicly with its source label. Leave as “not shown” unless you’ve actually worked it out.</p>
                <div className="grid gap-4 md:grid-cols-4">
                  <Select
                    name="nutritionSource"
                    label="Source"
                    defaultValue={dish?.nutritionSource ?? "NONE"}
                    options={[
                      { value: "NONE", label: "Not shown" },
                      { value: "ESTIMATED", label: "Estimated" },
                      { value: "VERIFIED", label: "Verified (lab / nutritionist)" },
                    ]}
                  />
                  <Input name="calories" type="number" min={0} label="kcal" defaultValue={dish?.calories ?? ""} />
                  <Input name="proteinG" type="number" min={0} label="Protein g" defaultValue={dish?.proteinG ?? ""} />
                  <Input name="carbsG" type="number" min={0} label="Carbs g" defaultValue={dish?.carbsG ?? ""} />
                  <Input name="fatG" type="number" min={0} label="Fat g" defaultValue={dish?.fatG ?? ""} />
                  <Input name="nutritionNote" label="How it was worked out" defaultValue={dish?.nutritionNote ?? ""} className="md:col-span-3" />
                </div>
              </Panel>

              <Panel title="Pricing & availability">
                <div className="grid gap-4 md:grid-cols-3">
                  <Input name="price" label="Build-a-Dabba price (Rs)" inputMode="decimal" defaultValue={rupeesInput(dish?.price ?? 0)} />
                  <Input name="costPrice" label="Manual cost (Rs)" inputMode="decimal" defaultValue={rupeesInput(dish?.costPrice ?? 0)} hint="Overwritten whenever a recipe version is saved" />
                  <Input name="dailyLimit" type="number" min={0} label="Daily limit (builder)" defaultValue={dish?.dailyLimit ?? ""} hint="Blank = no limit" />
                  <Input name="sortOrder" type="number" label="Sort order" defaultValue={dish?.sortOrder ?? 0} />
                  <div className="space-y-2 pt-5 md:col-span-2">
                    <Checkbox name="allowCustom" label="Available in Build-a-Dabba" defaultChecked={dish?.allowCustom ?? true} />
                    <Checkbox name="isActive" label="Active" defaultChecked={dish?.isActive ?? true} />
                  </div>
                </div>
              </Panel>
              <SubmitButton>{isNew ? "Create dish" : "Save dish"}</SubmitButton>
            </>
          </>
        </ActionForm>

        <div className="space-y-6">
          {!isNew && (
            <Panel title={current ? `Recipe — version ${current.version}` : "Recipe"} actions={<Link href="/admin/inventory" className="text-xs font-semibold text-sindoor hover:underline">Manage ingredients →</Link>}>
              {canRecipe ? (
                ingredients.length ? (
                  <RecipeEditor
                    ingredients={ingredients}
                    builderPrice={dish!.price}
                    save={saveRecipe.bind(null, dish!.id)}
                    initial={{
                      yieldPortions: current?.yieldPortions ?? 10,
                      method: current?.method ?? "",
                      notes: "",
                      lines: (current?.ingredients ?? []).map((l) => ({ ingredientId: l.ingredientId, quantity: l.quantity, wastePct: l.wastePct })),
                    }}
                  />
                ) : (
                  <p className="text-sm text-ink-mute">Add ingredients in Inventory first.</p>
                )
              ) : (
                <p className="text-sm text-ink-mute">Your role can view dishes but not edit recipes.</p>
              )}
            </Panel>
          )}
          {!isNew && dish!.recipe && dish!.recipe.versions.length > 0 && (
            <Panel title="Recipe history" bodyClass="p-0">
              <Table className="rounded-none border-0 shadow-none">
                <thead>
                  <tr>
                    <Th>Version</Th>
                    <Th>Saved</Th>
                    <Th className="text-right">Cost / portion</Th>
                    <Th>Notes</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {dish!.recipe.versions.map((v) => (
                    <tr key={v.id}>
                      <Td className="font-semibold">
                        v{v.version}
                        {v.id === dish!.recipe!.currentVersionId && <span className="ml-1.5 text-xs text-saag">current</span>}
                      </Td>
                      <Td className="text-xs text-ink-mute">{formatStamp(v.createdAt)}</Td>
                      <Td className="text-right tabular-nums">{rs(v.costPerPortion)}</Td>
                      <Td className="max-w-[200px] truncate text-xs text-ink-mute" title={v.notes ?? ""}>
                        {v.ingredients.length} items · {v.notes ?? "—"}
                      </Td>
                      <Td className="text-right">{v.id !== dish!.recipe!.currentVersionId && canRecipe && <ConfirmAction action={restoreRecipeVersion.bind(null, dish!.id, v.id)} label="Make current" variant="ghost" />}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}
          {!isNew && (
            <DishKitchens dishId={dish!.id} canEdit={can(user, "menu.edit")} />
          )}
          {!isNew && (
            <Panel title="Used in">
              {dish!.boxItems.length ? (
                <ul className="space-y-1 text-sm">
                  {dish!.boxItems.map((b) => (
                    <li key={b.id}>
                      <Link href={`/admin/boxes/${b.box.id}`} className="font-medium hover:text-sindoor">
                        {b.box.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-mute">Not in any dabba yet.</p>
              )}
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

/** Per-kitchen availability of a dish. Dabbas containing an unavailable dish are hidden at that kitchen. */
async function DishKitchens({ dishId, canEdit }: { dishId: string; canEdit: boolean }) {
  const [kitchens, rows] = await Promise.all([
    db.kitchen.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.kitchenAvailability.findMany({ where: { menuItemId: dishId, isAvailable: false }, select: { kitchenId: true } }),
  ]);
  const off = new Set(rows.map((r) => r.kitchenId));
  return (
    <Panel title="Kitchen availability">
      <p className="mb-3 text-sm text-ink-mute">Marking a dish unavailable hides every dabba that contains it at that kitchen.</p>
      <ul className="space-y-2">
        {kitchens.map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-2 rounded-lg border border-ink-line/60 px-3 py-2 text-sm">
            <span>
              {k.name} <span className={`ml-1 text-xs font-semibold ${off.has(k.id) ? "text-sindoor" : "text-saag"}`}>{off.has(k.id) ? "unavailable" : "available"}</span>
            </span>
            {canEdit && <ConfirmAction action={setKitchenAvailability.bind(null, { menuItemId: dishId }, k.id, off.has(k.id))} label={off.has(k.id) ? "Make available" : "Mark unavailable"} variant="ghost" />}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
