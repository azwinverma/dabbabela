"use server";
import { requirePermission } from "@/lib/auth";
import { fail, done, type ActionResult } from "@/lib/action";
import { completeDataRequest, rejectDataRequest } from "@/server/privacy";

export async function completeRequestAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("privacy");
  const confirm = String(fd.get("confirm") ?? "");
  const type = String(fd.get("type"));
  if (type === "DELETE" && confirm !== "DELETE") return fail('Type DELETE to confirm — this can\'t be undone');
  try {
    await completeDataRequest(String(fd.get("id")), user.id, String(fd.get("note") ?? "") || undefined);
    return done(type === "DELETE" ? "Personal data anonymised" : "Marked done");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed");
  }
}

export async function rejectRequestAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requirePermission("privacy");
  try {
    await rejectDataRequest(String(fd.get("id")), user.id, String(fd.get("note") ?? ""));
    return done("Rejected");
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Failed");
  }
}
