import Link from "next/link";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { ROLE_LABEL, STAFF_ROLES, systemGrants, permissionsFor } from "@/lib/permissions";
import { PageHeader, Panel, Table, Th, Td, Callout, EmptyRow } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea } from "@/components/ui/Fields";
import { Badge } from "@/components/ui/Badge";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { PermissionGrid } from "@/components/admin/PermissionGrid";
import { createRoleAction, installFoundationAction } from "./actions";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage({ searchParams }: { searchParams: Promise<{ base?: string }> }) {
  const me = await requirePermission("roles.view");
  const sp = await searchParams;
  const editor = me.role === "SUPER_ADMIN";
  const [custom, counts] = await Promise.all([
    db.staffRole.findMany({ orderBy: [{ isSystem: "desc" }, { name: "asc" }], include: { _count: { select: { users: true } } } }),
    db.user.groupBy({ by: ["role"], where: { role: { not: "CUSTOMER" }, isActive: true }, _count: true }),
  ]);
  const base = STAFF_ROLES.includes(sp.base as Role) ? (sp.base as Role) : null;

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="Everyone has a built-in base role. A custom role adds extra permissions on top of it, and scopes (on each staff member's page) limit them to kitchens or companies. Every permission is checked on the server."
        actions={editor ? <ConfirmAction action={installFoundationAction} label="Install missing presets" variant="ghost" confirm="Add any missing preset roles, expense categories, plan price rows, navigation links and meal categories? Existing data is never changed." /> : null}
      />
      {!editor && <Callout tone="info" className="mb-4">You can view roles. Only a super admin can create or change them.</Callout>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Built-in base roles" bodyClass="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Role</Th>
                <Th className="text-right">Active staff</Th>
                <Th className="text-right">Permissions</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {STAFF_ROLES.map((r) => (
                <tr key={r} className={base === r ? "bg-paper/60" : undefined}>
                  <Td className="font-medium">{ROLE_LABEL[r]}</Td>
                  <Td className="text-right tabular-nums">{counts.find((c) => c.role === r)?._count ?? 0}</Td>
                  <Td className="text-right tabular-nums">{r === "SUPER_ADMIN" ? "all" : systemGrants(r).size}</Td>
                  <Td className="text-right">
                    <Link className="text-xs font-semibold text-sindoor hover:underline" href={`/admin/roles?base=${r}#grid`}>
                      View
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>

        <Panel title="Custom roles" bodyClass="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Role</Th>
                <Th className="text-right">Staff</Th>
                <Th className="text-right">Extra permissions</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {custom.length === 0 && <EmptyRow colSpan={4}>No custom roles yet.</EmptyRow>}
              {custom.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <span className="font-medium">{c.name}</span> {c.isSystem && <Badge>preset</Badge>}
                    {c.description && <span className="block max-w-xs truncate text-[11px] text-ink-mute">{c.description}</span>}
                  </Td>
                  <Td className="text-right tabular-nums">{c._count.users}</Td>
                  <Td className="text-right tabular-nums">{c.permissions.length}</Td>
                  <Td className="text-right">
                    <Link className="text-xs font-semibold text-sindoor hover:underline" href={`/admin/roles/${c.id}`}>
                      {editor ? "Edit" : "View"}
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>

      {base && (
        <Panel title={`${ROLE_LABEL[base]} — base permissions`} className="mt-6" bodyClass="p-0">
          <div id="grid">
            <PermissionGrid checked={new Set(permissionsFor(base))} />
          </div>
        </Panel>
      )}

      {editor && (
        <Panel title="Create a custom role" className="mt-6">
          <ActionForm action={createRoleAction} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input name="name" label="Name" placeholder="e.g. Shift lead" required />
              <Input name="key" label="Key (optional)" placeholder="shift-lead" hint="Lowercase, dashes" />
              <Textarea name="description" label="What it's for" rows={1} />
            </div>
            <p className="text-xs text-ink-mute">Tick the extra permissions. People keep their base role&apos;s permissions too.</p>
            <PermissionGrid checked={new Set()} editable />
            <SubmitButton size="sm">Create role</SubmitButton>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
