"use server";
import { done, type ActionResult } from "@/lib/action";
import { guarded } from "../_kit/guard";
import { f } from "../_kit/form";
import { closePeriod, reopenPeriod } from "@/server/finance/settlement";

const PATHS = ["/admin/profitability", "/admin/expenses"];

export async function closePeriodAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "settlements.approve",
    async (user) => {
      const month = f.str(fd, "month", 7);
      await closePeriod(user, month, f.opt(fd, "note", 500));
      return done(`${month} closed — nothing dated in it can change now`);
    },
    PATHS,
  );
}

export async function reopenPeriodAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  return guarded(
    "settlements.approve",
    async (user) => {
      const month = f.str(fd, "month", 7);
      await reopenPeriod(user, month, f.str(fd, "reason", 500));
      return done(`${month} re-opened`);
    },
    PATHS,
  );
}
