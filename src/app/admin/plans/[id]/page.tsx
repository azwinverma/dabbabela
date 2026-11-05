import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { rs, rupeesInput } from "@/lib/money";
import { formatStamp, isoDate, todayKTM } from "@/lib/dates";
import { PageHeader, Panel, Table, Th, Td, EmptyRow } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea, Select, Checkbox } from "@/components/ui/Fields";
import { planPriceHistory, planPriceOn, POLICY_TEXT } from "@/server/subscriptions";
import { savePlan, schedulePrice } from "../actions";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("plans.view");
  const { id } = await params;
  const isNew = id === "new";
  const p = isNew ? null : await db.mealPlan.findUnique({ where: { id } });
  if (!isNew && !p) notFound();
  const editable = can(user, "plans.edit");
  const today = todayKTM();
  const [history, current, livePlans] = p
    ? await Promise.all([planPriceHistory(p.id), planPriceOn(p), db.subscription.count({ where: { planId: p.id, status: { in: ["ACTIVE", "PAUSED", "PENDING_PAYMENT"] } } })])
    : [[], null, 0];
  return (
    <>
      <PageHeader title={isNew ? "New plan" : p!.name} back={{ href: "/admin/plans", label: "Plan catalogue" }} />
      <ActionForm action={savePlan.bind(null, isNew ? null : p!.id)} className="max-w-4xl space-y-6">
        <>
          <>
            <Panel title="Plan">
              <div className="grid gap-4 md:grid-cols-2">
                <Input name="name" label="Name" defaultValue={p?.name} required />
                <Input name="nameNe" label="नाम (Nepali)" defaultValue={p?.nameNe ?? ""} className="lang-ne" />
                <Select name="kind" label="Kind" defaultValue={p?.kind ?? "WEEKLY"} options={[{ value: "WEEKLY", label: "Weekly" }, { value: "MONTHLY", label: "Monthly" }, { value: "OFFICE", label: "Office / team" }, { value: "CUSTOM", label: "Custom" }]} />
                <Input name="slug" label="URL name" defaultValue={p?.slug ?? ""} hint="Blank = from name" />
                <Input name="tagline" label="Tagline" defaultValue={p?.tagline ?? ""} className="md:col-span-2" />
                <Textarea name="description" label="Description" rows={3} defaultValue={p?.description ?? ""} className="md:col-span-2" />
                <Textarea name="features" label="Features (one per line)" rows={4} defaultValue={p?.features.join("\n") ?? ""} />
                <Textarea name="policyNote" label="Pause / refund wording shown before purchase" rows={4} defaultValue={p?.policyNote ?? ""} />
              </div>
            </Panel>
            <Panel title="Rules & price">
              <div className="grid gap-4 md:grid-cols-4">
                <Input name="durationWeeks" type="number" min={1} max={26} label="Weeks" defaultValue={p?.durationWeeks ?? 1} />
                <Input name="minDaysPerWeek" type="number" min={1} max={7} label="Min days / week" defaultValue={p?.minDaysPerWeek ?? 3} />
                <Input name="pricePerMeal" label="Price per meal (Rs)" inputMode="decimal" defaultValue={p ? rupeesInput(p.pricePerMeal) : ""} />
                <Input name="compareAtPrice" label="Regular price (Rs)" inputMode="decimal" defaultValue={p?.compareAtPrice != null ? rupeesInput(p.compareAtPrice) : ""} />
                <Input name="maxPauseDays" type="number" min={0} label="Max pause days" defaultValue={p?.maxPauseDays ?? 10} />
                <Input name="minWeeks" type="number" min={1} max={26} label="Shortest (weeks)" defaultValue={p?.minWeeks ?? ""} hint="Blank = fixed length" />
                <Input name="maxWeeks" type="number" min={1} max={26} label="Longest (weeks)" defaultValue={p?.maxWeeks ?? ""} hint="Blank = fixed length" />
                <Input name="renewalReminderDays" type="number" min={0} max={14} label="Renewal reminder (days before end)" defaultValue={p?.renewalReminderDays ?? 3} />
                <Input name="effectiveFrom" type="date" label="On sale from" defaultValue={p?.effectiveFrom ? isoDate(p.effectiveFrom) : ""} />
                <Input name="effectiveTo" type="date" label="On sale until" defaultValue={p?.effectiveTo ? isoDate(p.effectiveTo) : ""} />
                <Input name="sortOrder" type="number" label="Sort order" defaultValue={p?.sortOrder ?? 0} />
              </div>
              <div className="mt-4 flex flex-wrap gap-6">
                <Checkbox name="includesDelivery" label="Delivery included" defaultChecked={p?.includesDelivery ?? true} />
                <Checkbox name="isPopular" label="Mark as popular" defaultChecked={p?.isPopular ?? false} />
                <Checkbox name="isCorporate" label="Team / corporate plan" defaultChecked={p?.isCorporate ?? false} />
                <Checkbox name="isActive" label="On sale" defaultChecked={p?.isActive ?? true} />
              </div>
            </Panel>
            <Panel title="Policies">
              <div className="grid gap-4 md:grid-cols-2">
                <Select
                  name="skipPolicy"
                  label="When a paid meal is skipped"
                  defaultValue={p?.skipPolicy ?? ""}
                  options={[{ value: "", label: "Use the global setting" }, { value: "EXTEND", label: "Move it to the end of the plan" }, { value: "CREDIT", label: "Credit its value to the wallet" }]}
                />
                <Select
                  name="cancelPolicy"
                  label="When the customer cancels"
                  defaultValue={p?.cancelPolicy ?? ""}
                  options={[{ value: "", label: "Wallet credit (default)" }, { value: "CREDIT", label: "Wallet credit" }, { value: "REFUND", label: "Refund to original method (finance)" }, { value: "STAFF_ONLY", label: "Only via support (no online cancel)" }]}
                />
              </div>
              <p className="mt-3 text-xs text-ink-mute">
                Price, length and days are fixed when a plan is bought — editing them only affects new sales. Skip and cancel policies apply to the next skip/cancel on live plans too
                {p ? <> (<b>{livePlans}</b> live plan{livePlans === 1 ? "" : "s"} right now)</> : null}. Customers see: “{POLICY_TEXT.skip.EXTEND}” / “{POLICY_TEXT.cancel.CREDIT}” (wording follows the choice).
              </p>
            </Panel>
            {p && <p className="text-xs text-ink-mute">Changing the price here creates a new price version effective today. To schedule a future price, use “Price versions” below.</p>}
            <SubmitButton>{isNew ? "Create plan" : "Save plan"}</SubmitButton>
          </>
        </>
      </ActionForm>
      {p && (
        <Panel title="Price versions" className="mt-6 max-w-4xl">
          <p className="mb-3 text-sm text-ink-soft">
            Selling now at <b>{rs(current!.pricePerMeal)}</b> per meal{current!.compareAtPrice ? ` (regular ${rs(current!.compareAtPrice)})` : ""}. Each subscription keeps the version it was sold at.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>From</Th>
                <Th>Until</Th>
                <Th className="text-right">Per meal</Th>
                <Th className="text-right">Regular</Th>
                <Th className="text-right">Sold</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && <EmptyRow colSpan={6}>No price versions yet — saving the plan creates one.</EmptyRow>}
              {history.map((h) => (
                <tr key={h.id}>
                  <Td className="text-sm">
                    {isoDate(h.effectiveFrom)} {h.id === current!.id && <Badge tone="good">current</Badge>}
                    {isoDate(h.effectiveFrom) > today && <Badge tone="info">scheduled</Badge>}
                  </Td>
                  <Td className="text-sm text-ink-mute">{h.effectiveTo ? isoDate(h.effectiveTo) : "—"}</Td>
                  <Td className="text-right tabular-nums">{rs(h.pricePerMeal)}</Td>
                  <Td className="text-right tabular-nums text-ink-mute">{h.compareAtPrice != null ? rs(h.compareAtPrice) : "—"}</Td>
                  <Td className="text-right tabular-nums">{h._count.subscriptions}</Td>
                  <Td className="text-xs text-ink-mute">{formatStamp(h.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {editable && (
            <ActionForm action={schedulePrice.bind(null, p.id)} className="mt-4 grid items-end gap-3 md:grid-cols-5" resetOnSuccess>
              <Input name="newPrice" label="New price per meal (Rs)" inputMode="decimal" required />
              <Input name="newCompareAt" label="Regular price (Rs)" inputMode="decimal" />
              <Input name="from" type="date" label="Effective from" min={today} defaultValue={today} />
              <Input name="reason" label="Reason" placeholder="e.g. vegetable prices" />
              <SubmitButton size="sm">Save price version</SubmitButton>
            </ActionForm>
          )}
        </Panel>
      )}
    </>
  );
}
