import { describe, expect, it } from "vitest";

import { poseUnits, track, trackUnits, unit } from "./actionFixtures";
import {
  actionPoseAt,
  actionShift,
  convertToTracks,
  keyFromPose,
  planAction,
  poseChanges,
  setKeyValue,
} from "./actions";
import type { LegoAction, LegoProject } from "./model";

const first = (project: LegoProject): LegoAction => {
  const found = project.actions?.[0];
  if (!found) throw new Error("the unit has no action");
  return found;
};

describe("actionPoseAt", () => {
  const { staggered } = trackUnits();
  const a = first(staggered);

  it("has a key's own value on the key's frame", () => {
    expect(actionPoseAt(a, staggered, 10).arm.turn?.[0]).toBe(-0.5);
    expect(actionPoseAt(a, staggered, 15).hatch.move?.[1]).toBe(3);
    expect(actionPoseAt(a, staggered, 30).hatch).toBeUndefined();
  });

  it("is on the way between two keys, and at rest before the first", () => {
    expect(actionPoseAt(a, staggered, 5).arm.turn?.[0]).toBe(-0.25);
    expect(actionPoseAt(a, staggered, 15).arm.turn?.[0]).toBe(-0.25);
    expect(actionPoseAt(a, staggered, 0)).toEqual({});
  });

  it("holds the last pose after everything has stopped", () => {
    expect(actionPoseAt(a, staggered, 200)).toEqual({});
  });

  it("applies a key that jumps on frame 0", () => {
    const { frameZero } = trackUnits();
    expect(actionPoseAt(first(frameZero), frameZero, 0).arm.turn?.[0]).toBe(1);
    expect(actionPoseAt(first(frameZero), frameZero, 0).hatch.move?.[1]).toBe(
      2,
    );
  });

  it("is at rest for an action that moves nothing", () => {
    const empty = unit({
      actions: [{ ...first(unit()), keys: [], tracks: [] }],
    });
    expect(actionPoseAt(first(empty), empty, 12)).toEqual({});
  });
});

describe("poseChanges", () => {
  const { staggered } = trackUnits();
  const a = first(staggered);

  it("is empty while the held pose is the action's", () => {
    const held = actionPoseAt(a, staggered, 12);
    expect(poseChanges(a, staggered, 12, held)).toEqual([]);
  });

  it("names each channel the held pose changes, and the value held", () => {
    const held = actionPoseAt(a, staggered, 10);
    held.arm = { turn: [-0.5, 0, 0.3] };
    held.hatch = { move: [1, held.hatch.move?.[1] ?? 0, 0] };
    expect(poseChanges(a, staggered, 10, held)).toEqual([
      { piece: "arm", kind: "turn", axis: 2, value: 0.3 },
      { piece: "hatch", kind: "move", axis: 0, value: 1 },
    ]);
  });

  it("does not count a difference under the four places the script is written to", () => {
    const held = actionPoseAt(a, staggered, 10);
    held.arm = { turn: [-0.5 + 0.00001, 0, 0] };
    expect(poseChanges(a, staggered, 10, held)).toEqual([]);
  });

  it("is empty while a blend in is under way", () => {
    const blended = poseUnits().blendedIn;
    const act = first(blended);
    expect(actionShift(act, blended)).toBeLessThan(0);
    const held = { arm: { turn: [3, 0, 0] as [number, number, number] } };
    expect(poseChanges(act, blended, 3, held)).toEqual([]);
    expect(poseChanges(act, blended, 40, held).length).toBeGreaterThan(0);
  });
});

describe("keyFromPose", () => {
  const { staggered } = trackUnits();
  const a = first(staggered);

  it("keys a channel on a frame that already has a key, replacing it", () => {
    const held = actionPoseAt(a, staggered, 10);
    held.arm = { turn: [-0.8, 0, 0] };
    const next = keyFromPose(staggered, "act", 10, held);
    expect(first(next).tracks?.[0]).toEqual(
      track("arm", "turn", 0, [
        [10, -0.8],
        [20, 0],
      ]),
    );
    // The other track is as it was.
    expect(first(next).tracks?.[1]).toEqual(first(staggered).tracks?.[1]);
  });

  it("makes a track for a channel that has none, with the key in frame order", () => {
    const held = actionPoseAt(a, staggered, 12);
    held.arm = { ...held.arm, move: [2, 0, 0] };
    const next = keyFromPose(staggered, "act", 12, held);
    const tracks = first(next).tracks ?? [];
    expect(tracks).toHaveLength(3);
    expect(tracks[2]).toEqual(track("arm", "move", 0, [[12, 2]]));
  });

  it("puts a key between two the channel has, and after the last", () => {
    const held = actionPoseAt(a, staggered, 14);
    held.arm = { turn: [0.4, 0, 0] };
    const between = keyFromPose(staggered, "act", 14, held);
    expect(first(between).tracks?.[0].keys.map((k) => k.frame)).toEqual([
      10, 14, 20,
    ]);
    const late = keyFromPose(staggered, "act", 40, held);
    expect(first(late).tracks?.[0].keys.map((k) => k.frame)).toEqual([
      10, 20, 40,
    ]);
  });

  it("keys every channel that differs in one edit", () => {
    const held = actionPoseAt(a, staggered, 10);
    held.arm = { turn: [-0.5, 0.1, 0.2] };
    const next = keyFromPose(staggered, "act", 10, held);
    expect(first(next).tracks).toHaveLength(4);
  });

  it("changes nothing when no channel differs", () => {
    const held = actionPoseAt(a, staggered, 10);
    expect(keyFromPose(staggered, "act", 10, held)).toBe(staggered);
    expect(keyFromPose(staggered, "gone", 10, held)).toBe(staggered);
  });

  it("writes the key on the action's own frame under a blend in", () => {
    const blended: LegoProject = {
      ...trackUnits().staggered,
      actions: [{ ...a, blendIn: 0.5 }],
    };
    const act = first(blended);
    const shift = actionShift(act, blended);
    const ruler = 20 + shift;
    const held = actionPoseAt(act, blended, ruler);
    held.arm = { turn: [0.7, 0, 0] };
    const next = keyFromPose(blended, "act", ruler, held);
    expect(first(next).tracks?.[0].keys).toContainEqual({
      frame: 20,
      value: 0.7,
    });
  });

  it("turns an action of pose keys into tracks in the same edit, as one step", () => {
    const before = poseUnits().plain;
    const act = first(before);
    expect(act.tracks).toBeUndefined();
    const held = actionPoseAt(act, before, 30);
    held.arm = { turn: [1, 0, 0.2] };
    const after = keyFromPose(before, "act", 30, held);

    expect(first(after).keys).toEqual([]);
    expect(first(after).tracks).toBeDefined();
    expect(first(after).tracks).toContainEqual(
      track("arm", "turn", 2, [
        [30, 0.2],
        [90, 0.8],
      ]),
    );
    // Undo puts back the project the edit was made on, pose keys and all.
    expect(first(before).keys).toHaveLength(2);
    expect(first(before).tracks).toBeUndefined();
  });
});

describe("setKeyValue", () => {
  const { staggered } = trackUnits();
  const arm = { piece: "arm", kind: "turn", axis: 0 } as const;

  it("sets the value of a key", () => {
    const next = setKeyValue(staggered, "act", arm, 10, -1.2);
    expect(first(next).tracks?.[0].keys[0]).toEqual({ frame: 10, value: -1.2 });
    expect(first(next).tracks?.[0].keys[1]).toEqual({ frame: 20, value: 0 });
  });

  it("changes nothing for a frame with no key, the same value, or a bad number", () => {
    expect(setKeyValue(staggered, "act", arm, 11, 1)).toBe(staggered);
    expect(setKeyValue(staggered, "act", arm, 10, -0.5)).toBe(staggered);
    expect(setKeyValue(staggered, "act", arm, 10, Number.NaN)).toBe(staggered);
    expect(setKeyValue(staggered, "gone", arm, 10, 1)).toBe(staggered);
  });

  it("turns an action of pose keys into tracks in the same edit", () => {
    const before = poseUnits().plain;
    const after = setKeyValue(before, "act", arm, 30, 2);
    expect(first(after).keys).toEqual([]);
    expect(first(after).tracks?.[0].keys[0]).toEqual({ frame: 30, value: 2 });
    expect(first(before).tracks).toBeUndefined();
  });

  it("does not convert an action of pose keys when there is no key to set", () => {
    const before = poseUnits().plain;
    expect(setKeyValue(before, "act", arm, 31, 2)).toBe(before);
  });
});

describe("convertToTracks", () => {
  it("lowers pose keys to tracks and plays the same", () => {
    const before = poseUnits().plain;
    const after = convertToTracks(before, "act");
    expect(first(after).keys).toEqual([]);
    expect(planAction(first(after), after)).toEqual(
      planAction(first(before), before),
    );
  });

  it("leaves an action that has tracks alone", () => {
    const { staggered } = trackUnits();
    expect(convertToTracks(staggered, "act")).toBe(staggered);
    expect(convertToTracks(staggered, "gone")).toBe(staggered);
  });
});
