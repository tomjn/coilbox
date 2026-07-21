import { describe, expect, it } from "vitest";
import { computeReplayFilterVisibility } from "./replayFilterVisibility";

describe("computeReplayFilterVisibility", () => {
  it("hides both when nothing is watched or remixed", () => {
    const replays = [{ filename: "a" }, { filename: "b" }];
    const result = computeReplayFilterVisibility(replays, () => ({}));
    expect(result).toEqual({ watched: false, remixed: false });
  });

  it("shows watched when at least one row is watched", () => {
    const replays = [{ filename: "a" }, { filename: "b" }];
    const result = computeReplayFilterVisibility(replays, (f) => ({
      watched: f === "b",
    }));
    expect(result).toEqual({ watched: true, remixed: false });
  });

  it("shows remixed when at least one row is remixed", () => {
    const replays = [
      { filename: "a", remixed: false },
      { filename: "b", remixed: true },
    ];
    const result = computeReplayFilterVisibility(replays, () => ({}));
    expect(result).toEqual({ watched: false, remixed: true });
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
    expect(result).toEqual({ watched: true, remixed: true });
  });

  it("returns false for empty list", () => {
    const result = computeReplayFilterVisibility([], () => ({}));
    expect(result).toEqual({ watched: false, remixed: false });
  });
});
