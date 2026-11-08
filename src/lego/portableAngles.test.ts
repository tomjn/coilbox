import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  portableAtan2,
  portableCos,
  portableEuler,
  portableLog,
  portableSin,
} from "./portableAngles";

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

/** Each function's answers for a spread of arguments: the argument, what
 *  Node 24's V8 gave (`Math.sin` and `Math.cos` there are glibc's, `Math.log`
 *  is fdlibm's), and what the port gave when the table was made. The table
 *  holds every sixth point where JavaScriptCore's answer is not V8's, so the
 *  places the engines split are in it. */
const TRIG: Record<"sin" | "cos" | "log", [number, number, number][]> =
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("fixtures/trig-v8.json", import.meta.url)),
      "utf8",
    ),
  );

const bits = new DataView(new ArrayBuffer(8));
/** How many doubles apart two numbers are. */
function ulps(a: number, b: number): number {
  const order = (n: number) => {
    bits.setFloat64(0, n);
    const v = bits.getBigInt64(0);
    return v < 0n ? -(v & 0x7fffffffffffffffn) : v;
  };
  const d = order(a) - order(b);
  return Number(d < 0n ? -d : d);
}

describe.each([
  ["portableSin", portableSin, "sin"],
  ["portableCos", portableCos, "cos"],
  ["portableLog", portableLog, "log"],
] as const)("%s", (_name, port, key) => {
  it("gives the same bits on every engine, as the table has them", () => {
    expect(TRIG[key].length).toBeGreaterThan(300);
    for (const [x, , ours] of TRIG[key]) {
      expect(port(x), `${x}`).toBe(ours);
    }
  });

  it("is within one step of V8", () => {
    for (const [x, v8] of TRIG[key]) {
      expect(ulps(port(x), v8), `${x}`).toBeLessThanOrEqual(1);
    }
  });
});

describe("portableSin and portableCos", () => {
  it("give the edge cases fdlibm gives", () => {
    expect(Object.is(portableSin(0), 0)).toBe(true);
    expect(Object.is(portableSin(-0), -0)).toBe(true);
    expect(portableCos(0)).toBe(1);
    expect(portableSin(Number.NaN)).toBeNaN();
    expect(portableCos(Number.POSITIVE_INFINITY)).toBeNaN();
    expect(portableSin(Number.NEGATIVE_INFINITY)).toBeNaN();
  });

  it("agree with each other and with the engine to well under a step of the angle", () => {
    for (let k = -64; k <= 64; k++) {
      const x = (k * Math.PI) / 8;
      expect(portableSin(x)).toBeCloseTo(Math.sin(x), 12);
      expect(portableCos(x)).toBeCloseTo(Math.cos(x), 12);
    }
  });
});

describe("portableLog", () => {
  it("gives the edge cases fdlibm gives", () => {
    expect(portableLog(1)).toBe(0);
    expect(portableLog(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(portableLog(-1)).toBeNaN();
    expect(portableLog(Number.NaN)).toBeNaN();
    expect(portableLog(Number.POSITIVE_INFINITY)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(portableLog(5e-324)).toBeCloseTo(Math.log(5e-324), 9);
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
