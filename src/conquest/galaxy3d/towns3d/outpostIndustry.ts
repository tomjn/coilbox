/**
 * A sealed outpost's industrial decks, perched fortresses and research
 * complexes. Each family is one building, written once as a function, and its
 * presets change its proportions and which of its features it carries.
 *
 * Every part is placed in the structure's own frame: x along the outpost's
 * axis, z across it, y up from the plate.
 */
import * as THREE from "three";
import {
  at,
  type Builder,
  faceOut,
  type Kind,
  type Rgb,
} from "../landmarks/kit";
import type { OutpostPaint } from "./outpostColourways";
import type { OutpostModel } from "./outposts";
import {
  beam,
  chamfered,
  column,
  loft,
  mast,
  type Pt,
  plate,
  rect,
  round,
  shouldered,
  type Xyz,
} from "./parts";

/** Adds a part. `ground` is set for a part that stands on the plate, which takes its dust. */
type Add = (g: THREE.BufferGeometry, ground?: boolean) => void;

/** The finishes a structure's parts are added in. */
interface Tools {
  /** Painted plate with seams: the main masses, and the masses set against them. */
  hull: Add;
  hull2: Add;
  /** The same two paints with no seams, for tanks and caps. */
  shell: Add;
  cap: Add;
  /** Smooth accent paint: tanks, stripes and bands. */
  accent: Add;
  trim: Add;
  metal: Add;
  glass: Add;
  stripe: Add;
}

const tools = (b: Builder, p: OutpostPaint): Tools => {
  const origin = at(0, 0, 0);
  const add =
    (colour: Rgb, kind: Kind, settles = true): Add =>
    (g, ground = false) =>
      b.add(g, colour, origin, {
        kind,
        ...(settles ? { top: p.top, topCover: p.topCover } : {}),
        ...(ground ? { stains: p.dust } : { clean: true }),
      });
  return {
    hull: add(p.hull, 11),
    hull2: add(p.hull2, 11),
    shell: add(p.hull, 12),
    cap: add(p.hull2, 12),
    accent: add(p.accent, 12),
    trim: add(p.trim, 7),
    metal: add(p.metal, 13),
    glass: add(p.glass, 3, false),
    stripe: add(p.stripe, 14, false),
  };
};

const model = (
  id: string,
  family: OutpostModel["family"],
  lots: [number, number],
  height: number,
  parts: (t: Tools, w: number, d: number, h: number) => void,
): OutpostModel => ({
  id,
  family,
  lots,
  height,
  build(b, w, d, paint) {
    parts(tools(b, paint), w, d, height);
  },
});

/* ------------------------------- parts ------------------------------- */

/** A block from `y0` to `y1` closed at both ends, for a part whose underside shows. */
const solid = (foot: Pt[], y0: number, y1: number, head: Pt[] = foot) =>
  loft(
    foot.map(([x, z]): Xyz => [x, y0, z]),
    head.map(([x, z]): Xyz => [x, y1, z]),
    true,
  );

/**
 * A profile of `u` and height pushed from `v0` to `v1`. `u` runs along x and
 * the push along z, or the other way round when `uIsX` is false.
 */
const extrude = (profile: Pt[], v0: number, v1: number, uIsX = true) => {
  const ring = (v: number) =>
    profile.map(([u, y]): Xyz => (uIsX ? [u, y, v] : [v, y, u]));
  return loft(ring(v0), ring(v1), true);
};

/** A block `sx` by `sz` with every edge cut back by `c`, so it reads as a rounded pod. */
function pod(
  add: Add,
  sx: number,
  sz: number,
  y0: number,
  y1: number,
  cx: number,
  cz: number,
  c: number,
): void {
  const full = chamfered(sx, sz, c, cx, cz);
  const small = chamfered(sx - 2 * c, sz - 2 * c, 0.4 * c, cx, cz);
  add(solid(small, y0, y0 + c, full));
  add(column(full, y0 + c, y1 - c));
  add(column(full, y1 - c, y1, small));
}

/** An upright tank of radius `r` under a domed cap. */
function tank(
  body: Add,
  cap: Add,
  r: number,
  y0: number,
  y1: number,
  cx: number,
  cz: number,
  n = 10,
): void {
  const ring = round(2 * r, 2 * r, n, cx, cz);
  const dome = 0.45 * r;
  body(column(ring, y0, y1 - dome));
  cap(column(ring, y1 - dome, y1, round(1.1 * r, 1.1 * r, n, cx, cz)));
}

/** A ladder up a wall at `x, z`. Its rails stand apart along x when `alongX` is set. */
function ladder(
  add: Add,
  x: number,
  z: number,
  y0: number,
  y1: number,
  alongX: boolean,
): void {
  const half = 0.016;
  for (const s of [-1, 1])
    add(
      plate(
        0.005,
        0.005,
        y0,
        y1,
        alongX ? x + s * half : x,
        alongX ? z : z + s * half,
      ),
    );
  const n = Math.max(2, Math.round((y1 - y0) / 0.03));
  for (let i = 1; i < n; i++) {
    const y = y0 + ((y1 - y0) * i) / n;
    add(
      plate(
        alongX ? 2 * half : 0.004,
        alongX ? 0.004 : 2 * half,
        y,
        y + 0.004,
        x,
        z,
      ),
    );
  }
}

/** A railing `hgt` high standing on `y`, along a line that runs along x or along z. */
function rail(
  add: Add,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  hgt: number,
): void {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 0.07));
  for (let i = 0; i <= n; i++)
    add(
      plate(
        0.005,
        0.005,
        y,
        y + hgt,
        x0 + ((x1 - x0) * i) / n,
        z0 + ((z1 - z0) * i) / n,
      ),
    );
  const wx = Math.abs(x1 - x0) + 0.005;
  const wz = Math.abs(z1 - z0) + 0.005;
  for (const top of [y + hgt, y + 0.55 * hgt])
    add(plate(wx, wz, top - 0.004, top, (x0 + x1) / 2, (z0 + z1) / 2));
}

/**
 * A profile of radius and height swept round `cx, cz` from bearing `a0` to
 * `a1` in `n` steps, closed at both ends. Bearing 0 looks along +z.
 */
function arc(
  profile: Pt[],
  cx: number,
  cz: number,
  a0: number,
  a1: number,
  n: number,
): THREE.BufferGeometry {
  const m = profile.length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    for (const [r, y] of profile)
      pos.push(cx + r * Math.sin(a), y, cz + r * Math.cos(a));
  }
  for (let i = 0; i < n; i++)
    for (let k = 0; k < m; k++) {
      const k2 = (k + 1) % m;
      const p = i * m + k;
      const q = i * m + k2;
      idx.push(p, q, p + m, q, q + m, p + m);
    }
  const last = n * m;
  for (let k = 1; k < m - 1; k++) {
    idx.push(last, last + k, last + k + 1);
    idx.push(0, k + 1, k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return faceOut(g);
}

/* --------------------------- industrial deck --------------------------- */

interface DeckOpts {
  /** The height of the roof deck. */
  hull: number;
  /** How many tank bays stand along each long side. */
  bays: number;
  /** Half the length of the hatch court. */
  court: number;
  /** The length of the control cabin at the +x end, or 0 for a pair of stacks. */
  cabin: number;
}

/** How deep a tank bay is cut into each long side. */
const BAY = 0.105;
/** How far the court floor lies below the roof. */
const SINK = 0.035;

/**
 * A low, wide hull. A hatch court is sunk in its roof inside a striped rim,
 * and tanks stand in bays between the corner piers of its two long sides.
 */
function deck(t: Tools, w: number, d: number, h: number, o: DeckOpts): void {
  const hw = w / 2;
  const hd = d / 2;
  const top = o.hull;
  const floor = top - SINK;
  const hz = hd - BAY;
  const hx = hw - 0.025;

  t.trim(column(chamfered(w, d, 0.025), 0, 0.022), true);

  // The hull is a frame of four blocks round the court's lower floor.
  const cx = -o.cabin / 2;
  const a = o.court;
  const c = hz - 0.05;
  for (const s of [-1, 1])
    t.hull(plate(2 * hx, hz - c, 0, top, 0, (s * (hz + c)) / 2), true);
  t.hull(plate(cx - a + hx, 2 * c, 0, top, (cx - a - hx) / 2, 0), true);
  t.hull(plate(hx - cx - a, 2 * c, 0, top, (cx + a + hx) / 2, 0), true);
  t.trim(plate(2 * a, 2 * c, 0, floor, cx, 0));

  // The court: cut corners, hatch doors on its floor and a striped rim.
  const cut = 0.04;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      t.hull(
        column(
          [
            [cx + sx * a, sz * c],
            [cx + sx * (a - cut), sz * c],
            [cx + sx * a, sz * (c - cut)],
          ],
          floor,
          top,
        ),
      );
  const doors = Math.max(2, Math.round((2 * a) / 0.14));
  const doorW = (2 * a - 0.05) / doors;
  for (let i = 0; i < doors; i++)
    t.hull2(
      plate(
        doorW - 0.012,
        2 * c - 0.06,
        floor,
        floor + 0.008,
        cx + (i - (doors - 1) / 2) * doorW,
        0,
      ),
    );
  for (const s of [-1, 1]) {
    t.stripe(
      plate(2 * a + 0.036, 0.018, top, top + 0.005, cx, s * (c + 0.009)),
    );
    t.stripe(plate(0.018, 2 * c, top, top + 0.005, cx + s * (a + 0.009), 0));
  }

  // Piers at the corners and between the bays, and the tanks between them.
  const pier = 0.085;
  const edge = 0.012;
  const bayD = hd - edge - hz;
  const reach = hw - edge - pier / 2;
  const sill = 0.28 * top;
  const xs = Array.from(
    { length: o.bays + 1 },
    (_, i) => -reach + (2 * reach * i) / o.bays,
  );
  const r = 0.036;
  for (const s of [-1, 1]) {
    const zc = s * (hz + bayD / 2);
    for (const x of xs)
      t.hull2(
        column(
          rect(pier, bayD, x, zc),
          0,
          top - 0.015,
          rect(pier - 0.03, bayD, x, zc),
        ),
        true,
      );
    for (let i = 0; i < o.bays; i++) {
      const x0 = xs[i] + pier / 2;
      const x1 = xs[i + 1] - pier / 2;
      t.hull2(plate(x1 - x0, bayD, 0, sill, (x0 + x1) / 2, zc), true);
      const n = Math.floor((x1 - x0) / (2 * r + 0.014));
      for (let k = 0; k < n; k++) {
        const x = x0 + ((k + 0.5) * (x1 - x0)) / n;
        const z = s * (hz + r + 0.008);
        tank(t.accent, t.cap, r, sill, 0.9 * top, x, z);
        t.trim(
          column(
            round(2.2 * r, 2.2 * r, 10, x, z),
            sill + 0.3 * (0.9 * top - sill),
            sill + 0.3 * (0.9 * top - sill) + 0.012,
          ),
        );
      }
    }
  }

  // The ends: a ladder between two fins at one, a door at the other.
  ladder(t.metal, -hx - 0.006, 0, 0.022, top + 0.02, false);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      t.hull2(
        extrude(
          [
            [sx * hx, 0.022],
            [sx * (hw - 0.002), 0.022],
            [sx * hx, 0.62 * top],
          ],
          sz * (c + 0.01),
          sz * (c + 0.032),
        ),
      );
  t.trim(plate(0.008, 0.11, 0.022, 0.6 * top, hx, 0));
  t.stripe(plate(0.012, 0.14, 0.6 * top, 0.6 * top + 0.016, hx, 0));

  rail(t.metal, -hx + 0.008, -hz + 0.01, -hx + 0.008, -0.03, top, 0.03);
  rail(t.metal, -hx + 0.008, 0.03, -hx + 0.008, hz - 0.01, top, 0.03);

  // A plate hatch at each end with room for one.
  for (const s of [-1, 1]) {
    const room = s < 0 ? cx - a + hx : hx - o.cabin - (cx + a);
    if (room < 0.2) continue;
    const x = s < 0 ? (cx - a - hx) / 2 : (cx + a + hx - o.cabin) / 2;
    t.hull2(plate(0.5 * room, 1.3 * c, top, top + 0.008, x, 0));
    t.stripe(plate(0.5 * room - 0.04, 0.02, top + 0.008, top + 0.011, x, 0));
  }

  if (o.cabin > 0) {
    // A control cabin over the door, glazed all round, under a mast.
    const cw = o.cabin - 0.02;
    const cd = 2 * hz - 0.03;
    const ccx = hx - 0.005 - cw / 2;
    const roof = h - 0.08;
    const k = Math.min(0.022, cw / 5);
    pod(t.hull2, cw, cd, top, roof, ccx, 0, k);
    const band = top + 0.5 * (roof - top);
    t.glass(
      column(chamfered(cw + 0.008, cd + 0.008, k, ccx, 0), band, band + 0.028),
    );
    t.accent(plate(0.5 * cw, 0.6 * cd, roof, roof + 0.008, ccx, 0));
    t.metal(mast(0.016, roof + 0.008, h, ccx + 0.12 * cw, 0.15 * cd));
    t.metal(mast(0.01, roof + 0.008, h - 0.03, ccx - 0.2 * cw, -0.2 * cd));
    rail(t.metal, hx - o.cabin, -hz + 0.01, hx - o.cabin, hz - 0.01, top, 0.03);
  } else {
    // Two stacks at the door end.
    for (const s of [-1, 1]) {
      const x = hx - 0.04;
      const z = s * 0.45 * hz;
      t.hull2(column(round(0.07, 0.07, 10, x, z), top, top + 0.02));
      t.trim(
        column(
          round(0.05, 0.05, 10, x, z),
          top,
          h,
          round(0.04, 0.04, 10, x, z),
        ),
      );
    }
    rail(t.metal, hx - 0.008, -0.2 * hz, hx - 0.008, 0.2 * hz, top, 0.03);
  }
}

/* --------------------------- perched fortress --------------------------- */

interface PodSpec {
  cx: number;
  cz: number;
  sx: number;
  sz: number;
  /** Foot and head, as shares of a tier's height above the tier's floor. */
  y0: number;
  y1: number;
  /** Painted in the second hull colour. */
  alt?: boolean;
  /** The way its outer face looks, or left out for a pod with none. */
  face?: [number, number];
}

interface FortressOpts {
  /** The height of the trestle's deck. */
  deck: number;
  /** The height of one tier of pods, and how many there are. */
  tier: number;
  tiers: number;
}

const POD_CUT = 0.035;
/** How far a pod's outer face stays inside the footprint, so its windows fit. */
const POD_EDGE = 0.012;

/** The pods of one tier. The first is the main pod, which the others hang off. */
const fortressPods = (hw: number, hd: number): PodSpec[] =>
  hw < 0.4
    ? [
        { cx: -0.02, cz: 0.01, sx: 0.3, sz: 0.3, y0: 0, y1: 0.85 },
        {
          cx: hw - POD_EDGE - 0.085,
          cz: -0.07,
          sx: 0.17,
          sz: 0.22,
          y0: 0.3,
          y1: 1,
          face: [1, 0],
        },
        {
          cx: -(hw - POD_EDGE - 0.075),
          cz: 0.05,
          sx: 0.15,
          sz: 0.26,
          y0: -0.25,
          y1: 0.55,
          alt: true,
          face: [-1, 0],
        },
        {
          cx: -0.06,
          cz: -(hd - POD_EDGE - 0.07),
          sx: 0.24,
          sz: 0.14,
          y0: 0.1,
          y1: 0.7,
          alt: true,
          face: [0, -1],
        },
        {
          cx: 0.04,
          cz: hd - POD_EDGE - 0.065,
          sx: 0.2,
          sz: 0.13,
          y0: 0.4,
          y1: 0.95,
          face: [0, 1],
        },
      ]
    : [
        { cx: 0, cz: 0, sx: 0.78, sz: 0.3, y0: 0, y1: 0.8 },
        {
          cx: hw - POD_EDGE - 0.13,
          cz: -0.03,
          sx: 0.26,
          sz: 0.34,
          y0: 0.25,
          y1: 1,
          face: [1, 0],
        },
        {
          cx: -(hw - POD_EDGE - 0.12),
          cz: 0.04,
          sx: 0.24,
          sz: 0.3,
          y0: -0.2,
          y1: 0.6,
          alt: true,
          face: [-1, 0],
        },
        {
          cx: -0.2,
          cz: -(hd - POD_EDGE - 0.07),
          sx: 0.3,
          sz: 0.14,
          y0: 0.1,
          y1: 0.7,
          alt: true,
          face: [0, -1],
        },
        {
          cx: 0.12,
          cz: hd - POD_EDGE - 0.065,
          sx: 0.34,
          sz: 0.13,
          y0: 0.35,
          y1: 0.95,
          face: [0, 1],
        },
        { cx: -0.1, cz: 0, sx: 0.3, sz: 0.24, y0: 0.7, y1: 1.15, alt: true },
      ];

/**
 * Pods cantilevered off a core that stands on a braced trestle. A ramp runs
 * from the plate up to the base between the trestle's legs.
 */
function fortress(
  t: Tools,
  w: number,
  d: number,
  h: number,
  o: FortressOpts,
): void {
  const hw = w / 2;
  const hd = d / 2;
  const long = hw > 0.4;
  const yT = o.deck;

  // The base, and the ramp up to it from the +x end.
  const baseY = 0.09;
  const bx = long ? 0.22 : 0.12;
  t.hull2(column(chamfered(2 * bx, 0.26, 0.03), 0, baseY), true);
  t.trim(plate(2 * bx - 0.06, 0.2, baseY, baseY + 0.012));
  const end = hw - 0.008;
  t.hull2(
    extrude(
      [
        [bx, 0],
        [end, 0],
        [bx, baseY],
      ],
      -0.07,
      0.07,
    ),
    true,
  );
  for (const s of [-1, 1])
    t.stripe(
      extrude(
        [
          [bx, baseY],
          [end, 0],
          [end, 0.007],
          [bx, baseY + 0.007],
        ],
        s * 0.07,
        s * 0.086,
      ),
    );

  // The trestle: splayed legs, braces across each face and a girder ring.
  const fz = hd - 0.04;
  const tz = 0.11;
  const cols = long
    ? [
        { f: -(hw - 0.04), t: -0.34 },
        { f: 0, t: 0 },
        { f: hw - 0.04, t: 0.34 },
      ]
    : [
        { f: -(hw - 0.04), t: -0.11 },
        { f: hw - 0.04, t: 0.11 },
      ];
  const leg = (i: number, sz: number, s: number): Xyz => [
    cols[i].f + (cols[i].t - cols[i].f) * s,
    yT * s,
    sz * (fz + (tz - fz) * s),
  ];
  const brace = (a: Xyz, b: Xyz) => t.metal(beam(a, b, 0.016, 0.016));
  const girder = 0.72;
  for (const sz of [-1, 1]) {
    for (let i = 0; i < cols.length; i++) {
      t.trim(plate(0.07, 0.07, 0, 0.014, cols[i].f, sz * fz), true);
      t.metal(beam(leg(i, sz, 0), leg(i, sz, 1), 0.04, 0.04));
    }
    for (let i = 0; i + 1 < cols.length; i++) {
      brace(leg(i, sz, 0.08), leg(i + 1, sz, girder));
      brace(leg(i + 1, sz, 0.08), leg(i, sz, girder));
      const p = leg(i, sz, girder);
      const q = leg(i + 1, sz, girder);
      t.metal(
        plate(
          q[0] - p[0],
          0.016,
          p[1] - 0.008,
          p[1] + 0.008,
          (p[0] + q[0]) / 2,
          p[2],
        ),
      );
    }
  }
  for (const i of [0, cols.length - 1]) {
    const p = leg(i, -1, girder);
    const q = leg(i, 1, girder);
    t.metal(plate(0.016, q[2] - p[2], p[1] - 0.008, p[1] + 0.008, p[0], 0));
    // The ramp comes in under the +x face, so only the far face is braced.
    if (i > 0) continue;
    brace(leg(i, -1, 0.08), leg(i, 1, girder));
    brace(leg(i, 1, 0.08), leg(i, -1, girder));
  }

  // The core and the deck the pods stand on.
  const tx = cols[cols.length - 1].t;
  const yP = yT + 0.03;
  t.trim(column(chamfered(long ? 0.4 : 0.16, 0.16, 0.03), baseY, yT));
  t.trim(solid(chamfered(2 * tx + 0.1, 2 * tz + 0.1, 0.04), yT, yP));

  const specs = fortressPods(hw, hd);
  let crown = { y: 0, x: 0, z: 0 };
  let mainTop = { y: 0, x: 0, z: 0 };
  for (let tier = 0; tier < o.tiers; tier++) {
    // Each tier is the one below turned half way round.
    const turn = tier % 2 === 0 ? 1 : -1;
    const y = yP + tier * o.tier;
    specs.forEach((p, i) => {
      const cx = turn * p.cx;
      const cz = turn * p.cz;
      const y0 = y + p.y0 * o.tier;
      const y1 = y + p.y1 * o.tier;
      pod(p.alt ? t.hull2 : t.hull, p.sx, p.sz, y0, y1, cx, cz, POD_CUT);
      // A dark hatch plate on the roof.
      t.trim(
        plate(
          p.sx - 2 * POD_CUT - 0.03,
          p.sz - 2 * POD_CUT - 0.03,
          y1,
          y1 + 0.006,
          cx,
          cz,
        ),
      );
      if (y1 + 0.006 > crown.y) crown = { y: y1 + 0.006, x: cx, z: cz };
      // On the long main pod the turret stands clear of the pod on its roof.
      if (i === 0) mainTop = { y: y1, x: long ? turn * 0.22 : cx, z: cz };
      if (!p.face) return;
      // A window slit and a painted band on the face that looks out.
      const fx = turn * p.face[0];
      const fz2 = turn * p.face[1];
      const wide = 0.6 * ((fx !== 0 ? p.sz : p.sx) - 2 * POD_CUT) + 0.03;
      const px = cx + (fx * p.sx) / 2;
      const pz = cz + (fz2 * p.sz) / 2;
      const sx = fx !== 0 ? 0.008 : wide;
      const sz = fx !== 0 ? wide : 0.008;
      const mid = y0 + 0.62 * (y1 - y0);
      t.glass(plate(sx, sz, mid, mid + 0.03, px, pz));
      const low = y0 + 0.3 * (y1 - y0);
      t.accent(plate(sx, sz, low, low + 0.022, px, pz));
      // A strut from the deck's edge up under a pod that hangs clear of it.
      if (y0 > y + 0.05)
        brace(
          [cx - fx * 0.5 * p.sx, y - 0.02, cz - fz2 * 0.5 * p.sz],
          [cx + fx * 0.2 * p.sx, y0 + 0.01, cz + fz2 * 0.2 * p.sz],
        );
    });
  }

  // A sensor turret on the main pod and masts on the highest.
  const { x: mx, z: mz, y: my } = mainTop;
  t.trim(column(round(0.1, 0.1, 10, mx, mz), my, my + 0.04));
  pod(t.hull2, 0.13, 0.08, my + 0.04, my + 0.085, mx + 0.01, mz, 0.015);
  t.glass(plate(0.008, 0.05, my + 0.052, my + 0.07, mx + 0.075, mz));
  t.metal(mast(0.02, crown.y, h, crown.x, crown.z));
  t.metal(mast(0.012, crown.y, h - 0.06, crown.x - 0.04, crown.z + 0.05));
  t.metal(mast(0.012, my, my + 0.6 * (h - my), mx - 0.09, mz - 0.08));
}

/* --------------------------- research complex --------------------------- */

interface ResearchOpts {
  /** The slab: its centre, its width along x and its thickness along z. */
  slab: { x: number; z: number; w: number; t: number };
  /** How far the mast stands above the slab. */
  mast: number;
  /** The block at the slab's shoulder: its length, and its height as a share of the slab's. */
  block: number;
  shoulder: number;
  /** How many tanks stand on the block in each of `rows` rows. */
  tanks: number;
  rows: number;
  /** The gallery: the centre it curves round, its outer radius, its width and half its sweep. */
  gallery: { cx: number; cz: number; r: number; width: number; half: number };
  /** Galleries stacked: one, or a shorter second above it. */
  tiers: number;
  /** A landing pad in the gallery's court. */
  pad?: boolean;
}

/**
 * A tall slab with round shoulders and painted stripes up both broad faces, a
 * lower block at its side carrying a cluster of tanks, and a gallery that
 * curves round its foot behind one long window.
 */
function research(t: Tools, h: number, o: ResearchOpts): void {
  const s = o.slab;
  const top = h - o.mast;
  const cut = 0.22 * s.w;
  t.hull(shouldered(s.w, 0, top, cut, s.z - s.t / 2, s.z + s.t / 2, s.x), true);

  // Up each broad face: a dark recess, a line of glass and two painted stripes.
  const y0 = 0.08 * top;
  const y1 = top - cut - 0.03;
  for (const f of [-1, 1]) {
    const z = s.z + (f * s.t) / 2;
    t.trim(plate(0.46 * s.w, 0.012, y0, y1, s.x, z));
    t.glass(plate(0.09 * s.w, 0.018, y0 + 0.03, y1 - 0.03, s.x, z));
    for (const side of [-1, 1])
      t.accent(
        plate(0.075 * s.w, 0.024, y0, y1 + 0.015, s.x + side * 0.15 * s.w, z),
      );
  }
  // A painted collar under the shoulders.
  t.accent(
    plate(s.w + 0.012, 0.5 * s.t, top - cut - 0.05, top - cut - 0.02, s.x, s.z),
  );

  // Plant on the roof: a housing, two small tanks and the mast.
  const flat = s.w - 2 * cut;
  t.hull2(plate(0.9 * flat, 0.6 * s.t, top, top + 0.04, s.x, s.z));
  for (const side of [-1, 1])
    tank(
      t.accent,
      t.cap,
      0.16 * flat,
      top + 0.04,
      top + 0.04 + 0.4 * o.mast,
      s.x + side * 0.24 * flat,
      s.z + side * 0.12 * s.t,
    );
  t.metal(mast(0.03, top + 0.04, h, s.x, s.z - 0.12 * s.t));

  // A buttress on the far side from the block.
  const bx = s.x - s.w / 2;
  t.hull2(
    column(
      rect(0.08, 0.7 * s.t, bx - 0.035, s.z),
      0,
      0.5 * top,
      rect(0.03, 0.7 * s.t, bx - 0.01, s.z),
    ),
    true,
  );

  // The block at the slab's shoulder, banded, and the tanks on it.
  const x0 = s.x + s.w / 2 - 0.02;
  const bw = o.block;
  const bd = 0.86 * s.t;
  const bcx = x0 + bw / 2;
  const roof = o.shoulder * top;
  const plan = chamfered(bw, bd, 0.035, bcx, s.z);
  t.hull2(column(plan, 0, roof), true);
  const ring = chamfered(bw + 0.008, bd + 0.008, 0.035, bcx, s.z);
  t.accent(column(ring, roof - 0.06, roof - 0.035));
  t.glass(column(ring, 0.55 * roof, 0.55 * roof + 0.04));
  t.trim(plate(bw - 0.05, bd - 0.05, roof, roof + 0.012, bcx, s.z));
  const cell = (bw - 0.04) / o.tanks;
  const r = Math.min(0.055, cell / 2 - 0.006, bd / (2 * o.rows) - 0.012);
  const tall = 0.34 * top;
  for (let row = 0; row < o.rows; row++)
    for (let i = 0; i < o.tanks; i++) {
      const x = x0 + 0.02 + (i + 0.5) * cell;
      const z = s.z + ((row - (o.rows - 1) / 2) * bd) / o.rows;
      const foot = roof + 0.012;
      const head = foot + tall * (1 - 0.14 * ((i + row) % 2));
      t.trim(column(round(1.3 * r, 1.3 * r, 8, x, z), foot, foot + 0.04));
      tank(t.shell, t.cap, r, foot + 0.04, head, x, z, 14);
      for (const share of [0.25, 0.7]) {
        const y = foot + 0.04 + share * (head - foot - 0.04);
        t.accent(column(round(2.14 * r, 2.14 * r, 14, x, z), y, y + 0.03));
      }
      t.trim(column(round(0.7 * r, 0.7 * r, 8, x, z), head, head + 0.025));
    }

  // The gallery: a low base, the hull over it, and a second shorter one above.
  const g = o.gallery;
  const ri = g.r - g.width;
  const steps = Math.max(8, Math.round((2 * g.half * g.r) / 0.11));
  const sweep = (profile: Pt[], half = g.half, n = steps) =>
    arc(profile, g.cx, g.cz, -half, half, n);
  const low = 0.085;
  t.hull2(
    sweep([
      [ri + 0.025, 0],
      [g.r - 0.022, 0],
      [g.r - 0.022, low],
      [ri + 0.025, low],
    ]),
    true,
  );
  const tier = (
    y: number,
    up: number,
    outer: number,
    half: number,
    add: Add,
  ) => {
    const k = 0.03;
    const n = Math.max(6, Math.round((steps * half) / g.half));
    add(
      sweep(
        [
          [ri, y],
          [outer - k, y],
          [outer, y + k],
          [outer, up - k],
          [outer - k, up],
          [ri, up],
        ],
        half,
        n,
      ),
    );
    const band = (a: number, b: number, proud: number): Pt[] => [
      [outer - 0.005, y + a * (up - y)],
      [outer + proud, y + a * (up - y)],
      [outer + proud, y + b * (up - y)],
      [outer - 0.005, y + b * (up - y)],
    ];
    t.glass(sweep(band(0.45, 0.76, 0.004), half - 0.03, n));
    t.accent(sweep(band(0.24, 0.36, 0.003), half - 0.03, n));
    t.hull2(
      sweep(
        [
          [ri + 0.03, up],
          [outer - 0.04, up],
          [outer - 0.04, up + 0.012],
          [ri + 0.03, up + 0.012],
        ],
        half - 0.02,
        n,
      ),
    );
  };
  const up = low + 0.17;
  tier(low, up, g.r, g.half, t.hull);
  if (o.tiers > 1)
    tier(up + 0.012, up + 0.14, g.r - 0.035, 0.55 * g.half, t.hull);

  // A round tower closes each end of the gallery.
  const rm = g.r - g.width / 2;
  for (const side of [-1, 1]) {
    const x = g.cx + side * rm * Math.sin(g.half);
    const z = g.cz + rm * Math.cos(g.half);
    const drum = round(g.width, g.width, 12, x, z);
    t.shell(column(drum, 0, up + 0.03), true);
    t.accent(
      column(round(g.width + 0.008, g.width + 0.008, 12, x, z), up - 0.03, up),
    );
    t.cap(
      column(
        drum,
        up + 0.03,
        up + 0.06,
        round(0.5 * g.width, 0.5 * g.width, 12, x, z),
      ),
    );
  }

  // A spine from the slab's foot to the gallery, under a glass roof.
  const zf = s.z + s.t / 2;
  const zg = g.cz + Math.sqrt(ri * ri - (s.x - g.cx) ** 2) + 0.03;
  if (zg > zf) {
    t.hull2(plate(0.16, zg - zf, 0, 0.17, s.x, (zf + zg) / 2), true);
    t.glass(plate(0.08, zg - zf - 0.03, 0.17, 0.178, s.x, (zf + zg) / 2));
  }

  if (o.pad) {
    const px = s.x + 0.3;
    const pz = (zf + zg) / 2;
    t.stripe(column(round(0.26, 0.26, 16, px, pz), 0, 0.012), true);
    t.trim(column(round(0.21, 0.21, 16, px, pz), 0, 0.016));
    t.accent(plate(0.1, 0.022, 0.016, 0.019, px, pz));
    t.accent(plate(0.022, 0.1, 0.016, 0.019, px, pz));
  }
}

/** A gallery bowed gently along the front of a lot one deep. */
const bow = (w: number, d: number) => {
  const r = 1;
  const width = 0.15;
  return {
    cx: 0,
    cz: d / 2 - 0.008 - r,
    r,
    width,
    half: Math.asin((w / 2 - 0.006 - width / 2) / (r - width / 2)),
  };
};

/** A gallery curved more than half way round a court, on a lot two deep. */
const ringed = (d: number) => {
  const r = 0.6;
  return { cx: 0, cz: d / 2 - 0.02 - r, r, width: 0.16, half: 1.75 };
};

export const OUTPOST_INDUSTRY: OutpostModel[] = [
  /* --------------------------- industrial deck --------------------------- */

  // The plain deck: one bay of tanks a side and two stacks.
  model("outpost-deck", "deck", [1, 1], 0.22, (t, w, d, h) =>
    deck(t, w, d, h, { hull: 0.16, bays: 1, court: 0.15, cabin: 0 }),
  ),
  // A taller deck with a control cabin over its door.
  model("outpost-deck-cabin", "deck", [1, 1], 0.36, (t, w, d, h) =>
    deck(t, w, d, h, { hull: 0.2, bays: 1, court: 0.11, cabin: 0.14 }),
  ),
  // A long deck: two bays a side and a hatch at each end of its court.
  model("outpost-deck-long", "deck", [2, 1], 0.27, (t, w, d, h) =>
    deck(t, w, d, h, { hull: 0.19, bays: 2, court: 0.3, cabin: 0 }),
  ),
  // The works: the long deck built higher, with a deckhouse at one end.
  model("outpost-deck-works", "deck", [2, 1], 0.44, (t, w, d, h) =>
    deck(t, w, d, h, { hull: 0.24, bays: 2, court: 0.26, cabin: 0.34 }),
  ),

  /* --------------------------- perched fortress --------------------------- */

  model("outpost-fortress", "fortress", [1, 1], 0.85, (t, w, d, h) =>
    fortress(t, w, d, h, { deck: 0.32, tier: 0.36, tiers: 1 }),
  ),
  // Two tiers of pods on a taller trestle.
  model("outpost-fortress-tall", "fortress", [1, 1], 1.3, (t, w, d, h) =>
    fortress(t, w, d, h, { deck: 0.42, tier: 0.36, tiers: 2 }),
  ),
  // A long battery of pods on three pairs of legs.
  model("outpost-fortress-battery", "fortress", [2, 1], 1.05, (t, w, d, h) =>
    fortress(t, w, d, h, { deck: 0.4, tier: 0.42, tiers: 1 }),
  ),
  model("outpost-fortress-keep", "fortress", [2, 1], 1.6, (t, w, d, h) =>
    fortress(t, w, d, h, { deck: 0.52, tier: 0.42, tiers: 2 }),
  ),

  /* --------------------------- research complex --------------------------- */

  model("outpost-research", "research", [2, 1], 1.45, (t, w, d, h) =>
    research(t, h, {
      slab: { x: -0.2, z: -0.095, w: 0.44, t: 0.26 },
      mast: 0.2,
      block: 0.34,
      shoulder: 0.45,
      tanks: 3,
      rows: 1,
      gallery: bow(w, d),
      tiers: 1,
    }),
  ),
  // A taller slab over two galleries.
  model("outpost-research-tall", "research", [2, 1], 1.9, (t, w, d, h) =>
    research(t, h, {
      slab: { x: -0.2, z: -0.095, w: 0.44, t: 0.26 },
      mast: 0.22,
      block: 0.4,
      shoulder: 0.5,
      tanks: 4,
      rows: 1,
      gallery: bow(w, d),
      tiers: 2,
    }),
  ),
  // The campus: a broad slab, and a gallery curved round a court with a pad.
  model("outpost-research-campus", "research", [2, 2], 2.1, (t, _w, d, h) =>
    research(t, h, {
      slab: { x: -0.1, z: -0.36, w: 0.56, t: 0.34 },
      mast: 0.25,
      block: 0.38,
      shoulder: 0.42,
      tanks: 3,
      rows: 2,
      gallery: ringed(d),
      tiers: 1,
      pad: true,
    }),
  ),
  model("outpost-research-great", "research", [2, 2], 2.6, (t, _w, d, h) =>
    research(t, h, {
      slab: { x: -0.1, z: -0.36, w: 0.6, t: 0.36 },
      mast: 0.3,
      block: 0.38,
      shoulder: 0.5,
      tanks: 4,
      rows: 2,
      gallery: ringed(d),
      tiers: 2,
      pad: true,
    }),
  ),
];
