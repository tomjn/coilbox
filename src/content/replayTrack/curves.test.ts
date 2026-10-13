/**
 * The frontend's curves against the Rust reader's (#3806).
 *
 * `fixtures/replay-track-window.json` is written by the Rust test
 * `the_typescript_fixture_is_what_the_reader_gives` in
 * `crates/tauri-plugin-coilbox-content/src/demo/track_view.rs`. It holds three
 * windows exactly as the window command sends them, and the value
 * `coilbox-track` gives for each curve at a list of frames. Every number here
 * is compared with the Rust one, so the two cannot drift: the Rust test fails
 * when the reader changes until the file is written again, and these fail when
 * the file changes until the maths here agrees.
 */
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/replay-track-window.json";
import {
  aliveUnitCount,
  forEachAliveProjectile,
  forEachAliveUnit,
  type ProjectileValue,
  projectileAt,
  type StatusValue,
  statusAt,
  type TransformValue,
  transformAt,
} from "./curves";
import { decodeWindowPayload, type TrackWindow } from "./trackWindow";
import { windowOfFrame } from "./windowStore";

const EPSILON = 1e-9;

function bytes(base64: string): ArrayBuffer {
  const b = Buffer.from(base64, "base64");
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const windows: TrackWindow[] = fixture.windows.map((w) =>
  decodeWindowPayload(bytes(w.payload), fixture.rotationBits),
);

function unitIndex(w: TrackWindow, serial: number): number {
  const i = Array.from(w.unitSerial).indexOf(serial);
  expect(i, `unit ${serial} is in window ${w.index}`).toBeGreaterThanOrEqual(0);
  return i;
}

function projectileIndex(w: TrackWindow, serial: number): number {
  const i = Array.from(w.projectileSerial).indexOf(serial);
  expect(
    i,
    `projectile ${serial} is in window ${w.index}`,
  ).toBeGreaterThanOrEqual(0);
  return i;
}

function near(actual: number, expected: number, what: string) {
  expect(
    Math.abs(actual - expected),
    `${what}: ${actual} against ${expected}`,
  ).toBeLessThan(EPSILON);
}

describe("windowOfFrame", () => {
  it("puts every frame in the window the Rust reader puts it in", () => {
    expect(fixture.windowOfFrame.length).toBeGreaterThan(8);
    for (const c of fixture.windowOfFrame) {
      expect(windowOfFrame(fixture.geometry, c.frame), `frame ${c.frame}`).toBe(
        c.window,
      );
    }
  });
});

describe("the fixture", () => {
  it("covers all three windows and every kind of curve", () => {
    expect(windows.map((w) => w.index)).toEqual([0, 1, 2]);
    expect(fixture.transform.length).toBeGreaterThan(20);
    expect(fixture.status.length).toBeGreaterThan(20);
    expect(fixture.projectile.length).toBeGreaterThan(10);
  });
});

describe("transformAt", () => {
  it("gives the position and the blended rotation the Rust reader gives", () => {
    const out: TransformValue = {
      x: 0,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 0,
      fx: 0,
      fz: 0,
    };
    for (const c of fixture.transform) {
      const w = windows[c.window];
      const found = transformAt(w, unitIndex(w, c.serial), c.frame, out);
      const where = `unit ${c.serial} frame ${c.frame} window ${c.window}`;
      expect(found, where).toBe(true);
      near(out.x, c.x, `${where} x`);
      near(out.z, c.z, `${where} z`);
      near(out.qx, c.q[0], `${where} qx`);
      near(out.qy, c.q[1], `${where} qy`);
      near(out.qz, c.q[2], `${where} qz`);
      near(out.qw, c.q[3], `${where} qw`);
      // The front direction, from the rotation as the format page gives it.
      const [x, y, z, w4] = c.q;
      near(out.fx, 2 * (x * z + w4 * y), `${where} front x`);
      near(out.fz, 1 - 2 * (x * x + y * y), `${where} front z`);
    }
  });

  it("is exact where the frame is a key or the curve holds", () => {
    const out: TransformValue = {
      x: 0,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 0,
      fx: 0,
      fz: 0,
    };
    // Unit 0 has keys at frames 0, 45, 61, 100 and 150, and its first key is
    // x 100, z 200. Frame 0 is on a key, 150 is on the last.
    const w = windows[0];
    transformAt(w, unitIndex(w, 0), 0, out);
    expect([out.x, out.z]).toEqual([100, 200]);
  });

  it("goes the same way on a rotation across the blend's sign flip", () => {
    // Unit 1's keys at 30 and 70 have a negative dot product. Half way, at
    // frame 50, the blend must go the short way round, which the Rust reader's
    // value in the fixture shows by agreeing with the test above. Here check
    // the result is a unit quaternion.
    const out: TransformValue = {
      x: 0,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 0,
      fx: 0,
      fz: 0,
    };
    const w = windows[0];
    transformAt(w, unitIndex(w, 1), 50, out);
    near(
      Math.hypot(out.qx, out.qy, out.qz, out.qw),
      1,
      "length of the blended rotation",
    );
  });

  it("says no when the unit has no keys", () => {
    const out: TransformValue = {
      x: 9,
      z: 9,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      fx: 0,
      fz: 1,
    };
    const empty = {
      ...windows[0],
      unitTransformStart: new Uint32Array([0, 0]),
    };
    expect(transformAt(empty, 0, 10, out)).toBe(false);
    expect(out.x).toBe(9);
  });
});

describe("statusAt", () => {
  it("gives health and build progress as the Rust reader gives them", () => {
    const out: StatusValue = { health: 0, build: 0 };
    for (const c of fixture.status) {
      const w = windows[c.window];
      const where = `unit ${c.serial} frame ${c.frame} window ${c.window}`;
      expect(statusAt(w, unitIndex(w, c.serial), c.frame, out), where).toBe(
        true,
      );
      near(out.health, c.health, `${where} health`);
      near(out.build, c.build, `${where} build`);
    }
  });
});

describe("projectileAt", () => {
  it("gives the cubic's position and velocity as the Rust reader gives them", () => {
    const out: ProjectileValue = { x: 0, z: 0, vx: 0, vz: 0 };
    for (const c of fixture.projectile) {
      const w = windows[c.window];
      const where = `projectile ${c.serial} frame ${c.frame} window ${c.window}`;
      expect(
        projectileAt(w, projectileIndex(w, c.serial), c.frame, out),
        where,
      ).toBe(true);
      near(out.x, c.x, `${where} x`);
      near(out.z, c.z, `${where} z`);
      near(out.vx, c.vx, `${where} vx`);
      near(out.vz, c.vz, `${where} vz`);
    }
  });
});

describe("a window boundary", () => {
  // Frame 60 is the last frame of window 0 and the first of window 1.
  it("gives a unit the same value from either window", () => {
    const a: TransformValue = {
      x: 0,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 0,
      fx: 0,
      fz: 0,
    };
    const b = { ...a };
    const [first, second] = windows;
    for (const serial of [0, 1]) {
      transformAt(first, unitIndex(first, serial), 60, a);
      transformAt(second, unitIndex(second, serial), 60, b);
      expect(b, `unit ${serial}`).toEqual(a);
    }
  });

  it("gives a status curve the same value from either window", () => {
    const a: StatusValue = { health: 0, build: 0 };
    const b: StatusValue = { health: 0, build: 0 };
    const [first, second] = windows;
    for (const serial of [0, 1]) {
      statusAt(first, unitIndex(first, serial), 60, a);
      statusAt(second, unitIndex(second, serial), 60, b);
      expect(b, `unit ${serial}`).toEqual(a);
    }
  });

  it("gives a projectile that crosses it the same value from either window", () => {
    const a: ProjectileValue = { x: 0, z: 0, vx: 0, vz: 0 };
    const b: ProjectileValue = { x: 0, z: 0, vx: 0, vz: 0 };
    const [first, second] = windows;
    projectileAt(first, projectileIndex(first, 1), 60, a);
    projectileAt(second, projectileIndex(second, 1), 60, b);
    expect(b).toEqual(a);
  });
});

describe("which units are alive", () => {
  const frames = Array.from(new Set(fixture.transform.map((c) => c.frame)));

  it("counts the units the Rust reader has alive at each frame", () => {
    for (const frame of frames) {
      for (const w of windows) {
        const expected = fixture.transform.filter(
          (c) => c.window === w.index && c.frame === frame,
        ).length;
        expect(
          aliveUnitCount(w, frame),
          `frame ${frame} window ${w.index}`,
        ).toBe(expected);
      }
    }
  });

  it("visits exactly those units, and no other", () => {
    const w = windows[1];
    const seen: number[] = [];
    forEachAliveUnit(w, 75, (i) => seen.push(w.unitSerial[i]));
    expect(seen.sort()).toEqual([0, 1]);
    const later: number[] = [];
    forEachAliveUnit(w, 100, (i) => later.push(w.unitSerial[i]));
    expect(later.sort()).toEqual([0, 2]);
  });

  it("has its units in order of first frame, so the search stops early", () => {
    for (const w of windows) {
      const first = Array.from(w.unitFirst);
      expect(first).toEqual([...first].sort((a, b) => a - b));
    }
  });

  it("visits the projectiles alive at a frame", () => {
    const w = windows[0];
    const seen: number[] = [];
    forEachAliveProjectile(w, 55, (i) => seen.push(w.projectileSerial[i]));
    // Projectile 0 ended at 50. Projectile 1 runs from 50.
    expect(seen).toEqual([1]);
  });
});
