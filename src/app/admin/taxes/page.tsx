import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { isoDate, todayKTM } from "@/lib/dates";
import { PageHeader, Panel, Callout } from "@/components/admin/ui";
import { Badge } from "@/components/ui/Badge";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Checkbox } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { deleteTaxRule, saveTaxRule } from "./actions";

function RuleForm({ r }: { r?: { id: string; name: string; rateBps: number; inclusive: boolean; isActive: boolean; effectiveFrom: Date; effectiveTo: Date | null } }) {
  return (
    <ActionForm action={saveTaxRule.bind(null, r?.id ?? null)} resetOnSuccess={!r} className="grid gap-3 sm:grid-cols-4 sm:items-end">
      <>
        <>
          <Input name="name" label="Name" defaultValue={r?.name ?? "VAT 13%"} />
          <Input name="rate" label="Rate %" inputMode="decimal" defaultValue={r ? String(r.rateBps / 100) : "13"} />
          <Input name="effectiveFrom" type="date" label="From" defaultValue={r ? isoDate(r.effectiveFrom) : todayKTM()} />
          <Input name="effectiveTo" type="date" label="Until" defaultValue={r?.effectiveTo ? isoDate(r.effectiveTo) : ""} />
          <Checkbox name="inclusive" label="Menu prices include it" defaultChecked={r?.inclusive ?? true} />
          <Checkbox name="isActive" label="Active" defaultChecked={r?.isActive ?? false} />
          <label className="flex items-start gap-2 text-xs sm:col-span-2">
            <input type="checkbox" name="registered" value="yes" defaultChecked={r?.isActive} className="mt-0.5 accent-sindoor" />
            <span>
              The business is VAT-registered (PAN/VAT on file)
            </span>
          </label>
          <SubmitButton size="sm" variant={r ? "outline" : "primary"}>{r ? "Save" : "Add rule"}</SubmitButton>
        </>
      </>
    </ActionForm>
  );
}

export default async function TaxesPage() {
  await requirePermission("pricing");
  const rules = await db.taxRule.findMany({ orderBy: { effectiveFrom: "desc" } });
  const today = todayKTM();
  const live = rules.find((r) => r.isActive && isoDate(r.effectiveFrom) <= today && (!r.effectiveTo || isoDate(r.effectiveTo) >= today));
  return (
    <>
      <PageHeader title="Tax rules" description="Effective-dated. The rule active on an order's delivery date is used and stored on the order, so later changes never alter past invoices." />
      <Callout tone={live ? "info" : "warn"} className="mb-6" title={live ? `Now charging: ${live.name} (${live.inclusive ? "included in prices" : "added on top"})` : "No VAT is being charged"}>
        Only charge VAT once the company is registered and the PAN/VAT number is in Settings. Prices and invoices change for new orders only.
      </Callout>
      <div className="space-y-4">
        {rules.map((r) => (
          <Panel key={r.id} title={r.name} actions={<span className="flex items-center gap-2">{r.isActive ? <Badge tone="good">active</Badge> : <Badge>off</Badge>}{!r.isActive && <ConfirmAction action={deleteTaxRule.bind(null, r.id)} label="Delete" variant="ghost" confirm="Delete this rule?" />}</span>}>
            <RuleForm r={r} />
          </Panel>
        ))}
        <Panel title="Add a rule">
          <RuleForm />
        </Panel>
      </div>
    </>
  );
}
