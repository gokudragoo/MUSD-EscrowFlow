import { describe, expect, it } from "vitest";
import { countdown, formatDate, formatDuration, relativeTime, shortAddress, shortHash } from "@/lib/utils";

describe("identifier shortening", () => {
  const addr = "0xA1640ea3e502FD0A0b41d248773C5B9928dB91CD";
  it("shortAddress keeps the 0x prefix plus head and tail", () => {
    expect(shortAddress(addr)).toBe("0xA164…91CD");
    expect(shortAddress(addr, 6)).toBe("0xA1640e…dB91CD");
    expect(shortAddress(null)).toBe("");
    expect(shortAddress(undefined)).toBe("");
  });
  it("shortHash shows 10 + 6 characters", () => {
    expect(shortHash("0x9bdaf8c89ff30c3b32579d707cbe8126f9f98724ddfd678653a0384590c3dc6b")).toBe("0x9bdaf8c8…c3dc6b");
    expect(shortHash("")).toBe("");
  });
});

describe("countdown", () => {
  const now = 1_800_000_000;
  it("switches units as the deadline approaches", () => {
    expect(countdown(now + 2 * 86_400 + 3 * 3600, now)).toBe("2d 3h");
    expect(countdown(now + 5 * 3600 + 20 * 60, now)).toBe("5h 20m");
    expect(countdown(now + 90, now)).toBe("1m 30s");
  });
  it("never goes negative after the deadline", () => {
    expect(countdown(now - 500, now)).toBe("0m 0s");
  });
});

describe("date display helpers", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");

  it("relativeTime handles past and future instants", () => {
    expect(relativeTime(now / 1000 - 10, now)).toBe("just now");
    expect(relativeTime(now / 1000 + 2 * 3600, now)).toBe("in 2 hours");
    expect(relativeTime("2026-10-23T12:00:00Z", now)).toBe("3 days ago");
  });

  it("relativeTime returns a label instead of throwing on invalid input", () => {
    expect(relativeTime("not a date", now)).toBe("unknown time");
    expect(relativeTime(Number.NaN, now)).toBe("unknown time");
  });

  it("formatDate never prints 'Invalid Date'", () => {
    expect(formatDate("garbage")).toBe("Unknown date");
    expect(formatDate(Date.UTC(2026, 9, 26) / 1000)).toMatch(/2026/);
  });
});

describe("formatDuration", () => {
  it("formats review and grace periods", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(600)).toBe("10 min");
    expect(formatDuration(7200)).toBe("2 hours");
    expect(formatDuration(86_400)).toBe("1 day");
    expect(formatDuration(3 * 86_400)).toBe("3 days");
  });

  it("rolls over to the next unit at rounding boundaries", () => {
    expect(formatDuration(3599)).toBe("1 hour");
    expect(formatDuration(3570)).toBe("1 hour");
    expect(formatDuration(86_399)).toBe("1 day");
  });
});
