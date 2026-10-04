import { describe, expect, it } from "vitest";
import { answeredScan, type ScanReading, scanSettled } from "./scanSettled";

const RUNNING: ScanReading = {
  loading: true,
  data: null,
  error: null,
  cancelled: false,
};
const NOT_RUN: ScanReading = { ...RUNNING, loading: false };
const DONE: ScanReading = { ...NOT_RUN, data: {} };
const FAILED: ScanReading = { ...NOT_RUN, error: "boom" };
const CANCELLED: ScanReading = { ...NOT_RUN, cancelled: true };

const withScan = (scan: ScanReading) =>
  scanSettled({ targetLoading: false, hasTarget: true, scan });

describe("whether the unitsync scan has answered", () => {
  it("waits for the target read before asking anything", () => {
    expect(
      scanSettled({ targetLoading: true, hasTarget: false, scan: DONE }),
    ).toBe(false);
  });

  it("is answered on an install with no engine to scan", () => {
    // There is no scan to wait for and there never will be, so a reader that
    // waited for one would wait forever.
    expect(
      scanSettled({ targetLoading: false, hasTarget: false, scan: NOT_RUN }),
    ).toBe(true);
  });

  it("waits while the scan is running, and while it has not started", () => {
    expect(withScan(RUNNING)).toBe(false);
    expect(withScan(NOT_RUN)).toBe(false);
  });

  it("is answered by a result, an error or a cancel alike", () => {
    // An error is an answer. It is not a report of an empty install, which is
    // why callers read `data` separately, but it does end the wait.
    expect(withScan(DONE)).toBe(true);
    expect(withScan(FAILED)).toBe(true);
    expect(withScan(CANCELLED)).toBe(true);
  });
});

describe("whether a scan result can vouch for what is installed", () => {
  it("passes a clean result through", () => {
    const data = {};
    expect(answeredScan(data)).toBe(data);
  });

  it("returns nothing for a result whose Init failed (issue #3392)", () => {
    expect(answeredScan({ initFailure: "disk full" })).toBeNull();
  });

  it("returns nothing when there is no result", () => {
    expect(answeredScan(null)).toBeNull();
    expect(answeredScan(undefined)).toBeNull();
  });
});
