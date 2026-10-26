import { describe, expect, it } from "vitest";
import {
  AmountError,
  ONE_MUSD,
  basisPoints,
  checkMilestoneSum,
  formatMusd,
  parseMusd,
  splitEvenly,
  sumWei,
  toDecimalString,
  tryParseMusd,
} from "@/lib/money";

describe("parseMusd", () => {
  it("parses whole and fractional amounts into 18-decimal base units", () => {
    expect(parseMusd("40")).toBe(40n * ONE_MUSD);
    expect(parseMusd("40.5")).toBe(405n * 10n ** 17n);
    expect(parseMusd("0.000000000000000001")).toBe(1n);
    expect(parseMusd("1,234.56")).toBe(123456n * 10n ** 16n);
    expect(parseMusd(" 200 ")).toBe(200n * ONE_MUSD);
  });
  it("rejects malformed, negative, exponent and over-precise input", () => {
    for (const bad of ["", "-1", "1e18", "abc", "1.2.3", ".5", "01", "1.0000000000000000001", "NaN", "Infinity"]) {
      expect(() => parseMusd(bad), bad).toThrow(AmountError);
    }
  });
  it("never uses floating point (0.1 + 0.2 exact)", () => {
    expect(parseMusd("0.1") + parseMusd("0.2")).toBe(parseMusd("0.3"));
  });
  it("tryParseMusd returns null instead of throwing", () => {
    expect(tryParseMusd("x")).toBeNull();
    expect(tryParseMusd(null)).toBeNull();
    expect(tryParseMusd("2")).toBe(2n * ONE_MUSD);
  });
});

describe("formatting", () => {
  it("toDecimalString is exact and trims trailing zeros", () => {
    expect(toDecimalString(40n * ONE_MUSD)).toBe("40");
    expect(toDecimalString(405n * 10n ** 17n)).toBe("40.5");
    expect(toDecimalString(1n)).toBe("0.000000000000000001");
    expect(toDecimalString(-5n * ONE_MUSD)).toBe("-5");
  });
  it("formatMusd groups thousands and truncates (never rounds up)", () => {
    expect(formatMusd(1234567n * ONE_MUSD)).toBe("1,234,567.00");
    expect(formatMusd(parseMusd("39.999"))).toBe("39.99");
    expect(formatMusd(parseMusd("160"), { symbol: true })).toBe("160.00 MUSD");
    expect(formatMusd(parseMusd("0.5"), { maxDecimals: 4, minDecimals: 0 })).toBe("0.5");
  });
  it("formatMusd shows dust as <0.01 instead of 0.00", () => {
    expect(formatMusd(1n)).toBe("<0.01");
    expect(formatMusd(0n)).toBe("0.00");
  });
  it("formatMusd scales the dust marker with the requested precision", () => {
    expect(formatMusd(ONE_MUSD / 2n, { maxDecimals: 0 })).toBe("<1");
    expect(formatMusd(1n, { maxDecimals: 4, symbol: true })).toBe("<0.0001 MUSD");
    expect(formatMusd(-1n)).toBe("-<0.01");
  });
});

describe("milestone sums", () => {
  const amounts = ["40", "60", "60", "40"].map(parseMusd);
  it("accepts the spec example 40/60/60/40 = 200", () => {
    const r = checkMilestoneSum(parseMusd("200"), amounts);
    expect(r.ok).toBe(true);
    expect(r.difference).toBe(0n);
  });
  it("reports under- and over-allocation exactly", () => {
    expect(checkMilestoneSum(parseMusd("210"), amounts)).toMatchObject({ ok: false, difference: parseMusd("10") });
    expect(checkMilestoneSum(parseMusd("190"), amounts)).toMatchObject({ ok: false, difference: -parseMusd("10") });
  });
  it("rejects zero milestones, zero amounts and zero budget", () => {
    expect(checkMilestoneSum(0n, []).ok).toBe(false);
    expect(checkMilestoneSum(parseMusd("10"), [parseMusd("10"), 0n]).ok).toBe(false);
    expect(checkMilestoneSum(0n, [0n]).ok).toBe(false);
  });
  it("splitEvenly keeps the exact total (remainder on the last part)", () => {
    const parts = splitEvenly(parseMusd("100"), 3);
    expect(sumWei(parts)).toBe(parseMusd("100"));
    expect(parts[0]).toBe(parts[1]);
    expect(parts[2] - parts[0]).toBe(1n);
    expect(splitEvenly(10n, 0)).toEqual([]);
  });
  it("basisPoints is floored and capped", () => {
    expect(basisPoints(parseMusd("40"), parseMusd("200"))).toBe(2000);
    expect(basisPoints(1n, 3n)).toBe(3333);
    expect(basisPoints(5n, 0n)).toBe(0);
    expect(basisPoints(10n, 5n)).toBe(10_000);
  });
});
