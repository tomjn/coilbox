import { describe, expect, it } from "vitest";
import {
  DOCK_LANE_ORDER,
  DOCK_MAX_HEIGHT,
  DOCK_MAX_SHARE,
  type DockLane,
  dockHeight,
  fittingLanes,
} from "./replayDockRows";

const ALL: readonly DockLane[] = DOCK_LANE_ORDER;
const FIXED = dockHeight([]);

describe("the dock's cap", () => {
  it("is the share, as a length of the window", () => {
    expect(DOCK_MAX_HEIGHT).toBe(`${DOCK_MAX_SHARE * 100}vh`);
  });
});

describe("fittingLanes", () => {
  it("keeps every lane in a tall window", () => {
    expect(fittingLanes(940, ALL)).toEqual(ALL);
  });

  it("keeps the dock within its share at every window height that has room for the rows that always show", () => {
    for (let height = 300; height <= 1600; height += 10) {
      const lanes = fittingLanes(height, ALL);
      if (DOCK_MAX_SHARE * height >= FIXED) {
        expect(dockHeight(lanes)).toBeLessThanOrEqual(DOCK_MAX_SHARE * height);
      } else {
        expect(lanes).toEqual([]);
      }
    }
  });

  it("gives up the Heat window first, then the metric, then Players, then Chat", () => {
    const heights = [];
    for (let height = 1000; height >= 300; height -= 5) {
      heights.push(fittingLanes(height, ALL).length);
    }
    // The count only falls as the window shortens, one lane at a time.
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeLessThanOrEqual(heights[i - 1]);
    }
    expect(fittingLanes(700, ALL)).toEqual([
      "kills",
      "chat",
      "players",
      "metric",
    ]);
    expect(fittingLanes(600, ALL)).toEqual(["kills", "chat", "players"]);
    expect(fittingLanes(450, ALL)).toEqual(["kills", "chat"]);
    expect(fittingLanes(400, ALL)).toEqual(["kills"]);
    expect(fittingLanes(300, ALL)).toEqual([]);
  });

  it("only considers the lanes the replay has", () => {
    const noMetric = ALL.filter((lane) => lane !== "metric");
    expect(fittingLanes(940, noMetric)).toEqual(noMetric);
    // Without the metric lane the Heat window fits where it would not after it.
    expect(fittingLanes(620, noMetric)).toEqual(noMetric);
    expect(fittingLanes(550, noMetric)).toEqual(["kills", "chat", "players"]);
  });
});
