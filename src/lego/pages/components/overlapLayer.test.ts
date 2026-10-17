import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { OverlapResult } from "../../overlap";
import { buildOverlap, disposeOverlap } from "./overlapLayer";

function result(count: number): OverlapResult {
  return {
    buried: Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      holderId: "h",
      triangles: 12,
      box: { min: [i, 0, 0], max: [i + 1, 2, 3] },
    })),
    wastedTriangles: count * 12,
    checked: count + 1,
  };
}

describe("buildOverlap", () => {
  it("draws nothing when no piece is buried", () => {
    expect(buildOverlap(result(0))).toBeNull();
  });

  it("draws one outline a buried piece, round its box", () => {
    const group = buildOverlap(result(2)) as THREE.Group;

    expect(group.children).toHaveLength(2);
    const box = new THREE.Box3().setFromObject(group.children[0]);
    expect(box.min.toArray()).toEqual([0, 0, 0]);
    expect(box.max.toArray()).toEqual([1, 2, 3]);
    disposeOverlap(group);
  });

  it("is not hit by a click on the model", () => {
    const group = buildOverlap(result(1)) as THREE.Group;
    const hits: THREE.Intersection[] = [];
    group.children[0].raycast(new THREE.Raycaster(), hits);

    expect(hits).toHaveLength(0);
  });
});
