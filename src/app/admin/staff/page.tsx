import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { canGrantRole, PERMISSIONS, ROLE_LABEL, STAFF_ROLES, type Permission } from "@/lib/permissions";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Panel, Callout } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select } from "@/components/ui/Fields";
import { Badge } from "@/components/ui/Badge";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { createStaff, promoteUser, resetPassword, resetTwoFactor, toggleActive, updateStaff } from "./actions";

export default async function StaffPage() {
  const me = await requirePermission("staff");
  const [staff, kitchens, sessions] = await Promise.all([
    db.user.findMany({ where: { role: { not: "CUSTOMER" } }, orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }] }),
    db.kitchen.findMany({ select: { id: true, name: true } }),
    db.session.groupBy({ by: ["userId"], where: { expiresAt: { gt: new Date() } }, _count: true }),
  ]);
  const grantable = STAFF_ROLES.filter((r) => canGrantRole(me.role, r));
  const roleOpts = grantable.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  const kitchenOpts = [{ value: "", label: "All kitchens" }, ...kitchens.map((k) => ({ value: k.id, label: k.name }))];
  const perms = Object.keys(PERMISSIONS) as Permission[];
  const without2fa = staff.filter((s) => s.isActive && !s.twoFactorEnabled).length;

  return (
    <>
      <PageHeader title="Staff & roles" description="Each role sees only what it needs. Changes take effect on the next request; role changes and deactivation sign the person out." />
      {without2fa > 0 && <Callout tone="warn" className="mb-4">{without2fa} active staff member(s) haven't turned on two-factor authentication. With the staff 2FA flag on, they're sent to set it up before reaching the control room.</Callout>}
      <div className="space-y-3">
        {staff.map((s) => {
          const editable = canGrantRole(me.role, s.role) && s.id !== me.id;
          return (
            <Panel key={s.id} className={s.isActive ? "" : "opacity-60"}>
              <div className="flex flex-wrap items-start gap-4">
                <div className="min-w-[200px] flex-1">
                  <p className="font-semibold">
                    {s.name} {s.id === me.id && <span className="text-xs text-ink-mute">(you)</span>}
                  </p>
                  <p className="text-xs text-ink-mute">{s.email}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone="brand">{ROLE_LABEL[s.role]}</Badge>
                    {s.twoFactorEnabled ? <Badge tone="good">2FA on</Badge> : <Badge tone="warn">no 2FA</Badge>}
                    {!s.isActive && <Badge tone="bad">deactivated</Badge>}
                    <Badge>{sessions.find((x) => x.userId === s.id)?._count ?? 0} session(s)</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-mute">Last sign-in: {s.lastLoginAt ? formatStamp(s.lastLoginAt) : "never"}</p>
                </div>
                {editable ? (
                  <ActionForm action={updateStaff.bind(null, s.id)} className="grid flex-[2] gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                    <Select name="role" label="Role" defaultValue={s.role} options={[...(grantable.includes(s.role) ? [] : [{ value: s.role, label: ROLE_LABEL[s.role] }]), ...roleOpts, { value: "CUSTOMER", label: "Remove staff access" }]} />
                    <Select name="kitchenId" label="Kitchen scope" defaultValue={s.kitchenId ?? ""} options={kitchenOpts} />
                    <Input name="reason" label="Reason (role change)" />
                    <SubmitButton size="sm" variant="outline">Save</SubmitButton>
                  </ActionForm>
                ) : (
                  <p className="flex-[2] text-xs text-ink-mute">{s.id === me.id ? "Manage your own password and 2FA from your account's Security page." : "Only a super admin can change this account."}</p>
                )}
              </div>
              {editable && (
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-ink-line/50 pt-3">
                  <ActionForm action={resetPassword.bind(null, s.id)} resetOnSuccess className="flex items-end gap-2">
                    <Input name="password" type="text" autoComplete="off" label="New temporary password" className="w-56" />
                    <SubmitButton size="sm" variant="ghost">Reset password</SubmitButton>
                  </ActionForm>
                  {s.twoFactorEnabled && <ConfirmAction action={resetTwoFactor.bind(null, s.id)} label="Reset 2FA" variant="ghost" confirm="Remove their two-factor setup (lost phone)? They'll be signed out." />}
                  <ConfirmAction action={toggleActive.bind(null, s.id)} label={s.isActive ? "Deactivate" : "Re-activate"} variant={s.isActive ? "danger" : "outline"} confirm={s.isActive ? `Deactivate ${s.name}? They'll be signed out everywhere.` : undefined} />
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Add a staff member">
          <ActionForm action={createStaff} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
            <>
              <>
                <Input name="name" label="Name" />
                <Input name="email" type="email" label="Email" />
                <Input name="phone" label="Phone (optional)" />
                <Select name="role" label="Role" options={roleOpts} />
                <Select name="kitchenId" label="Kitchen scope" options={kitchenOpts} />
                <Input name="password" type="text" autoComplete="off" label="Temporary password" hint="10+ characters, letters and numbers" />
                <SubmitButton size="sm" className="sm:col-span-2">Create account</SubmitButton>
              </>
            </>
          </ActionForm>
        </Panel>
        <Panel title="Give an existing account a role">
          <ActionForm action={promoteUser} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
            <Input name="email" type="email" label="Their account email" />
            <Select name="role" label="Role" options={roleOpts} />
            <SubmitButton size="sm" variant="outline" className="sm:col-span-2">Grant role</SubmitButton>
          </ActionForm>
        </Panel>
      </div>

      <Panel title="Permission matrix" className="mt-6" bodyClass="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-xs">
          <thead>
            <tr className="bg-paper/60">
              <th className="sticky left-0 bg-paper px-3 py-2 text-left font-bold uppercase tracking-wide text-ink-mute">Permission</th>
              {STAFF_ROLES.map((r) => (
                <th key={r} className="px-1.5 py-2 text-center font-semibold" title={ROLE_LABEL[r]}>
                  <span className="inline-block max-w-[70px] truncate">{ROLE_LABEL[r]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {perms.map((p) => (
              <tr key={p} className="border-t border-ink-line/40">
                <td className="sticky left-0 bg-white px-3 py-1.5 font-mono">{p}</td>
                {STAFF_ROLES.map((r) => (
                  <td key={r} className="text-center">
                    {(PERMISSIONS[p] as string[]).includes(r) ? <span className="font-bold text-saag" aria-label="yes">●</span> : <span className="text-ink-line" aria-label="no">·</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
