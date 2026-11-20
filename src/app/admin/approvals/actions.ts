"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { done, fail, type ActionResult } from "@/lib/action";
import { approveRequest, cancelRequest, executeApproval, rejectRequest } from "@/server/approvals";

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const id = (fd: FormData) => String(fd.get("id") ?? "").slice(0, 64);
const note = (fd: FormData) => String(fd.get("note") ?? "").trim().slice(0, 500);

function refresh(reqId: string) {
  revalidatePath("/admin/approvals");
  revalidatePath(`/admin/approvals/${reqId}`);
}

/** Approve (and execute) someone else's request. The service re-checks requester ≠ approver, permission and scope. */
export async function approveApprovalAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("approvals.approve");
  try {
    const r = await approveRequest(user, id(fd), note(fd) || null);
    refresh(id(fd));
    return r.status === "EXECUTED" ? done("Approved and carried out") : fail(`Approved, but it couldn't be carried out: ${r.error ?? "unknown error"} — fix the cause and retry`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function rejectApprovalAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("approvals.approve");
  try {
    await rejectRequest(user, id(fd), note(fd));
    refresh(id(fd));
    return done("Rejected — the requester has been told");
  } catch (e) {
    return fail(msg(e));
  }
}

/** Retry a FAILED execution (same checks as approving; idempotent). */
export async function retryApprovalAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("approvals.approve");
  try {
    const r = await executeApproval(user, id(fd));
    refresh(id(fd));
    return r.status === "EXECUTED" ? done("Carried out") : fail(`Still failing: ${r.error ?? "unknown error"}`);
  } catch (e) {
    return fail(msg(e));
  }
}

/** The requester withdraws their own pending request. */
export async function cancelApprovalAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("approvals.view");
  try {
    await cancelRequest(user, id(fd), note(fd) || null);
    refresh(id(fd));
    return done("Request withdrawn");
  } catch (e) {
    return fail(msg(e));
  }
}
