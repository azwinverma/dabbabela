import { describe, expect, it } from "vitest";
import { allocate, inclusiveTax, parseRupees, rs } from "@/lib/money";
import { normalizeNepalPhone, isNepalMobile, maskPhone } from "@/lib/phone";

describe("money", () => {
  it("formats paisa as rupees with South Asian grouping", () => {
    expect(rs(20000)).toBe("Rs 200");
    expect(rs(12500000)).toBe("Rs 1,25,000");
    expect(rs(22650)).toBe("Rs 226.50");
    expect(rs(-5000)).toBe("−Rs 50");
    expect(rs(20000, { locale: "ne" })).toBe("रु 200");
  });
  it("parses staff input into paisa without floats", () => {
    expect(parseRupees("200")).toBe(20000);
    expect(parseRupees("1,250.5")).toBe(125050);
    expect(parseRupees("0.29")).toBe(29);
    expect(parseRupees("abc")).toBeNull();
    expect(parseRupees("1.234")).toBeNull();
    // signed amounts, as the credit-adjustment form suggests ("+100 or -50")
    expect(parseRupees("+100")).toBe(10000);
    expect(parseRupees("-50")).toBe(-5000);
    expect(parseRupees("+-5")).toBeNull();
  });
  it("allocates exactly", () => {
    const parts = allocate(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(7, [0, 0])).toEqual([0, 0]);
  });
  it("extracts inclusive VAT", () => {
    expect(inclusiveTax(11300, 1300)).toBe(1300);
    expect(inclusiveTax(20000, 1300)).toBe(2301);
  });
});

describe("Nepal phone numbers", () => {
  it("normalises mobiles and landlines", () => {
    expect(normalizeNepalPhone("9801234567")).toBe("+9779801234567");
    expect(normalizeNepalPhone("+977 980-123-4567")).toBe("+9779801234567");
    expect(normalizeNepalPhone("977 9761234567")).toBe("+9779761234567");
    expect(normalizeNepalPhone("01-4412345")).toBe("+97714412345");
    expect(normalizeNepalPhone("12345")).toBeNull();
    expect(isNepalMobile("9512345678")).toBe(false);
    expect(isNepalMobile("9851234567")).toBe(true);
  });
  it("masks for staff without PII access", () => {
    expect(maskPhone("+9779801234567")).toBe("980-•••-•567");
  });
});
