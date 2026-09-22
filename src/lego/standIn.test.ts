import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { StandInTrack } from "./scriptPlayback";
import {
  attachedAt,
  buildStandIn,
  disposeStandIn,
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
        { frame: 0, pos: [0, 0, 0], fromAttachPiece: true },
        { frame: 10, pos: [0, -1, -1], fromAttachPiece: true },
      ],
    });
    expect(standInAt(dropped, 5, 8)?.fromAttachPiece).toBe(true);
    expect(standInAt(track(), 15, 8)?.fromAttachPiece).toBe(false);
  });
});

describe("attachedAt", () => {
  const riding: StandInTrack = {
    keys: [{ frame: 0, pos: [0, 0, 0] }],
    attach: {
      from: "QueryTransport",
      frame: 10,
      until: 20,
      follow: true,
    },
  };

  it("is nothing before the attach frame", () => {
    expect(attachedAt(riding, 9)).toBeNull();
  });

  it("is the attach from its own frame on", () => {
    expect(attachedAt(riding, 10)?.from).toBe("QueryTransport");
    expect(attachedAt(riding, 19)?.from).toBe("QueryTransport");
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
        follow: false,
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
