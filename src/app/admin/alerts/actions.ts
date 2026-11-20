"use server";
import type { Role } from "@prisma/client";
import { done, fail, type ActionResult } from "@/lib/action";
import { guarded } from "../_kit/guard";
import { f } from "../_kit/form";
import { acknowledgeAlerts, assignAlerts, reopenAlert, resolveAlerts, saveEscalationRules } from "@/server/alerts";
import { alertsJob } from "@/server/jobs";
import { audit } from "@/lib/audit";

const PATHS = ["/admin/alerts", "/admin"];

function ids(fd: FormData) {
  return fd
    .getAll("ids")
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

const plural = (n: number) => `${n} alert${n === 1 ? "" : "s"}`;

export async function acknowledgeAlertsAction(fd: FormData): Promise<ActionResult> {
  return guarded("alerts.edit", async (user) => done(`${plural((await acknowledgeAlerts(user, ids(fd))).changed)} acknowledged`), PATHS);
}

export async function assignAlertsAction(fd: FormData): Promise<ActionResult> {
  return guarded("alerts.edit", async (user) => done(`${plural((await assignAlerts(user, ids(fd), f.opt(fd, "ownerId", 40))).changed)} assigned`), PATHS);
}

export async function resolveAlertsAction(fd: FormData): Promise<ActionResult> {
  return guarded(
    "alerts.edit",
    async (user) => {
      const note = f.str(fd, "note", 1000) || f.str(fd, "reason", 1000);
      return done(`${plural((await resolveAlerts(user, ids(fd), note)).changed)} resolved`);
    },
    PATHS,
  );
}

export async function reopenAlertAction(fd: FormData): Promise<ActionResult> {
  return guarded(
    "alerts.edit",
    async (user) => {
      await reopenAlert(user, ids(fd)[0] ?? "", f.str(fd, "reason", 500));
      return done("Re-opened");
    },
    PATHS,
  );
}

/** Run every detector + escalation now (recorded as an `alerts.*` JobRun). */
export async function runDetectorsAction(): Promise<ActionResult> {
  return guarded(
    "alerts.edit",
    async (user) => {
      const r = await alertsJob();
      await audit({ actorId: user.id, action: "alert.run_detectors", entity: "JobRun", entityId: r.bucket, summary: `Detectors run manually${r.failed.length ? ` — failed: ${r.failed.join(", ")}` : ""}` });
      if (r.failed.length) return fail(`Some steps failed: ${r.steps.filter((s) => s.error).map((s) => s.error).join("; ").slice(0, 200)}`);
      const d = r.steps.find((s) => s.step === "detectors")?.result as { raised?: number; reopened?: number; resolved?: number } | undefined;
      return done(d ? `Detectors ran: ${d.raised ?? 0} new, ${d.reopened ?? 0} re-opened, ${d.resolved ?? 0} auto-resolved` : "Detectors ran");
    },
    PATHS,
  );
}

const minutes = (fd: FormData, k: string) => {
  const s = f.str(fd, k, 10);
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 && n <= 10_080 ? n : null;
};

export async function saveEscalationAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "alerts.edit",
    async (user) => {
      await saveEscalationRules(user, {
        criticalAfterMinutes: minutes(fd, "criticalAfterMinutes"),
        warningAfterMinutes: minutes(fd, "warningAfterMinutes"),
        roles: fd.getAll("roles").filter((v): v is string => typeof v === "string") as Role[],
        notifyEmail: f.bool(fd, "notifyEmail"),
      });
      return done("Escalation rules saved");
    },
    PATHS,
  );
}
