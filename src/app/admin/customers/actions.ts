"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { fail, done, type ActionResult } from "@/lib/action";
import { parseRupees } from "@/lib/money";
import { PREF_CHANNELS, PREF_TOPICS } from "@/lib/actions/account-constants";
import { log } from "@/lib/logger";
import {
  addCustomerNote,
  CrmError,
  decideCreditRequest,
  issueCredit,
  logPrivacyRequest,
  processPrivacyRequest,
  requestCredit,
  setCommunicationPrefs,
  setCustomerActive,
  setPinnedNote,
  updateCustomer,
} from "@/server/crm";
import { can } from "@/lib/permissions";

/** Staff actions on a customer (WP-11). Each re-checks permissions here and again in `src/server/crm.ts`. */

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function msg(e: unknown) {
  if (e instanceof CrmError) return e.message;
  if (e instanceof Error && e.message.length < 160 && !/prisma|invocation/i.test(e.message)) return e.message;
  log.error("crm.action_failed", { error: e });
  return "Something went wrong — try again";
}

function refresh(id: string) {
  revalidatePath(`/admin/customers/${id}`);
  revalidatePath("/admin/customers");
}

export async function setActiveAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requirePermission("customers.edit");
  const id = s(fd, "id");
  const active = fd.get("active") === "true";
  try {
    const r = await setCustomerActive(actor, id, active, s(fd, "reason"));
    refresh(id);
    if (!r.changed) return done(active ? "Already active" : "Already suspended");
    return done(active ? "Reactivated — they can sign in and order again" : `Suspended and signed out of ${r.sessionsRevoked} device(s)`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function saveNoteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requirePermission("customers.edit");
  const id = s(fd, "id");
  try {
    await setPinnedNote(actor, id, String(fd.get("note") ?? ""));
    refresh(id);
    return done("Pinned note saved");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function addNoteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requirePermission("customers.edit");
  const id = s(fd, "id");
  try {
    await addCustomerNote(actor, id, String(fd.get("note") ?? ""));
    refresh(id);
    return done("Note added to the timeline");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function updateCustomerAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requirePermission("customers.edit");
  const id = s(fd, "id");
  const spice = parseInt(s(fd, "spiceTolerance"), 10);
  try {
    const r = await updateCustomer(
      actor,
      id,
      {
        name: s(fd, "name"),
        locale: s(fd, "locale"),
        diet: s(fd, "diet"),
        spiceTolerance: Number.isFinite(spice) ? spice : undefined,
        allergies: fd.getAll("allergies").map(String),
        avoidOnionGarlic: fd.get("avoidOnionGarlic") === "on",
        dietaryNotes: String(fd.get("dietaryNotes") ?? ""),
        ...(fd.has("phone") && can(actor, "customers.pii") ? { phone: s(fd, "phone") } : {}),
      },
      s(fd, "reason") || null,
    );
    refresh(id);
    return done(r.changed.length ? `Saved: ${r.changed.join(", ")}` : "Nothing changed");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function creditAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requirePermission("refunds.create");
  const id = s(fd, "id");
  const amount = parseRupees(s(fd, "amount"));
  if (amount == null || amount <= 0) return fail("Enter the credit in rupees");
  try {
    if (can(actor, "refunds.approve")) {
      await issueCredit(actor, id, amount, s(fd, "note"));
      refresh(id);
      return done("Credit added to their wallet");
    }
    await requestCredit(actor, id, amount, s(fd, "note"));
    refresh(id);
    return done("Credit requested — someone who can approve credit will review it");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function decideCreditAction(fd: FormData): Promise<{ ok: boolean; message?: string }> {
  const actor = await requirePermission("refunds.approve");
  try {
    const r = await decideCreditRequest(actor, s(fd, "requestId"), fd.get("approve") === "true", s(fd, "reason") || null);
    refresh(s(fd, "id"));
    return { ok: true, message: r.approved ? "Approved — credit added" : "Rejected" };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export async function commPrefsAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requirePermission("customers.edit");
  const id = s(fd, "id");
  const prefs: Record<string, boolean> = {};
  for (const t of PREF_TOPICS) for (const c of PREF_CHANNELS) prefs[`${t}:${c}`] = fd.get(`${t}:${c}`) === "on";
  try {
    const r = await setCommunicationPrefs(actor, id, prefs, s(fd, "reason"));
    refresh(id);
    return done(r.changed.length ? "Communication preferences saved" : "Nothing changed");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function openPrivacyRequestAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requirePermission("privacy.edit");
  const id = s(fd, "id");
  try {
    await logPrivacyRequest(actor, id, fd.get("type") === "DELETE" ? "DELETE" : "EXPORT", s(fd, "note") || null);
    refresh(id);
    return done("Request logged — complete it below or from Privacy requests");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function processPrivacyAction(fd: FormData): Promise<{ ok: boolean; message?: string }> {
  const actor = await requirePermission("privacy.edit");
  try {
    const r = await processPrivacyRequest(actor, s(fd, "requestId"), s(fd, "reason") || null);
    refresh(s(fd, "id"));
    return { ok: true, message: r.type === "DELETE" ? "Personal data anonymised" : "Marked done" };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}
