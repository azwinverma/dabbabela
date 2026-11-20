import { apiRoute } from "@/server/api/route";
import { assertOwnSubscription } from "@/server/api/customer-dto";
import { resumeSubscription } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

/** Resume a paused plan: held meals are rescheduled from the next available service days. */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", limit: "write" }, async ({ user, params }) => {
  await assertOwnSubscription(user.id, params.id);
  const n = await resumeSubscription(params.id, { id: user.id, isStaff: false }, { userId: user.id });
  return { rescheduled: n, message: `Welcome back — ${n} meal${n === 1 ? "" : "s"} rescheduled` };
});
