import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { portableAtan2, portableEuler } from "./portableAngles";

/** `Math.atan2` as Node 24's V8 answered it, for points of every sign and of
 *  sizes from 1e-5 to 1e3, with the pair that differs in JavaScriptCore first. */
const V8: [number, number, number][] = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("fixtures/atan2-v8.json", import.meta.url)),
    "utf8",
  ),
);

describe("portableAtan2", () => {
  it("matches V8 bit for bit, whichever engine runs it", () => {
    expect(V8.length).toBeGreaterThan(400);
    for (const [y, x, angle] of V8) {
      expect(portableAtan2(y, x), `${y}, ${x}`).toBe(angle);
    }
  });

  it("gives the edge cases fdlibm gives", () => {
    expect(Object.is(portableAtan2(0, 1), 0)).toBe(true);
    expect(Object.is(portableAtan2(-0, 1), -0)).toBe(true);
    expect(portableAtan2(0, -1)).toBe(Math.PI);
    expect(portableAtan2(-0, -1)).toBe(-Math.PI);
    expect(portableAtan2(1, 0)).toBe(Math.PI / 2);
    expect(portableAtan2(Infinity, Infinity)).toBe(Math.PI / 4);
    expect(portableAtan2(-Infinity, -Infinity)).toBe((-3 * Math.PI) / 4);
    expect(portableAtan2(1, -Infinity)).toBe(Math.PI);
    expect(portableAtan2(Infinity, 1)).toBe(Math.PI / 2);
    expect(portableAtan2(Number.NaN, 1)).toBeNaN();
  });
});

describe("portableEuler", () => {
  it("turns as three.js's Euler does, to within rounding", () => {
    for (const [a, b, c] of [
      [0.3, -1.1, 2.2],
      [Math.PI / 2, 0, -0.72],
      [0, Math.PI / 2, 0],
      [-2.5, 0.4, 0.1],
    ] as const) {
      const m = new THREE.Matrix4().makeRotationFromEuler(
        new THREE.Euler(a, b, c),
      );
      const x = new THREE.Vector3();
      const y = new THREE.Vector3();
      const z = new THREE.Vector3();
      m.extractBasis(x, y, z);
      const ours = portableEuler(x, y, z);
      const theirs = new THREE.Euler().setFromRotationMatrix(m);
      expect(ours[0]).toBeCloseTo(theirs.x, 9);
      expect(ours[1]).toBeCloseTo(theirs.y, 9);
      expect(ours[2]).toBeCloseTo(theirs.z, 9);
    }
  });
});
