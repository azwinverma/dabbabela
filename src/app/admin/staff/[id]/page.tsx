import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can, canGrantRole, permissionsFor, ROLE_LABEL, STAFF_ROLES, ungrantable } from "@/lib/permissions";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, Callout } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Checkbox, Input, Select } from "@/components/ui/Fields";
import { Badge } from "@/components/ui/Badge";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { PermissionSummary } from "@/components/admin/PermissionGrid";
import { assignCustomRole, resetPassword, resetTwoFactor, revokeAllSessions, revokeSession, saveScopes, toggleActive, updateStaff } from "../actions";

export const metadata = { title: "Staff member" };

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Mac OS/i.test(ua) ? "macOS" : /Windows/i.test(ua) ? "Windows" : /Linux/i.test(ua) ? "Linux" : "Other";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}

export default async function StaffMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("staff.view");
  const { id } = await params;
  const s = await db.user.findUnique({
    where: { id },
    include: { staffRole: true, scopes: true },
  });
  if (!s || s.role === "CUSTOMER") notFound();
  const [kitchens, companies, customRoles, sessions, logins] = await Promise.all([
    db.kitchen.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    db.company.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 200 }),
    db.staffRole.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, permissions: true } }),
    db.session.findMany({ where: { userId: id, expiresAt: { gt: new Date() } }, orderBy: { updatedAt: "desc" }, select: { id: true, createdAt: true, updatedAt: true, ipAddress: true, userAgent: true } }),
    db.loginEvent.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 25 }),
  ]);
  const editable = can(me, "staff.edit") && canGrantRole(me, s.role) && s.id !== me.id;
  const grantable = STAFF_ROLES.filter((r) => canGrantRole(me, r));
  const roleOpts = [...(grantable.includes(s.role) ? [] : [{ value: s.role, label: ROLE_LABEL[s.role] }]), ...grantable.map((r) => ({ value: r, label: ROLE_LABEL[r] })), { value: "CUSTOMER", label: "Remove staff access" }];
  const allowedKitchens = me.kitchenIds ? kitchens.filter((k) => me.kitchenIds!.includes(k.id)) : kitchens;
  const kitchenOpts = [...(me.kitchenIds ? [] : [{ value: "", label: "All kitchens" }]), ...allowedKitchens.map((k) => ({ value: k.id, label: k.name }))];
  const customOpts = [{ value: "", label: "None" }, ...customRoles.filter((r) => ungrantable(me, r.permissions).length === 0 || r.id === s.staffRoleId).map((r) => ({ value: r.id, label: r.name }))];
  const scopedKitchens = new Set(s.scopes.map((x) => x.kitchenId).filter(Boolean) as string[]);
  const scopedCompanies = new Set(s.scopes.map((x) => x.companyId).filter(Boolean) as string[]);
  const effective = permissionsFor({ role: s.role, customGrants: s.staffRole?.permissions ?? [] });

  return (
    <>
      <PageHeader
        title={s.name}
        back={{ href: "/admin/staff", label: "Staff" }}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {s.email} <Badge tone="brand">{ROLE_LABEL[s.role]}</Badge> {s.staffRole && <Badge>+ {s.staffRole.name}</Badge>}
            {s.twoFactorEnabled ? <Badge tone="good">2FA on</Badge> : <Badge tone="warn">no 2FA</Badge>}
            {!s.isActive && <Badge tone="bad">deactivated</Badge>}
          </span>
        }
        actions={
          editable ? (
            <ConfirmAction action={toggleActive.bind(null, s.id)} label={s.isActive ? "Deactivate" : "Re-activate"} variant={s.isActive ? "danger" : "outline"} confirm={s.isActive ? `Deactivate ${s.name}? They'll be signed out everywhere.` : undefined} />
          ) : null
        }
      />
      {!editable && (
        <Callout tone="info" className="mb-4">
          {s.id === me.id ? "This is you — manage your own password and 2FA on your account's Security page." : "You can view this account but not change it."}
        </Callout>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Access">
          {editable ? (
            <div className="space-y-4">
              <ActionForm action={updateStaff.bind(null, s.id)} className="grid gap-3 sm:grid-cols-2">
                <Select name="role" label="Base role" defaultValue={s.role} options={roleOpts} />
                <Select name="kitchenId" label="Primary kitchen" defaultValue={s.kitchenId ?? ""} options={kitchenOpts} />
                <Input name="reason" label="Reason (required for a role change)" className="sm:col-span-2" />
                <SubmitButton size="sm" variant="outline" className="sm:col-span-2">Save role</SubmitButton>
              </ActionForm>
              <ActionForm action={assignCustomRole.bind(null, s.id)} className="flex items-end gap-2 border-t border-ink-line/50 pt-4">
                <Select name="staffRoleId" label="Custom role (extra permissions)" defaultValue={s.staffRoleId ?? ""} options={customOpts} className="flex-1" />
                <SubmitButton size="sm" variant="outline">Save</SubmitButton>
              </ActionForm>
            </div>
          ) : (
            <p className="text-sm">
              {ROLE_LABEL[s.role]}
              {s.staffRole ? ` + ${s.staffRole.name}` : ""} · {s.kitchenId ? kitchens.find((k) => k.id === s.kitchenId)?.name : "all kitchens"}
            </p>
          )}
        </Panel>

        <Panel title="Scope">
          <p className="mb-3 text-xs text-ink-mute">Limits what this person sees. No kitchens ticked and no primary kitchen = all kitchens. Companies are for account managers (company-level data).</p>
          <ActionForm action={saveScopes.bind(null, s.id)} className="space-y-3">
            <fieldset disabled={!editable} className="space-y-3">
              <legend className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-mute">Extra kitchens</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {allowedKitchens.map((k) => (
                  <Checkbox key={k.id} name="kitchen" value={k.id} label={k.name} defaultChecked={scopedKitchens.has(k.id)} />
                ))}
              </div>
              {companies.length > 0 && (
                <>
                  <p className="pt-2 text-xs font-bold uppercase tracking-wide text-ink-mute">Companies</p>
                  <div className="grid max-h-48 gap-1.5 overflow-y-auto sm:grid-cols-2">
                    {companies.map((c) => (
                      <Checkbox key={c.id} name="company" value={c.id} label={c.name} defaultChecked={scopedCompanies.has(c.id)} />
                    ))}
                  </div>
                </>
              )}
            </fieldset>
            {editable && <SubmitButton size="sm" variant="outline">Save scope</SubmitButton>}
          </ActionForm>
        </Panel>
      </div>

      <Panel title="Effective permissions" className="mt-6" actions={<Link href={`/admin/roles?base=${s.role}#grid`} className="text-xs font-semibold text-sindoor hover:underline">Base role grid →</Link>}>
        <PermissionSummary perms={effective} />
      </Panel>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title={`Active sessions (${sessions.length})`} bodyClass="p-0" actions={editable && sessions.length > 0 ? <ConfirmAction action={revokeAllSessions.bind(null, s.id)} label="Sign out everywhere" variant="ghost" confirm={`Sign ${s.name} out of every device?`} /> : null}>
          <Table>
            <thead>
              <tr>
                <Th>Device</Th>
                <Th>IP</Th>
                <Th>Last active</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 && <EmptyRow colSpan={4}>Not signed in anywhere.</EmptyRow>}
              {sessions.map((x) => (
                <tr key={x.id}>
                  <Td className="text-xs">{device(x.userAgent)}</Td>
                  <Td className="font-mono text-xs">{x.ipAddress ?? "—"}</Td>
                  <Td className="text-xs">{formatStamp(x.updatedAt)}</Td>
                  <Td className="text-right">{editable && <ConfirmAction action={revokeSession.bind(null, s.id, x.id)} label="Sign out" variant="ghost" />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <Panel title="Sign-in activity (last 25)" bodyClass="p-0">
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Method</Th>
                <Th>Result</Th>
                <Th>IP · device</Th>
              </tr>
            </thead>
            <tbody>
              {logins.length === 0 && <EmptyRow colSpan={4}>No sign-ins recorded yet (recording started 2026-11-04).</EmptyRow>}
              {logins.map((l) => (
                <tr key={l.id}>
                  <Td className="text-xs">{formatStamp(l.createdAt)}</Td>
                  <Td className="text-xs">{l.method}</Td>
                  <Td>{l.success ? <Badge tone="good">{l.reason === "TWO_FACTOR_REQUIRED" ? "password ok · 2FA next" : "success"}</Badge> : <Badge tone="bad">{l.reason ?? "failed"}</Badge>}</Td>
                  <Td className="text-xs">
                    <span className="font-mono">{l.ip ?? "—"}</span> · {device(l.userAgent)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>

      {editable && (
        <Panel title="Recovery" className="mt-6">
          <div className="flex flex-wrap items-end gap-3">
            <ActionForm action={resetPassword.bind(null, s.id)} resetOnSuccess className="flex items-end gap-2">
              <Input name="password" type="text" autoComplete="off" label="New temporary password" className="w-56" />
              <SubmitButton size="sm" variant="ghost">Reset password</SubmitButton>
            </ActionForm>
            {s.twoFactorEnabled && <ConfirmAction action={resetTwoFactor.bind(null, s.id)} label="Reset 2FA" variant="ghost" confirm="Remove their two-factor setup (lost phone)? They'll be signed out." />}
          </div>
        </Panel>
      )}
    </>
  );
}
