/**
 * The spire: the other form a run's last stop can take, in place of the
 * stronghold. A dark core stands inside a ring of tall plates with rounded
 * heads. Four of the plates sweep out at the foot into buttresses, and the
 * whole stands on a round cast hardstand.
 *
 * Like a depot it is painted metal and wears the same paint on every planet,
 * from {@link SPIRE_LIVERIES}. Only the hardstand's stone and what settles on
 * top are the planet's. It is a megastructure seen from orbit, so nothing on
 * it is small enough to read as a window, a door or a vehicle. Built with a
 * buttress along +x.
 */
import * as THREE from "three";
import { loft } from "./anomalyParts";
import {
  at,
  Builder,
  type BuiltLandmark,
  box,
  faceOut,
  on,
  type Paint,
  polar,
  seeded,
  shaft,
  TAU,
} from "./kit";
import type { SpireLivery, SpirePalette } from "./palettes";

/** The hardstand's radius at its top, and how far its foot spreads past that. */
const PLINTH_R = 2.05;
const PLINTH_SPREAD = 0.1;
/** How far the spire reaches from its origin: the foot of its hardstand. */
export const SPIRE_REACH = 2.2;
/** How far the hardstand stands above the highest ground under it. */
const PLINTH_LIFT = 0.05;
/** How far it goes down below the lowest. */
const PLINTH_FOOT = 0.2;

/** The dark core's radius. */
const CORE_R = 0.72;
/** How far out the middle of each plate stands. */
const RING_R = 0.8;
/** The top of the tallest plates, above the hardstand. */
const TOP = 4.0;
/** Where a buttress leaves the upright and starts to sweep out. */
const KNEE = 1.6;
/** How far out past the ring a buttress's toe lands. */
const FOOT_OUT = 1.1;
/** How far the toe goes down into the hardstand. */
const TOE_SINK = 0.06;
/** The top of the dark hall the plates stand over. */
const HALL_TOP = 1.2;

export interface Spire {
  built: BuiltLandmark;
}

const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const ACROSS = vec(0, 0, 1);

/** One cut through a plate: where its middle is, how wide and how thick. */
interface Station {
  x: number;
  y: number;
  /** Half its width, across the bearing it stands on. */
  a: number;
  /** Half its thickness. */
  b: number;
}

/**
 * A plate through stations in the plane of +x and +y. It bends with the line
 * the stations follow, so its faces stay square to it.
 */
function plate(stations: Station[], segs = 20): THREE.BufferGeometry {
  const n = stations.length;
  return loft(
    n,
    segs,
    (t) => {
      const i = Math.round(t * (n - 1));
      const s = stations[i];
      const from = stations[Math.max(0, i - 1)];
      const to = stations[Math.min(n - 1, i + 1)];
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      return {
        c: vec(s.x, s.y, 0),
        ua: ACROSS,
        ub: vec((to.y - from.y) / len, -(to.x - from.x) / len, 0),
        a: s.a,
        b: s.b,
        r: Math.min(s.a, s.b) * 0.6,
      };
    },
    undefined,
    { caps: 2 },
  );
}

/** An upright run of stations from `y0` to `y1`. */
const upright = (
  x: number,
  y0: number,
  y1: number,
  a: number,
  b: number,
  n: number,
): Station[] =>
  Array.from({ length: n }, (_, j) => ({
    x,
    y: y0 + ((y1 - y0) * j) / (n - 1),
    a,
    b,
  }));

/**
 * A rounded end: the stations past `y0` that narrow a plate to nothing along
 * a quarter circle, going up for `up` 1 and down for -1.
 */
const arch = (
  x: number,
  y0: number,
  a: number,
  b: number,
  up: 1 | -1,
  n = 7,
): Station[] =>
  Array.from({ length: n }, (_, j) => {
    const f = (((j + 1) / n) * Math.PI) / 2;
    return {
      x,
      y: y0 + up * a * Math.sin(f),
      a: Math.max(0.02, a * Math.cos(f)),
      b,
    };
  });

/** A plate with a rounded end top and bottom, `y0` to `y1` over all. */
const capsule = (x: number, y0: number, y1: number, a: number, b: number) =>
  plate([
    ...arch(x, y0 + a, a, b, -1).reverse(),
    ...upright(x, y0 + a, y1 - a, a, b, 6),
    ...arch(x, y1 - a, a, b, 1),
  ]);

/**
 * The middle of a buttress, `s` of the way from its knee to its toe: nearly
 * upright where it leaves the ring, and flattening as it reaches the ground.
 */
const footAt = (s: number): [number, number] => [
  RING_R + FOOT_OUT * s ** 2.5,
  KNEE * (1 - s) - TOE_SINK * s,
];

/** The stations of a buttress from `s0` down at the toe to `s1` up at the knee. */
const footRun = (s0: number, s1: number, n: number, grow = 0): Station[] =>
  Array.from({ length: n }, (_, j) => {
    const s = s0 + ((s1 - s0) * j) / (n - 1);
    const [x, y] = footAt(s);
    return { x, y, a: 0.3 + 0.04 * s + grow, b: 0.07 + 0.03 * s + grow };
  });

/** The wall that fills in under a buttress, between it and the hall. */
function web(halfWidth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(CORE_R, -TOE_SINK);
  shape.lineTo(CORE_R, KNEE);
  const steps = 14;
  for (let j = 0; j <= steps; j++) shape.lineTo(...footAt(j / steps));
  return new THREE.ExtrudeGeometry(shape, {
    depth: halfWidth * 2,
    bevelEnabled: false,
  }).translate(0, 0, -halfWidth);
}

/**
 * A round slab standing on y = 0, wider at its foot. Its top is cut into
 * rings, so what settles on it has vertices to land on.
 */
function slab(r: number, h: number, rFoot: number, sides = 40) {
  const rings = 8;
  const profile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(rFoot, 0),
    ...Array.from(
      { length: rings + 1 },
      (_, i) => new THREE.Vector2((r * (rings - i)) / rings, h),
    ),
  ];
  return faceOut(new THREE.LatheGeometry(profile, sides));
}

/**
 * Build the spire round its origin. `ground` is the terrain's height under a
 * point, less the height at the origin.
 */
export function buildSpire(
  ground: (x: number, z: number) => number,
  p: SpirePalette,
  livery: SpireLivery,
  seed: number,
): Spire {
  const b = new Builder();
  const rand = seeded(seed);

  const settled = { top: p.top, topCover: p.topCover * 0.4 };
  /** Painted plate with seams, standing on the hardstand. */
  const panel: Paint = { kind: 11, ...settled };
  /** The same, on a part that stands on another. */
  const fitted: Paint = { kind: 11, clean: true, ...settled };
  /** Painted with no seams: a band, a lid. */
  const band: Paint = { kind: 12, clean: true, ...settled };
  const bare: Paint = { kind: 13, clean: true };

  // The hardstand: level with the highest ground under it, so no slope rises
  // through it, and deep enough to show a wall on the downhill side.
  let lo = ground(0, 0);
  let hi = lo;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU;
    for (const r of [PLINTH_R * 0.5, PLINTH_R]) {
      const g = ground(r * Math.cos(a), r * Math.sin(a));
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
  }
  const floor = hi + PLINTH_LIFT;
  const foot = lo - PLINTH_FOOT;
  b.add(
    slab(PLINTH_R, floor - foot, PLINTH_R + PLINTH_SPREAD),
    p.pad,
    at(0, foot, 0),
    { kind: 8, top: p.top, topCover: p.topCover },
  );
  const F = at(0, floor, 0);
  /** A placement on bearing `a`, its +x pointing out from the middle. */
  const bearing = (a: number) => on(F, 0, 0, 0, -a);

  // The core, and the dark hall round its foot.
  b.add(shaft(CORE_R, CORE_R, TOP - 0.1, 24), livery.core, F, fitted, "tower");
  b.add(
    shaft(0.9, 0.9, HALL_TOP, 8).rotateY(Math.PI / 8),
    livery.core,
    F,
    panel,
  );

  for (let k = 0; k < 4; k++) {
    // A buttress, and the plate it carries up the core.
    const A = bearing((k * TAU) / 4);
    b.add(web(0.2), livery.core, A, panel);
    b.add(
      plate([
        ...footRun(1, 0, 18),
        ...upright(RING_R, KNEE + 0.15, TOP - 0.3, 0.3, 0.07, 8),
        ...arch(RING_R, TOP - 0.3, 0.3, 0.07, 1),
      ]),
      livery.hull,
      A,
      panel,
    );
    // A band across the buttress, and a second plate over the upper half.
    b.add(plate(footRun(0.6, 0.5, 4, 0.012)), livery.accent, A, band);
    b.add(capsule(0.905, 2.3, 3.8, 0.33, 0.035), livery.hull2, A, fitted);
    b.add(box(0.26, 0.07, 0.22, 0.01), livery.core, on(A, 0.82, 1.95, 0), bare);

    // Between two buttresses: a shorter plate, rounded at both ends, with a
    // band round it, and two painted strips on the hall's face below.
    const B = bearing(((k + 0.5) * TAU) / 4);
    b.add(
      capsule(RING_R, HALL_TOP + 0.1, TOP - 0.15, 0.2, 0.06),
      livery.hull,
      B,
      fitted,
    );
    b.add(
      plate(upright(RING_R, 2.9, 3.02, 0.21, 0.07, 2)),
      livery.accent,
      B,
      band,
    );
    for (const side of [-1, 1])
      b.add(
        box(0.03, 0.75, 0.06),
        livery.accent,
        on(B, 0.83, 0.2, side * 0.13),
        band,
      );
    // On most of the open ground between them, a low drum.
    if (rand() < 0.75) {
      const r = 0.2 + rand() * 0.14;
      const h = 0.1 + rand() * 0.06;
      const D = F.clone().multiply(polar(1.42, ((k + 0.5) * TAU) / 4));
      b.add(shaft(r * 1.06, r, h, 16), livery.hull2, D, panel);
      b.add(shaft(r * 0.7, r * 0.7, 0.02, 16), p.metal, on(D, 0, h, 0), bare);
    }
  }

  // The crown: a dark cap inside the plates' heads, a lid and three masts.
  const C = on(F, 0, TOP - 0.1, 0);
  b.add(shaft(0.6, 0.5, 0.3, 16), livery.core, C, fitted, "tower");
  b.add(
    shaft(0.36, 0.3, 0.1, 12),
    livery.hull2,
    on(C, 0, 0.3, 0),
    band,
    "tower",
  );
  const turn = rand() * TAU;
  [0.62, 0.42, 0.3].forEach((h, k) => {
    const M = on(C, 0, 0.4, 0).multiply(polar(0.2, turn + (k * TAU) / 3));
    const tall = h + rand() * 0.1;
    b.add(shaft(0.014, 0.005, tall, 5), p.metal, M, bare, "mast");
    b.add(
      box(0.008, 0.008, 0.06),
      p.metal,
      on(M, 0, tall * 0.7, 0),
      bare,
      "mast",
    );
    if (k === 0)
      b.glow(box(0.012, 0.012, 0.012), [255, 84, 54], on(M, 0, tall, 0), 1.2);
  });

  return { built: b.build() };
}
