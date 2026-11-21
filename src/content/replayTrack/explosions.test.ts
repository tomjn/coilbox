/**
 * Where shots landed and units died, worked out from the fixture the Rust reader
 * wrote (#5317).
 *
 * The fixture has three windows, 0 to 60, 60 to 120 and 120 to 150, and 12
 * frames of fade is what these ask for. In it:
 *
 * - shot 0 flies from frame 10 to 50 and lands at 500, 400, in window 0.
 * - shot 1 flies from 50 to 75, over the edge between windows 0 and 1, and lands
 *   at 825, 900.
 * - shot 2 is debris, from 90 to 100.
 * - unit 1 is last seen at frame 89, at 3300, 2200.
 * - unit 0 runs to the recording's last frame, 150. Unit 2 is last seen at 149.
 */
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/replay-track-window.json";
import { type ExplosionMark, forEachExplosion } from "./explosions";
import { decodeWindowPayload, type TrackWindow } from "./trackWindow";
import { windowOfFrame } from "./windowStore";

const SPAN = 12;

function bytes(base64: string): ArrayBuffer {
  const b = Buffer.from(base64, "base64");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const windows: TrackWindow[] = fixture.windows.map((w) =>
  decodeWindowPayload(bytes(w.payload), fixture.rotationBits),
);

/** The explosions at a frame, as the handle gives them: from the window that
 *  has it and the one before, when that is held. */
function at(frame: number, withEarlier = true): ExplosionMark[] {
  const k = windowOfFrame(fixture.geometry, frame);
  const out: ExplosionMark[] = [];
  forEachExplosion(
    windows[k],
    withEarlier ? windows[k - 1] : undefined,
    frame,
    SPAN,
    (e) => out.push({ ...e }),
  );
  return out;
}

describe("a shot landing", () => {
  it("makes a circle for the frames after its last, and none once the fade is over", () => {
    // It is still a shot on frame 50.
    expect(at(50)).toEqual([]);
    expect(at(51)).toEqual([{ x: 500, z: 400, age: 1, death: false }]);
    expect(at(56)).toEqual([{ x: 500, z: 400, age: 6, death: false }]);
    expect(at(60)).toEqual([{ x: 500, z: 400, age: 10, death: false }]);
    expect(at(62)).toEqual([{ x: 500, z: 400, age: 12, death: false }]);
    expect(at(63)).toEqual([]);
  });

  it("is found across the edge of a window, from the window before", () => {
    // Frames 61 and 62 are in window 1. The shot is in window 0 only.
    expect(at(61)).toEqual([{ x: 500, z: 400, age: 11, death: false }]);
    expect(at(61, false)).toEqual([]);
  });

  it("makes none while it carries on past the end of a window", () => {
    // Shot 1 is held in window 0 up to frame 60 and in window 1 from there.
    // Window 0 gives its last frame as 60, and that is not where it landed, so
    // frames 61 and on must not count window 0's end of it.
    for (let frame = 51; frame <= 75; frame++) {
      expect(
        at(frame).filter((e) => e.x === 825 && e.z === 900),
        `frame ${frame}`,
      ).toEqual([]);
    }
    expect(at(76)).toEqual([{ x: 825, z: 900, age: 1, death: false }]);
    expect(at(87)).toEqual([{ x: 825, z: 900, age: 12, death: false }]);
    expect(at(88)).toEqual([]);
  });

  it("makes none for debris", () => {
    // Debris ends at frame 100. Anything at 101 to 112 is from a unit.
    for (let frame = 101; frame <= 112; frame++) {
      expect(
        at(frame).filter((e) => !e.death),
        `frame ${frame}`,
      ).toEqual([]);
    }
  });
});

describe("a unit dying", () => {
  it("makes the circle where it was last seen, marked as a death", () => {
    expect(at(89)).toEqual([]);
    expect(at(90)).toEqual([{ x: 3300, z: 2200, age: 1, death: true }]);
    expect(at(101)).toEqual([{ x: 3300, z: 2200, age: 12, death: true }]);
    expect(at(102)).toEqual([]);
  });

  it("makes none for a unit still there when the recording stops", () => {
    // Unit 0 is last seen at frame 150, the last frame there is. Unit 2 is last
    // seen at 149 and so has died by 150.
    expect(at(150)).toEqual([{ x: 60, z: 5000, age: 1, death: true }]);
  });
});
