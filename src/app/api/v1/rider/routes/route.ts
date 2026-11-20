import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readQuery, ymd } from "@/server/api/http";
import { isoDateStr } from "@/server/api/ops-dto";
import { isPastDay, riderDate, riderDayWindow, riderRoutes } from "@/server/dispatch";

export const dynamic = "force-dynamic";

const q = z.object({ date: isoDateStr.optional() });
const FINISHED = ["DELIVERED", "FAILED_DELIVERY", "CANCELLED"];

/**
 * Routes for one day (default today, Kathmandu). Riders see only their own; other staff with rider.view see their
 * kitchens'. Days outside the window (last 14 days … next 7) fall back to today, like the web rider app.
 */
export const GET = apiRoute({ auth: { permission: "rider.view" } }, async ({ req, user }) => {
  const p = readQuery(req, q);
  const window = riderDayWindow();
  const date = riderDate(p.date, window.today);
  const routes = await riderRoutes(user, date);
  return {
    date,
    window,
    readOnly: isPastDay(date, window.today),
    routes: routes.map((r) => ({
      id: r.id,
      name: r.name,
      date: ymd(r.date),
      status: r.status,
      slotLabel: r.slot?.label ?? null,
      riderName: r.rider?.name ?? null,
      stops: r.assignments.length,
      stopsDone: r.assignments.filter((a) => FINISHED.includes(a.order.status)).length,
      cashCollected: r.cashCollected,
      readOnly: isPastDay(ymd(r.date)!, window.today),
    })),
  };
});
