import { describe, expect, it } from "vitest";
import {
  computeReplayFilterVisibility,
  isShortReplay,
} from "./replayFilterVisibility";

describe("isShortReplay", () => {
  it("is short below the threshold", () => {
    expect(isShortReplay(59)).toBe(true);
    expect(isShortReplay(0)).toBe(true);
  });

  it("is not short at or above the threshold", () => {
    expect(isShortReplay(60)).toBe(false);
    expect(isShortReplay(120)).toBe(false);
  });

  it("is not short when the duration is unknown", () => {
    expect(isShortReplay(undefined)).toBe(false);
  });
});

describe("computeReplayFilterVisibility", () => {
  it("hides all when nothing is watched, remixed, or short", () => {
    const replays = [{ filename: "a" }, { filename: "b" }];
    const result = computeReplayFilterVisibility(replays, () => ({}));
    expect(result).toEqual({ watched: false, remixed: false, short: false });
  });

  it("shows watched when at least one row is watched", () => {
    const replays = [{ filename: "a" }, { filename: "b" }];
    const result = computeReplayFilterVisibility(replays, (f) => ({
      watched: f === "b",
    }));
    expect(result).toEqual({ watched: true, remixed: false, short: false });
  });

  it("shows remixed when at least one row is remixed", () => {
    const replays = [
      { filename: "a", remixed: false },
      { filename: "b", remixed: true },
    ];
    const result = computeReplayFilterVisibility(replays, () => ({}));
    expect(result).toEqual({ watched: false, remixed: true, short: false });
  });

  it("shows short when at least one row is under a minute", () => {
    const replays = [
      { filename: "a", durationSec: 120 },
      { filename: "b", durationSec: 45 },
    ];
    const result = computeReplayFilterVisibility(replays, () => ({}));
    expect(result).toEqual({ watched: false, remixed: false, short: true });
  });

  it("does not treat an unknown duration as short", () => {
    const replays = [{ filename: "a" }, { filename: "b", durationSec: 120 }];
    const result = computeReplayFilterVisibility(replays, () => ({}));
    expect(result).toEqual({ watched: false, remixed: false, short: false });
  });

  it("does not treat a replay exactly at the threshold as short", () => {
    const replays = [{ filename: "a", durationSec: 60 }];
    const result = computeReplayFilterVisibility(replays, () => ({}));
    expect(result).toEqual({ watched: false, remixed: false, short: false });
  });

  it("is based on the passed-in list, independent of any active toggle", () => {
    // Simulates the caller passing the unfiltered library even while
    // remixedOnly is active — visibility for `watched` should not depend on
    // whether remixedOnly narrowed the rows the caller happens to render.
    const replays = [
      { filename: "a", remixed: true },
      { filename: "b", remixed: false },
    ];
    const result = computeReplayFilterVisibility(replays, (f) => ({
      watched: f === "b",
    }));
    expect(result).toEqual({ watched: true, remixed: true, short: false });
  });

  it("returns false for empty list", () => {
    const result = computeReplayFilterVisibility([], () => ({}));
    expect(result).toEqual({ watched: false, remixed: false, short: false });
  });
});
