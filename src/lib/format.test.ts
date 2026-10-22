import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "../i18n";
import {
  formatBytes,
  formatCompact,
  formatDate,
  formatDateTime,
  formatDuration,
  formatList,
  formatNumber,
  formatTime,
} from "./format";

const activate = (locale: string) =>
  i18n.loadAndActivate({ locale, messages: {} });

afterEach(() => activate("en"));

describe("formatBytes", () => {
  it("returns null for a missing size", () => {
    expect(formatBytes(undefined)).toBeNull();
    expect(formatBytes(null)).toBeNull();
  });

  it("formats bytes with no decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats across units, one decimal under 10 and none at or above", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024 * 5)).toBe("5.0 MB");
    expect(formatBytes(1024 * 1024 * 20)).toBe("20 MB");
  });

  it("does not stop at MB, so a map over 1 GB reads in GB rather than thousands of MB", () => {
    // Issue #2426: MapsPage divided by 1_048_576 and stopped there, so a 3 GB
    // map read as "3072.0 MB".
    const threeGB = 3 * 1024 * 1024 * 1024;
    expect(formatBytes(threeGB)).toBe("3.0 GB");
  });

  it("formats GB and TB", () => {
    expect(formatBytes(1024 * 1024 * 1024 * 20)).toBe("20 GB");
    expect(formatBytes(1024 * 1024 * 1024 * 1024 * 2)).toBe("2.0 TB");
  });

  it("follows the app language: 1,5 MB under de, 1.5 MB under en", () => {
    activate("en");
    expect(formatBytes(1_536_000)).toBe("1.5 MB");
    activate("de");
    expect(formatBytes(1_536_000)).toBe("1,5 MB");
  });

  it("treats a non-finite or negative size as 0 B rather than propagating NaN", () => {
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });
});

describe("formatDuration", () => {
  it("formats under an hour as mm:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("formats an hour or more as h:mm:ss", () => {
    expect(formatDuration(3725)).toBe("1:02:05");
  });

  it("floors a fractional number of seconds", () => {
    expect(formatDuration(65.9)).toBe("1:05");
  });
});

describe("locale formatters", () => {
  it("formatNumber groups and separates by the app language", () => {
    activate("en");
    expect(formatNumber(1234.5)).toBe("1,234.5");
    activate("de");
    expect(formatNumber(1234.5)).toBe("1.234,5");
    expect(formatNumber(1.236, { maximumFractionDigits: 2 })).toBe("1,24");
  });

  it("formatCompact shortens by the app language", () => {
    activate("en");
    expect(formatCompact(1_200_000)).toBe("1.2M");
    activate("de");
    expect(formatCompact(1_200_000)).toBe("1,2\u00a0Mio.");
  });

  it("formatDate, formatTime and formatDateTime follow the app language", () => {
    const at = Date.UTC(2026, 8, 1, 12, 0, 0);
    activate("en");
    expect(formatDate(at, { dateStyle: "medium", timeZone: "UTC" })).toBe(
      "Sep 1, 2026",
    );
    expect(formatTime(at, { timeStyle: "short", timeZone: "UTC" })).toMatch(
      /12:00\sPM/,
    );
    activate("de");
    expect(formatDate(at, { dateStyle: "medium", timeZone: "UTC" })).toBe(
      "01.09.2026",
    );
    expect(formatTime(at, { timeStyle: "short", timeZone: "UTC" })).toBe(
      "12:00",
    );
    expect(formatDateTime(at, { timeZone: "UTC" })).toBe("1.9.2026, 12:00:00");
  });
});

describe("formatList", () => {
  it("writes English lists without an Oxford comma", () => {
    expect(formatList(["a", "b", "c"], "conjunction")).toBe("a, b and c");
    expect(formatList(["a", "b", "c"], "disjunction")).toBe("a, b or c");
  });

  it("follows the app language", () => {
    activate("de");
    expect(formatList(["a", "b", "c"], "conjunction")).toBe("a, b und c");
  });
});
