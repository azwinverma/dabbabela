"use client";
import { useActionState, useState } from "react";
import { ActionForm, SubmitButton, FormMessage } from "@/components/ui/ActionForm";
import { Input, Select } from "@/components/ui/Fields";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { updateMemberAction, inviteAction, revokeInviteAction, importAction, teamOrderAction, type ImportState, type TeamOrderState } from "./actions";

export function MemberControls({ m, locations }: { m: { id: string; status: string; role: string; department: string | null; costCenter: string | null; employeeCode: string | null; officeLocationId: string | null }; locations: { id: string; name: string }[] }) {
  return (
    <ActionForm action={updateMemberAction} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="memberId" value={m.id} />
      <select name="role" defaultValue={m.role} className="field h-8 w-24 py-0 text-xs" aria-label="Role">
        <option value="MEMBER">Member</option>
        <option value="ADMIN">Admin</option>
      </select>
      <input name="department" defaultValue={m.department ?? ""} placeholder="Department" className="field h-8 w-28 py-0 text-xs" aria-label="Department" />
      <input name="costCenter" defaultValue={m.costCenter ?? ""} placeholder="Cost centre" className="field h-8 w-24 py-0 text-xs" aria-label="Cost centre" />
      <input name="employeeCode" defaultValue={m.employeeCode ?? ""} placeholder="Emp #" className="field h-8 w-20 py-0 text-xs" aria-label="Employee code" />
      <select name="officeLocationId" defaultValue={m.officeLocationId ?? ""} className="field h-8 w-32 py-0 text-xs" aria-label="Office">
        <option value="">Office…</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      {m.status === "PENDING" ? (
        <SubmitButton size="sm" variant="dark" name="status" value="ACTIVE" className="h-8" pendingText="…">
          Approve
        </SubmitButton>
      ) : (
        <SubmitButton size="sm" variant="outline" className="h-8" pendingText="…">
          Save
        </SubmitButton>
      )}
      <SubmitButton size="sm" variant="ghost" name="status" value="REMOVED" className="h-8 text-sindoor" pendingText="…" confirm="Remove this person from the team? Their future company-paid meals stop.">
        Remove
      </SubmitButton>
    </ActionForm>
  );
}

export function InviteForm() {
  return (
    <ActionForm action={inviteAction} className="grid gap-2 sm:grid-cols-2" resetOnSuccess>
      <Input name="email" type="email" label="Work email" required />
      <Input name="name" label="Name" />
      <Input name="department" label="Department" />
      <Select name="role" label="Role" options={[{ value: "MEMBER", label: "Member — orders their own lunch" }, { value: "ADMIN", label: "Admin — manages the team" }]} />
      <div className="sm:col-span-2">
        <SubmitButton size="sm">Send invite</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function RevokeInvite({ id }: { id: string }) {
  return <ConfirmAction action={revokeInviteAction.bind(null, id)} label="Revoke" variant="ghost" confirm="Cancel this invite?" />;
}

export function ImportForm() {
  const [state, action] = useActionState<ImportState, FormData>(importAction, { ok: false });
  const [text, setText] = useState("");
  const preview = state.rows && !state.results;
  return (
    <div className="space-y-3">
      <form action={action} className="space-y-2">
        <label className="label" htmlFor="csv">
          Paste rows: name, email, department, cost centre
        </label>
        <textarea id="csv" name="csv" rows={6} className="field font-mono text-xs" value={preview ? (state.csv ?? text) : text} onChange={(e) => setText(e.target.value)} placeholder={"Asha Gurung, asha@company.com.np, Accounts, FIN-01\nBikash Rai, bikash@company.com.np, Sales, SAL-02"} />
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" name="file" accept=".csv,text/csv" className="text-xs" aria-label="CSV file" />
          <SubmitButton size="sm" variant="outline" pendingText="Checking…">
            Check list
          </SubmitButton>
          {preview && (
            <SubmitButton size="sm" name="commit" value="1" pendingText="Inviting…">
              Invite {state.rows!.filter((r) => !r.error).length} people
            </SubmitButton>
          )}
        </div>
      </form>
      {state.message && <FormMessage ok={state.ok || Boolean(preview && !state.rows?.some((r) => r.error))} message={state.message} />}
      {preview && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ink-mute">
              <th className="py-1">Line</th>
              <th>Name</th>
              <th>Email</th>
              <th>Department</th>
              <th>Cost centre</th>
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {state.rows!.map((r) => (
              <tr key={r.line} className={r.error ? "bg-sindoor-light" : ""}>
                <td className="py-1">{r.line}</td>
                <td>{r.name}</td>
                <td>{r.email}</td>
                <td>{r.department}</td>
                <td>{r.costCenter}</td>
                <td className={r.error ? "font-semibold text-sindoor" : "text-saag"}>{r.error ?? "OK"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {state.results && (
        <ul className="space-y-0.5 text-xs">
          {state.results.map((r) => (
            <li key={r.email} className={r.ok ? "text-saag" : "text-sindoor"}>
              {r.email}: {r.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TeamOrderForm({
  date,
  boxes,
  members,
  slots,
}: {
  date: string;
  boxes: { id: string; name: string; label: string }[];
  members: { id: string; name: string; department: string | null; office: string | null }[];
  slots: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<TeamOrderState, FormData>(teamOrderAction, { ok: false });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const all = picked.size === members.length && members.length > 0;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="date" value={date} />
      <fieldset>
        <legend className="label">Dabba</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {boxes.map((b, i) => (
            <label key={b.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-line bg-white p-3 text-sm has-[:checked]:border-ink has-[:checked]:ring-2 has-[:checked]:ring-besar">
              <input type="radio" name="boxId" value={b.id} defaultChecked={i === 0} className="mt-1 accent-sindoor" />
              <span>
                <span className="font-semibold">{b.name}</span>
                <span className="block text-xs text-ink-mute">{b.label}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {slots.length > 0 && (
        <Select name="slotId" label="Delivery window" placeholder="Office default / any" options={slots.map((s) => ({ value: s.id, label: s.label }))} className="max-w-xs" />
      )}
      <fieldset>
        <legend className="label flex items-center gap-3">
          People ({picked.size} selected)
          <button type="button" className="text-xs font-semibold text-sindoor underline" onClick={() => setPicked(all ? new Set() : new Set(members.map((m) => m.id)))}>
            {all ? "Clear" : "Select all"}
          </button>
        </legend>
        <div className="grid max-h-80 gap-1 overflow-y-auto rounded-lg border border-ink-line bg-white p-2 sm:grid-cols-2 lg:grid-cols-3">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-paper">
              <input
                type="checkbox"
                name="memberId"
                value={m.id}
                checked={picked.has(m.id)}
                onChange={(e) => {
                  const n = new Set(picked);
                  if (e.target.checked) n.add(m.id);
                  else n.delete(m.id);
                  setPicked(n);
                }}
                className="accent-sindoor"
              />
              <span>
                {m.name}
                <span className="block text-[11px] text-ink-mute">{[m.department, m.office].filter(Boolean).join(" · ") || "No office set"}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <SubmitButton pendingText="Placing orders…">Order {picked.size || ""} dabbas</SubmitButton>
      {state.message && <FormMessage ok={state.ok} message={state.message} />}
      {state.results && (
        <ul className="space-y-0.5 text-sm">
          {state.results.map((r, i) => (
            <li key={i} className={r.ok ? "text-saag-dark" : "text-sindoor"}>
              {r.ok ? "✓" : "✕"} {r.name}: {r.message}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
