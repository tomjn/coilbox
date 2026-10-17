import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { FootprintResult } from "../../footprint";
import { buildFootprint, disposeFootprint } from "./footprintLayer";

function ok(
  overrides: Partial<Extract<FootprintResult, { status: "ok" }>> = {},
): FootprintResult {
  return {
    status: "ok",
    now: { x: 2, z: 3 },
    base: { x: 2, z: 3 },
    outlying: [],
    outlyingRoles: [],
    written: null,
    differs: false,
    overhang: { x: 0, z: 0 },
    wasted: { x: 0, z: 0 },
    ...overrides,
  };
}

function bounds(object: THREE.Object3D): THREE.Box3 {
  return new THREE.Box3().setFromObject(object);
}

describe("buildFootprint", () => {
  it("draws nothing when the check does not apply", () => {
    expect(
      buildFootprint({ status: "notApplicable", reason: "none" }),
    ).toBeNull();
  });

  it("draws one rectangle, centred, the size of the footprint in elmos", () => {
    const group = buildFootprint(ok()) as THREE.Group;

    expect(group.children).toHaveLength(1);
    const box = bounds(group);
    expect(box.min.x).toBeCloseTo(-16, 6);
    expect(box.max.x).toBeCloseTo(16, 6);
    expect(box.min.z).toBeCloseTo(-24, 6);
    expect(box.max.z).toBeCloseTo(24, 6);
    disposeFootprint(group);
  });

  it("draws the base rectangle as well when it is smaller", () => {
    const group = buildFootprint(ok({ base: { x: 2, z: 2 } })) as THREE.Group;

    expect(group.children).toHaveLength(2);
    disposeFootprint(group);
  });

  it("draws the written rectangle as well when it differs", () => {
    const group = buildFootprint(
      ok({ written: { x: 1, z: 1, source: "export" }, differs: true }),
    ) as THREE.Group;

    expect(group.children).toHaveLength(2);
    disposeFootprint(group);
  });

  it("does not make the rectangle pickable", () => {
    const group = buildFootprint(ok()) as THREE.Group;
    const hits: THREE.Intersection[] = [];
    group.children[0].raycast(new THREE.Raycaster(), hits);

    expect(hits).toEqual([]);
  });
});
