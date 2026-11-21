import { z } from "zod";
import { apiRoute } from "@/server/api/route";
import { readQuery } from "@/server/api/http";
import { activeCompany } from "@/lib/auth";
import { isValidISODate, weekStartOf } from "@/lib/dates";
import { isLocale } from "@/lib/i18n";
import { getPublicWeek, resolveWeek } from "@/lib/public";
import { filterCompanyMenu, memberCompanyMenu } from "@/server/corporate";

export const dynamic = "force-dynamic";

const q = z.object({
  /** A Kathmandu service date; returns that day only. */
  date: z.string().refine(isValidISODate, "Use YYYY-MM-DD").optional(),
  /** Any date in the wanted week (Sunday-start); returns the whole week. Default: this week. */
  week: z.string().refine(isValidISODate, "Use YYYY-MM-DD").optional(),
  locale: z.string().optional(),
});

/**
 * The public menu (same data as /menu): per day, orderable or the reason it isn't, cut-off, and the dabbas with price,
 * diet, allergens, nutrition, sold-out / remaining. With a bearer token of a company member, only the company's
 * lunch menu is returned (checkout enforces the same list).
 */
export const GET = apiRoute({ auth: "optional", limit: "read" }, async ({ req, user }) => {
  const p = readQuery(req, q);
  const locale = isLocale(p.locale) ? p.locale : user && isLocale(user.locale) ? user.locale : "en";
  const week = p.date ? weekStartOf(p.date) : resolveWeek(p.week);
  const [data, companyMenu] = await Promise.all([getPublicWeek(week, locale), memberCompanyMenu(activeCompany(user))]);
  let days = data.days.map((d) => ({
    date: d.date,
    weekday: d.day,
    label: d.label,
    closed: d.closed,
    closure: d.closure,
    note: d.note,
    orderable: !d.problem && !d.closed,
    problem: d.problem,
    cutoff: d.cutoff,
    kind: d.kind,
    items: companyMenu ? filterCompanyMenu(d.items, companyMenu.allowed) : d.items,
  }));
  if (p.date) days = days.filter((d) => d.date === p.date);
  return {
    weekStart: data.weekStart,
    hasMenu: data.hasMenu,
    kind: data.kind,
    isPast: data.isPast,
    companyMenu: companyMenu ? { companyName: companyMenu.companyName, buildBlocked: companyMenu.buildBlocked } : null,
    days,
  };
});
