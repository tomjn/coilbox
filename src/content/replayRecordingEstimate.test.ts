import { describe, expect, it } from "vitest";
import type { RecordingCost } from "./bindings";
import { budgetEffect, estimateRecording } from "./replayRecordingEstimate";

const MB = 1_000_000;

const cost = (over: Partial<RecordingCost> = {}): RecordingCost => ({
  gameId: "a".repeat(32),
  game: "Some Game 1.0",
  frames: 10_000,
  millis: 60_000,
  trackBytes: 500_000,
  ...over,
});

describe("estimateRecording", () => {
  it("has no estimate without a past recording", () => {
    expect(estimateRecording([], "Some Game 1.0", 20_000)).toBeNull();
  });

  it("scales the past time and size by frames", () => {
    expect(estimateRecording([cost()], "Some Game 1.0", 20_000)).toEqual({
      seconds: 120,
      bytes: 1_000_000,
      runs: 1,
    });
  });

  it("pools recordings by total, so a long one counts for more than a short one", () => {
    const slow = cost({ frames: 30_000, millis: 300_000, trackBytes: 900_000 });
    const quick = cost({
      gameId: "b".repeat(32),
      frames: 10_000,
      millis: 20_000,
      trackBytes: 100_000,
    });
    // 320 s and 1,000,000 bytes over 40,000 frames.
    expect(estimateRecording([slow, quick], "Some Game 1.0", 10_000)).toEqual({
      seconds: 80,
      bytes: 250_000,
      runs: 2,
    });
  });

  it("goes by the same game at another version", () => {
    expect(estimateRecording([cost()], "Some Game 2.1", 10_000)).toMatchObject({
      runs: 1,
    });
  });

  it("has no estimate from recordings of other games only", () => {
    expect(
      estimateRecording(
        [cost({ game: "Another Game 3" })],
        "Some Game 1.0",
        10_000,
      ),
    ).toBeNull();
  });

  it("ignores an entry with no frames, no time or no size", () => {
    const empty = [
      cost({ frames: 0 }),
      cost({ millis: 0 }),
      cost({ trackBytes: 0 }),
    ];
    expect(estimateRecording(empty, "Some Game 1.0", 10_000)).toBeNull();
  });

  it("has no estimate for a replay with no length", () => {
    expect(estimateRecording([cost()], "Some Game 1.0", 0)).toBeNull();
  });
});

describe("budgetEffect", () => {
  const facts = {
    budgetBytes: (10 * MB) as number | null,
    totalBytes: 0,
    ownBytes: 0,
    estimateBytes: (5 * MB) as number | null,
  };

  it("says nothing without a size estimate or a budget", () => {
    expect(budgetEffect({ ...facts, estimateBytes: null })).toBeNull();
    expect(budgetEffect({ ...facts, budgetBytes: null })).toBeNull();
  });

  it("says nothing when the track fits", () => {
    expect(budgetEffect({ ...facts, totalBytes: 4 * MB })).toBeNull();
  });

  it("says older tracks will go when the total would pass the budget", () => {
    expect(budgetEffect({ ...facts, totalBytes: 8 * MB })).toBe("removesOlder");
  });

  it("does not count the replay's own track twice", () => {
    expect(
      budgetEffect({ ...facts, totalBytes: 8 * MB, ownBytes: 4 * MB }),
    ).toBeNull();
  });

  it("says a track larger than the whole budget keeps only itself", () => {
    expect(budgetEffect({ ...facts, estimateBytes: 11 * MB })).toBe(
      "largerThanBudget",
    );
  });
});
