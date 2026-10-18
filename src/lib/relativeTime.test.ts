import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../i18n";
import { refreshedLabel, relativeTime } from "./relativeTime";

const activate = (locale: string) =>
  i18n.loadAndActivate({ locale, messages: {} });

afterEach(() => activate("en"));

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
    expect(relativeTime(agoMs(5_000), now)).toBe("now");
    expect(relativeTime(agoMs(2 * MINUTE), now)).toBe("2 minutes ago");
    expect(relativeTime(agoMs(2 * HOUR), now)).toBe("2 hours ago");
    expect(relativeTime(agoMs(3 * DAY), now)).toBe("3 days ago");
  });

  it("rounds down, so a unit is only claimed once it has passed", () => {
    expect(relativeTime(agoMs(59_000), now)).toBe("now");
    expect(relativeTime(agoMs(HOUR - 1000), now)).toBe("59 minutes ago");
    expect(relativeTime(agoMs(DAY - 1000), now)).toBe("23 hours ago");
  });

  it("treats a timestamp from a clock ahead of this one as now", () => {
    expect(relativeTime(agoMs(-5 * MINUTE), now)).toBe("now");
  });

  it("follows the app language: vor 3 Tagen under de", () => {
    activate("de");
    expect(relativeTime(agoMs(3 * DAY), now)).toBe("vor 3 Tagen");
    expect(relativeTime(agoMs(5_000), now)).toBe("jetzt");
  });

  it("gives a date once the relative form stops meaning anything", () => {
    const stamp = relativeTime(agoMs(400 * DAY), now);
    expect(stamp).not.toMatch(/ago/);
    expect(stamp).toMatch(/2025/);
  });
});

describe("refreshedLabel", () => {
  it("says now under a minute", () => {
    expect(refreshedLabel(0)).toBe("refreshed now");
    expect(refreshedLabel(59)).toBe("refreshed now");
  });

  it("counts whole minutes, hours and days", () => {
    expect(refreshedLabel(180)).toBe("refreshed 3 minutes ago");
    expect(refreshedLabel(3600)).toBe("refreshed 1 hour ago");
    expect(refreshedLabel(86_400 * 2 + 5)).toBe("refreshed 2 days ago");
  });

  it("keeps counting days rather than switching to a date", () => {
    expect(refreshedLabel(86_400 * 90)).toBe("refreshed 90 days ago");
  });
});
