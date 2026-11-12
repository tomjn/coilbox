import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { loft, roundRect, terraced } from "./anomalyParts";

/** Six times the volume a closed mesh encloses, positive when it faces out. */
function volume6(g: THREE.BufferGeometry): number {
  const pos = g.getAttribute("position");
  const index = g.getIndex();
  const at = (i: number) =>
    new THREE.Vector3().fromBufferAttribute(pos, index ? index.getX(i) : i);
  let v = 0;
  for (let i = 0; i < (index ? index.count : pos.count); i += 3)
    v += at(i).dot(at(i + 1).cross(at(i + 2)));
  return v;
}

describe("roundRect", () => {
  it("stays on the outline and closes on itself", () => {
    for (let k = 0; k <= 40; k++) {
      const [x, y] = roundRect(2, 0.5, 0.1, k / 40);
      expect(Math.abs(x)).toBeLessThanOrEqual(2 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.5 + 1e-9);
      expect(Math.max(Math.abs(x) - 1.9, Math.abs(y) - 0.4)).toBeGreaterThan(
        -1e-9,
      );
    }
    expect(roundRect(2, 0.5, 0.1, 1)).toEqual(roundRect(2, 0.5, 0.1, 0));
  });
});

describe("loft", () => {
  it("makes a closed skin that faces out", () => {
    const g = loft(8, 24, (t) => ({
      c: new THREE.Vector3(0, t * 2, 0),
      ua: new THREE.Vector3(1, 0, 0),
      ub: new THREE.Vector3(0, 0, 1),
      a: 0.5,
      b: 0.25,
      r: 0.05,
    }));
    // A 1 by 2 by 0.5 box, less its rounded corners.
    expect(volume6(g) / 6).toBeGreaterThan(0.9);
    expect(volume6(g) / 6).toBeLessThan(1);
  });
});

describe("terraced", () => {
  it("cuts noise into flat levels from 0 to 1", () => {
    expect(terraced(0, 4)).toBe(0);
    expect(terraced(1, 4)).toBe(1);
    expect(terraced(0.3, 4)).toBe(terraced(0.26, 4));
  });
});
