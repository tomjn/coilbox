import { describe, expect, it } from "vitest";

import {
  localAnchors,
  nearestSnap,
  pieceAnchors,
  screenPixelsToWorld,
  snapRotation,
  type Vec3,
} from "./snapping";

const UNIT = { min: [-1, -1, -1] as Vec3, max: [1, 1, 1] as Vec3 };

describe("localAnchors", () => {
  it("gives eight corners, six face centres and the middle", () => {
    const anchors = localAnchors(UNIT);

    expect(anchors.filter((a) => a.kind === "corner")).toHaveLength(8);
    expect(anchors.filter((a) => a.kind === "face")).toHaveLength(6);
    expect(anchors.filter((a) => a.kind === "centre")).toHaveLength(1);
  });

  it("puts face centres on the faces, not the corners", () => {
    const faces = localAnchors(UNIT)
      .filter((a) => a.kind === "face")
      .map((a) => a.position);

    expect(faces).toContainEqual([1, 0, 0]);
    expect(faces).toContainEqual([0, -1, 0]);
    expect(faces).toContainEqual([0, 0, 1]);
  });

  it("follows a box that is not centred on its own origin", () => {
    const anchors = localAnchors({ min: [0, 0, 0], max: [4, 2, 6] });
    const centre = anchors.find((a) => a.kind === "centre");

    expect(centre?.position).toEqual([2, 1, 3]);
  });
});

describe("pieceAnchors", () => {
  it("gives the box's fifteen when the piece has none of its own", () => {
    expect(pieceAnchors(UNIT, undefined)).toHaveLength(15);
    expect(pieceAnchors(UNIT, [])).toHaveLength(15);
  });

  it("uses the piece's own anchors instead of the box, not as well as", () => {
    const anchors = pieceAnchors(UNIT, [
      { name: "mouth", position: [0, 0.5, 1] },
    ]);

    expect(anchors).toEqual([
      { position: [0, 0.5, 1], kind: "custom", name: "mouth" },
    ]);
  });

  it("leaves a piece with no part its own origin to seat against", () => {
    expect(pieceAnchors(null, undefined)).toEqual([
      { position: [0, 0, 0], kind: "centre" },
    ]);
  });

  it("lets a piece with no part carry anchors too", () => {
    const anchors = pieceAnchors(null, [{ name: "muzzle", position: [0, 0, 3] }]);

    expect(anchors).toEqual([
      { position: [0, 0, 3], kind: "custom", name: "muzzle" },
    ]);
  });
});

describe("nearestSnap", () => {
  it("finds the closest pair inside the threshold", () => {
    const snap = nearestSnap([[0, 0, 0]], [[0.2, 0, 0]], 0.5);

    expect(snap).not.toBeNull();
    expect(snap?.delta).toEqual([0.2, 0, 0]);
    expect(snap?.distance).toBeCloseTo(0.2);
  });

  it("moves the piece so the two anchors meet exactly", () => {
    const moving: Vec3 = [1, 0, 0];
    const target: Vec3 = [1.1, 0.1, 0];
    const snap = nearestSnap([moving], [target], 0.5);

    const seated = moving.map((n, i) => n + (snap?.delta[i] ?? 0));
    expect(seated).toEqual(target);
  });

  it("prefers the nearer of two candidates", () => {
    const snap = nearestSnap(
      [[0, 0, 0]],
      [
        [0.4, 0, 0],
        [0.1, 0, 0],
      ],
      0.5,
    );

    expect(snap?.at).toEqual([0.1, 0, 0]);
  });

  it("returns nothing when the nearest pair is out of reach", () => {
    expect(nearestSnap([[0, 0, 0]], [[2, 0, 0]], 0.5)).toBeNull();
    // Nothing to snap to is not the same as being too far away, but both mean
    // the piece stays where it was put.
    expect(nearestSnap([[0, 0, 0]], [], 0.5)).toBeNull();
  });
});

describe("snapRotation", () => {
  it("rounds to the nearest step", () => {
    const step = Math.PI / 12; // 15 degrees
    const snapped = snapRotation([step * 0.6, step * 2.4, 0], step);

    expect(snapped[0]).toBeCloseTo(step);
    expect(snapped[1]).toBeCloseTo(step * 2);
    expect(snapped[2]).toBe(0);
  });

  it("leaves the rotation alone when there is no step", () => {
    const free: Vec3 = [0.123, 0.456, 0.789];
    expect(snapRotation(free, 0)).toEqual(free);
  });
});

describe("screenPixelsToWorld", () => {
  // A 90 degree vertical FOV makes tan(fov/2) exactly 1, so the numbers stay
  // simple: worldPerPixel = 2 * distance / viewportHeightPx.
  const WIDE_FOV = Math.PI / 2;

  it("matches the projection maths for a round FOV", () => {
    const threshold = screenPixelsToWorld(WIDE_FOV, 100, 10, 1);
    expect(threshold).toBeCloseTo(0.2);
  });

  it("grows with distance, so a snap reaches just as far zoomed out", () => {
    const near = screenPixelsToWorld(WIDE_FOV, 100, 10, 5);
    const far = screenPixelsToWorld(WIDE_FOV, 100, 20, 5);
    expect(far).toBeCloseTo(near * 2);
  });

  it("shrinks with viewport height, so a bigger canvas is not a bigger reach", () => {
    const small = screenPixelsToWorld(WIDE_FOV, 100, 10, 5);
    const large = screenPixelsToWorld(WIDE_FOV, 200, 10, 5);
    expect(large).toBeCloseTo(small / 2);
  });

  it("scales linearly with the pixel figure", () => {
    const single = screenPixelsToWorld(WIDE_FOV, 100, 10, 1);
    const triple = screenPixelsToWorld(WIDE_FOV, 100, 10, 3);
    expect(triple).toBeCloseTo(single * 3);
  });

  it("stays close to the old fixed 0.45 at the home camera distance", () => {
    // The home camera sits at [9, 7, 11], about 15.8 world units from a piece
    // at the origin, with a 40 degree vertical FOV and roughly a 580px tall
    // panel. 24px lands close to the old fixed figure so the default snap
    // does not change character.
    const fov = (40 * Math.PI) / 180;
    const distance = Math.hypot(9, 7, 11);
    const threshold = screenPixelsToWorld(fov, 580, distance, 24);

    expect(threshold).toBeGreaterThan(0.4);
    expect(threshold).toBeLessThan(0.55);
  });

  it("never collapses to zero for a piece at or behind the camera", () => {
    expect(screenPixelsToWorld(WIDE_FOV, 100, 0, 5)).toBeGreaterThan(0);
    expect(screenPixelsToWorld(WIDE_FOV, 100, -3, 5)).toBeGreaterThan(0);
  });

  it("clamps to a minimum so an extreme zoom in cannot vanish", () => {
    const tiny = screenPixelsToWorld(WIDE_FOV, 100, 0.001, 0.001);
    expect(tiny).toBeGreaterThan(0);
    expect(tiny).toBeLessThan(0.1);
  });

  it("clamps to a maximum so an extreme zoom out cannot grab the whole scene", () => {
    const huge = screenPixelsToWorld(WIDE_FOV, 10, 100000, 50);
    expect(huge).toBeLessThanOrEqual(3);
  });

  it("guards against a collapsed or zero viewport height", () => {
    expect(Number.isFinite(screenPixelsToWorld(WIDE_FOV, 0, 10, 5))).toBe(true);
    expect(Number.isFinite(screenPixelsToWorld(WIDE_FOV, -50, 10, 5))).toBe(
      true,
    );
  });
});
