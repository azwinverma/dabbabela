import { describe, expect, it } from "vitest";
import {
  cleanViewName,
  dateWhere,
  flatParams,
  hrefWith,
  isValidModule,
  pageCount,
  pageWindow,
  parseDateRange,
  parseEnum,
  parseListParams,
  parseView,
  sameView,
  serializeView,
  sortHref,
  viewHref,
} from "@/app/admin/_kit/params";

describe("list params", () => {
  const opts = { sortable: ["createdAt", "total"] as const, sort: "createdAt" as const };

  it("parses page, per and sort with safe fallbacks", () => {
    expect(parseListParams({}, opts)).toEqual({ page: 1, per: 50, sort: "createdAt", dir: "desc" });
    expect(parseListParams({ page: "3", per: "100", sort: "total", dir: "asc" }, opts)).toEqual({ page: 3, per: 100, sort: "total", dir: "asc" });
    expect(parseListParams({ page: "-4", per: "9999", sort: "password", dir: "sideways" }, opts)).toEqual({ page: 1, per: 50, sort: "createdAt", dir: "desc" });
    expect(parseListParams({ page: ["2", "5"] }, opts).page).toBe(2);
    expect(parseListParams({ page: "abc" }, { ...opts, per: 25 })).toMatchObject({ page: 1, per: 25 });
  });

  it("computes windows and page counts", () => {
    expect(pageWindow({ page: 3, per: 25 })).toEqual({ skip: 50, take: 25 });
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(51, 25)).toBe(3);
  });

  it("parses Kathmandu date ranges", () => {
    const r = parseDateRange({ from: "2026-11-01", to: "2026-11-03" });
    expect(r.gte?.toISOString()).toBe("2026-10-31T18:15:00.000Z");
    expect(r.lte?.toISOString()).toBe("2026-11-03T18:14:59.999Z");
    expect(parseDateRange({ from: "2026-11-05", to: "2026-11-01" })).toMatchObject({ from: "2026-11-01", to: "2026-11-05" });
    expect(parseDateRange({ from: "2026-13-40" })).toEqual({ from: undefined, to: undefined, gte: undefined, lte: undefined });
    expect(dateWhere({})).toBeUndefined();
  });

  it("restricts enums", () => {
    expect(parseEnum({ status: "OPEN" }, "status", ["OPEN", "CLOSED"] as const)).toBe("OPEN");
    expect(parseEnum({ status: "DROP TABLE" }, "status", ["OPEN"] as const)).toBeUndefined();
  });

  it("builds links that keep filters and reset paging when filters change", () => {
    const p = { q: "momo", status: "OPEN", page: "4" };
    expect(hrefWith("/admin/x", p, { page: 5 })).toBe("/admin/x?q=momo&status=OPEN&page=5");
    expect(hrefWith("/admin/x", p, { status: "CLOSED" })).toBe("/admin/x?q=momo&status=CLOSED");
    expect(hrefWith("/admin/x", p, { q: null, status: "" })).toBe("/admin/x");
    expect(hrefWith("/admin/x", { page: "2" }, { page: 1 })).toBe("/admin/x");
    expect(hrefWith("/admin/x", { q: "a&b=c" })).toBe("/admin/x?q=a%26b%3Dc");
  });

  it("toggles sort direction on the active column", () => {
    const params = { q: "x", page: "3" };
    expect(sortHref("/a", params, { sort: "createdAt", dir: "desc" }, "createdAt")).toBe("/a?q=x&sort=createdAt&dir=asc");
    expect(sortHref("/a", params, { sort: "createdAt", dir: "asc" }, "createdAt")).toBe("/a?q=x&sort=createdAt&dir=desc");
    expect(sortHref("/a", params, { sort: "createdAt", dir: "asc" }, "total", "asc")).toBe("/a?q=x&sort=total&dir=asc");
  });

  it("flattens Next search params and URLSearchParams", () => {
    expect(flatParams({ a: "1", b: ["2", "3"], c: "", d: undefined, e: "  " })).toEqual({ a: "1", b: "2" });
    expect(flatParams(new URLSearchParams("a=1&a=2&b="))).toEqual({ a: "1" });
  });
});

describe("saved-view serialization", () => {
  it("drops paging, invalid keys, non-scalars and empties; sorts and caps", () => {
    expect(serializeView({ status: "OPEN", page: "3", "bad key": "x", nested: { a: 1 }, n: 5, empty: "", list: ["first", "second"] })).toEqual({ list: "first", n: "5", status: "OPEN" });
    expect(Object.keys(serializeView({ zeta: "1", alpha: "2" }))).toEqual(["alpha", "zeta"]);
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${String(i).padStart(2, "0")}`, "v"]));
    expect(Object.keys(serializeView(many))).toHaveLength(20);
    expect(serializeView({ q: "x".repeat(500) }).q).toHaveLength(200);
  });

  it("parses untrusted stored JSON safely and round-trips", () => {
    expect(parseView(null)).toEqual({});
    expect(parseView(["a"])).toEqual({});
    expect(parseView("status=OPEN")).toEqual({});
    const q = { status: "OPEN", from: "2026-11-01" };
    expect(parseView(JSON.parse(JSON.stringify(serializeView(q))))).toEqual(serializeView(q));
    expect(viewHref("/admin/orders", { status: "OPEN", page: "9" })).toBe("/admin/orders?status=OPEN");
  });

  it("matches the current URL ignoring page and key order", () => {
    expect(sameView({ a: "1", b: "2" }, { b: "2", a: "1", page: "4" })).toBe(true);
    expect(sameView({ a: "1" }, { a: "1", b: "2" })).toBe(false);
  });

  it("validates module slugs and names", () => {
    expect(isValidModule("audit")).toBe(true);
    expect(isValidModule("inventory/stock")).toBe(true);
    expect(isValidModule("../etc")).toBe(false);
    expect(isValidModule("Orders")).toBe(false);
    expect(cleanViewName("  a   b ")).toBe("a b");
    expect(cleanViewName("x".repeat(100))).toHaveLength(60);
  });
});
