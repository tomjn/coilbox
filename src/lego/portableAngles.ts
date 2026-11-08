/**
 * Angles that come out the same in every JavaScript engine (#3233).
 *
 * The language leaves `Math.atan2`, `Math.asin` and the rest to each engine,
 * and they differ in the last bit: `Math.atan2(-0.7361796409603496,
 * 0.6767861820660132)` is `-0.8274080365596059` in V8, which Node and
 * Windows' WebView2 run, and `-0.8274080365596058` in JavaScriptCore, which
 * Bun and the macOS and Linux webviews run. A generated unit must be the same
 * document on every machine, so the generator turns its parts with these.
 *
 * Only `+`, `-`, `*`, `/` and `Math.sqrt` are used, which every engine
 * computes exactly as IEEE 754 says. `portableAtan2` is a port of fdlibm's
 * `atan` and `atan2`, the code V8 runs, so it also matches V8 bit for bit.
 */

const ATAN_HI = [
  0.4636476090008061, 0.7853981633974483, 0.982793723247329, 1.5707963267948966,
];
const ATAN_LO = [
  2.2698777452961687e-17, 3.061616997868383e-17, 1.3903311031230998e-17,
  6.123233995736766e-17,
];
const AT = [
  0.3333333333333293, -0.19999999999876483, 0.14285714272503466,
  -0.11111110405462356, 0.09090887133436507, -0.0769187620504483,
  0.06661073137387531, -0.058335701337905735, 0.049768779946159324,
  -0.036531572744216916, 0.016285820115365782,
];
const PI = Math.PI;
const PI_LO = 1.2246467991473532e-16;
const PI_O_2 = Math.PI / 2;
const PI_O_4 = Math.PI / 4;

const view = new DataView(new ArrayBuffer(8));

/** The unbiased binary exponent of a finite, non-zero number. */
function exponent(value: number): number {
  view.setFloat64(0, value);
  return ((view.getUint16(0) >> 4) & 0x7ff) - 1023;
}

/** fdlibm's `atan`. */
function atan(input: number): number {
  if (Number.isNaN(input)) return input;
  const negative = input < 0 || Object.is(input, -0);
  let x = Math.abs(input);
  if (x >= 2 ** 66) {
    const z = (ATAN_HI[3] as number) + (ATAN_LO[3] as number);
    return negative ? -z : z;
  }
  let id: number;
  if (x < 0.4375) {
    if (x < 2 ** -27) return input;
    id = -1;
    x = input;
  } else if (x < 1.1875) {
    if (x < 0.6875) {
      id = 0;
      x = (2 * x - 1) / (2 + x);
    } else {
      id = 1;
      x = (x - 1) / (x + 1);
    }
  } else if (x < 2.4375) {
    id = 2;
    x = (x - 1.5) / (1 + 1.5 * x);
  } else {
    id = 3;
    x = -1 / x;
  }
  const a = AT as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const z = x * x;
  const w = z * z;
  const s1 =
    z * (a[0] + w * (a[2] + w * (a[4] + w * (a[6] + w * (a[8] + w * a[10])))));
  const s2 = w * (a[1] + w * (a[3] + w * (a[5] + w * (a[7] + w * a[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r =
    (ATAN_HI[id] as number) - (x * (s1 + s2) - (ATAN_LO[id] as number) - x);
  return negative ? -r : r;
}

/** fdlibm's `atan2`: the angle of the point `x`, `y`. */
export function portableAtan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  if (x === 1) return atan(y);
  const yNegative = y < 0 || Object.is(y, -0);
  const xNegative = x < 0 || Object.is(x, -0);
  const m = (yNegative ? 1 : 0) | (xNegative ? 2 : 0);
  if (y === 0) {
    if (m < 2) return y;
    return m === 2 ? PI : -PI;
  }
  if (x === 0) return yNegative ? -PI_O_2 : PI_O_2;
  if (!Number.isFinite(x)) {
    if (!Number.isFinite(y)) {
      return [PI_O_4, -PI_O_4, 3 * PI_O_4, -3 * PI_O_4][m] as number;
    }
    return [0, -0, PI, -PI][m] as number;
  }
  if (!Number.isFinite(y)) return yNegative ? -PI_O_2 : PI_O_2;
  const k = exponent(y) - exponent(x);
  let z: number;
  let quadrant = m;
  if (k > 60) {
    z = PI_O_2 + 0.5 * PI_LO;
    quadrant &= 1;
  } else if (xNegative && k < -60) {
    z = 0;
  } else {
    z = atan(Math.abs(y / x));
  }
  switch (quadrant) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}

/**
 * The XYZ Euler angles, in radians, of the rotation whose columns are `x`,
 * `y` and `z`: what three.js's `Euler.setFromRotationMatrix` gives, by the
 * same rule, with `portableAtan2` in place of the engine's.
 */
export function portableEuler(
  x: { x: number; y: number; z: number },
  y: { x: number; y: number; z: number },
  z: { x: number; y: number; z: number },
): [number, number, number] {
  const m13 = Math.min(Math.max(z.x, -1), 1);
  // asin(s) is the angle whose sine is s and whose cosine is the root of 1-s².
  const pitch = portableAtan2(m13, Math.sqrt((1 - m13) * (1 + m13)));
  if (Math.abs(m13) < 0.9999999) {
    return [portableAtan2(-z.y, z.z), pitch, portableAtan2(-y.x, x.x)];
  }
  return [portableAtan2(y.z, y.y), pitch, 0];
}
