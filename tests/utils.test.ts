import { describe, expect, it } from "vitest";
import { formatDate, formatDuration, relativeTime } from "@/lib/utils";

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
