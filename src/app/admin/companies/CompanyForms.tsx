"use client";
import { useState } from "react";
import type { Company } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Textarea, Checkbox } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { rupeesInput } from "@/lib/money";
import {
  saveCompanyAction,
  regenerateCodeAction,
  updateMemberAction,
  addLocationAction,
  saveContractAction,
  toggleLocationAction,
  activateContractAction,
  endContractAction,
  saveBudgetAction,
  saveCompanyMenuAction,
  saveDeliveryInstructionsAction,
  generateInvoiceAction,
  issueInvoiceAction,
} from "./actions";

const r = (p: number | null | undefined) => (p == null ? "" : rupeesInput(p));

export function CompanyForm({ company, zones }: { company?: Company | null; zones: { id: string; name: string }[] }) {
  const [mode, setMode] = useState(company?.billingMode ?? "EMPLOYEE_PAID");
  return (
    <ActionForm action={saveCompanyAction} className="space-y-5">
      {(state) => (
        <>
          {company && <input type="hidden" name="id" value={company.id} />}
          <fieldset className="grid gap-3 md:grid-cols-2">
            <legend className="mb-2 text-sm font-bold">Company</legend>
            <Input name="name" label="Display name" defaultValue={company?.name} required error={state.errors?.name} />
            <Input name="legalName" label="Legal name (for invoices)" defaultValue={company?.legalName ?? ""} />
            <Input name="panVat" label="PAN / VAT number" defaultValue={company?.panVat ?? ""} />
            <Select name="zoneId" label="Main delivery zone" defaultValue={company?.zoneId ?? ""} placeholder="—" options={zones.map((z) => ({ value: z.id, label: z.name }))} />
            <Textarea name="billingAddress" label="Billing address" rows={2} defaultValue={company?.billingAddress ?? ""} className="md:col-span-2" />
            <Input name="contactPerson" label="Contact person" defaultValue={company?.contactPerson ?? ""} />
            <Input name="contactEmail" type="email" label="Contact email" defaultValue={company?.contactEmail ?? ""} />
            <Input name="contactPhone" label="Contact phone" defaultValue={company?.contactPhone ?? ""} error={state.errors?.contactPhone} />
          </fieldset>
          <fieldset className="grid gap-3 md:grid-cols-3">
            <legend className="mb-2 text-sm font-bold">Who pays</legend>
            <Select
              name="billingMode"
              label="Billing mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              options={[
                { value: "EMPLOYEE_PAID", label: "Employees pay (company discount only)" },
                { value: "COMPANY_PAID", label: "Company pays everything" },
                { value: "SPLIT", label: "Split: company pays a share" },
              ]}
              className="md:col-span-3"
            />
            {mode === "SPLIT" && (
              <>
                <Input name="subsidyPct" type="number" min={0} max={100} label="Company pays (%)" defaultValue={company?.subsidyPct ?? 50} />
                <Input name="subsidyCap" label="…up to (Rs per meal)" defaultValue={r(company?.subsidyCap)} placeholder="no cap" error={state.errors?.subsidyCap} />
              </>
            )}
            {mode !== "EMPLOYEE_PAID" && <Input name="monthlyAllowance" label="Monthly allowance per person (Rs)" defaultValue={r(company?.monthlyAllowance)} placeholder="unlimited" hint="After this, the employee pays the rest" error={state.errors?.monthlyAllowance} />}
            <Input name="discountPct" type="number" min={0} max={50} label="Company discount (%)" defaultValue={company?.discountPct ?? 0} />
            <Input name="invoiceTermsDays" type="number" min={0} max={120} label="Invoice terms (days)" defaultValue={company?.invoiceTermsDays ?? 15} />
            <Input name="creditLimit" label="Credit limit (Rs outstanding)" defaultValue={r(company?.creditLimit)} placeholder="no limit" hint="New company-paid orders are blocked above this" error={state.errors?.creditLimit} />
            <Input name="cutoffOverride" label="Own order cut-off (HH:MM)" defaultValue={company?.cutoffOverride ?? ""} placeholder="use global" error={state.errors?.cutoffOverride} />
          </fieldset>
          <div className="flex flex-wrap gap-6">
            <Checkbox name="freeDelivery" label="Free delivery for members" defaultChecked={company?.freeDelivery ?? true} />
            <Checkbox name="requireApproval" label="New members wait for approval" defaultChecked={company?.requireApproval ?? true} />
            {company && (
              <label className="flex items-center gap-2 text-sm">
                <select name="isActive" defaultValue={company.isActive ? "on" : "off"} className="field h-9 w-32 py-1">
                  <option value="on">Active</option>
                  <option value="off">Inactive</option>
                </select>
              </label>
            )}
          </div>
          <Textarea name="notes" label="Internal notes" rows={2} defaultValue={company?.notes ?? ""} />
          {company && <Input name="reason" label="Reason for this change (audit log)" placeholder="e.g. contract renewed at new subsidy" />}
          <SubmitButton>{company ? "Save company" : "Create company"}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function RegenerateCode({ id }: { id: string }) {
  return <ConfirmAction action={regenerateCodeAction.bind(null, id)} label="New code" confirm="Generate a new join code? The old one stops working." />;
}

export function LocationForm({ companyId, slots }: { companyId: string; slots: { id: string; label: string }[] }) {
  return (
    <ActionForm action={addLocationAction} className="grid gap-2 md:grid-cols-4" resetOnSuccess>
      <input type="hidden" name="companyId" value={companyId} />
      <Input name="name" label="Name" placeholder="Head office, 4th floor" required />
      <Input name="line1" label="Street / building" required />
      <Input name="area" label="Area" placeholder="New Baneshwor" required />
      <Input name="ward" label="Ward" type="number" min={1} max={40} />
      <Input name="landmark" label="Landmark" />
      <Input name="receiverName" label="Receiver" placeholder="Reception" />
      <Input name="receiverPhone" label="Receiver phone" />
      <Select name="slotId" label="Default slot" placeholder="—" options={slots.map((s) => ({ value: s.id, label: s.label }))} />
      <div className="md:col-span-4">
        <SubmitButton size="sm" variant="dark">
          Add location
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function LocationToggle({ id, active }: { id: string; active: boolean }) {
  return <ConfirmAction action={toggleLocationAction.bind(null, id, !active)} label={active ? "Retire" : "Reopen"} />;
}

const DAYS = [
  ["SUN", "Sun"],
  ["MON", "Mon"],
  ["TUE", "Tue"],
  ["WED", "Wed"],
  ["THU", "Thu"],
  ["FRI", "Fri"],
  ["SAT", "Sat"],
] as const;

type MemberLike = {
  id: string;
  status: string;
  role: string;
  department: string | null;
  costCenter: string | null;
  employeeCode: string | null;
  officeLocationId: string | null;
  allowanceOverride: number | null;
  mealEligible: boolean;
  eligibleDays: string[];
};

export function MemberRow({ m, locations }: { m: MemberLike; locations: { id: string; name: string }[] }) {
  return (
    <ActionForm action={updateMemberAction} className="flex flex-wrap items-center gap-1.5" showMessage>
      <input type="hidden" name="memberId" value={m.id} />
      <input type="hidden" name="eligibilityForm" value="1" />
      <select name="status" defaultValue={m.status} className="field h-8 w-28 py-0 text-xs" aria-label="Status">
        <option value="PENDING">Pending</option>
        <option value="ACTIVE">Active</option>
        <option value="REMOVED">Removed</option>
      </select>
      <select name="role" defaultValue={m.role} className="field h-8 w-24 py-0 text-xs" aria-label="Role">
        <option value="MEMBER">Member</option>
        <option value="ADMIN">Admin</option>
      </select>
      <input name="department" defaultValue={m.department ?? ""} placeholder="Dept" className="field h-8 w-24 py-0 text-xs" aria-label="Department" />
      <input name="costCenter" defaultValue={m.costCenter ?? ""} placeholder="Cost centre" className="field h-8 w-24 py-0 text-xs" aria-label="Cost centre" />
      <input name="employeeCode" defaultValue={m.employeeCode ?? ""} placeholder="Emp #" className="field h-8 w-20 py-0 text-xs" aria-label="Employee code" />
      <select name="officeLocationId" defaultValue={m.officeLocationId ?? ""} className="field h-8 w-32 py-0 text-xs" aria-label="Office">
        <option value="">No office</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <input name="allowanceOverride" defaultValue={m.allowanceOverride != null ? rupeesInput(m.allowanceOverride) : ""} placeholder="Allowance Rs" className="field h-8 w-24 py-0 text-xs" aria-label="Allowance override" />
      <EligibilityFields m={m} />
      <SubmitButton size="sm" variant="outline" pendingText="…" className="h-8">
        Save
      </SubmitButton>
    </ActionForm>
  );
}

/** Meal eligibility inputs (company pays only when eligible; no day ticked = every service day). */
export function EligibilityFields({ m }: { m: { mealEligible: boolean; eligibleDays: string[] } }) {
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs">
      <label className="flex items-center gap-1 font-semibold">
        <input type="checkbox" name="mealEligible" defaultChecked={m.mealEligible} className="accent-sindoor" /> Company meals
      </label>
      <span className="text-ink-mute">on</span>
      {DAYS.map(([v, l]) => (
        <label key={v} className="flex items-center gap-0.5" title={`Eligible on ${l}`}>
          <input type="checkbox" name="eligibleDays" value={v} defaultChecked={m.eligibleDays.includes(v)} className="accent-sindoor" />
          {l}
        </label>
      ))}
    </span>
  );
}

type ContractLike = {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string | null;
  pricePerMeal: number | null;
  minMealsPerDay: number | null;
  minMealsPerMonth: number | null;
  creditTermsDays: number | null;
  boxPrices: Record<string, number>;
  terms: string | null;
  documentUrl: string | null;
  status: string;
  version: number;
};

/**
 * mode "new": first contract (v1 draft) · "edit": a draft · "version": next version of an active contract
 * (prefilled from it, new start date).
 */
export function ContractForm({ companyId, contract, boxes, mode = contract ? "edit" : "new" }: { companyId: string; contract?: ContractLike; boxes: { id: string; name: string; price: number }[]; mode?: "new" | "edit" | "version" }) {
  const readOnly = mode === "edit" && contract?.status !== "DRAFT";
  return (
    <ActionForm action={saveContractAction} className="grid gap-2 md:grid-cols-4" resetOnSuccess={mode !== "edit"}>
      <input type="hidden" name="companyId" value={companyId} />
      {contract && <input type="hidden" name="contractId" value={contract.id} />}
      {mode === "version" && <input type="hidden" name="mode" value="version" />}
      <fieldset disabled={readOnly} className="contents">
        <Input name="title" label="Title" defaultValue={contract?.title} required className="md:col-span-2" />
        <Input name="startsOn" type="date" label="Starts" defaultValue={mode === "version" ? "" : contract?.startsOn} required />
        <Input name="endsOn" type="date" label="Ends" defaultValue={mode === "version" ? "" : (contract?.endsOn ?? "")} />
        <Input name="pricePerMeal" label="Agreed Rs / meal (reference)" defaultValue={contract?.pricePerMeal != null ? rupeesInput(contract.pricePerMeal) : ""} />
        <Input name="minMealsPerDay" type="number" min={0} label="Min meals / day" defaultValue={contract?.minMealsPerDay ?? ""} />
        <Input name="minMealsPerMonth" type="number" min={0} label="Min meals / month" defaultValue={contract?.minMealsPerMonth ?? ""} hint="Shortfall shown on the company page" />
        <Input name="creditTermsDays" type="number" min={0} max={180} label="Credit terms (days)" defaultValue={contract?.creditTermsDays ?? ""} hint="Invoice due date = issue + this" />
        <Input name="documentUrl" label="Signed copy URL" defaultValue={contract?.documentUrl ?? ""} className="md:col-span-2" />
        <Textarea name="terms" label="Key terms" rows={2} defaultValue={contract?.terms ?? ""} className="md:col-span-2" />
        {boxes.length > 0 && (
          <details className="md:col-span-4" open={Object.keys(contract?.boxPrices ?? {}).length > 0}>
            <summary className="cursor-pointer text-sm font-semibold">Negotiated per-dabba prices ({Object.keys(contract?.boxPrices ?? {}).length})</summary>
            <p className="my-1 text-xs text-ink-mute">Leave blank to use the menu price. Applied at checkout to every member order on dates this contract is active.</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {boxes.map((b) => (
                <Input key={b.id} name={`price_${b.id}`} label={`${b.name} (menu ${rupeesInput(b.price)})`} defaultValue={contract?.boxPrices[b.id] != null ? rupeesInput(contract.boxPrices[b.id]) : ""} placeholder="menu price" />
              ))}
            </div>
          </details>
        )}
      </fieldset>
      {!readOnly && (
        <div className="md:col-span-4">
          <SubmitButton size="sm" variant="dark">
            {mode === "version" ? `Draft version ${(contract?.version ?? 0) + 1}` : mode === "edit" ? "Save draft" : "Draft contract"}
          </SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}

export function ActivateContract({ id, supersedes }: { id: string; supersedes: boolean }) {
  return <ConfirmAction action={activateContractAction.bind(null, id)} label="Activate" variant="dark" confirm={supersedes ? "Activate this version? The previous version ends the day before this one starts." : "Activate this contract? Its negotiated prices apply from the start date."} />;
}

export function EndContractForm({ id }: { id: string }) {
  return (
    <ActionForm action={endContractAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="contractId" value={id} />
      <Input name="endsOn" type="date" label="End on" required />
      <Input name="reason" label="Reason" required className="min-w-48" />
      <SubmitButton size="sm" variant="outline">
        Set end date
      </SubmitButton>
    </ActionForm>
  );
}

export function BudgetForm({ companyId, month, department, amount, departments }: { companyId: string; month: string; department?: string; amount?: number | null; departments?: string[] }) {
  return (
    <ActionForm action={saveBudgetAction} className="flex flex-wrap items-end gap-2" resetOnSuccess={!department}>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="month" value={month} />
      {department != null ? <input type="hidden" name="department" value={department} /> : <Input name="department" label="Department" list="departments" required />}
      {departments && (
        <datalist id="departments">
          {departments.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      )}
      <Input name="amount" label={department != null ? "Budget Rs" : "Monthly budget Rs"} defaultValue={amount != null ? rupeesInput(amount) : ""} placeholder="no cap" className="w-32" />
      <SubmitButton size="sm" variant="outline" pendingText="…">
        {department != null ? "Save" : "Add budget"}
      </SubmitButton>
    </ActionForm>
  );
}

export function CompanyMenuForm({ companyId, boxes, selected }: { companyId: string; boxes: { id: string; name: string; category: string | null }[]; selected: string[] }) {
  return (
    <ActionForm action={saveCompanyMenuAction} className="space-y-3">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {boxes.map((b) => (
          <Checkbox key={b.id} name="boxId" value={b.id} defaultChecked={selected.includes(b.id)} label={<span>{b.name}{b.category && <span className="ml-1 text-xs text-ink-mute">{b.category}</span>}</span>} />
        ))}
      </div>
      <SubmitButton size="sm" variant="dark">
        Save company menu
      </SubmitButton>
    </ActionForm>
  );
}

export function DeliveryInstructionsForm({ companyId, value }: { companyId: string; value: string | null }) {
  return (
    <ActionForm action={saveDeliveryInstructionsAction} className="space-y-2">
      <input type="hidden" name="companyId" value={companyId} />
      <Textarea name="deliveryInstructions" label="Delivery instructions (all offices)" rows={3} maxLength={500} defaultValue={value ?? ""} placeholder="e.g. Use the service lift; leave with reception before 12:30" />
      <SubmitButton size="sm" variant="outline">
        Save instructions
      </SubmitButton>
    </ActionForm>
  );
}

export function GenerateInvoiceForm({ companyId, from, to }: { companyId: string; from: string; to: string }) {
  return (
    <ActionForm action={generateInvoiceAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <Input name="periodStart" type="date" label="From" defaultValue={from} required />
      <Input name="periodEnd" type="date" label="To" defaultValue={to} required />
      <Select name="grouping" label="Lines" defaultValue="ORDER" options={[{ value: "ORDER", label: "One per order" }, { value: "DAY", label: "One per day" }]} />
      <SubmitButton size="sm" variant="dark" pendingText="Generating…">
        Generate draft
      </SubmitButton>
    </ActionForm>
  );
}

export function IssueInvoice({ id }: { id: string }) {
  return <ConfirmAction action={issueInvoiceAction.bind(null, id)} label="Issue" confirm="Issue this invoice? The due date is set from the contract's credit terms." />;
}
