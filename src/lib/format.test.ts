import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration } from "./format";

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
