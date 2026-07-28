import { describe, expect, it } from "vitest";

import { localAnchors, nearestSnap, snapRotation, type Vec3 } from "./snapping";

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
