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
 * `atan` and `atan2`. What it must give is the same answer everywhere, not
 * V8's, though it matched Node 24's V8 on every sample in its test.
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

const view32 = new DataView(new ArrayBuffer(8));

/** The high 32 bits of a double, as a signed integer. */
function highWord(value: number): number {
  view32.setFloat64(0, value);
  return view32.getInt32(0);
}

/** The double whose high 32 bits are `high` and whose low 32 bits are 0. */
function fromHighWord(high: number): number {
  view32.setUint32(0, high >>> 0);
  view32.setUint32(4, 0);
  return view32.getFloat64(0);
}

const S1 = -1.6666666666666632e-1;
const S2 = 8.33333333332249e-3;
const S3 = -1.984126982985795e-4;
const S4 = 2.7557313707070068e-6;
const S5 = -2.5050760253406863e-8;
const S6 = 1.58969099521155e-10;
const C1 = 4.16666666666666e-2;
const C2 = -1.388888888887411e-3;
const C3 = 2.480158728947673e-5;
const C4 = -2.7557314351390663e-7;
const C5 = 2.087572321298175e-9;
const C6 = -1.1359647557788195e-11;
const INV_PIO2 = 6.366197723675814e-1;
const PIO2_1 = 1.5707963267341256;
const PIO2_1T = 6.077100506506192e-11;
const PIO2_2 = 6.077100506303966e-11;
const PIO2_2T = 2.0222662487959506e-21;
const PIO2_3 = 2.0222662487111665e-21;
const PIO2_3T = 8.4784276603689e-32;

/** fdlibm's `__kernel_sin`: sin of `x + y` for |x| <= pi/4, `y` the tail. */
function kernelSin(x: number, y: number, tail: boolean): number {
  if ((highWord(x) & 0x7fffffff) < 0x3e400000 && Math.trunc(x) === 0) return x;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (!tail) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

/** fdlibm's `__kernel_cos`: cos of `x + y` for |x| <= pi/4. */
function kernelCos(x: number, y: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix < 0x3e400000 && Math.trunc(x) === 0) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromHighWord(ix - 0x00200000);
  const hz = 0.5 * z - qx;
  return 1 - qx - (hz - (z * r - x * y));
}

const TWO_PI = 2 * Math.PI;

/**
 * fdlibm's `__ieee754_rem_pio2` for an `x` beyond pi/4: the quadrant count `n`
 * and `x - n * pi / 2` as the two doubles `y0 + y1`. It is fdlibm's medium
 * path, exact to about 1.6e6 radians. Past that the angle is first taken
 * modulo 2pi as a double (`%` is exact in every engine), so the answer is in
 * range and the same everywhere, but is off by about the angle times 2e-16.
 */
function remPio2(input: number): [number, number, number] {
  let x = input;
  let ix = highWord(x) & 0x7fffffff;
  if (ix > 0x413921fb) {
    x = input % TWO_PI;
    ix = highWord(x) & 0x7fffffff;
    if (ix <= 0x3fe921fb) return [0, x, 0];
  }
  if (ix < 0x4002d97c) {
    // Under 3pi/4, so the quadrant is 1 or -1.
    const sign = x > 0 ? 1 : -1;
    let z = x - sign * PIO2_1;
    if (ix !== 0x3ff921fb) {
      const y0 = z - sign * PIO2_1T;
      return [sign, y0, z - y0 - sign * PIO2_1T];
    }
    z -= sign * PIO2_2;
    const y0 = z - sign * PIO2_2T;
    return [sign, y0, z - y0 - sign * PIO2_2T];
  }
  const t0 = Math.abs(x);
  const n = Math.trunc(t0 * INV_PIO2 + 0.5);
  let r = t0 - n * PIO2_1;
  let w = n * PIO2_1T;
  let y0 = r - w;
  const j = ix >> 20;
  if (j - ((highWord(y0) >> 20) & 0x7ff) > 16) {
    let t = r;
    w = n * PIO2_2;
    r = t - w;
    w = n * PIO2_2T - (t - r - w);
    y0 = r - w;
    if (j - ((highWord(y0) >> 20) & 0x7ff) > 49) {
      t = r;
      w = n * PIO2_3;
      r = t - w;
      w = n * PIO2_3T - (t - r - w);
      y0 = r - w;
    }
  }
  const y1 = r - y0 - w;
  return x < 0 ? [-n, -y0, -y1] : [n, y0, y1];
}

/** fdlibm's `sin`: the sine of an angle in radians. */
export function portableSin(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, false);
  if (ix >= 0x7ff00000) return Number.NaN;
  const [n, y0, y1] = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelSin(y0, y1, true);
    case 1:
      return kernelCos(y0, y1);
    case 2:
      return -kernelSin(y0, y1, true);
    default:
      return -kernelCos(y0, y1);
  }
}

/** fdlibm's `cos`: the cosine of an angle in radians. */
export function portableCos(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return Number.NaN;
  const [n, y0, y1] = remPio2(x);
  switch (n & 3) {
    case 0:
      return kernelCos(y0, y1);
    case 1:
      return -kernelSin(y0, y1, true);
    case 2:
      return -kernelCos(y0, y1);
    default:
      return kernelSin(y0, y1, true);
  }
}

const LN2_HI = 6.931471803691238e-1;
const LN2_LO = 1.9082149292705877e-10;
const TWO54 = 18014398509481984;
const LG1 = 6.666666666666735e-1;
const LG2 = 3.999999999940942e-1;
const LG3 = 2.857142874366239e-1;
const LG4 = 2.2222198432149784e-1;
const LG5 = 1.818357216161805e-1;
const LG6 = 1.5313837699209373e-1;
const LG7 = 1.4798198605116586e-1;

/** fdlibm's `log`: the natural logarithm. */
export function portableLog(input: number): number {
  let x = input;
  let hx = highWord(x);
  let k = 0;
  if (Number.isNaN(x)) return x;
  if (hx < 0x00100000) {
    if (x === 0) return Number.NEGATIVE_INFINITY;
    if (hx < 0) return Number.NaN;
    k -= 54;
    x *= TWO54;
    hx = highWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  const i0 = (hx + 0x95f64) & 0x100000;
  view32.setFloat64(0, x);
  view32.setUint32(0, (hx | (i0 ^ 0x3ff00000)) >>> 0);
  x = view32.getFloat64(0);
  k += i0 >> 20;
  const f = x - 1;
  const dk = k;
  if ((0x000fffff & (2 + hx)) < 3) {
    if (f === 0) return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO;
    const R = f * f * (0.5 - 0.3333333333333333 * f);
    return k === 0 ? f - R : dk * LN2_HI - (R - dk * LN2_LO - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  const i = (hx - 0x6147a) | (0x6b851 - hx);
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    return k === 0
      ? f - (hfsq - s * (hfsq + R))
      : dk * LN2_HI - (hfsq - (s * (hfsq + R) + dk * LN2_LO) - f);
  }
  return k === 0
    ? f - s * (f - R)
    : dk * LN2_HI - (s * (f - R) - dk * LN2_LO - f);
}
