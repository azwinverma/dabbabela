"use server";
import type { MemberRole } from "@prisma/client";
import { requireCompanyAdmin } from "@/lib/auth";
import { siteUrl } from "@/lib/site-url";
import { isValidISODate } from "@/lib/dates";
import { fail, done, type ActionResult } from "@/lib/action";
import { commitImport, createInvite, parseRosterCsv, placeTeamOrder, revokeInvite, updateMember, type ImportRow } from "@/server/team";

const msg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function updateMemberAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user, company } = await requireCompanyAdmin();
  try {
    const status = s(fd, "status");
    await updateMember(company.id, s(fd, "memberId"), user.id, {
      ...(status === "ACTIVE" || status === "REMOVED" ? { status } : {}),
      role: (s(fd, "role") === "ADMIN" ? "ADMIN" : "MEMBER") as MemberRole,
      department: s(fd, "department") || null,
      costCenter: s(fd, "costCenter") || null,
      employeeCode: s(fd, "employeeCode") || null,
      officeLocationId: s(fd, "officeLocationId") || null,
    });
    return done(status === "REMOVED" ? "Removed from the team" : status === "ACTIVE" ? "Approved" : "Saved");
  } catch (e) {
    return fail(msg(e));
  }
}

export async function inviteAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user, company } = await requireCompanyAdmin();
  try {
    await createInvite(company.id, { id: user.id, name: user.name }, { email: s(fd, "email"), name: s(fd, "name"), department: s(fd, "department"), role: s(fd, "role") === "ADMIN" ? "ADMIN" : "MEMBER" }, await siteUrl());
    return done(`Invite emailed to ${s(fd, "email")} (valid 14 days)`);
  } catch (e) {
    return fail(msg(e));
  }
}

export async function revokeInviteAction(id: string) {
  const { company } = await requireCompanyAdmin();
  try {
    await revokeInvite(company.id, id);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}

export type ImportState = ActionResult & { rows?: ImportRow[]; results?: { email: string; ok: boolean; message: string }[]; csv?: string };

/** Step 1 previews (nothing saved); step 2 (commit=1) sends invites for valid rows only. */
export async function importAction(_: ImportState, fd: FormData): Promise<ImportState> {
  const { user, company } = await requireCompanyAdmin();
  let text = s(fd, "csv");
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > 200_000) return { ok: false, message: "Keep the file under 200 KB (about 500 people)" };
    text = await file.text();
  }
  if (!text) return { ok: false, message: "Paste the list or choose a CSV file" };
  const rows = parseRosterCsv(text);
  if (!rows.length) return { ok: false, message: "No rows found" };
  if (fd.get("commit") !== "1") {
    const bad = rows.filter((r) => r.error).length;
    return { ok: false, rows, csv: text, message: bad ? `${bad} row(s) have problems and will be skipped. Fix them or continue.` : `${rows.length} people ready to invite.` };
  }
  const results = await commitImport(company.id, { id: user.id, name: user.name }, rows, await siteUrl());
  return { ok: true, results, message: `${results.filter((r) => r.ok).length} of ${rows.length} invited` };
}

export type TeamOrderState = ActionResult & { results?: { name: string; ok: boolean; message: string }[] };

export async function teamOrderAction(_: TeamOrderState, fd: FormData): Promise<TeamOrderState> {
  const { user, company } = await requireCompanyAdmin();
  const date = s(fd, "date");
  if (!isValidISODate(date)) return { ok: false, message: "Pick a date" };
  const memberIds = fd.getAll("memberId").map(String).filter(Boolean);
  try {
    const results = await placeTeamOrder(company.id, { id: user.id }, { memberIds, date, boxId: s(fd, "boxId"), slotId: s(fd, "slotId") || null });
    const ok = results.filter((r) => r.ok).length;
    return { ok: ok > 0, results, message: `${ok} of ${results.length} dabbas ordered` };
  } catch (e) {
    return { ok: false, message: msg(e) };
  }
}
