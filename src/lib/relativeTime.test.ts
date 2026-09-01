import { describe, expect, it } from "vitest";
import { relativeTime } from "./relativeTime";

const now = Date.parse("2026-09-01T12:00:00.000Z");
const agoMs = (ms: number) => new Date(now - ms).toISOString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("says nothing at all for a document with no timestamp", () => {
    expect(relativeTime(undefined, now)).toBeNull();
    expect(relativeTime("", now)).toBeNull();
    expect(relativeTime("last tuesday", now)).toBeNull();
  });

  it("counts in the largest unit that still has a whole number in it", () => {
    expect(relativeTime(agoMs(5_000), now)).toBe("just now");
    expect(relativeTime(agoMs(2 * MINUTE), now)).toBe("2m ago");
    expect(relativeTime(agoMs(2 * HOUR), now)).toBe("2h ago");
    expect(relativeTime(agoMs(3 * DAY), now)).toBe("3d ago");
  });

  it("rounds down, so a unit is only claimed once it has passed", () => {
    expect(relativeTime(agoMs(59_000), now)).toBe("just now");
    expect(relativeTime(agoMs(HOUR - 1000), now)).toBe("59m ago");
    expect(relativeTime(agoMs(DAY - 1000), now)).toBe("23h ago");
  });

  it("treats a timestamp from a clock ahead of this one as now", () => {
    expect(relativeTime(agoMs(-5 * MINUTE), now)).toBe("just now");
  });

  it("gives a date once the relative form stops meaning anything", () => {
    const stamp = relativeTime(agoMs(400 * DAY), now);
    expect(stamp).not.toMatch(/ago/);
    expect(stamp).toMatch(/2025/);
  });
});
