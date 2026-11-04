"use client";
import { useState } from "react";
import type { Company } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select, Textarea, Checkbox } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { rupeesInput } from "@/lib/money";
import { saveCompanyAction, regenerateCodeAction, updateMemberAction, addLocationAction, saveContractAction, toggleLocationAction } from "./actions";

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

export function MemberRow({ m, locations }: { m: { id: string; status: string; role: string; department: string | null; costCenter: string | null; employeeCode: string | null; officeLocationId: string | null; allowanceOverride: number | null }; locations: { id: string; name: string }[] }) {
  return (
    <ActionForm action={updateMemberAction} className="flex flex-wrap items-center gap-1.5" showMessage>
      <input type="hidden" name="memberId" value={m.id} />
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
      <SubmitButton size="sm" variant="outline" pendingText="…" className="h-8">
        Save
      </SubmitButton>
    </ActionForm>
  );
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

export function ContractForm({ companyId, contract }: { companyId: string; contract?: { id: string; title: string; startsOn: string; endsOn: string | null; pricePerMeal: number | null; minMealsPerDay: number | null; terms: string | null; documentUrl: string | null; status: string } }) {
  return (
    <ActionForm action={saveContractAction} className="grid gap-2 md:grid-cols-4" resetOnSuccess={!contract}>
      <input type="hidden" name="companyId" value={companyId} />
      {contract && <input type="hidden" name="contractId" value={contract.id} />}
      <Input name="title" label="Title" defaultValue={contract?.title} required className="md:col-span-2" />
      <Input name="startsOn" type="date" label="Starts" defaultValue={contract?.startsOn} required />
      <Input name="endsOn" type="date" label="Ends" defaultValue={contract?.endsOn ?? ""} />
      <Input name="pricePerMeal" label="Agreed Rs / meal" defaultValue={contract?.pricePerMeal != null ? rupeesInput(contract.pricePerMeal) : ""} />
      <Input name="minMealsPerDay" type="number" label="Min meals / day" defaultValue={contract?.minMealsPerDay ?? ""} />
      <Select name="status" label="Status" defaultValue={contract?.status ?? "DRAFT"} options={[{ value: "DRAFT", label: "Draft" }, { value: "ACTIVE", label: "Active" }, { value: "ENDED", label: "Ended" }]} />
      <Input name="documentUrl" label="Signed copy URL" defaultValue={contract?.documentUrl ?? ""} />
      <Textarea name="terms" label="Key terms" rows={2} defaultValue={contract?.terms ?? ""} className="md:col-span-4" />
      <div className="md:col-span-4">
        <SubmitButton size="sm" variant="dark">
          {contract ? "Save contract" : "Add contract"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
