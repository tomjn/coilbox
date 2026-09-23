import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { ScriptOutput, StandInTrack } from "./scriptPlayback";
import {
  attachedAt,
  buildStandIn,
  disposeStandIn,
  passengerAt,
  standInAfterRelease,
  standInAt,
  standInRadius,
} from "./standIn";

/** Two keys, ten frames apart, moving two radii along x and one up. */
function track(overrides: Partial<StandInTrack> = {}): StandInTrack {
  return {
    keys: [
      { frame: 10, pos: [0, 0, 2] },
      { frame: 20, pos: [2, 1, 2] },
    ],
    ...overrides,
  };
}

describe("standInAt", () => {
  it("scales a key's radius multiples into elmos", () => {
    expect(standInAt(track(), 10, 8)?.pos).toEqual([0, 0, 16]);
  });

  it("interpolates between two keys", () => {
    expect(standInAt(track(), 15, 8)?.pos).toEqual([8, 4, 16]);
  });

  /** A frame before the first key holds the first key, rather than
   *  extrapolating backwards to somewhere the scenario never asked for. */
  it("holds the first key before the track starts", () => {
    expect(standInAt(track(), 0, 8)?.pos).toEqual([0, 0, 16]);
  });

  it("holds the last key after the track ends", () => {
    expect(standInAt(track(), 999, 8)?.pos).toEqual([16, 8, 16]);
  });

  it("has no position at all for a track with no keys", () => {
    expect(standInAt({ keys: [] }, 0, 8)).toBeNull();
  });

  /** Heading is optional on a key and interpolates like the position does. */
  it("interpolates heading, and is zero where no key sets one", () => {
    const turning: StandInTrack = {
      keys: [
        { frame: 0, pos: [0, 0, 0], heading: 0 },
        { frame: 10, pos: [0, 0, 0], heading: 1 },
      ],
    };
    expect(standInAt(turning, 5, 8)?.heading).toBeCloseTo(0.5);
    expect(standInAt(track(), 15, 8)?.heading).toBe(0);
  });

  /** A key measured from the attach piece says so, which is what a dropped
   *  passenger needs: it leaves the transport where the transport held it. */
  it("reports which origin a key is measured from", () => {
    const dropped = track({
      keys: [
        { frame: 0, pos: [0, 0, 0], fromRelease: true },
        { frame: 10, pos: [0, -1, -1], fromRelease: true },
      ],
    });
    expect(standInAt(dropped, 5, 8)?.fromRelease).toBe(true);
    expect(standInAt(track(), 15, 8)?.fromRelease).toBe(false);
  });
});

describe("attachedAt", () => {
  const riding: StandInTrack = {
    keys: [{ frame: 0, pos: [0, 0, 0] }],
    attach: {
      from: "QueryBuildInfo",
      frame: 10,
      until: 20,
    },
  };

  it("is nothing before the attach frame", () => {
    expect(attachedAt(riding, 9)).toBeNull();
  });

  it("is the attach from its own frame on", () => {
    expect(attachedAt(riding, 10)?.from).toBe("QueryBuildInfo");
    expect(attachedAt(riding, 19)?.from).toBe("QueryBuildInfo");
  });

  it("is nothing again once it detaches", () => {
    expect(attachedAt(riding, 20)).toBeNull();
  });

  it("never ends when nothing says it should", () => {
    const held: StandInTrack = {
      keys: [{ frame: 0, pos: [0, 0, 0] }],
      attach: {
        from: "QueryBuildInfo",
        frame: 0,
        until: null,
      },
    };
    expect(attachedAt(held, 999)?.from).toBe("QueryBuildInfo");
  });

  it("is nothing for a track with no attach", () => {
    expect(attachedAt(track(), 5)).toBeNull();
  });
});

describe("standInRadius", () => {
  /** A fraction of the unit's larger horizontal extent, so it reads as another
   *  unit rather than a speck or a wall. */
  it("is a fraction of the wider horizontal extent", () => {
    expect(
      standInRadius({ mid: [0, 0, 0], sizeX: 60, sizeY: 20, sizeZ: 30 }),
    ).toBe(14);
  });

  it("uses z when the unit is longer than it is wide", () => {
    expect(
      standInRadius({ mid: [0, 0, 0], sizeX: 30, sizeY: 20, sizeZ: 60 }),
    ).toBe(14);
  });

  it("never disappears for a unit with almost nothing in it", () => {
    expect(
      standInRadius({ mid: [0, 0, 0], sizeX: 0, sizeY: 0, sizeZ: 0 }),
    ).toBe(4.2);
  });

  it("never grows into a wall beside a very large unit", () => {
    expect(
      standInRadius({ mid: [0, 0, 0], sizeX: 600, sizeY: 100, sizeZ: 600 }),
    ).toBe(28);
  });
});

describe("buildStandIn", () => {
  /** A view aid, never a piece. Nothing in the builder may select, hover or
   *  seat against it, which is how `referenceObject.ts` does it too. */
  it("is invisible to the pointer", () => {
    const group = buildStandIn(10);
    let meshes = 0;
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshes += 1;
        expect(child.raycast({} as never, [])).toBeUndefined();
      }
    });
    expect(meshes).toBeGreaterThan(0);
    disposeStandIn(group);
  });

  /** Sized in elmos with nothing rescaled, and standing on y = 0 the way the
   *  engine stands a unit, so a track's `y: 0` sits it on the ground. */
  it("is built to the radius it is given, standing on the ground", () => {
    const box = new THREE.Box3().setFromObject(buildStandIn(10));
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.x).toBeCloseTo(10, 1);
    expect(box.min.x).toBeCloseTo(-10, 1);
  });

  /** The front reads from the silhouette: it sticks out further forward than
   *  it does back, so a shape seen from behind is not a shape seen in front. */
  it("is not the same front to back", () => {
    const box = new THREE.Box3().setFromObject(buildStandIn(10));
    expect(box.max.z).toBeGreaterThan(Math.abs(box.min.z));
  });

  /** Up reads from the silhouette too: the top is not the base. */
  it("is not the same upside down", () => {
    const group = buildStandIn(10);
    const box = new THREE.Box3().setFromObject(group);
    // Narrower at the top than at the base, so a stand-in that has somehow
    // been turned over is obvious rather than merely wrong.
    expect(widthAt(group, box.max.y * 0.9)).toBeLessThan(
      widthAt(group, box.min.y + 0.01),
    );
  });
});

/**
 * Every face points outwards.
 *
 * The shape is convex, so a triangle's own normal has to agree with the
 * direction from the middle of the shape to that triangle. A face wound the
 * other way is culled, and what you see through the hole is the inside of the
 * far side, which looks like a solid shape with its colours in the wrong
 * places rather than like a bug. The glacis plate shipped that way until
 * somebody rotated the camera far enough round to catch it.
 */
describe("the stand-in's winding", () => {
  it("turns every face outwards", () => {
    const mesh = buildStandIn(10).children[0] as THREE.Mesh;
    const pos = mesh.geometry.getAttribute("position");

    const middle = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      middle.add(new THREE.Vector3().fromBufferAttribute(pos, i));
    }
    middle.divideScalar(pos.count);

    const inward: string[] = [];
    for (let t = 0; t < pos.count; t += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, t);
      const b = new THREE.Vector3().fromBufferAttribute(pos, t + 1);
      const c = new THREE.Vector3().fromBufferAttribute(pos, t + 2);
      const normal = new THREE.Vector3()
        .crossVectors(b.clone().sub(a), c.clone().sub(a))
        .normalize();
      const outward = a.clone().add(b).add(c).divideScalar(3).sub(middle);
      if (normal.dot(outward) <= 0) {
        inward.push(
          `triangle at vertex ${t}, normal (${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)})`,
        );
      }
    }

    expect(inward).toEqual([]);
  });
});

describe("passengerAt", () => {
  const attach = (
    frame: number,
    piece: string | null,
    unit = 2,
  ): ScriptOutput => ({
    frame,
    kind: "attach",
    unit,
    piece,
  });
  const drop = (frame: number, unit = 2): ScriptOutput => ({
    frame,
    kind: "drop",
    unit,
  });

  it("is loose before anything attaches it", () => {
    expect(passengerAt([attach(10, "link")], 9)).toEqual({ kind: "loose" });
    expect(passengerAt([], 100)).toEqual({ kind: "loose" });
  });

  /** `UpdateTransportees` runs within the attach's own frame
   *  (`rts/Game/Game.cpp:1796-1798`), so the picture already has it there. */
  it("rides from the attach's own frame", () => {
    expect(passengerAt([attach(10, "link")], 10)).toEqual({
      kind: "riding",
      piece: "link",
    });
  });

  it("is in the void when attached to no piece", () => {
    expect(passengerAt([attach(10, "link"), attach(20, null)], 25)).toEqual({
      kind: "void",
    });
  });

  it("remembers the frame and the piece it was let go from", () => {
    const events = [attach(10, "link"), drop(30)];
    expect(passengerAt(events, 29)).toEqual({ kind: "riding", piece: "link" });
    expect(passengerAt(events, 30)).toEqual({
      kind: "released",
      frame: 30,
      from: "link",
    });
    expect(passengerAt(events, 99)).toEqual({
      kind: "released",
      frame: 30,
      from: "link",
    });
  });

  it("is let go from nowhere when it was dropped out of the void", () => {
    expect(passengerAt([attach(10, null), drop(30)], 30)).toEqual({
      kind: "released",
      frame: 30,
      from: null,
    });
  });

  /** The Hulk picks up, hides, then reaches out and puts down again. */
  it("follows several attach and drop cycles", () => {
    const events = [
      attach(10, "link"),
      attach(40, null),
      drop(60),
      attach(80, "link"),
      drop(120),
    ];
    expect(passengerAt(events, 50)).toEqual({ kind: "void" });
    expect(passengerAt(events, 70)).toEqual({
      kind: "released",
      frame: 60,
      from: null,
    });
    expect(passengerAt(events, 90)).toEqual({ kind: "riding", piece: "link" });
    expect(passengerAt(events, 130)).toEqual({
      kind: "released",
      frame: 120,
      from: "link",
    });
  });

  /** The engine does nothing for an id with no unit behind it, and a drop of a
   *  unit nobody carries does nothing either (`Unit.cpp:2715-2720`). */
  it("ignores other units, and a drop of a stand-in nobody carries", () => {
    expect(passengerAt([attach(10, "link", 7)], 20)).toEqual({ kind: "loose" });
    expect(passengerAt([drop(10)], 20)).toEqual({ kind: "loose" });
  });

  it("ignores effects", () => {
    const events: ScriptOutput[] = [
      attach(10, "link"),
      { frame: 15, kind: "sfx", piece: "flare", sfx: 1025 },
    ];
    expect(passengerAt(events, 20)).toEqual({ kind: "riding", piece: "link" });
  });
});

/** How wide the shape is across x at one height, read off its vertices. */
function widthAt(group: THREE.Group, y: number): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const pos = child.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - y) > 0.5) continue;
      min = Math.min(min, pos.getX(i));
      max = Math.max(max, pos.getX(i));
    }
  });
  return max - min;
}

describe("standInAfterRelease", () => {
  const release = { frame: 100, at: [5, 4, 0] as [number, number, number] };

  /** A dropped stand-in holds where it was let go and does not fall. */
  it("holds at the release point when no key follows it", () => {
    const pose = standInAfterRelease(
      { keys: [{ frame: 0, pos: [0, 0, 9] }] },
      150,
      release,
      10,
    );
    expect(pose).toEqual({ pos: [5, 4, 0], heading: 0 });
  });

  /** The release point is an implicit key on the drop's frame. */
  it("moves from the release point to the next key", () => {
    const pose = standInAfterRelease(
      { keys: [{ frame: 200, pos: [0, 0, 1] }] },
      150,
      release,
      10,
    );
    expect(pose.pos).toEqual([2.5, 2, 5]);
  });

  it("measures a fromRelease key from the release point", () => {
    const pose = standInAfterRelease(
      { keys: [{ frame: 200, pos: [0, 1, 0], fromRelease: true }] },
      200,
      release,
      10,
    );
    expect(pose.pos).toEqual([5, 14, 0]);
  });

  /** The runtime owned the stand-in while it was carried. */
  it("passes over keys at or before the drop", () => {
    const pose = standInAfterRelease(
      {
        keys: [
          { frame: 50, pos: [9, 9, 9] },
          { frame: 100, pos: [9, 9, 9] },
        ],
      },
      120,
      release,
      10,
    );
    expect(pose.pos).toEqual([5, 4, 0]);
  });

  it("is at the release point on the drop's own frame", () => {
    const pose = standInAfterRelease(
      { keys: [{ frame: 200, pos: [0, 0, 1] }] },
      100,
      release,
      10,
    );
    expect(pose.pos).toEqual([5, 4, 0]);
  });
});
