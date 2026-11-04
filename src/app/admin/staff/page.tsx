import Link from "next/link";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { can, canGrantRole, ROLE_LABEL, STAFF_ROLES, ungrantable } from "@/lib/permissions";
import { formatStamp } from "@/lib/dates";
import { PageHeader, Panel, Callout, Table, Th, Td } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Select } from "@/components/ui/Fields";
import { Badge } from "@/components/ui/Badge";
import { createStaff, promoteUser } from "./actions";

export const metadata = { title: "Staff" };

export default async function StaffPage() {
  const me = await requirePermission("staff.view");
  const editor = can(me, "staff.edit");
  const [staff, kitchens, sessions, customRoles] = await Promise.all([
    db.user.findMany({
      where: { role: { not: "CUSTOMER" } },
      orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
      include: { staffRole: { select: { name: true } }, scopes: { select: { kitchenId: true, companyId: true } } },
    }),
    db.kitchen.findMany({ select: { id: true, name: true } }),
    db.session.groupBy({ by: ["userId"], where: { expiresAt: { gt: new Date() } }, _count: true }),
    db.staffRole.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, permissions: true } }),
  ]);
  const grantable = STAFF_ROLES.filter((r) => canGrantRole(me, r));
  const roleOpts = grantable.map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  const allowedKitchens = me.kitchenIds ? kitchens.filter((k) => me.kitchenIds!.includes(k.id)) : kitchens;
  const kitchenOpts = [...(me.kitchenIds ? [] : [{ value: "", label: "All kitchens" }]), ...allowedKitchens.map((k) => ({ value: k.id, label: k.name }))];
  const customOpts = [{ value: "", label: "None" }, ...customRoles.filter((r) => ungrantable(me, r.permissions).length === 0).map((r) => ({ value: r.id, label: r.name }))];
  const kitchenName = new Map(kitchens.map((k) => [k.id, k.name]));
  const without2fa = staff.filter((s) => s.isActive && !s.twoFactorEnabled).length;

  return (
    <>
      <PageHeader
        title="Staff"
        description="Open a person to change their role, custom role, kitchen/company scope, sessions and see their sign-in activity."
        actions={can(me, "roles.view") ? <Link href="/admin/roles" className="text-sm font-semibold text-sindoor underline">Roles & permissions →</Link> : null}
      />
      {without2fa > 0 && <Callout tone="warn" className="mb-4">{without2fa} active staff member(s) haven&apos;t turned on two-factor authentication. With the staff 2FA flag on, they&apos;re sent to set it up before reaching the control room.</Callout>}

      <Panel bodyClass="p-0">
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Scope</Th>
              <Th>Security</Th>
              <Th>Last sign-in</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => {
              const kitchensScoped = [s.kitchenId, ...s.scopes.map((x) => x.kitchenId)].filter((x): x is string => Boolean(x));
              const companies = s.scopes.filter((x) => x.companyId).length;
              return (
                <tr key={s.id} className={s.isActive ? undefined : "opacity-60"}>
                  <Td>
                    <span className="font-medium">{s.name}</span> {s.id === me.id && <span className="text-xs text-ink-mute">(you)</span>}
                    <span className="block text-xs text-ink-mute">{s.email}</span>
                  </Td>
                  <Td>
                    <Badge tone="brand">{ROLE_LABEL[s.role]}</Badge> {s.staffRole && <Badge>+ {s.staffRole.name}</Badge>}
                  </Td>
                  <Td className="text-xs">
                    {kitchensScoped.length ? [...new Set(kitchensScoped)].map((k) => kitchenName.get(k) ?? "?").join(", ") : "All kitchens"}
                    {companies > 0 && <span className="block text-ink-mute">{companies} compan{companies === 1 ? "y" : "ies"}</span>}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {s.twoFactorEnabled ? <Badge tone="good">2FA</Badge> : <Badge tone="warn">no 2FA</Badge>}
                      {!s.isActive && <Badge tone="bad">deactivated</Badge>}
                      <Badge>{sessions.find((x) => x.userId === s.id)?._count ?? 0} session(s)</Badge>
                    </div>
                  </Td>
                  <Td className="text-xs">{s.lastLoginAt ? formatStamp(s.lastLoginAt) : "never"}</Td>
                  <Td className="text-right">
                    <Link href={`/admin/staff/${s.id}`} className="text-xs font-semibold text-sindoor hover:underline">
                      Open
                    </Link>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>

      {editor && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Panel title="Add a staff member">
            <ActionForm action={createStaff} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
              <Input name="name" label="Name" />
              <Input name="email" type="email" label="Email" />
              <Input name="phone" label="Phone (optional)" />
              <Select name="role" label="Base role" options={roleOpts} />
              <Select name="staffRoleId" label="Custom role (optional)" options={customOpts} />
              <Select name="kitchenId" label="Kitchen scope" options={kitchenOpts} />
              <Input name="password" type="text" autoComplete="off" label="Temporary password" hint="10+ characters, letters and numbers" className="sm:col-span-2" />
              <SubmitButton size="sm" className="sm:col-span-2">Create account</SubmitButton>
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
      )}
    </>
  );
}
