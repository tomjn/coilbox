import { describe, expect, it } from "vitest";
import { action, poseUnits, trackUnits, unit } from "./actionFixtures";
import { bakeAction } from "./actions";
import {
  actionKeyCount,
  channelKeyName,
  pieceKeyName,
  rulerFrame,
  timelineView,
} from "./timelineModel";

function viewOf(project: ReturnType<typeof unit>) {
  const first = project.actions?.[0];
  if (!first) throw new Error("the fixture has no action");
  return timelineView(first, project);
}

describe("timelineView (#5396)", () => {
  it("shows a pose key action through its tracks, a row for each piece it moves", () => {
    const view = viewOf(poseUnits().plain);
    expect(view.rows.map((row) => row.piece.id)).toEqual(["arm", "hatch"]);
    const [arm, hatch] = view.rows;
    // Raised after one second, Swung two seconds after that.
    expect(arm.frames).toEqual([30, 90]);
    expect(hatch.frames).toEqual([30, 90]);
    expect(arm.channels.map((c) => c.label)).toEqual(["Turn x", "Turn z"]);
    expect(hatch.channels.map((c) => c.label)).toEqual(["Move y"]);
  });

  it("shows a track action on the frames its channels key, in piece order", () => {
    const view = viewOf(trackUnits().staggered);
    const [arm, hatch] = view.rows;
    expect(arm.frames).toEqual([10, 20]);
    expect(hatch.frames).toEqual([15, 30]);
    expect(arm.channels).toEqual([
      {
        kind: "turn",
        axis: 0,
        label: "Turn x",
        keys: [
          { frame: 10, value: -0.5 },
          { frame: 20, value: 0 },
        ],
      },
    ]);
    expect(view.lastKey).toBe(30);
  });

  it("runs the ruler to a second past the last key", () => {
    expect(viewOf(trackUnits().staggered).end).toBe(60);
  });

  it("marks the end of the lap and where each channel wraps to its first key", () => {
    const view = viewOf(trackUnits().loopOffsets);
    expect(view.lap).toBe(50);
    expect(view.lastKey).toBe(50);
    // The arm's channels first key on frames 10 and 20, so after the lap ends
    // they arrive back on 60 and 70. The hatch's first key is on frame 5.
    expect(view.rows.map((row) => row.wraps)).toEqual([[60, 70], [55]]);
    expect(view.end).toBe(80);
  });

  it("has no lap or wraps for an action that plays once", () => {
    const view = viewOf(trackUnits().staggered);
    expect(view.lap).toBe(0);
    expect(view.rows.flatMap((row) => row.wraps)).toEqual([]);
  });

  it("puts the keys where the blend in plays them", () => {
    // The first key is on frame 30, and half a second of blend is 15 frames.
    const project = poseUnits().blendedIn;
    const view = viewOf(project);
    expect(view.rows[0].frames).toEqual([15, 75]);
    const first = project.actions?.[0];
    if (!first) throw new Error("no action");
    const baked = bakeAction(first, project);
    // The preview's last frame of the lead is the last key's frame.
    expect(baked.end).toEqual({ loopFrom: view.lastKey });
  });

  it("marks a piece another action or a preset also moves, with who wins", () => {
    const project = poseUnits().twoActions;
    const view = viewOf(project);
    const arm = view.rows.find((row) => row.piece.id === "arm");
    expect(arm?.clash).toContain("Also moved by Aim.");
    expect(arm?.clash).toContain("last");
    expect(view.rows.find((row) => row.piece.id === "hatch")?.clash).toBeNull();
  });

  it("leaves out a piece the unit no longer has", () => {
    const project = unit({
      pieces: unit().pieces.filter((piece) => piece.id !== "hatch"),
    });
    expect(viewOf(project).rows.map((row) => row.piece.id)).toEqual(["arm"]);
  });

  it("is an empty second of ruler for an action with no keys", () => {
    const project = unit({
      actions: [action({ keys: [] })],
    });
    expect(viewOf(project)).toEqual({ rows: [], end: 30, lastKey: 0, lap: 0 });
  });
});

describe("rulerFrame", () => {
  it("is the preview's own frame until it passes the end of the ruler", () => {
    const view = viewOf(poseUnits().plain);
    expect(rulerFrame(view, 0)).toBe(0);
    expect(rulerFrame(view, 120)).toBe(120);
  });

  it("shows a frame of the lap one lap earlier when it is past the ruler", () => {
    const view = viewOf(poseUnits().plain);
    expect(rulerFrame(view, 121)).toBe(31);
    expect(rulerFrame(view, 179)).toBe(89);
  });

  it("holds a one shot action's playhead on the ruler", () => {
    const view = viewOf(trackUnits().staggered);
    expect(rulerFrame(view, 100)).toBe(60);
  });
});

describe("what a key is called", () => {
  it("names a piece's key by frame", () => {
    const row = viewOf(trackUnits().staggered).rows[0];
    expect(pieceKeyName(row, 10)).toBe("Keys of arm on frame 10");
  });

  it("names a channel's key with its value in degrees or elmos", () => {
    const [arm, hatch] = viewOf(trackUnits().staggered).rows;
    expect(channelKeyName(arm, arm.channels[0], { frame: 10, value: 0 })).toBe(
      "Turn x of arm, frame 10, 0 degrees",
    );
    expect(
      channelKeyName(arm, arm.channels[0], { frame: 10, value: Math.PI / 2 }),
    ).toBe("Turn x of arm, frame 10, 90 degrees");
    expect(
      channelKeyName(hatch, hatch.channels[0], { frame: 15, value: 3 }),
    ).toBe("Move y of hatch, frame 15, 3 elmos");
  });
});

describe("actionKeyCount", () => {
  it("counts a pose key action's keys and a track action's key frames", () => {
    expect(actionKeyCount(poseUnits().plain.actions?.[0] as never)).toBe(2);
    expect(actionKeyCount(trackUnits().staggered.actions?.[0] as never)).toBe(
      4,
    );
  });
});
