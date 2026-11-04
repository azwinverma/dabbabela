import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/permissions";
import { PageHeader, Panel, Table, Th, Td, EmptyRow, Callout } from "@/components/admin/ui";
import { ActionForm, SubmitButton } from "@/components/ui/ActionForm";
import { Input, Textarea } from "@/components/ui/Fields";
import { Badge } from "@/components/ui/Badge";
import { ConfirmAction } from "@/components/admin/ConfirmAction";
import { PermissionGrid } from "@/components/admin/PermissionGrid";
import { deleteRoleAction, updateRoleAction } from "../actions";

export const metadata = { title: "Edit role" };

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission("roles.view");
  const { id } = await params;
  const role = await db.staffRole.findUnique({ where: { id }, include: { users: { select: { id: true, name: true, email: true, role: true, isActive: true }, orderBy: { name: "asc" } } } });
  if (!role) notFound();
  const editor = me.role === "SUPER_ADMIN";

  return (
    <>
      <PageHeader
        title={role.name}
        back={{ href: "/admin/roles", label: "Roles & permissions" }}
        description={
          <>
            Custom role <span className="font-mono">{role.key}</span> {role.isSystem && <Badge>preset</Badge>} — adds these permissions on top of each person&apos;s base role.
          </>
        }
        actions={editor && !role.isSystem ? <ConfirmAction action={deleteRoleAction.bind(null, role.id)} label="Delete role" variant="danger" confirm={`Delete “${role.name}”? Only possible when nobody has it.`} /> : null}
      />
      {editor ? (
        <Panel title="Role">
          <ActionForm action={updateRoleAction.bind(null, role.id)} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input name="name" label="Name" defaultValue={role.name} required />
              <Textarea name="description" label="What it's for" rows={2} defaultValue={role.description ?? ""} />
            </div>
            <PermissionGrid checked={new Set(role.permissions)} editable />
            <SubmitButton size="sm">Save role</SubmitButton>
          </ActionForm>
        </Panel>
      ) : (
        <>
          <Callout tone="info" className="mb-4">Read-only — only a super admin can change roles.</Callout>
          <Panel title="Permissions" bodyClass="p-0">
            <PermissionGrid checked={new Set(role.permissions)} />
          </Panel>
        </>
      )}
      <Panel title={`Staff with this role (${role.users.length})`} className="mt-6" bodyClass="p-0">
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Base role</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {role.users.length === 0 && <EmptyRow colSpan={3}>Nobody yet — assign it from a staff member&apos;s page.</EmptyRow>}
            {role.users.map((u) => (
              <tr key={u.id} className={u.isActive ? undefined : "opacity-60"}>
                <Td>
                  {u.name} <span className="text-xs text-ink-mute">{u.email}</span>
                </Td>
                <Td>{ROLE_LABEL[u.role]}</Td>
                <Td className="text-right">
                  <Link href={`/admin/staff/${u.id}`} className="text-xs font-semibold text-sindoor hover:underline">
                    Open
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}
