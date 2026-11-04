"use server";

import { redirect } from "next/navigation";
import { done, type ActionResult } from "@/lib/action";
import { ensureFoundationData } from "@/server/foundation";
import { createRole, deleteRole, updateRole } from "@/server/access";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { guarded } from "../_kit/guard";
import { f } from "../_kit/form";

const perms = (fd: FormData) => fd.getAll("perm").filter((v): v is string => typeof v === "string");

export async function createRoleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  let id = "";
  const res = await guarded("roles.edit", async (me) => {
    const role = await createRole(me, { name: f.str(fd, "name", 60), key: f.opt(fd, "key", 40), description: f.opt(fd, "description", 500), permissions: perms(fd) });
    id = role.id;
    return done("Role created");
  }, ["/admin/roles"]);
  if (res.ok && id) redirect(`/admin/roles/${id}`);
  return res;
}

export async function updateRoleAction(id: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded("roles.edit", async (me) => {
    await updateRole(me, id, { name: f.str(fd, "name", 60), description: f.opt(fd, "description", 500), permissions: perms(fd) });
    return done("Role saved — takes effect on each person's next page load");
  }, ["/admin/roles", `/admin/roles/${id}`, "/admin/staff"]);
}

export async function deleteRoleAction(id: string): Promise<ActionResult> {
  const res = await guarded("roles.edit", async (me) => {
    await deleteRole(me, id);
    return done("Role deleted");
  }, ["/admin/roles"]);
  if (res.ok) redirect("/admin/roles");
  return res;
}

/** Owner-only: run the idempotent foundation backfill (preset roles, expense categories, plan prices, nav, categories). */
export async function installFoundationAction(): Promise<ActionResult> {
  return guarded("roles.edit", async (me) => {
    if (me.role !== "SUPER_ADMIN") throw new Error("Only a super admin can do this");
    const r = await ensureFoundationData(db);
    await audit({ actorId: me.id, action: "foundation.install", entity: "Setting", entityId: "foundation.v1", summary: JSON.stringify(r), after: r });
    const added = Object.values(r).reduce((a, b) => a + b, 0);
    return done(added ? `Added ${added} missing row(s): ${JSON.stringify(r)}` : "Everything was already in place");
  }, ["/admin/roles"]);
}
