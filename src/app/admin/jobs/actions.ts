"use server";
import { done, fail, type ActionResult } from "@/lib/action";
import { guarded } from "../_kit/guard";
import { f } from "../_kit/form";
import { JOBS, retryJobRun, runJobManually, type JobName } from "@/server/jobs";

const PATHS = ["/admin/jobs", "/admin/alerts", "/admin"];

export async function runJobAction(job: string): Promise<ActionResult> {
  return guarded(
    "settings.edit",
    async (user) => {
      if (!(job in JOBS)) return fail("Unknown job");
      const r = await runJobManually(user, job as JobName);
      return r.failed.length ? fail(`${JOBS[job as JobName].label} ran; failed steps: ${r.failed.join(", ")} — see the history below`) : done(`${JOBS[job as JobName].label} ran`);
    },
    PATHS,
  );
}

export async function retryRunAction(fd: FormData): Promise<ActionResult> {
  return guarded(
    "settings.edit",
    async (user) => {
      const r = await retryJobRun(user, f.str(fd, "key", 300));
      return r.ok ? done("Retried — done") : fail(`Failed again: ${r.error?.slice(0, 180)}`);
    },
    PATHS,
  );
}
