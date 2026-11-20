import { apiRoute } from "@/server/api/route";
import { riderDayWindow, riderRouteDays } from "@/server/dispatch";

export const dynamic = "force-dynamic";

/** Route counts per day inside the rider window, for the date strip. Riders count their own routes only. */
export const GET = apiRoute({ auth: { permission: "rider.view" } }, async ({ user }) => {
  const counts = await riderRouteDays(user);
  return { window: riderDayWindow(), days: [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, routes]) => ({ date, routes })) };
});
