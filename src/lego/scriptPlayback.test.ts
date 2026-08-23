import { describe, expect, it } from "vitest";

import {
  clampFrame,
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

  /**
   * A unit is told what it is standing on by the engine rather than working it
   * out. A script that branches on it gets nothing, matches no branch, and
   * stands still: Expand and Exterminate's construction mech does exactly that.
   */
  it("all tell the unit it is standing on land", () => {
    for (const scenario of SCENARIOS) {
      const told = scenario.events.find((e) => e.callin === "setSFXoccupy");
      expect(told, scenario.id).toBeDefined();
      expect(told?.args, scenario.id).toEqual([4]);
      // After Create, not alongside it: a script routinely starts its own
      // `setSFXoccupy` with no argument from Create, and a started thread runs
      // after the call that started it, so the same frame is too early.
      expect(told?.frame, scenario.id).toBe(1);
    }
  });

  /**
   * A factory and a mobile builder are driven differently. A factory is opened
   * with `Activate` first and then told to build with no arguments at all, and
   * most factory scripts will not animate until the yard is open.
   */
  it("offer a factory its own way of building", () => {
    const factory = scenarioById("building-factory");

    expect(factory).toBeDefined();
    const callins = factory?.events.map((e) => e.callin) ?? [];
    expect(callins).toContain("Activate");
    const build = factory?.events.find((e) => e.callin === "StartBuilding");
    expect(build?.args).toBeUndefined();
    expect(callins.indexOf("Activate")).toBeLessThan(
      callins.indexOf("StartBuilding"),
    );
  });

  /** The mobile builder's form keeps its two angles, which aim the nanolathe. */
  it("keep the mobile builder aiming where it was told to", () => {
    const build = scenarioById("building")?.events.find(
      (e) => e.callin === "StartBuilding",
    );

    expect(build?.args).toHaveLength(2);
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

describe("clampFrame", () => {
  it("leaves a frame that is already in range alone", () => {
    expect(clampFrame(timeline(), 1)).toBe(1);
  });

  it("pulls a frame before the start up to the first frame", () => {
    expect(clampFrame(timeline(), -4)).toBe(0);
  });

  it("pulls a frame past the end back to the last frame", () => {
    expect(clampFrame(timeline(), 99)).toBe(2);
  });

  it("has nowhere to land in a timeline with no frames", () => {
    expect(clampFrame(timeline({ frames: [] }), 5)).toBe(0);
  });
});

describe("playable", () => {
  it("is what has frames, whether or not it also failed", () => {
    expect(playable(null)).toBe(false);
    expect(playable(timeline({ frames: [] }))).toBe(false);
    expect(playable(timeline({ error: "it threw" }))).toBe(true);
  });
});
