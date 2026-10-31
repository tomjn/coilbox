import { describe, expect, it } from "vitest";
import { combineProgress, taskbarProgress } from "./taskbarProgress";

const at = (percent: number | null) => ({ progress: { percent } });
const notStarted = { progress: null };

describe("combineProgress", () => {
  it("shows nothing when nothing is running", () => {
    expect(combineProgress([])).toEqual({ kind: "none" });
  });

  it("uses the percentage of a single download", () => {
    expect(combineProgress([at(42)])).toEqual({ kind: "normal", percent: 42 });
  });

  it("takes the mean of several downloads", () => {
    expect(combineProgress([at(20), at(60), at(100)])).toEqual({
      kind: "normal",
      percent: 60,
    });
  });

  it("rounds the mean to a whole number", () => {
    expect(combineProgress([at(10), at(11)])).toEqual({
      kind: "normal",
      percent: 11,
    });
  });

  it("leaves downloads with no percentage out of the mean", () => {
    expect(combineProgress([at(80), at(null), notStarted])).toEqual({
      kind: "normal",
      percent: 80,
    });
  });

  it("is indeterminate when no download has a percentage", () => {
    expect(combineProgress([at(null), notStarted])).toEqual({
      kind: "indeterminate",
    });
  });

  it("counts a download at zero percent", () => {
    expect(combineProgress([at(0), at(100)])).toEqual({
      kind: "normal",
      percent: 50,
    });
  });
});

describe("taskbarProgress", () => {
  it("shows the error state once nothing is running after a failure", () => {
    expect(taskbarProgress([], true)).toEqual({ kind: "error" });
  });

  it("shows running downloads over an unseen failure", () => {
    expect(taskbarProgress([at(30)], true)).toEqual({
      kind: "normal",
      percent: 30,
    });
  });

  it("shows nothing with no downloads and no failure", () => {
    expect(taskbarProgress([], false)).toEqual({ kind: "none" });
  });
});
