import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { rs, rupeesInput } from "@/lib/money";
import { DIET_LABEL } from "@/lib/labels";
import { boxFacts, boxInclude } from "@/server/menu";
import { PageHeader, Panel, KV, Callout } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Select, Checkbox } from "@/components/ui/Fields";
import { ImageField } from "@/components/admin/ImageField";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { Composer } from "../Composer";
import { addSubstitution, deleteBox, deleteSubstitution, saveBox, setKitchenAvailability, toggleSubstitution } from "../actions";

export default async function BoxPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("menu.view");
  const { id } = await params;
  const isNew = id === "new";
  const [box, dishes, categories, kitchens, availability] = await Promise.all([
    isNew ? null : db.lunchBox.findUnique({ where: { id }, include: { ...boxInclude, substitutions: { include: { fromItem: true, toItem: { include: { allergens: { include: { allergen: true } } } } } } } }),
    db.menuItem.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: { allergens: { include: { allergen: true } }, recipe: { include: { currentVersion: { select: { costPerPortion: true } } } } },
    }),
    db.mealCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.kitchen.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    isNew ? [] : db.kitchenAvailability.findMany({ where: { boxId: id, isAvailable: false } }),
  ]);
  const off = new Set(availability.map((a) => a.kitchenId));
  const dishOff = isNew || !box ? [] : await db.kitchenAvailability.findMany({ where: { menuItemId: { in: box.items.map((i) => i.menuItemId) }, isAvailable: false }, include: { menuItem: { select: { name: true } } } });
  if (!isNew && !box) notFound();
  const facts = box ? boxFacts(box) : null;
  const dishOpts = dishes.map((d) => ({ id: d.id, name: d.name, category: d.category, cost: d.recipe?.currentVersion?.costPerPortion || d.costPrice, diet: d.diet, allergens: d.allergens.filter((a) => !a.mayContain).map((a) => a.allergen.code), isActive: d.isActive }));

  return (
    <>
      <PageHeader title={isNew ? "New dabba" : box!.name} back={{ href: "/admin/boxes", label: "Dabbas" }} actions={!isNew && <ConfirmAction action={deleteBox.bind(null, box!.id)} label="Delete" variant="danger" confirm="Delete permanently? Only possible if it was never ordered or put on a menu." />} />
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <ActionForm action={saveBox.bind(null, isNew ? null : box!.id)} className="space-y-6">
          <>
            <>
              <Panel title="What's inside">
                <Composer dishes={dishOpts} initial={(box?.items ?? []).map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity }))} price={box?.price ?? 0} />
              </Panel>
              <Panel title="Details">
                <div className="grid gap-4 md:grid-cols-2">
                  <Input name="name" label="Name" defaultValue={box?.name} required />
                  <Input name="nameNe" label="नाम (Nepali)" defaultValue={box?.nameNe ?? ""} className="lang-ne" />
                  <Input name="tagline" label="Tagline" defaultValue={box?.tagline ?? ""} />
                  <Input name="taglineNe" label="Tagline (Nepali)" defaultValue={box?.taglineNe ?? ""} className="lang-ne" />
                  <Input name="shortDescription" label="Short description" defaultValue={box?.shortDescription ?? ""} hint="One line for menu cards (max 200 characters)" maxLength={200} />
                  <Input name="shortDescriptionNe" label="Short description (Nepali)" defaultValue={box?.shortDescriptionNe ?? ""} className="lang-ne" maxLength={200} />
                  <Textarea name="description" label="Description" rows={3} defaultValue={box?.description ?? ""} />
                  <Textarea name="descriptionNe" label="विवरण (Nepali)" rows={3} defaultValue={box?.descriptionNe ?? ""} />
                  <Textarea name="healthNote" label="Why it works" rows={2} defaultValue={box?.healthNote ?? ""} hint="Honest and specific. No medical or probiotic/complete-protein claims." />
                  <Textarea name="healthNoteNe" label="Why it works (Nepali)" rows={2} defaultValue={box?.healthNoteNe ?? ""} />
                  <Textarea name="kitchenNote" label="Kitchen note (internal)" rows={2} defaultValue={box?.kitchenNote ?? ""} hint="Batching / station notes. Never shown to customers." />
                  <Input name="portionNote" label="Portion note" defaultValue={box?.portionNote ?? ""} />
                  <Input name="slug" label="URL name" defaultValue={box?.slug ?? ""} hint="Leave blank to generate from the name" />
                  <Input name="tags" label="Tags" defaultValue={box?.tags.join(", ") ?? ""} hint="Comma separated, e.g. Classic, Budget" />
                  <Select name="categoryId" label="Meal category" defaultValue={box?.categoryId ?? ""} placeholder="No category" options={categories.map((c) => ({ value: c.id, label: c.isActive ? c.name : `${c.name} (hidden)` }))} hint="Customers filter the menu by category" />
                </div>
              </Panel>
              <Panel title="Price & look">
                <div className="grid gap-4 md:grid-cols-3">
                  <Input name="price" label="Price (Rs)" inputMode="decimal" defaultValue={box ? rupeesInput(box.price) : ""} required />
                  <Select name="accent" label="Illustration colour" defaultValue={box?.accent ?? "achar"} options={["achar", "turmeric", "saag", "charcoal"].map((v) => ({ value: v, label: v }))} />
                  <Input name="sortOrder" type="number" label="Sort order" defaultValue={box?.sortOrder ?? 0} />
                  <Input name="packagingCost" label="Packaging cost (Rs)" inputMode="decimal" defaultValue={box ? rupeesInput(box.packagingCost) : ""} hint="Per box, for profitability estimates" />
                  <Input name="maxDailyQty" type="number" min={0} label="Max per day (per kitchen)" defaultValue={box?.maxDailyQty ?? ""} hint="Blank = no limit. A menu day's quantity can only be lower." />
                </div>
                <div className="mt-4">
                  <ImageField name="image" label="Photo" defaultValue={box?.image} hint="Real photo of this dabba. Without one, the site shows a hand-drawn illustration." />
                </div>
                <div className="mt-4 flex flex-wrap gap-6">
                  <Checkbox name="isSpecial" label="Special (one day a week)" defaultChecked={box?.isSpecial ?? false} />
                  <Checkbox name="isActive" label="Active" defaultChecked={box?.isActive ?? true} />
                  <Checkbox name="isVisible" label="Visible on the website" defaultChecked={box?.isVisible ?? true} />
                  <Checkbox name="isFeatured" label="Featured" defaultChecked={box?.isFeatured ?? false} />
                </div>
              </Panel>
              <SubmitButton>{isNew ? "Create dabba" : "Save dabba"}</SubmitButton>
            </>
          </>
        </ActionForm>

        {!isNew && box && facts && (
          <div className="space-y-6">
            <Panel title="Derived facts">
              <KV
                items={[
                  ["Diet", `${DIET_LABEL[facts.diet].label}${facts.dietVerified ? " (verified)" : " (not all dishes verified)"}`],
                  ["Allergens", facts.allergens.map((a) => `${a.name}${a.mayContain ? " (may contain)" : ""}`).join(", ") || "None listed"],
                  ["Onion / garlic", facts.hasOnionGarlic ? "Yes" : "No"],
                  ["Spice", ["None", "Mild", "Medium", "Hot", "Very hot"][facts.spice]],
                  ["Food + packaging cost", rs(box.costPrice)],
                  ["Packaging (per box)", box.packagingCost ? rs(box.packagingCost) : "Not set"],
                  ["Category", box.category?.name ?? "None"],
                  ["On the website", `${box.isVisible ? "Visible" : "Hidden"}${box.isFeatured ? " · featured" : ""}`],
                  ["Margin", `${rs(box.price - box.costPrice)} (${box.price ? Math.round(((box.price - box.costPrice) / box.price) * 100) : 0}%)`],
                  ["Nutrition", facts.nutrition ? `${facts.nutrition.calories} kcal · ${facts.nutrition.proteinG} g protein (${facts.nutrition.source.toLowerCase()})` : "Not shown (some dishes have no nutrition source)"],
                ]}
              />
            </Panel>
            <Panel title="Kitchen availability">
              <p className="mb-3 text-sm text-ink-mute">Hide this dabba at a kitchen that can't make it. It disappears from that kitchen's menu and can't be ordered there.</p>
              {kitchens.length === 0 && <p className="text-sm text-ink-mute">No active kitchens.</p>}
              <ul className="space-y-2">
                {kitchens.map((k) => (
                  <li key={k.id} className="flex items-center justify-between gap-2 rounded-lg border border-ink-line/60 px-3 py-2 text-sm">
                    <span>
                      {k.name} <span className={`ml-1 text-xs font-semibold ${off.has(k.id) ? "text-sindoor" : "text-saag"}`}>{off.has(k.id) ? "unavailable" : "available"}</span>
                    </span>
                    <ConfirmAction action={setKitchenAvailability.bind(null, { boxId: box.id }, k.id, off.has(k.id))} label={off.has(k.id) ? "Make available" : "Mark unavailable"} variant="ghost" />
                  </li>
                ))}
              </ul>
              {dishOff.length > 0 && (
                <Callout tone="warn" className="mt-3">
                  Also hidden where a dish inside is unavailable: {dishOff.map((d) => `${d.menuItem?.name} (${kitchens.find((k) => k.id === d.kitchenId)?.name ?? "kitchen"})`).join(", ")}.
                </Callout>
              )}
            </Panel>
            <Panel title="Chef-approved swaps">
              <p className="mb-3 text-sm text-ink-mute">Customers can pick these when ordering this dabba. Price change is added to the dabba price.</p>
              {box.substitutions.length === 0 && <Callout tone="info">No swaps yet.</Callout>}
              <ul className="space-y-2">
                {box.substitutions.map((s) => (
                  <li key={s.id} className={`flex items-center justify-between gap-2 rounded-lg border border-ink-line/60 px-3 py-2 text-sm ${s.isActive ? "" : "opacity-50"}`}>
                    <span>
                      {s.fromItem.name} → <b>{s.toItem.name}</b>{" "}
                      <span className="text-xs text-ink-mute">{s.priceDelta === 0 ? "same price" : `${s.priceDelta > 0 ? "+" : ""}${rs(s.priceDelta)}`}</span>
                    </span>
                    <span className="flex gap-1">
                      <ConfirmAction action={toggleSubstitution.bind(null, s.id)} label={s.isActive ? "Pause" : "Enable"} variant="ghost" />
                      <ConfirmAction action={deleteSubstitution.bind(null, s.id)} label="Delete" variant="ghost" confirm="Remove this swap?" />
                    </span>
                  </li>
                ))}
              </ul>
              <ActionForm action={addSubstitution.bind(null, box.id)} resetOnSuccess className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_110px_auto] sm:items-end">
                <Select name="fromItemId" label="Replace" options={box.items.map((i) => ({ value: i.menuItemId, label: i.menuItem.name }))} placeholder="Dish in box" />
                <Select name="toItemId" label="With" options={dishes.filter((d) => d.isActive).map((d) => ({ value: d.id, label: d.name }))} placeholder="Replacement" />
                <Input name="priceDelta" label="± Rs" placeholder="0" />
                <SubmitButton size="sm">Add swap</SubmitButton>
              </ActionForm>
            </Panel>
          </div>
        )}
      </div>
    </>
  );
}
