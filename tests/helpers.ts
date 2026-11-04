import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import { addDays, ktmNow, weekdayOf } from "@/lib/dates";

export async function loadUser(email: string): Promise<CurrentUser> {
  const u = await db.user.findUniqueOrThrow({
    where: { email },
    include: {
      membership: { include: { company: true, officeLocation: true } },
      addresses: { where: { archivedAt: null }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], include: { zone: true } },
    },
  });
  return { ...u, sessionId: "test" };
}

/** Next service day (Sun–Fri) at least `minAhead` days out, so cut-offs never interfere. */
export function serviceDay(minAhead = 2, n = 0) {
  let d = addDays(ktmNow().date, minAhead);
  let found = 0;
  for (;;) {
    if (weekdayOf(d) !== "SAT") {
      if (found === n) return d;
      found++;
    }
    d = addDays(d, 1);
  }
}

export async function primaryBoxOn(date: string) {
  const { getOffersForDates } = await import("@/server/menu");
  const offers = await getOffersForDates([date]);
  const o = offers.get(date)!;
  return o.items.find((i) => i.isPrimary)!.box;
}
