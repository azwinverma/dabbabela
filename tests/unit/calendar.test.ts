import { describe, expect, it } from "vitest";
import { dateProblem, planDatesFrom } from "@/server/calendar";

const settings = { orderCutoff: "09:30", advanceDays: 28, deliveryDays: ["SUN", "MON", "TUE", "WED", "THU", "FRI"] as const };

describe("cut-off & service calendar", () => {
  const now = { date: "2026-11-08", time: "09:00" }; // a Sunday
  it("accepts same-day before the cut-off and refuses after", () => {
    expect(dateProblem("2026-11-08", { ...settings, deliveryDays: [...settings.deliveryDays] }, new Map(), { now })).toBeNull();
    expect(dateProblem("2026-11-08", { ...settings, deliveryDays: [...settings.deliveryDays] }, new Map(), { now: { ...now, time: "09:30" } })).toMatch(/close at 09:30/);
  });
  it("honours a company cut-off override", () => {
    expect(dateProblem("2026-11-08", { ...settings, deliveryDays: [...settings.deliveryDays] }, new Map(), { now: { ...now, time: "09:45" }, cutoff: "10:00" })).toBeNull();
  });
  it("refuses past days, Saturdays, closures and far-future days", () => {
    const s = { ...settings, deliveryDays: [...settings.deliveryDays] };
    expect(dateProblem("2026-11-07", s, new Map(), { now })).toMatch(/passed/);
    expect(dateProblem("2026-11-14", s, new Map(), { now })).toMatch(/don't deliver/);
    expect(dateProblem("2026-11-10", s, new Map([["2026-11-10", "Tihar"]]), { now })).toMatch(/Tihar/);
    expect(dateProblem("2026-12-20", s, new Map(), { now })).toMatch(/28 days/);
  });
  it("counts a month plan in real service days", () => {
    const dates = planDatesFrom("2026-11-08", 4, ["SUN", "MON", "TUE", "WED", "THU", "FRI"], [...settings.deliveryDays], new Map([["2026-11-10", "Tihar"], ["2026-11-11", "Tihar"]]));
    expect(dates.length).toBe(22); // 24 service days minus 2 holidays
    expect(dates).not.toContain("2026-11-14");
  });
});
