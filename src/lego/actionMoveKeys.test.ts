import { describe, expect, it } from "vitest";

import { poseUnits, track, tracked, trackUnits } from "./actionFixtures";
import { deleteKeys, earliestMove, moveKeys } from "./actions";
import type { LegoAction, LegoActionTrack, LegoProject } from "./model";

const first = (project: LegoProject): LegoAction => {
  const found = project.actions?.[0];
  if (!found) throw new Error("the unit has no action");
  return found;
};

const tracksOf = (project: LegoProject): LegoActionTrack[] =>
  first(project).tracks ?? [];

const armX = { piece: "arm", kind: "turn", axis: 0 } as const;
const armZ = { piece: "arm", kind: "turn", axis: 2 } as const;
const hatchY = { piece: "hatch", kind: "move", axis: 1 } as const;

/** Two channels of the arm that both key on frame 10. */
const arm = () =>
  tracked([
    track("arm", "turn", 0, [
      [10, 1],
      [20, 0],
    ]),
    track("arm", "turn", 2, [
      [10, 0.5],
      [30, 0],
    ]),
    track("hatch", "move", 1, [[15, 3]]),
  ]);

describe("moveKeys", () => {
  it("moves one key to a later frame and keeps its value", () => {
    const { staggered } = trackUnits();
    const moved = moveKeys(staggered, "act", [{ ...armX, frame: 10 }], 4);
    expect(tracksOf(moved)[0].keys).toEqual([
      { frame: 14, value: -0.5 },
      { frame: 20, value: 0 },
    ]);
    expect(tracksOf(moved)[1]).toBe(tracksOf(staggered)[1]);
  });

  it("moves a key to an earlier frame, and the keys stay in frame order", () => {
    const { staggered } = trackUnits();
    const moved = moveKeys(staggered, "act", [{ ...armX, frame: 20 }], -9);
    expect(tracksOf(moved)[0].keys).toEqual([
      { frame: 10, value: -0.5 },
      { frame: 11, value: 0 },
    ]);
    const past = moveKeys(staggered, "act", [{ ...hatchY, frame: 30 }], -20);
    expect(tracksOf(past)[1].keys.map((k) => k.frame)).toEqual([10, 15]);
  });

  it("moves every key of a piece on one frame together", () => {
    const project = arm();
    const moved = moveKeys(
      project,
      "act",
      [
        { ...armX, frame: 10 },
        { ...armZ, frame: 10 },
      ],
      3,
    );
    expect(tracksOf(moved)[0].keys[0]).toEqual({ frame: 13, value: 1 });
    expect(tracksOf(moved)[1].keys[0]).toEqual({ frame: 13, value: 0.5 });
    expect(tracksOf(moved)[0].keys[1].frame).toBe(20);
    expect(tracksOf(moved)[2]).toBe(tracksOf(project)[2]);
  });

  it("changes nothing when a key lands on a frame its channel already keys", () => {
    const { staggered } = trackUnits();
    const same = moveKeys(staggered, "act", [{ ...armX, frame: 10 }], 10);
    expect(same).toBe(staggered);
  });

  it("refuses the whole move when one of a piece's keys has no room", () => {
    const project = tracked([
      track("arm", "turn", 0, [
        [10, 1],
        [13, 0],
      ]),
      track("arm", "turn", 2, [[10, 0.5]]),
    ]);
    const refused = moveKeys(
      project,
      "act",
      [
        { ...armX, frame: 10 },
        { ...armZ, frame: 10 },
      ],
      3,
    );
    expect(refused).toBe(project);
  });

  it("lets a key land on another channel's frame", () => {
    const { staggered } = trackUnits();
    const moved = moveKeys(staggered, "act", [{ ...armX, frame: 10 }], 5);
    expect(tracksOf(moved)[0].keys[0].frame).toBe(15);
  });

  it("does not take a key before frame 0", () => {
    const { staggered } = trackUnits();
    expect(moveKeys(staggered, "act", [{ ...armX, frame: 10 }], -11)).toBe(
      staggered,
    );
    expect(
      tracksOf(moveKeys(staggered, "act", [{ ...armX, frame: 10 }], -10))[0]
        .keys[0].frame,
    ).toBe(0);
  });

  it("changes nothing for no offset, a part of a frame, or a key that is not there", () => {
    const { staggered } = trackUnits();
    expect(moveKeys(staggered, "act", [{ ...armX, frame: 10 }], 0)).toBe(
      staggered,
    );
    expect(moveKeys(staggered, "act", [{ ...armX, frame: 10 }], 0.5)).toBe(
      staggered,
    );
    expect(moveKeys(staggered, "act", [{ ...armX, frame: 11 }], 3)).toBe(
      staggered,
    );
    expect(moveKeys(staggered, "gone", [{ ...armX, frame: 10 }], 3)).toBe(
      staggered,
    );
  });

  it("converts an action of pose keys to tracks in the same edit", () => {
    const { plain } = poseUnits();
    const moved = moveKeys(plain, "act", [{ ...armX, frame: 30 }], 5);
    expect(first(moved).keys).toEqual([]);
    expect(
      tracksOf(moved)
        .find((t) => t.piece === "arm" && t.axis === 0)
        ?.keys.map((k) => k.frame),
    ).toEqual([35, 90]);
    expect(first(plain).tracks).toBeUndefined();
  });

  it("takes the offset in the action's own frames under a blend in", () => {
    const blended = tracked(
      [
        track("arm", "turn", 0, [
          [40, 1],
          [60, 0],
        ]),
      ],
      { blendIn: 0.5 },
    );
    // The blend takes 15 frames in place of the 40 before the first key, so the
    // ruler shows the first key on frame 15 and the second on frame 35.
    const moved = moveKeys(blended, "act", [{ ...armX, frame: 35 }], 5);
    expect(tracksOf(moved)[0].keys.map((k) => k.frame)).toEqual([40, 65]);
  });
});

describe("earliestMove", () => {
  it("is the offset that puts the first key on frame 0", () => {
    const { staggered } = trackUnits();
    const a = first(staggered);
    expect(earliestMove(a, staggered, [{ ...armX, frame: 10 }])).toBe(-10);
    expect(
      earliestMove(a, staggered, [
        { ...armX, frame: 20 },
        { ...hatchY, frame: 15 },
      ]),
    ).toBe(-15);
    expect(earliestMove(a, staggered, [])).toBe(0);
  });
});

describe("deleteKeys", () => {
  it("removes one key and leaves the rest of its track", () => {
    const { staggered } = trackUnits();
    const left = deleteKeys(staggered, "act", [{ ...armX, frame: 10 }]);
    expect(tracksOf(left)[0].keys).toEqual([{ frame: 20, value: 0 }]);
    expect(tracksOf(left)[1]).toBe(tracksOf(staggered)[1]);
  });

  it("removes the track when its last key goes", () => {
    const { oneKey } = trackUnits();
    const left = deleteKeys(oneKey, "act", [{ ...armX, frame: 30 }]);
    expect(tracksOf(left)).toEqual([]);
    expect(first(left).keys).toEqual([]);
  });

  it("removes every key of a piece on one frame", () => {
    const left = deleteKeys(arm(), "act", [
      { ...armX, frame: 10 },
      { ...armZ, frame: 10 },
    ]);
    expect(tracksOf(left).map((t) => t.keys.map((k) => k.frame))).toEqual([
      [20],
      [30],
      [15],
    ]);
  });

  it("changes nothing for a key that is not there", () => {
    const { staggered } = trackUnits();
    expect(deleteKeys(staggered, "act", [{ ...armX, frame: 11 }])).toBe(
      staggered,
    );
  });

  it("converts an action of pose keys to tracks in the same edit", () => {
    const { plain } = poseUnits();
    const left = deleteKeys(plain, "act", [{ ...armX, frame: 30 }]);
    expect(first(left).keys).toEqual([]);
    expect(
      tracksOf(left)
        .find((t) => t.piece === "arm" && t.axis === 0)
        ?.keys.map((k) => k.frame),
    ).toEqual([90]);
  });
});
