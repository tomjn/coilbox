/**
 * A ruined castle on a run's anomaly: a small broken historic site on a low
 * mound. Two rings of low wall that step down into their gaps, squat corner
 * towers cut off at uneven heights and the shell of a keep, the one tall mass.
 * No roofs, no windows, no banners and nothing that shines: it is long
 * abandoned.
 */
import * as THREE from "three";
import {
  Builder,
  type BuiltLandmark,
  box,
  noise3,
  on,
  type Paint,
  polar,
  type Rgb,
  seeded,
  shaft,
  smooth,
  sweep,
  TAU,
} from "./kit";
import type { RuinPalette } from "./palettes";

/** How far the ruin reaches from its origin: the edge of its mound. */
export const RUIN_REACH = 1.8;
/**
 * The two rings of wall: radius, the mound's height under them, sides, the
 * tallest a section stands, thickness and the towers' radius.
 */
export const RUIN_WALLS = [
  { r: 1.35, top: 0.16, sides: 12, h: 0.26, thick: 0.09, tower: 0.16 },
  { r: 0.78, top: 0.34, sides: 8, h: 0.22, thick: 0.08, tower: 0.13 },
];
/** Where the mound's skirt starts to fade into the ground: just past the outer wall. */
const FADE_FROM = RUIN_WALLS[0].r + 0.1;
/** The share of wall sections that have fallen. */
const FALLEN = 0.28;
/** The share of corners that still have a tower. */
const TOWERS = 0.35;
/** The tallest a tower stands, as a multiple of its wall. */
const TOWER_CAP = 1.4;
/** Bearings the terrace's height is read at, round the inner wall. */
const TERRACE_BEARINGS = 16;
/** How far a wall's foot sinks into the mound. */
const SINK = 0.06;
/** The cells the ruin's blocks are cut into, so their weathering shows. */
const CELL = 0.04;

export interface Ruin {
  built: BuiltLandmark;
}

/**
 * Build the ruin round its origin. `ground` is the terrain's height under a
 * point, less the height at the origin. `edgeColour` is the ground's own
 * colour at a point, which the mound takes on towards its edge.
 */
export function buildRuin(
  ground: (x: number, z: number) => number,
  p: RuinPalette,
  seed: number,
  edgeColour?: (x: number, z: number) => Rgb | undefined,
): Ruin {
  const b = new Builder();
  const rand = seeded(seed);
  const stone: Paint = { kind: 0, top: p.top, topCover: p.topCover };
  const dark: Paint = { kind: 0, clean: true };
  const [outer, inner] = RUIN_WALLS;

  // The mound: two low tiers, overgrown, and a skirt down to the terrain.
  const rise = (r: number) =>
    outer.top * (1 - smooth(outer.r, RUIN_REACH, r)) +
    (inner.top - outer.top) * (1 - smooth(inner.r - 0.04, inner.r + 0.15, r));
  const rough = (x: number, z: number) =>
    (noise3(x * 3 + 9, 2, z * 3) - 0.5) * 0.04;
  // The castle stands on a terrace cut level with the highest ground under its
  // inner wall. On a slope that faces away from the camera, that lifts it into
  // view rather than leaving it behind its own hillside.
  let terrace = ground(0, 0);
  for (let k = 0; k < TERRACE_BEARINGS; k++) {
    const a = (k / TERRACE_BEARINGS) * TAU;
    terrace = Math.max(
      terrace,
      ground(inner.r * Math.cos(a), inner.r * Math.sin(a)),
    );
  }
  const moundY = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    const level = 1 - smooth(outer.r, RUIN_REACH, r);
    const base = ground(x, z) * (1 - level) + terrace * level;
    return base + rise(r) + rough(x, z) * smooth(0.2, 0.9, r);
  };
  const ROWS = 36;
  const SEGS = 128;
  b.add(
    sweep(ROWS, SEGS, (i, s) => {
      const a = (s / SEGS) * TAU;
      const r = (i / (ROWS - 1)) * RUIN_REACH;
      const x = r * Math.cos(a);
      const z = r * Math.sin(a);
      const sink = 0.03 * smooth(0.85, 1, i / (ROWS - 1));
      return [x, moundY(x, z) - 0.01 - sink, z];
    }),
    p.rock,
    new THREE.Matrix4(),
    {
      kind: 2,
      top: p.top,
      topCover: Math.min(0.9, p.topCover * 1.4),
      clean: true,
      fade: (x, _y, z) => {
        const r = Math.hypot(x, z) + (noise3(x * 3.4, 5, z * 3.4) - 0.5) * 0.25;
        return (
          1 -
          Math.min(1, Math.max(0, (r - FADE_FROM) / (RUIN_REACH - FADE_FROM)))
        );
      },
      blend: edgeColour,
      // The ground's colour reaches in to the inner ring, so the mound has no edge.
      blendWeight: (x, z) => smooth(inner.r, RUIN_REACH, Math.hypot(x, z)),
    },
    "crag",
  );

  for (const [w, ring] of RUIN_WALLS.entries()) {
    const step = TAU / ring.sides;
    const turn = w * 0.3;
    const apothem = ring.r * Math.cos(step / 2);
    const length = 2 * ring.r * Math.sin(step / 2);
    // Two gaps are always there, on opposite sides, so the ring reads as broken.
    const fallen = Array.from(
      { length: ring.sides },
      (_, k) =>
        k === 0 || k === Math.floor(ring.sides / 2) + 1 || rand() < FALLEN,
    );
    /** How many sections lie between section `k` and the nearest gap. */
    const fromGap = (k: number) => {
      for (let d = 0; d < ring.sides; d++)
        if (
          fallen[(k + d) % ring.sides] ||
          fallen[(k - d + ring.sides) % ring.sides]
        )
          return d;
      return ring.sides;
    };
    const heightAt = (k: number, side: number) => {
      // Lower towards the gap on that side.
      const towards = fallen[(k + side + ring.sides) % ring.sides] ? 0 : 1;
      const d = fromGap(k) - 1 + towards * 0.5;
      return ring.h * Math.min(1, 0.35 + 0.3 * d + 0.15 * rand());
    };
    for (let k = 0; k < ring.sides; k++) {
      const a = k * step + turn;
      const ground0 = moundY(apothem * Math.cos(a), apothem * Math.sin(a));
      const m = polar(apothem, a, ground0 - SINK, Math.PI / 2);
      if (fallen[k]) {
        // What is left of a fallen section: a low course in the grass.
        b.add(
          box(length * 0.6, SINK + 0.02, ring.thick * 1.2, 0, CELL),
          p.darkStone,
          m,
          dark,
        );
        continue;
      }
      // Two pieces, each broken off at its own height, lower towards a gap.
      for (const side of [-1, 1]) {
        const hh = SINK + heightAt(k, side);
        b.add(
          box(length / 2 + 0.01, hh, ring.thick, 0, CELL),
          p.stone,
          on(m, side * (length / 4), 0, 0),
          stone,
        );
      }
      b.add(
        box(length + 0.02, SINK + 0.05, ring.thick * 1.5, 0, CELL),
        p.darkStone,
        m,
        dark,
      );
    }
    // Squat corner towers, some gone, the rest cut off at uneven heights.
    for (let k = 0; k < ring.sides; k++) {
      if (rand() > TOWERS) continue;
      const a = k * step + turn + step / 2;
      const x = ring.r * Math.cos(a);
      const z = ring.r * Math.sin(a);
      const m = polar(ring.r, a, moundY(x, z) - SINK);
      const hh = SINK + ring.h * (0.8 + (TOWER_CAP - 0.8) * rand());
      b.add(
        shaft(ring.tower * 1.15, ring.tower * 1.05, SINK + 0.05, 14),
        p.darkStone,
        m,
        dark,
      );
      b.add(shaft(ring.tower, ring.tower * 0.94, hh, 14), p.stone, m, stone);
    }
  }

  // The keep: the shell of its lower stage, open to the sky, the tallest thing left.
  const KEEP = 0.36;
  const y0 = moundY(0, 0) - SINK;
  b.add(
    shaft(KEEP + 0.1, KEEP + 0.07, SINK + 0.06, 8),
    p.darkStone,
    polar(0, 0, y0),
    dark,
  );
  const sides = 8;
  const len = 2 * KEEP * Math.sin(Math.PI / sides);
  for (let k = 0; k < sides; k++) {
    const a = ((k + 0.5) / sides) * TAU;
    const m = polar(KEEP * Math.cos(Math.PI / sides), a, y0, Math.PI / 2);
    const hh = SINK + (k % 3 === 0 ? 0.12 : 0.35 + 0.3 * rand());
    b.add(box(len + 0.02, hh, 0.08, 0, CELL), p.stone, m, stone);
  }

  return { built: b.build() };
}
