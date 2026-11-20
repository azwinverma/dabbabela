import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readJson } from "@/server/api/http";
import { assertOwnSubscription, ISO_DATE } from "@/server/api/customer-dto";
import { pauseSubscription } from "@/server/subscriptions";

export const dynamic = "force-dynamic";

const schema = z.object({ from: z.string().regex(ISO_DATE, "Use YYYY-MM-DD").optional(), reason: z.string().max(300).optional() });

/** Pause a plan from `from` (default: the next changeable meal). Paused meals are held until resume. */
export const POST = apiRoute<"user", { id: string }>({ auth: "user", limit: "write" }, async ({ req, user, params }) => {
  const b = await readJson(req, schema);
  await assertOwnSubscription(user.id, params.id);
  const n = await pauseSubscription(params.id, { id: user.id, isStaff: false }, { userId: user.id, from: b.from, reason: b.reason?.trim() || undefined });
  return { paused: n, message: `Paused — ${n} meal${n === 1 ? "" : "s"} on hold until you resume` };
});
