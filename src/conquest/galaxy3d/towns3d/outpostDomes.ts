/** A sealed outpost's habitat domes, capsule stacks and utility structures. */
import * as THREE from "three";
import {
  type Builder,
  faceOut,
  type Kind,
  type Rgb,
  TAU,
} from "../landmarks/kit";
import type { OutpostFamily, OutpostPaint } from "./outpostColourways";
import type { OutpostModel } from "./outposts";
import {
  chamfered,
  column,
  mast,
  type Pt,
  plate,
  rect,
  shouldered,
  type Xyz,
} from "./parts";

/* --------------------------------- paint --------------------------------- */

type Put = (g: THREE.BufferGeometry, m?: THREE.Matrix4) => void;

/** One way to add a part for each surface a structure has. */
interface Tools {
  /** Painted plate with seams, in the main colour and the second. */
  hull: Put;
  hull2: Put;
  /** Smooth paint, as on a dome or a tank. */
  smooth: Put;
  smooth2: Put;
  accent: Put;
  /** Dark metal. */
  trim: Put;
  /** Bare metal. */
  metal: Put;
  glass: Put;
  /** Hazard stripes. */
  stripe: Put;
}

const tools = (b: Builder, paint: OutpostPaint): Tools => {
  const put =
    (colour: Rgb, kind: Kind, settles = true): Put =>
    (g, m) => {
      if (m) g.applyMatrix4(m);
      g.computeBoundingBox();
      const foot = (g.boundingBox as THREE.Box3).min.y;
      b.add(g, colour, new THREE.Matrix4(), {
        kind,
        // Only a part that stands on the ground takes grime at its foot.
        clean: foot > 0.005,
        ...(settles
          ? { top: paint.top, topCover: paint.topCover, stains: paint.dust }
          : {}),
      });
    };
  return {
    hull: put(paint.hull, 11),
    hull2: put(paint.hull2, 11),
    smooth: put(paint.hull, 12),
    smooth2: put(paint.hull2, 12),
    accent: put(paint.accent, 12),
    trim: put(paint.trim, 7),
    metal: put(paint.metal, 13),
    glass: put(paint.glass, 3, false),
    stripe: put(paint.stripe, 14, false),
  };
};

/* --------------------------------- parts --------------------------------- */

/**
 * A closed skin over rings of the same number of points, each convex and
 * flat, capped at both ends.
 */
function skin(rings: Xyz[][]): THREE.BufferGeometry {
  const n = rings[0].length;
  const idx: number[] = [];
  for (let r = 0; r < rings.length - 1; r++)
    for (let i = 0; i < n; i++) {
      const a = r * n + i;
      const c = r * n + ((i + 1) % n);
      idx.push(a, c, a + n, c, c + n, a + n);
    }
  const last = (rings.length - 1) * n;
  for (let i = 1; i < n - 1; i++)
    idx.push(0, i + 1, i, last, last + i, last + i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(rings.flat(2), 3),
  );
  g.setIndex(idx);
  return faceOut(g);
}

/** A level ring of `n` points, `r` from `cx, cz`. */
const ring = (r: number, y: number, n: number, cx = 0, cz = 0): Xyz[] =>
  Array.from({ length: n }, (_, i): Xyz => {
    const a = ((i + 0.5) / n) * TAU - Math.PI;
    return [cx + r * Math.cos(a), y, cz + r * Math.sin(a)];
  });

/** A part turned on a lathe: `profile` is its radius at each height, going up. */
const turned = (profile: Pt[], n: number, cx = 0, cz = 0) =>
  skin(profile.map(([r, y]) => ring(r, y, n, cx, cz)));

/** An upright tank with a domed head, from `y0` to `y1`. */
const tank = (
  r: number,
  y0: number,
  y1: number,
  cx: number,
  cz: number,
  n = 10,
) =>
  turned(
    [
      [r, y0],
      [r, y1 - 0.6 * r],
      [0.8 * r, y1 - 0.22 * r],
      [0.45 * r, y1],
    ],
    n,
    cx,
    cz,
  );

/** How far up a dome's arc its shell stops and its crown begins. */
const CROWN_AT = (72 * Math.PI) / 180;

interface DomeSpec {
  cx: number;
  cz: number;
  /** The shell's radius at its foot. */
  r: number;
  /** The foot of the drum, its height, and the top of the crown. */
  y0: number;
  drum: number;
  top: number;
  /** How much of the height the crown takes. */
  crown: number;
  ribs: number;
  sides: number;
  /** A window band round the drum. */
  glazed?: boolean;
  /** A solid cap and a mast in place of the skylight. */
  capped?: boolean;
}

/** A ribbed dome on a drum ring, with a crown collar and a skylight or a cap. */
function dome(t: Tools, s: DomeSpec): void {
  const { cx, cz, r, sides } = s;
  const yd = s.y0 + s.drum;
  const yc = s.top - s.crown;
  const rise = (yc - yd) / Math.sin(CROWN_AT);
  const lip = Math.min(0.02, 0.2 * s.drum);

  // The drum: a wide dark gutter at its foot, a wall and a lip under the shell.
  t.trim(
    turned(
      [
        [1.16 * r, s.y0],
        [1.16 * r, s.y0 + 0.4 * s.drum],
        [1.07 * r, s.y0 + 0.52 * s.drum],
      ],
      sides,
      cx,
      cz,
    ),
  );
  t.hull2(
    turned(
      [
        [1.05 * r, s.y0],
        [1.05 * r, yd],
      ],
      sides,
      cx,
      cz,
    ),
  );
  if (s.glazed)
    t.glass(
      turned(
        [
          [1.065 * r, s.y0 + 0.58 * s.drum],
          [1.065 * r, s.y0 + 0.86 * s.drum],
        ],
        sides,
        cx,
        cz,
      ),
    );
  t.trim(
    turned(
      [
        [1.1 * r, yd - lip],
        [1.1 * r, yd],
        [1.0 * r, yd + 0.6 * lip],
      ],
      sides,
      cx,
      cz,
    ),
  );

  // The shell.
  const rows = 6;
  const arc = (k: number, of: number): [number, number, number] => {
    const a = (k / of) * CROWN_AT;
    return [r * Math.cos(a), yd + rise * Math.sin(a), a];
  };
  t.smooth(
    turned(
      Array.from({ length: rows + 1 }, (_, k): Pt => {
        const [rad, y] = arc(k, rows);
        return [rad, y];
      }),
      sides,
      cx,
      cz,
    ),
  );

  // Ribs up the shell, each on one of its edges and standing a little proud.
  const proud = 0.022 * r;
  const half = 0.032 * r;
  const step = sides / s.ribs;
  for (let k = 0; k < s.ribs; k++) {
    const a = ((k * step + 0.5) / sides) * TAU - Math.PI;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const rings: Xyz[][] = [];
    for (let j = 0; j <= rows; j++) {
      const [rad, y, up] = arc(j, rows);
      const point = (off: number, side: number): Xyz => {
        const rr = rad + off * Math.cos(up);
        return [
          cx + rr * ca - side * half * sa,
          y + off * Math.sin(up),
          cz + rr * sa + side * half * ca,
        ];
      };
      rings.push([
        point(proud, -1),
        point(proud, 1),
        point(-3 * proud, 1),
        point(-3 * proud, -1),
      ]);
    }
    t.accent(skin(rings));
  }

  // The crown: a collar round the top of the shell, then glass or a cap.
  t.accent(
    turned(
      [
        [0.4 * r, yc - 0.4 * s.crown],
        [0.4 * r, yc + 0.2 * s.crown],
        [0.34 * r, yc + 0.3 * s.crown],
      ],
      sides,
      cx,
      cz,
    ),
  );
  if (s.capped) {
    t.smooth2(
      turned(
        [
          [0.31 * r, yc + 0.25 * s.crown],
          [0.26 * r, yc + 0.5 * s.crown],
          [0.1 * r, yc + 0.6 * s.crown],
        ],
        sides,
        cx,
        cz,
      ),
    );
    t.metal(mast(0.16 * r, yc + 0.5 * s.crown, s.top, cx, cz));
  } else
    t.glass(
      turned(
        [
          [0.31 * r, yc + 0.25 * s.crown],
          [0.27 * r, yc + 0.7 * s.crown],
          [0.14 * r, s.top],
        ],
        sides,
        cx,
        cz,
      ),
    );
}

/**
 * An entry tunnel with round shoulders, running out from `cx, cz` along
 * `dx, dz` from `from` to `to`, ending in a striped frame round a dark door.
 */
function vestibule(
  t: Tools,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
  from: number,
  to: number,
  wide: number,
  y0: number,
  y1: number,
): void {
  const alongX = dx !== 0;
  const out = (r: number) => (alongX ? cx : cz) + (dx + dz) * r;
  const across = alongX ? cz : cx;
  const c = 0.3 * wide;
  t.hull(
    shouldered(wide, y0, y1, c, out(from), out(to - 0.012), across, alongX),
  );
  t.stripe(
    shouldered(
      1.16 * wide,
      y0,
      y1 + 0.08 * wide,
      1.16 * c,
      out(to - 0.035),
      out(to - 0.004),
      across,
      alongX,
    ),
  );
  t.trim(
    shouldered(
      0.62 * wide,
      y0,
      y0 + 0.78 * (y1 - y0),
      0.15 * wide,
      out(to - 0.02),
      out(to),
      across,
      alongX,
    ),
  );
}

/** A boxy annex with a painted belt, a dark roof and plant on it. */
function annex(
  t: Tools,
  cx: number,
  cz: number,
  aw: number,
  ad: number,
  y0: number,
  y1: number,
): void {
  const c = 0.12 * Math.min(aw, ad);
  const h = y1 - y0;
  t.hull2(column(chamfered(aw, ad, c, cx, cz), y0, y1));
  t.accent(
    column(
      chamfered(aw + 0.006, ad + 0.006, c, cx, cz),
      y0 + 0.6 * h,
      y0 + 0.74 * h,
    ),
  );
  t.glass(
    column(
      chamfered(aw + 0.004, ad + 0.004, c, cx, cz),
      y0 + 0.3 * h,
      y0 + 0.44 * h,
    ),
  );
  t.trim(plate(0.82 * aw, 0.82 * ad, y1, y1 + 0.012, cx, cz));
  t.hull(
    plate(
      0.32 * aw,
      0.3 * ad,
      y1 + 0.012,
      y1 + 0.045,
      cx - 0.16 * aw,
      cz + 0.14 * ad,
    ),
  );
  t.metal(
    plate(
      0.16 * aw,
      0.4 * ad,
      y1 + 0.012,
      y1 + 0.028,
      cx + 0.2 * aw,
      cz - 0.1 * ad,
    ),
  );
}

/** A rounded section `hh` high and `dd` deep at `x`, its corners turned to `rr`. */
const pill = (
  x: number,
  yMid: number,
  cz: number,
  hh: number,
  dd: number,
  rr: number,
  inset: number,
): Xyz[] => {
  const a = dd / 2 - inset;
  const b = hh / 2 - inset;
  const q = Math.max(rr - inset, 0.002);
  const out: Xyz[] = [];
  const sz = [1, 1, -1, -1];
  const sy = [-1, 1, 1, -1];
  for (let k = 0; k < 4; k++)
    for (let j = 0; j < 3; j++) {
      const th = ((-90 + 90 * k + 45 * j) * Math.PI) / 180;
      out.push([
        x,
        yMid + sy[k] * (b - q) + q * Math.sin(th),
        cz + sz[k] * (a - q) + q * Math.cos(th),
      ]);
    }
  return out;
};

/** A long hull with a rounded section and rounded ends, lying along x on `y0`. */
function capsule(
  cx: number,
  cz: number,
  y0: number,
  len: number,
  hh: number,
  dd: number,
): THREE.BufferGeometry {
  const rr = Math.min(0.32 * hh, 0.45 * dd);
  const yMid = y0 + hh / 2;
  const ends: [number, number][] = [
    [len / 2, 0.6 * rr],
    [len / 2 - 0.35 * rr, 0.15 * rr],
    [len / 2 - rr, 0],
  ];
  const rings = [
    ...ends.map(([x, inset]) => pill(cx - x, yMid, cz, hh, dd, rr, inset)),
    ...ends
      .reverse()
      .map(([x, inset]) => pill(cx + x, yMid, cz, hh, dd, rr, inset)),
  ];
  return skin(rings);
}

/** A band round a capsule at `x`, `wide` along it and a little proud. */
const collar = (
  x: number,
  cz: number,
  y0: number,
  hh: number,
  dd: number,
  wide: number,
) => {
  const rr = Math.min(0.32 * hh, 0.45 * dd);
  const yMid = y0 + hh / 2;
  return skin([
    pill(x - wide / 2, yMid, cz, hh, dd, rr, -0.005),
    pill(x + wide / 2, yMid, cz, hh, dd, rr, -0.005),
  ]);
};

/**
 * One capsule hull with its bands and a window strip down each side. `end`
 * is 1 or -1, the end that carries the painted band.
 */
function hullPart(
  t: Tools,
  cx: number,
  cz: number,
  y0: number,
  len: number,
  hh: number,
  dd: number,
  end: number,
): void {
  t.hull(capsule(cx, cz, y0, len, hh, dd));
  for (const f of [-0.22, 0.1])
    t.hull2(collar(cx + end * f * len, cz, y0, hh, dd, 0.02));
  t.accent(collar(cx + end * (len / 2 - 0.7 * hh), cz, y0, hh, dd, 0.045));
  t.glass(
    plate(
      0.42 * len,
      dd + 0.006,
      y0 + 0.42 * hh,
      y0 + 0.64 * hh,
      cx - end * 0.1 * len,
      cz,
    ),
  );
}

type Edge = "x0" | "x1" | "z0" | "z1";

/** A ramp over a rectangle on plan, rising to `y` at its `high` edge, with striped kerbs. */
function ramp(
  t: Tools,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  high: Edge,
): void {
  const thin = 0.004;
  const wedge = (
    ax0: number,
    ax1: number,
    az0: number,
    az1: number,
    top: number,
  ) => {
    const foot = rect(ax1 - ax0, az1 - az0, (ax0 + ax1) / 2, (az0 + az1) / 2);
    const head =
      high === "x0"
        ? rect(thin, az1 - az0, ax0 + thin / 2, (az0 + az1) / 2)
        : high === "x1"
          ? rect(thin, az1 - az0, ax1 - thin / 2, (az0 + az1) / 2)
          : high === "z0"
            ? rect(ax1 - ax0, thin, (ax0 + ax1) / 2, az0 + thin / 2)
            : rect(ax1 - ax0, thin, (ax0 + ax1) / 2, az1 - thin / 2);
    return column(foot, 0, top, head);
  };
  t.hull2(wedge(x0, x1, z0, z1, y));
  const kerb = 0.016;
  if (high === "x0" || high === "x1") {
    t.stripe(wedge(x0, x1, z0, z0 + kerb, y + 0.012));
    t.stripe(wedge(x0, x1, z1 - kerb, z1, y + 0.012));
  } else {
    t.stripe(wedge(x0, x0 + kerb, z0, z1, y + 0.012));
    t.stripe(wedge(x1 - kerb, x1, z0, z1, y + 0.012));
  }
}

/* --------------------------------- domes --------------------------------- */

/** One dome on its drum, with an entry or two and a tank beside it. */
function singleDome(t: Tools, w: number, h: number, tall: boolean): void {
  const r = 0.39 * w;
  dome(t, {
    cx: 0,
    cz: 0,
    r,
    y0: 0,
    drum: tall ? 0.36 * h : 0.22 * h,
    top: h,
    crown: tall ? 0.075 : 0.045,
    ribs: 8,
    sides: 16,
    glazed: tall,
    capped: tall,
  });
  const reach = 0.5 * w - 0.002;
  vestibule(t, 0, 0, 0, 1, 0.9 * r, reach, 0.2 * w, 0, tall ? 0.1 : 0.078);
  if (tall) vestibule(t, 0, 0, -1, 0, 0.9 * r, reach, 0.17 * w, 0, 0.085);
  t.accent(tank(0.055 * w, 0, tall ? 0.13 : 0.085, 0.31 * w, -0.31 * w, 8));
  t.smooth2(tank(0.04 * w, 0, tall ? 0.1 : 0.065, 0.39 * w, -0.2 * w, 8));
}

/** A dome between two halls, one ending in a door and one in an annex. */
function wingedDome(t: Tools, w: number, d: number, h: number): void {
  const r = 0.39 * d;
  // The long hall, with bands, windows and a door at its end.
  const far = -0.5 * w + 0.004;
  t.hull(shouldered(0.6 * d, 0, 0.15, 0.07, far + 0.02, -0.8 * r, 0, true));
  for (const x of [-0.26 * w, -0.37 * w])
    t.hull2(
      shouldered(
        0.6 * d + 0.014,
        0,
        0.157,
        0.074,
        x - 0.012,
        x + 0.012,
        0,
        true,
      ),
    );
  t.glass(plate(0.14 * w, 0.6 * d + 0.006, 0.06, 0.092, -0.315 * w, 0));
  t.stripe(
    shouldered(
      0.6 * d + 0.03,
      0,
      0.165,
      0.078,
      far + 0.004,
      far + 0.03,
      0,
      true,
    ),
  );
  t.trim(shouldered(0.3 * d, 0, 0.11, 0.03, far, far + 0.01, 0, true));
  t.trim(plate(0.05 * w, 0.2 * d, 0.15, 0.165, -0.315 * w, 0));

  // The short hall and the annex it runs into.
  t.hull(shouldered(0.5 * d, 0, 0.13, 0.06, 0.8 * r, 0.33 * w, 0, true));
  t.hull2(
    shouldered(0.5 * d + 0.014, 0, 0.137, 0.064, 0.24 * w, 0.26 * w, 0, true),
  );
  t.glass(plate(0.06 * w, 0.5 * d + 0.006, 0.055, 0.085, 0.2 * w, 0));
  annex(t, 0.405 * w, 0, 0.17 * w, 0.88 * d, 0, 0.2);
  t.accent(tank(0.05 * d, 0, 0.1, 0.3 * w, -0.4 * d, 8));

  dome(t, {
    cx: 0,
    cz: 0,
    r,
    y0: 0,
    drum: 0.12,
    top: h,
    crown: 0.06,
    ribs: 8,
    sides: 16,
    glazed: true,
  });
  vestibule(t, 0, 0, 0, 1, 0.9 * r, 0.5 * d - 0.002, 0.22 * d, 0, 0.09);
}

/** Two domes on one plinth, joined by a link with the entry at its middle. */
function twinDomes(t: Tools, w: number, d: number, h: number): void {
  const deck = 0.04;
  t.trim(column(chamfered(w, d, 0.07), 0, 0.028));
  t.hull2(column(chamfered(w - 0.03, d - 0.03, 0.06), 0.028, deck));
  const r = 0.37 * d;
  const x = 0.265 * w;
  for (const side of [-1, 1])
    dome(t, {
      cx: side * x,
      cz: 0,
      r,
      y0: deck,
      drum: 0.075,
      top: h,
      crown: 0.05,
      ribs: 8,
      sides: 16,
      glazed: true,
    });
  // The link, and the airlock block at its middle.
  t.hull(
    shouldered(0.26 * d, deck, 0.13, 0.04, -x + 0.8 * r, x - 0.8 * r, 0, true),
  );
  annex(t, 0, -0.04 * d, 0.13 * w, 0.5 * d, deck, 0.17);
  vestibule(t, 0, 0, 0, 1, 0.2 * d, 0.5 * d - 0.006, 0.22 * d, deck, 0.125);
  // An end door on one dome and tanks at the foot of the other.
  vestibule(
    t,
    -x,
    0,
    -1,
    0,
    0.9 * r,
    0.5 * w - x - 0.008,
    0.2 * d,
    deck,
    0.115,
  );
  for (const z of [-0.16 * d, 0.16 * d])
    t.accent(tank(0.055 * d, deck, 0.13, 0.468 * w, z, 8));
  t.metal(plate(0.012, 0.32 * d, 0.07, 0.082, 0.468 * w, 0));
}

/** A great dome on a plinth, an entry on each side and annexes at its corners. */
function greatDome(
  t: Tools,
  w: number,
  d: number,
  h: number,
  r: number,
  drum: number,
  crown: number,
): void {
  const deck = 0.05;
  t.trim(column(chamfered(w, d, 0.14), 0, 0.035));
  t.hull2(column(chamfered(w - 0.04, d - 0.04, 0.13), 0.035, deck));

  // Three annexes of different heights, and a tank yard at the fourth corner.
  const k = h / 0.9;
  const at = 0.5 * w - 0.165;
  annex(t, at, at, 0.3, 0.3, deck, deck + 0.3 * k);
  annex(t, -at, at, 0.3, 0.3, deck, deck + 0.2 * k);
  annex(t, at, -at, 0.3, 0.3, deck, deck + 0.24 * k);
  t.metal(
    mast(0.03, deck + 0.3 * k, deck + 0.3 * k + 0.16, at + 0.08, at - 0.08),
  );
  t.hull2(plate(0.3, 0.3, deck, deck + 0.03, -at, -at));
  for (const [tx, tz, th] of [
    [-0.07, -0.07, 0.3],
    [0.07, -0.07, 0.3],
    [-0.07, 0.07, 0.3],
    [0.07, 0.07, 0.22],
  ])
    t.accent(tank(0.058, deck + 0.03, deck + th * k, -at + tx, -at + tz));
  t.metal(plate(0.2, 0.012, deck + 0.2 * k, deck + 0.2 * k + 0.012, -at, -at));

  dome(t, {
    cx: 0,
    cz: 0,
    r,
    y0: deck,
    drum,
    top: h,
    crown,
    ribs: 12,
    sides: 24,
    glazed: true,
  });

  const reach = 0.5 * w - 0.003;
  vestibule(t, 0, 0, 0, 1, 0.9 * r, reach, 0.3, deck, deck + 0.19 * k);
  vestibule(t, 0, 0, 0, -1, 0.9 * r, reach, 0.2, deck, deck + 0.14 * k);
  vestibule(t, 0, 0, 1, 0, 0.9 * r, reach, 0.2, deck, deck + 0.14 * k);
  vestibule(t, 0, 0, -1, 0, 0.9 * r, reach, 0.2, deck, deck + 0.14 * k);
  // A ramp down from the main entry's plinth edge is the plate's job, so the
  // entry gets a canopy block instead.
  t.hull2(
    plate(0.36, 0.1, deck + 0.19 * k, deck + 0.19 * k + 0.02, 0, r + 0.02),
  );
}

/* ----------------------------- capsule stacks ----------------------------- */

interface Row {
  /** Where the row's hulls lie across the block, and how deep they are. */
  cz: number;
  dd: number;
  /** How many hulls it stacks. */
  n: number;
  /** How far the row starts above the podium, in storeys. */
  lift: number;
  /** How far the lowest hull is cut back from the block's near end. */
  foot?: number;
}

interface Core {
  x: number;
  wide: number;
  z0: number;
  z1: number;
  /** How far its roof stands below the main core's. */
  drop: number;
}

interface StackSpec {
  x0: number;
  x1: number;
  /** The podium's height and its extent across the block. */
  pod: number;
  podX0: number;
  podZ0: number;
  podZ1: number;
  rows: Row[];
  cores: Core[];
}

/** Capsule hulls stacked and offset on a podium, round one or two cores. */
function capsuleStack(t: Tools, h: number, s: StackSpec): void {
  const coreTop = h - 0.11;
  const pitch = (coreTop - 0.08 - s.pod) / s.rows[0].n;
  const hh = 0.8 * pitch;
  const span = s.x1 - s.x0;

  // The podium.
  const podW = s.x1 - s.podX0;
  const podD = s.podZ1 - s.podZ0;
  const podX = (s.podX0 + s.x1) / 2;
  const podZ = (s.podZ0 + s.podZ1) / 2;
  t.trim(column(chamfered(podW, podD, 0.03, podX, podZ), 0, 0.8 * s.pod));
  t.hull2(
    column(
      chamfered(podW - 0.02, podD - 0.02, 0.025, podX, podZ),
      0.8 * s.pod,
      s.pod,
    ),
  );

  s.rows.forEach((row, ri) => {
    for (let i = 0; i < row.n; i++) {
      const y = s.pod + (row.lift + i) * pitch + 0.2 * pitch;
      const even = (i + ri) % 2 === 0;
      const cut = i === 0 ? (row.foot ?? 0) : 0;
      // Each hull is flush with one end of the block and short of the other.
      const from = even ? s.x0 + cut : s.x0 + Math.max(cut, 0.15 * span);
      const to = even ? s.x1 - 0.12 * span : s.x1;
      const len = to - from;
      const cx = (from + to) / 2;
      const cz = row.cz + (even ? -0.012 : 0.012);
      hullPart(t, cx, cz, y, len, hh, row.dd, even ? -1 : 1);

      // The gantry deck under it, which shows past its short end, with rails.
      const deck0 = Math.max(s.x0 + 0.02 * span, cut > 0 ? from : s.x0);
      const deck1 = s.x1 - 0.02 * span;
      t.trim(
        plate(
          deck1 - deck0,
          0.8 * row.dd,
          y - 0.2 * pitch,
          y + 0.08 * hh,
          (deck0 + deck1) / 2,
          row.cz,
        ),
      );
      const open0 = even ? to - 0.03 : deck0;
      const open1 = even ? deck1 : from + 0.03;
      if (open1 - open0 > 0.04)
        for (const side of [-1, 1])
          t.metal(
            plate(
              open1 - open0,
              0.008,
              y + 0.08 * hh,
              y + 0.3 * hh,
              (open0 + open1) / 2,
              row.cz + side * 0.38 * row.dd,
            ),
          );
    }
    // Plant on the roof of the row's top hull.
    const roof = s.pod + (row.lift + row.n) * pitch;
    const mid = (s.x0 + s.x1) / 2;
    t.trim(
      plate(
        0.34 * span,
        0.5 * row.dd,
        roof - 0.01,
        roof + 0.014,
        mid - 0.14 * span,
        row.cz,
      ),
    );
    t.hull2(
      plate(
        0.1 * span,
        0.3 * row.dd,
        roof,
        roof + 0.045,
        mid - 0.2 * span,
        row.cz,
      ),
    );
    t.accent(
      plate(
        0.05 * span,
        0.3 * row.dd,
        roof,
        roof + 0.03,
        mid - 0.05 * span,
        row.cz,
      ),
    );
  });

  // The cores the hulls hang from, each with a dark slot and a painted strip
  // up both faces.
  s.cores.forEach((core, ci) => {
    const top = coreTop - core.drop;
    const zMid = (core.z0 + core.z1) / 2;
    const deep = core.z1 - core.z0;
    t.hull2(
      shouldered(core.wide, 0, top, 0.28 * core.wide, core.z0, core.z1, core.x),
    );
    t.trim(
      plate(
        0.26 * core.wide,
        deep + 0.008,
        s.pod + 0.04,
        top - 0.4 * core.wide,
        core.x + 0.1 * core.wide,
        zMid,
      ),
    );
    t.accent(
      plate(
        0.09 * core.wide,
        deep + 0.008,
        s.pod + 0.04,
        top - 0.4 * core.wide,
        core.x - 0.2 * core.wide,
        zMid,
      ),
    );
    t.glass(
      plate(
        0.1 * core.wide,
        deep + 0.012,
        top - 0.75 * core.wide,
        top - 0.45 * core.wide,
        core.x + 0.1 * core.wide,
        zMid,
      ),
    );
    t.trim(
      plate(
        0.5 * core.wide,
        0.5 * deep,
        top - 0.004,
        top + 0.014,
        core.x,
        zMid,
      ),
    );
    if (ci > 0) return;
    // Masts on the main core, the tallest the top of the whole stack.
    t.metal(mast(0.028, top, h, core.x - 0.12 * core.wide, zMid - 0.12 * deep));
    t.metal(
      mast(0.022, top, h - 0.025, core.x + 0.14 * core.wide, zMid + 0.1 * deep),
    );
    t.metal(mast(0.022, top, h - 0.04, core.x, zMid + 0.2 * deep));
  });
}

/** A stack one row deep on a long lot, with a ramp up to its podium at one end. */
function capsuleBlock(
  t: Tools,
  w: number,
  d: number,
  h: number,
  n: number,
): void {
  const x0 = -0.5 * w + 0.008;
  const x1 = 0.5 * w - 0.008;
  const podX0 = -0.24 * w;
  const pod = 0.07;
  capsuleStack(t, h, {
    x0,
    x1,
    pod,
    podX0,
    podZ0: -0.48 * d,
    podZ1: 0.48 * d,
    rows: [{ cz: 0, dd: 0.76 * d, n, lift: 0, foot: podX0 + 0.02 - x0 }],
    cores: [
      { x: 0.24 * w, wide: 0.19 * w, z0: -0.485 * d, z1: 0.485 * d, drop: 0 },
    ],
  });
  ramp(t, x0, podX0 + 0.01, -0.32 * d, 0.32 * d, pod, "x1");
  // Legs under the hull that hangs over the ramp.
  const under = pod + (h - 0.19 - pod) / n;
  for (const side of [-1, 1])
    t.metal(plate(0.022, 0.022, 0, under + 0.02, -0.33 * w, side * 0.4 * d));
}

/** A stack three rows deep that steps down to wide ramps at its front. */
function capsuleCity(
  t: Tools,
  w: number,
  d: number,
  h: number,
  n: number,
): void {
  const x0 = -0.5 * w + 0.008;
  const x1 = 0.5 * w - 0.008;
  const pod = 0.1;
  const podZ1 = 0.26 * d;
  capsuleStack(t, h, {
    x0,
    x1,
    pod,
    podX0: x0,
    podZ0: -0.5 * d + 0.004,
    podZ1,
    rows: [
      { cz: -0.31 * d, dd: 0.34 * d, n, lift: 0 },
      { cz: -0.02 * d, dd: 0.3 * d, n: Math.max(1, n - 2), lift: 0.5 },
    ],
    cores: [
      {
        x: 0.25 * w,
        wide: 0.2 * w,
        z0: -0.5 * d + 0.012,
        z1: 0.2 * d,
        drop: 0,
      },
      {
        x: -0.3 * w,
        wide: 0.14 * w,
        z0: -0.5 * d + 0.012,
        z1: 0.17 * d,
        drop: 0.36 * h,
      },
    ],
  });
  // Two wide ramps up to the podium, and a low hull between them.
  ramp(t, 0.1 * w, 0.4 * w, podZ1 - 0.01, 0.5 * d - 0.004, pod, "z0");
  ramp(t, -0.44 * w, -0.16 * w, podZ1 - 0.01, 0.5 * d - 0.004, pod, "z0");
  hullPart(t, -0.03 * w, 0.37 * d, 0.015, 0.2 * w, 0.11, 0.14 * d, 1);
  t.trim(plate(0.18 * w, 0.1 * d, 0, 0.03, -0.03 * w, 0.37 * d));
}

/* -------------------------------- utility -------------------------------- */

/** A raised pad with a striped rim, a painted ring and a control hut. */
function landingPad(t: Tools, w: number, d: number, h: number): void {
  const cut = 0.2 * w;
  t.trim(
    column(
      chamfered(w, d, cut),
      0,
      0.05,
      chamfered(0.95 * w, 0.95 * d, 0.95 * cut),
    ),
  );
  t.hull2(column(chamfered(0.92 * w, 0.92 * d, 0.92 * cut), 0.05, 0.064));
  // The rim, a strip down each straight edge.
  const edge = 0.44 * w;
  const run = w - 2 * cut - 0.05;
  for (const side of [-1, 1]) {
    t.stripe(plate(run, 0.03, 0.064, 0.072, 0, side * edge));
    t.stripe(plate(0.03, run, 0.064, 0.072, side * edge, 0));
  }
  // The mark: a painted ring round a dark centre.
  t.accent(
    turned(
      [
        [0.27 * w, 0.064],
        [0.27 * w, 0.069],
      ],
      16,
    ),
  );
  t.smooth2(
    turned(
      [
        [0.21 * w, 0.064],
        [0.21 * w, 0.071],
      ],
      16,
    ),
  );
  t.trim(plate(0.2 * w, 0.045 * w, 0.071, 0.074));
  t.trim(plate(0.045 * w, 0.2 * w, 0.071, 0.074));
  // The hut at one corner with its beacon mast, and a fuel tank at another.
  const corner = 0.5 * w - 0.045;
  t.hull(column(chamfered(0.08, 0.08, 0.012, corner, corner), 0, 0.12));
  t.glass(plate(0.084, 0.084, 0.075, 0.1, corner, corner));
  t.trim(plate(0.06, 0.06, 0.12, 0.13, corner, corner));
  t.metal(mast(0.02, 0.13, h, corner + 0.015, corner + 0.015));
  t.accent(tank(0.035, 0, 0.1, -corner, corner, 8));
}

/** A rounded hut with a striped door at each end, a ramp and a tank. */
function airlockHut(t: Tools, w: number, d: number, h: number): void {
  const x0 = -0.5 * w + 0.01;
  const x1 = 0.5 * w - 0.07;
  const wide = 0.52 * d;
  const top = h - 0.045;
  const z = 0.08 * d;
  t.hull(shouldered(wide, 0, top, 0.075, x0 + 0.02, x1 - 0.02, z, true));
  for (const x of [-0.2 * w, -0.03 * w, 0.14 * w])
    t.hull2(
      shouldered(
        wide + 0.016,
        0,
        top + 0.008,
        0.08,
        x - 0.013,
        x + 0.013,
        z,
        true,
      ),
    );
  for (const [a, b, door] of [
    [x0 + 0.006, x0 + 0.03, x0],
    [x1 - 0.03, x1 - 0.006, x1],
  ]) {
    t.stripe(shouldered(wide + 0.03, 0, top + 0.014, 0.085, a, b, z, true));
    t.trim(
      shouldered(
        0.5 * wide,
        0,
        0.72 * top,
        0.03,
        Math.min(a, door),
        Math.max(b, door),
        z,
        true,
      ),
    );
  }
  ramp(
    t,
    x1 - 0.002,
    0.5 * w - 0.004,
    z - 0.3 * wide,
    z + 0.3 * wide,
    0.028,
    "x0",
  );
  // The air tank on its cradle beside the hut.
  const tz = -0.36 * d;
  t.trim(plate(0.5 * w, 0.1 * d, 0, 0.03, -0.1 * w, tz));
  t.accent(capsule(-0.1 * w, tz, 0.025, 0.56 * w, 0.085, 0.085));
  t.metal(plate(0.014, 0.2 * d, 0.07, 0.084, -0.1 * w, tz + 0.1 * d));
  // A vent and a beacon box on the roof.
  t.trim(plate(0.1 * w, 0.2 * d, top - 0.004, top + 0.022, -0.115 * w, z));
  t.accent(plate(0.07 * w, 0.07 * w, top - 0.004, h, 0.055 * w, z));
}

/** Three tall tanks under a catwalk, two fat ones and a pump hut on a skid. */
function tankFarm(t: Tools, w: number, d: number, h: number): void {
  t.trim(column(chamfered(0.98 * w, 0.98 * d, 0.03), 0, 0.022));
  for (const side of [-1, 1])
    t.stripe(plate(0.8 * w, 0.03, 0.022, 0.03, 0, side * 0.45 * d));
  const back = -0.25 * d;
  const tall = h - 0.03;
  for (const x of [-0.3 * w, 0, 0.3 * w]) {
    t.smooth(tank(0.115 * w, 0.022, tall, x, back, 12));
    t.accent(
      turned(
        [
          [0.121 * w, 0.4 * tall],
          [0.121 * w, 0.52 * tall],
        ],
        12,
        x,
        back,
      ),
    );
  }
  // The catwalk across their heads, and a vent on the middle one.
  t.trim(plate(0.74 * w, 0.06 * d, tall - 0.012, tall, 0, back + 0.1 * d));
  t.metal(plate(0.74 * w, 0.008, tall, tall + 0.022, 0, back + 0.13 * d));
  t.metal(mast(0.022, tall - 0.01, h, 0, back));
  // The low tanks and the pump hut between them.
  for (const side of [-1, 1])
    t.accent(tank(0.15 * w, 0.022, 0.13, side * 0.27 * w, 0.2 * d, 12));
  t.hull2(
    column(chamfered(0.16 * w, 0.26 * d, 0.012, 0, 0.22 * d), 0.022, 0.1),
  );
  t.trim(plate(0.12 * w, 0.2 * d, 0.1, 0.108, 0, 0.22 * d));
  // Pipes from the low tanks to the tall ones.
  t.metal(plate(0.7 * w, 0.016, 0.06, 0.076, 0, -0.02 * d));
  for (const x of [-0.27 * w, 0.27 * w])
    t.metal(plate(0.016, 0.16 * d, 0.06, 0.076, x, 0.05 * d));
}

/** Tapered fins across a manifold, with heat pipes through them and a pump. */
function radiatorArray(t: Tools, w: number, d: number, h: number): void {
  t.trim(plate(0.96 * w, 0.3 * d, 0, 0.03));
  t.smooth2(capsule(-0.03 * w, 0, 0.025, 0.86 * w, 0.085, 0.2 * d));
  for (let i = 0; i < 6; i++) {
    const x = (-0.4 + i * 0.145) * w;
    t.hull(
      column(
        rect(0.018, 0.97 * d, x, 0),
        0.085,
        h - 0.012,
        rect(0.018, 0.56 * d, x, 0),
      ),
    );
    t.trim(plate(0.026, 0.58 * d, h - 0.012, h, x, 0));
    t.accent(plate(0.024, 0.2 * d, 0.03, 0.12, x, 0));
  }
  // Heat pipes through the fins, and legs under their outer ends.
  for (const side of [-1, 1]) {
    t.metal(plate(0.78 * w, 0.014, 0.17, 0.184, -0.04 * w, side * 0.2 * d));
    t.metal(plate(0.76 * w, 0.02, 0, 0.09, -0.04 * w, side * 0.44 * d));
  }
  // The pump at one end.
  t.hull2(column(chamfered(0.13 * w, 0.4 * d, 0.012, 0.43 * w, 0), 0, 0.12));
  t.stripe(plate(0.13 * w + 0.004, 0.4 * d + 0.004, 0.04, 0.065, 0.43 * w, 0));
  t.trim(plate(0.09 * w, 0.3 * d, 0.12, 0.13, 0.43 * w, 0));
}

/** A banded mast beside an equipment hut that carries a dish. */
function commsMast(t: Tools, w: number, d: number, h: number): void {
  // The hut.
  const hx = -0.16 * w;
  const hz = -0.12 * d;
  t.hull(column(chamfered(0.5 * w, 0.44 * d, 0.02, hx, hz), 0, 0.1));
  t.accent(
    column(
      chamfered(0.5 * w + 0.006, 0.44 * d + 0.006, 0.02, hx, hz),
      0.062,
      0.078,
    ),
  );
  t.trim(plate(0.42 * w, 0.36 * d, 0.1, 0.11, hx, hz));
  t.stripe(plate(0.1 * w, 0.012, 0, 0.075, hx, hz + 0.22 * d + 0.004));

  // The dish on the hut's roof, tipped up and away from the mast.
  const dish = 0.19 * w;
  const tip = new THREE.Matrix4()
    .makeRotationZ(0.7)
    .setPosition(hx - 0.02 * w, 0.21, hz);
  t.metal(plate(0.03, 0.03, 0.11, 0.2, hx - 0.02 * w, hz));
  t.smooth(
    turned(
      [
        [0.14 * dish, -0.26 * dish],
        [dish, 0],
        [0.95 * dish, 0.03 * dish],
        [0.5 * dish, -0.1 * dish],
        [0.12 * dish, -0.17 * dish],
      ],
      14,
    ),
    tip,
  );
  t.metal(mast(0.016, -0.17 * dish, 0.4 * dish), tip);

  // The mast, in bands of bare metal and paint, with two cross arms.
  const mx = 0.27 * w;
  const mz = 0.2 * d;
  const body = h - 0.07;
  const at = (y: number) => 0.062 - 0.04 * (y / body);
  const bands = [0, 0.3, 0.52, 0.76, 1].map((f) => f * body);
  t.trim(column(chamfered(0.3 * w, 0.3 * d, 0.02, mx, mz), 0, 0.025));
  bands.slice(0, -1).forEach((y0, i) => {
    const y1 = bands[i + 1];
    const part = column(
      rect(at(y0), at(y0), mx, mz),
      y0,
      y1,
      rect(at(y1), at(y1), mx, mz),
    );
    if (i % 2 === 0) t.metal(part);
    else t.accent(part);
  });
  t.metal(plate(0.2 * w, 0.012, 0.78 * body, 0.78 * body + 0.012, mx, mz));
  t.metal(plate(0.012, 0.16 * d, 0.9 * body, 0.9 * body + 0.012, mx, mz));
  t.smooth(tank(0.03, 0.6 * body, 0.6 * body + 0.06, mx + 0.04, mz, 8));
  t.metal(mast(0.02, body, h, mx, mz));
}

/* -------------------------------- presets -------------------------------- */

const model = (
  id: string,
  family: OutpostFamily,
  lots: [number, number],
  height: number,
  build: (t: Tools, w: number, d: number, h: number) => void,
  round = false,
): OutpostModel => ({
  id: `outpost-${id}`,
  family,
  lots,
  height,
  ...(round ? { round } : {}),
  build(b, w, d, paint) {
    build(tools(b, paint), w, d, height);
  },
});

export const OUTPOST_DOMES: OutpostModel[] = [
  model(
    "dome",
    "dome",
    [1, 1],
    0.3,
    (t, w, _d, h) => singleDome(t, w, h, false),
    true,
  ),
  model(
    "dome-high",
    "dome",
    [1, 1],
    0.45,
    (t, w, _d, h) => singleDome(t, w, h, true),
    true,
  ),
  model("dome-twin", "dome", [2, 1], 0.36, twinDomes),
  model("dome-wings", "dome", [2, 1], 0.42, wingedDome),
  model("dome-hall", "dome", [2, 2], 0.62, (t, w, d, h) =>
    greatDome(t, w, d, h, 0.46, 0.1, 0.085),
  ),
  model("dome-great", "dome", [2, 2], 0.9, (t, w, d, h) =>
    greatDome(t, w, d, h, 0.44, 0.2, 0.12),
  ),

  model("capsule-block", "capsule", [2, 1], 0.62, (t, w, d, h) =>
    capsuleBlock(t, w, d, h, 2),
  ),
  model("capsule-tall-block", "capsule", [2, 1], 0.95, (t, w, d, h) =>
    capsuleBlock(t, w, d, h, 4),
  ),
  model("capsule-stack", "capsule", [2, 2], 0.85, (t, w, d, h) =>
    capsuleCity(t, w, d, h, 3),
  ),
  model("capsule-great-stack", "capsule", [2, 2], 1.3, (t, w, d, h) =>
    capsuleCity(t, w, d, h, 5),
  ),

  model("utility-pad", "utility", [1, 1], 0.18, landingPad),
  model("utility-airlock", "utility", [1, 1], 0.22, airlockHut),
  model("utility-tanks", "utility", [1, 1], 0.26, tankFarm),
  model("utility-radiators", "utility", [1, 1], 0.3, radiatorArray),
  model("utility-mast", "utility", [1, 1], 0.4, commsMast),
];
