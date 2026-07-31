import { describe, expect, it } from "vitest";

import {
  frameAt,
  hiddenAt,
  PREVIEW_FRAMES,
  playable,
  poseAt,
  SCENARIOS,
  type ScriptTimeline,
  scenarioById,
} from "./scriptPlayback";

/** Two pieces, three frames, the second piece turning a tenth per frame. */
function timeline(overrides: Partial<ScriptTimeline> = {}): ScriptTimeline {
  return {
    fps: 30,
    pieces: ["base", "turret"],
    frames: [
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2, 0],
    ],
    hidden: [],
    error: null,
    warnings: [],
    ...overrides,
  };
}

describe("scenarios", () => {
  it("all create the unit first, because the engine does", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.events[0]).toEqual({ frame: 0, callin: "Create" });
    }
  });

  it("never fire anything past the end of the preview", () => {
    for (const scenario of SCENARIOS) {
      for (const event of scenario.events) {
        expect(event.frame).toBeLessThan(PREVIEW_FRAMES);
      }
    }
  });

  it("are found by id, and an unknown one is not invented", () => {
    expect(scenarioById("moving")?.label).toBe("Moving");
    expect(scenarioById("nope")).toBeUndefined();
  });
});

describe("frameAt", () => {
  it("loops rather than running out", () => {
    const played = timeline();
    expect(frameAt(played, 0)).toBe(0);
    expect(frameAt(played, 2 / 30)).toBe(2);
    // Three frames at 30fps is a tenth of a second, so the fourth is the first.
    expect(frameAt(played, 3 / 30)).toBe(0);
    expect(frameAt(played, 4 / 30)).toBe(1);
  });

  it("has no frame at all for a run that produced none", () => {
    expect(frameAt(timeline({ frames: [] }), 0)).toBe(-1);
  });
});

describe("poseAt", () => {
  it("reads the six numbers belonging to one piece", () => {
    expect(poseAt(timeline(), 2, 1)).toEqual([0, 0, 0, 0, 0.2, 0]);
  });

  it("is nothing for a frame or a piece that is not there", () => {
    expect(poseAt(timeline(), 9, 0)).toBeNull();
    expect(poseAt(timeline(), 0, 7)).toBeNull();
  });
});

describe("hiddenAt", () => {
  it("hides nothing when the script hid nothing", () => {
    expect(hiddenAt(timeline(), 0, 0)).toBe(false);
  });

  it("reads the flag when there is one", () => {
    const played = timeline({
      hidden: [
        [false, true],
        [false, false],
        [false, false],
      ],
    });
    expect(hiddenAt(played, 0, 1)).toBe(true);
    expect(hiddenAt(played, 1, 1)).toBe(false);
  });
});

describe("playable", () => {
  it("is what has frames, whether or not it also failed", () => {
    expect(playable(null)).toBe(false);
    expect(playable(timeline({ frames: [] }))).toBe(false);
    expect(playable(timeline({ error: "it threw" }))).toBe(true);
  });
});
