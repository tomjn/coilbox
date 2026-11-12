/**
 * A sealed outpost's stacked towers, spires and saucer towers: the tall end
 * of an outpost and its centrepieces. Each family is one design, and its
 * presets change the proportions and how much hangs off it.
 */
import type * as THREE from "three";
import { at, type Builder, type Kind, type Rgb, TAU } from "../landmarks/kit";
import type { OutpostPaint } from "./outpostColourways";
import type { OutpostModel } from "./outposts";
import {
  beam,
  chamfered,
  column,
  loft,
  mast,
  plate,
  round,
  type Xyz,
} from "./parts";

/** Adds one part. `grounded` parts take grime at their foot. */
type Put = (
  g: THREE.BufferGeometry,
  colour: Rgb,
  kind: Kind,
  place?: THREE.Matrix4,
  grounded?: boolean,
) => void;

const HERE = at(0, 0, 0);
const turn = (a: number) => at(0, 0, 0, a);
/** The four faces of a square tower. */
const FACES = [0, 1, 2, 3].map((k) => turn((k * Math.PI) / 2));

const putter =
  (b: Builder, paint: OutpostPaint): Put =>
  (g, colour, kind, place = HERE, grounded = false) =>
    b.add(g, colour, place, {
      kind,
      top: paint.top,
      topCover: paint.topCover,
      stains: paint.dust,
      clean: !grounded,
    });

/**
 * A fin standing on `y0` along +x from `r0` to `r1`, `t` thick. Its top edge
 * runs from `yIn` at the near end down to `yOut` at the far one.
 */
function fin(
  r0: number,
  r1: number,
  y0: number,
  yIn: number,
  yOut: number,
  t: number,
): THREE.BufferGeometry {
  const ring = (r: number, y: number): Xyz[] => [
    [r, y0, -t / 2],
    [r, y0, t / 2],
    [r, y, t / 2],
    [r, y, -t / 2],
  ];
  return loft(ring(r0, yIn), ring(r1, yOut), true);
}

/** An upright tank of radius `r` with a coned end top and bottom. */
function tank(
  put: Put,
  colour: Rgb,
  r: number,
  y0: number,
  y1: number,
  cx: number,
  cz: number,
): void {
  const cap = Math.min(0.8 * r, (y1 - y0) / 4);
  const wide = round(2 * r, 2 * r, 8, cx, cz);
  const narrow = round(r, r, 8, cx, cz);
  put(column(narrow, y0, y0 + cap, wide), colour, 12);
  put(column(wide, y0 + cap, y1 - cap), colour, 12);
  put(column(wide, y1 - cap, y1, narrow), colour, 12);
}

/* ------------------------------ stacked ------------------------------- */

interface StackedShape {
  id: string;
  height: number;
  segments: number;
  /** The segment from which the tower steps in, or none. */
  setback?: number;
  /** A mast on the roof, which the height includes. */
  mast?: boolean;
}

/**
 * A tower of panelled segments, each on a dark neck under a painted band.
 * Two faces of a segment are window grids and two are braced panels, the
 * braces a diagonal on one segment and a chevron on the next.
 */
function stacked(shape: StackedShape): OutpostModel {
  const { id, height, segments } = shape;
  return {
    id,
    family: "stacked",
    lots: [1, 1],
    height,
    build(b, w, d, paint) {
      const m = Math.min(w, d);
      const put = putter(b, paint);
      const base = 0.07;
      const neck = 0.025;
      const band = 0.03;
      const top = height - (shape.mast ? 0.34 : 0.12);
      const seg = (top - base) / segments;
      const proud = 0.025 * m;

      put(
        column(
          chamfered(m, m, 0.08 * m),
          0,
          0.04,
          chamfered(0.96 * m, 0.96 * m, 0.08 * m),
        ),
        paint.hull2,
        11,
        HERE,
        true,
      );
      put(
        column(chamfered(0.92 * m, 0.92 * m, 0.07 * m), 0.04, base),
        paint.stripe,
        14,
      );

      let bw = 0;
      for (let i = 0; i < segments; i++) {
        const stepped = shape.setback !== undefined && i >= shape.setback;
        bw = 0.8 * m * (stepped ? 0.84 : 1) * (i % 2 === 1 ? 0.94 : 1);
        const y0 = base + i * seg;
        const ya = y0 + neck;
        const yb = y0 + seg - band;
        const rise = yb - ya;
        const pier = 0.2 * bw;
        const edge = bw / 2 + proud - pier / 2;
        const zf = bw / 2;
        // Half the span of a face between its corner piers.
        const a = bw / 2 + proud - pier;

        put(
          column(chamfered(0.86 * bw, 0.86 * bw, 0.05 * bw), y0, ya),
          paint.trim,
          7,
        );
        put(column(chamfered(bw, bw, 0.05 * bw), ya, yb), paint.hull, 11);
        put(
          column(
            chamfered(bw + 0.08 * m, bw + 0.08 * m, 0.05 * bw),
            yb,
            yb + band,
          ),
          paint.accent,
          11,
        );
        for (const sx of [-1, 1])
          for (const sz of [-1, 1])
            put(
              plate(pier, pier, ya, yb, sx * edge, sz * edge),
              // Painted and plain segments take turns up the tower.
              i % 2 === 0 ? paint.accent : paint.hull,
              11,
            );

        FACES.forEach((face, k) => {
          if (k % 2 === 0) {
            // A window grid either side of a painted mullion.
            put(
              plate(2 * a, 0.024 * m, ya + 0.12 * rise, yb - 0.1 * rise, 0, zf),
              paint.glass,
              3,
              face,
            );
            put(
              plate(0.1 * bw, 0.04 * m, ya, yb, 0, zf),
              paint.accent,
              11,
              face,
            );
            return;
          }
          // A dark panel behind painted braces.
          put(plate(2 * a, 0.016 * m, ya, yb, 0, zf), paint.trim, 7, face);
          const bx = 0.1 * bw;
          const reach = a - bx / 2;
          const side = Math.floor(i / 2) % 2 === 0 ? 1 : -1;
          const brace = (x0: number, x1: number) =>
            put(
              beam([x0, ya, zf], [x1, yb, zf], bx, 0.04 * m),
              paint.accent,
              11,
              face,
            );
          if (i % 2 === 0) brace(-side * reach, side * reach);
          else {
            brace(-reach, 0);
            brace(reach, 0);
          }
        });
      }

      // The roof: a dark parapet, plant and, on some, a mast.
      const roof = top + 0.03;
      const plant = shape.mast ? roof + 0.07 : height;
      put(column(chamfered(bw, bw, 0.05 * bw), top, roof), paint.trim, 7);
      put(
        plate(0.46 * bw, 0.36 * bw, roof, plant, -0.14 * bw, 0.12 * bw),
        paint.hull2,
        11,
      );
      put(
        column(
          round(0.2 * bw, 0.2 * bw, 8, 0.22 * bw, -0.2 * bw),
          roof,
          roof + 0.06,
        ),
        paint.accent,
        12,
      );
      put(
        plate(0.5 * bw, 0.1 * bw, roof, roof + 0.03, -0.14 * bw, -0.26 * bw),
        paint.metal,
        13,
      );
      if (shape.mast) {
        put(
          plate(0.14 * bw, 0.14 * bw, roof, roof + 0.1, 0.2 * bw, 0.2 * bw),
          paint.trim,
          7,
        );
        put(
          mast(0.07 * m, roof + 0.1, height, 0.2 * bw, 0.2 * bw),
          paint.metal,
          13,
        );
      }
    },
  };
}

/* ------------------------------- spire -------------------------------- */

interface SpireShape {
  id: string;
  height: number;
  /** How wide the shaft is at its foot and at its tip, as a share of the lot. */
  foot: number;
  tip: number;
  /** How many lengths the shaft is built in. */
  lengths: number;
  /** Four fins against its faces, or eight with four more against its corners. */
  fins: 4 | 8;
  /** How far up the shaft the fins reach, as a share of the height. */
  finTop: number;
  /** Slim towers against the shaft's corners: the corner and how high each stands. */
  risers: [number, number][];
}

/**
 * A tall shaft that narrows all the way up, lines of windows up each face,
 * buttress fins sweeping out from its foot and a pair of masts at its tip.
 */
function spire(shape: SpireShape): OutpostModel {
  const { id, height: h } = shape;
  return {
    id,
    family: "spire",
    lots: [2, 2],
    height: h,
    landmark: true,
    build(b, w, d, paint) {
      const m = Math.min(w, d);
      const put = putter(b, paint);
      const plan = (s: number) => chamfered(s, s, 0.24 * s);
      const apron = 0.06;
      const y0 = 0.235;
      const yTop = 0.87 * h;
      const collar = 0.035;
      /** The shaft's width at a height. */
      const size = (y: number) =>
        (shape.foot + ((shape.tip - shape.foot) * (y - y0)) / (yTop - y0)) * m;

      put(
        column(
          chamfered(0.98 * m, 0.98 * m, 0.26 * m),
          0,
          apron,
          chamfered(0.92 * m, 0.92 * m, 0.25 * m),
        ),
        paint.hull2,
        11,
        HERE,
        true,
      );
      put(
        column(
          chamfered(0.68 * m, 0.68 * m, 0.17 * m),
          apron,
          0.2,
          chamfered(0.6 * m, 0.6 * m, 0.15 * m),
        ),
        paint.hull,
        11,
        HERE,
        true,
      );
      put(
        column(chamfered(0.62 * m, 0.62 * m, 0.155 * m), 0.2, y0),
        paint.stripe,
        14,
      );

      for (let i = 0; i < shape.lengths; i++) {
        const ya = y0 + (i / shape.lengths) * (yTop - y0);
        const yc = y0 + ((i + 1) / shape.lengths) * (yTop - y0);
        const yb = yc - collar;
        const sa = size(ya);
        const sb = size(yb);
        const last = i === shape.lengths - 1;
        put(
          column(plan(sa), ya, yb, plan(sb)),
          last ? paint.hull2 : paint.hull,
          11,
        );
        put(
          column(plan(sb + 0.05 * m), yb, yc),
          i % 2 === 1 ? paint.accent : paint.trim,
          i % 2 === 1 ? 11 : 7,
        );
        // Two lines of windows up each face, leaning in with it.
        for (const face of FACES)
          for (const off of [-0.16, 0.16])
            put(
              beam(
                [off * sa, ya + 0.03, sa / 2],
                [off * sb, yb - 0.03, sb / 2],
                0.15 * sb,
                0.02 * m,
              ),
              paint.glass,
              3,
              face,
            );
      }

      // Buttress fins, each steep against the shaft and shallow at its foot.
      const yFin = shape.finTop * h;
      const inside = 0.3 * shape.foot * m;
      for (const face of FACES) {
        put(
          fin(inside, 0.32 * m, apron, yFin, 0.28 * yFin, 0.055 * m),
          paint.accent,
          11,
          face,
        );
        put(
          fin(0.32 * m, 0.47 * m, apron, 0.28 * yFin, 0.14, 0.055 * m),
          paint.accent,
          11,
          face,
        );
        put(
          fin(0.3 * m, 0.48 * m, apron, 0.11, 0.11, 0.09 * m),
          paint.trim,
          7,
          face,
        );
      }
      if (shape.fins === 8)
        for (let k = 0; k < 4; k++) {
          const corner = turn(Math.PI / 4 + (k * Math.PI) / 2);
          put(
            fin(inside, 0.3 * m, apron, 0.62 * yFin, 0.2 * yFin, 0.045 * m),
            paint.hull2,
            11,
            corner,
          );
          put(
            fin(0.3 * m, 0.43 * m, apron, 0.2 * yFin, 0.12, 0.045 * m),
            paint.hull2,
            11,
            corner,
          );
        }

      shape.risers.forEach(([corner, top]) => {
        const sx = corner % 2 === 0 ? 1 : -1;
        const sz = corner < 2 ? 1 : -1;
        const x = sx * 0.19 * m;
        const z = sz * 0.19 * m;
        const yr = top * h;
        put(
          column(
            chamfered(0.15 * m, 0.15 * m, 0.035 * m, x, z),
            apron,
            yr,
            chamfered(0.11 * m, 0.11 * m, 0.025 * m, x, z),
          ),
          paint.hull2,
          11,
        );
        put(plate(0.13 * m, 0.13 * m, yr, yr + 0.03, x, z), paint.accent, 11);
        put(
          plate(0.07 * m, 0.07 * m, yr + 0.03, yr + 0.09, x, z),
          paint.trim,
          7,
        );
        put(mast(0.03 * m, yr + 0.09, yr + 0.3, x, z), paint.metal, 13);
      });

      // The crown and its masts.
      const s = shape.tip * m;
      const yCrown = yTop + 0.02 * h;
      put(
        column(plan(1.15 * s), yTop, yCrown, plan(0.8 * s)),
        paint.accent,
        11,
      );
      put(plate(0.4 * s, 0.4 * s, yCrown, yCrown + 0.02 * h), paint.trim, 7);
      put(mast(0.05 * m, yCrown + 0.02 * h, h), paint.metal, 13);
      put(
        mast(0.03 * m, yCrown, 0.95 * h, 0.26 * s, -0.22 * s),
        paint.metal,
        13,
      );
      put(plate(0.2 * s, 0.03 * m, 0.94 * h, 0.945 * h, 0, 0), paint.metal, 13);
    },
  };
}

/* ------------------------------- saucer ------------------------------- */

interface SaucerShape {
  id: string;
  lots: [number, number];
  height: number;
  landmark?: boolean;
  /** How wide the saucer and the core shaft are, as shares of the lot. */
  disc: number;
  core: number;
  /** Where the saucer's underside starts and how deep it is, as shares of the height. */
  stem: number;
  depth: number;
  /** How high the battered base stands, as a share of the height. */
  base: number;
  /** Tanks standing against the core, and pods held off it on arms. */
  tanks: number;
  pods: number;
  /** A second, smaller disc half way up the core. */
  ring?: boolean;
}

/** How far up the core each tank in turn reaches. */
const TANK_TOPS = [0.86, 0.52, 0.72, 0.42, 0.9, 0.6];

/**
 * A core shaft on a battered base, tanks and pods clinging to it, under a
 * wide saucer with a band of windows round its rim and antennas on its dome.
 */
function saucer(shape: SaucerShape): OutpostModel {
  const { id, lots, height: h } = shape;
  return {
    id,
    family: "saucer",
    lots,
    height: h,
    landmark: shape.landmark,
    round: true,
    build(b, w, d, paint) {
      const m = Math.min(w, d);
      const put = putter(b, paint);
      const big = lots[0] > 1;
      const n = big ? 20 : 16;
      /** A round plan `s` across. */
      const ring = (s: number, sides = n) => round(s, s, sides);
      // Detail is drawn larger on one lot, where there is less of it.
      const u = (big ? 0.68 : 1) * m;
      const core = shape.core * m;
      const across = shape.disc * m;
      const yBase = shape.base * h;
      const yDisc = shape.stem * h;
      const deep = shape.depth * h;
      const span = yDisc - yBase;
      // With a ring, the tanks stand below it and the pods hang above.
      const yRing = yBase + 0.52 * span;
      const tankSpan = shape.ring ? 0.5 * span : span;

      put(
        column(ring(0.96 * m), 0, 0.55 * yBase, ring(0.7 * m)),
        paint.hull2,
        11,
        HERE,
        true,
      );
      put(column(ring(0.72 * m), 0.55 * yBase, 0.72 * yBase), paint.stripe, 14);
      put(
        column(ring(0.66 * m), 0.72 * yBase, yBase, ring(core + 0.14 * m)),
        paint.hull,
        11,
      );

      put(column(ring(core, 12), yBase, yDisc + 0.2 * deep), paint.hull, 11);
      for (const t of [0.34, 0.68]) {
        const y = yBase + t * span;
        put(column(ring(core + 0.05 * u, 12), y, y + 0.02 * h), paint.trim, 7);
      }
      put(
        column(
          ring(core + 0.03 * u, 12),
          yDisc - 0.07 * span,
          yDisc - 0.01 * span,
        ),
        paint.glass,
        3,
      );

      const rTank = 0.11 * u;
      for (let i = 0; i < shape.tanks; i++) {
        const a = ((i + 0.5) / shape.tanks) * TAU;
        const r = core / 2 + 0.6 * rTank;
        tank(
          put,
          i % 2 === 0 ? paint.hull2 : paint.accent,
          rTank,
          0.8 * yBase,
          yBase + TANK_TOPS[i % TANK_TOPS.length] * tankSpan,
          r * Math.cos(a),
          r * Math.sin(a),
        );
      }

      const pod = 0.2 * u;
      const rPod = Math.min(core / 2 + 0.9 * pod, 0.47 * m - 0.62 * pod);
      for (let i = 0; i < shape.pods; i++) {
        const face = turn((i / shape.pods) * TAU);
        const y =
          yBase + (shape.ring ? 0.7 : 0.4) * span + (i % 2) * 0.1 * span;
        put(
          plate(rPod, 0.3 * pod, y + 0.25 * pod, y + 0.5 * pod, rPod / 2, 0),
          paint.trim,
          7,
          face,
        );
        put(
          column(
            chamfered(pod, 0.8 * pod, 0.2 * pod, rPod, 0),
            y,
            y + 0.7 * pod,
          ),
          paint.hull2,
          11,
          face,
        );
        put(
          plate(0.7 * pod, 0.6 * pod, y + 0.7 * pod, y + 0.8 * pod, rPod, 0),
          paint.accent,
          11,
          face,
        );
        put(
          plate(
            0.06 * pod,
            0.56 * pod,
            y + 0.25 * pod,
            y + 0.55 * pod,
            rPod + 0.5 * pod,
            0,
          ),
          paint.glass,
          3,
          face,
        );
      }

      if (shape.ring) {
        const s = 0.58 * across;
        const t = 0.03 * h;
        put(
          column(ring(core), yRing, yRing + t, ring(0.94 * s)),
          paint.hull2,
          12,
        );
        put(column(ring(s), yRing + t, yRing + 1.5 * t), paint.accent, 12);
        put(
          column(
            ring(s),
            yRing + 1.5 * t,
            yRing + 2.2 * t,
            ring(core + 0.04 * m),
          ),
          paint.hull,
          12,
        );
      }

      // The saucer: a dished underside, a rim with a band of windows, a dome.
      const y = (t: number) => yDisc + t * deep;
      put(
        column(ring(core + 0.02 * m), y(0), y(0.4), ring(0.94 * across)),
        paint.hull2,
        12,
      );
      put(column(ring(across), y(0.4), y(0.5)), paint.accent, 12);
      put(column(ring(0.96 * across), y(0.5), y(0.7)), paint.glass, 3);
      put(column(ring(across), y(0.7), y(0.78)), paint.hull, 12);
      put(
        column(ring(across), y(0.78), y(0.92), ring(0.8 * across)),
        paint.hull,
        12,
      );
      put(
        column(ring(0.8 * across), y(0.92), y(1), ring(0.46 * across)),
        paint.hull,
        12,
      );
      put(column(ring(0.4 * across, 12), y(1), y(1.1)), paint.trim, 7);
      put(
        column(
          ring(0.44 * across, 12),
          y(1.1),
          y(1.22),
          ring(0.2 * across, 12),
        ),
        paint.accent,
        12,
      );

      const yMast = y(1.2);
      put(mast(0.06 * u, yMast, h), paint.metal, 13);
      put(
        mast(
          0.04 * u,
          y(0.95),
          yMast + 0.6 * (h - yMast),
          0.3 * across,
          0.05 * across,
        ),
        paint.metal,
        13,
      );
      put(
        mast(
          0.04 * u,
          y(0.95),
          yMast + 0.35 * (h - yMast),
          -0.2 * across,
          -0.24 * across,
        ),
        paint.metal,
        13,
      );
      put(
        plate(
          0.12 * across,
          0.1 * across,
          y(0.95),
          y(1.08),
          -0.24 * across,
          0.2 * across,
        ),
        paint.hull2,
        11,
      );
    },
  };
}

export const OUTPOST_TOWERS: OutpostModel[] = [
  stacked({ id: "outpost-stack-three", height: 1.0, segments: 3 }),
  stacked({ id: "outpost-stack-four", height: 1.3, segments: 4 }),
  stacked({ id: "outpost-stack-five", height: 1.75, segments: 5, mast: true }),
  stacked({ id: "outpost-stack-six", height: 2.0, segments: 6, setback: 4 }),
  stacked({
    id: "outpost-stack-seven",
    height: 2.4,
    segments: 7,
    setback: 5,
    mast: true,
  }),

  spire({
    id: "outpost-spire",
    height: 4.6,
    foot: 0.42,
    tip: 0.2,
    lengths: 4,
    fins: 4,
    finTop: 0.3,
    risers: [
      [0, 0.44],
      [3, 0.3],
    ],
  }),
  spire({
    id: "outpost-spire-great",
    height: 5.4,
    foot: 0.4,
    tip: 0.15,
    lengths: 5,
    fins: 8,
    finTop: 0.36,
    risers: [],
  }),

  saucer({
    id: "outpost-saucer-post",
    lots: [1, 1],
    height: 1.6,
    disc: 0.96,
    core: 0.3,
    stem: 0.58,
    depth: 0.2,
    base: 0.14,
    tanks: 3,
    pods: 0,
  }),
  saucer({
    id: "outpost-saucer-watch",
    lots: [1, 1],
    height: 2.2,
    disc: 0.92,
    core: 0.28,
    stem: 0.66,
    depth: 0.15,
    base: 0.11,
    tanks: 4,
    pods: 2,
  }),
  saucer({
    id: "outpost-saucer-mushroom",
    lots: [2, 2],
    height: 2.3,
    disc: 0.98,
    core: 0.3,
    stem: 0.5,
    depth: 0.3,
    base: 0.2,
    tanks: 4,
    pods: 4,
  }),
  saucer({
    id: "outpost-saucer-tall",
    lots: [2, 2],
    height: 3.0,
    disc: 0.8,
    core: 0.26,
    stem: 0.64,
    depth: 0.2,
    base: 0.12,
    tanks: 6,
    pods: 3,
  }),
  saucer({
    id: "outpost-saucer-great",
    lots: [2, 2],
    height: 4.3,
    landmark: true,
    disc: 0.92,
    core: 0.24,
    stem: 0.66,
    depth: 0.16,
    base: 0.1,
    tanks: 6,
    pods: 4,
    ring: true,
  }),
];
