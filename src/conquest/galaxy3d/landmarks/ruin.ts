/**
 * A ruined castle on a run's anomaly: a small broken historic site on a low
 * mound. Two rings of wall with gaps and fallen sections, corner towers cut
 * off at uneven heights and the shell of a keep. No roofs, no windows, no
 * banners and nothing that shines: it is long abandoned.
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
export const RUIN_REACH = 2.6;
/** The two rings of wall: radius, the ground they stand on, sides, height, thickness. */
export const RUIN_WALLS = [
  { r: 1.9, top: 0.22, sides: 12, h: 0.34, thick: 0.11, tower: 0.13 },
  { r: 1.1, top: 0.48, sides: 8, h: 0.3, thick: 0.09, tower: 0.1 },
];
/** Where the mound's skirt starts to fade into the ground, and where it is gone. */
const FADE_FROM = 2.15;
/** The share of wall sections that have fallen. */
const FALLEN = 0.28;
/** The share of corners that still have a tower. */
const TOWERS = 0.55;

export interface Ruin {
  built: BuiltLandmark;
}

/**
 * Build the ruin round its origin. `ground` is the terrain's height under a
 * point, less the height at the origin. `edgeColour` is the ground's own
 * colour at a point, which the mound takes on at its edge.
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
    outer.top * (1 - smooth(outer.r, FADE_FROM + 0.2, r)) +
    (inner.top - outer.top) * (1 - smooth(inner.r - 0.05, inner.r + 0.2, r));
  const rough = (x: number, z: number) =>
    (noise3(x * 2.2 + 9, 2, z * 2.2) - 0.5) * 0.06;
  const moundY = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    return ground(x, z) + rise(r) + rough(x, z) * smooth(0.3, 1.2, r);
  };
  const ROWS = 44;
  const SEGS = 160;
  b.add(
    sweep(ROWS, SEGS, (i, s) => {
      const a = (s / SEGS) * TAU;
      const r = (i / (ROWS - 1)) * RUIN_REACH;
      const x = r * Math.cos(a);
      const z = r * Math.sin(a);
      return [
        x,
        moundY(x, z) - 0.01 - 0.03 * smooth(0.85, 1, i / (ROWS - 1)),
        z,
      ];
    }),
    p.rock,
    new THREE.Matrix4(),
    {
      kind: 2,
      top: p.top,
      topCover: Math.min(0.9, p.topCover * 1.4),
      clean: true,
      fade: (x, _y, z) => {
        const r = Math.hypot(x, z) + (noise3(x * 2.4, 5, z * 2.4) - 0.5) * 0.35;
        return (
          1 -
          Math.min(1, Math.max(0, (r - FADE_FROM) / (RUIN_REACH - FADE_FROM)))
        );
      },
      blend: edgeColour,
      blendWeight: (x, z) => smooth(outer.r, RUIN_REACH, Math.hypot(x, z)),
    },
    "crag",
  );

  // The two rings of wall, each section standing, broken or fallen.
  for (const [w, ring] of RUIN_WALLS.entries()) {
    const step = TAU / ring.sides;
    const apothem = ring.r * Math.cos(step / 2);
    const length = 2 * ring.r * Math.sin(step / 2);
    // Two gaps are always there, on opposite sides, so the ring reads as broken.
    const gaps = new Set([0, Math.floor(ring.sides / 2) + 1]);
    for (let k = 0; k < ring.sides; k++) {
      const a = k * step + w * 0.3;
      const fallen = gaps.has(k) || rand() < FALLEN;
      const at = (r: number) => moundY(r * Math.cos(a), r * Math.sin(a));
      const m = polar(apothem, a, at(apothem) - 0.1, Math.PI / 2);
      if (fallen) {
        // What is left of a fallen section: a low course and the stones from it.
        b.add(
          box(length * 0.7, 0.05, ring.thick * 1.2),
          p.darkStone,
          on(m, 0, 0, 0),
          dark,
        );
        for (let i = 0; i < 5; i++) {
          const g = new THREE.IcosahedronGeometry(0.03 + rand() * 0.04, 0);
          b.add(
            g,
            rand() > 0.5 ? p.stone : p.rock,
            on(
              m,
              (rand() - 0.5) * length,
              0.08,
              0.1 + rand() * 0.25,
              rand() * TAU,
            ),
            { kind: 2, top: p.top, topCover: p.topCover },
          );
        }
        continue;
      }
      // A standing section is three pieces, each broken off at its own height.
      for (let j = 0; j < 3; j++) {
        const hh = 0.1 + ring.h * (0.25 + 0.75 * rand());
        b.add(
          box(length / 3 + 0.01, hh, ring.thick),
          p.stone,
          on(m, (j - 1) * (length / 3), 0, 0),
          stone,
        );
      }
      // The footing, wider than the wall.
      b.add(box(length + 0.02, 0.14, ring.thick * 1.6), p.darkStone, m, dark);
    }
    // Corner towers, some gone, the rest cut off at uneven heights.
    for (let k = 0; k < ring.sides; k++) {
      if (rand() > TOWERS) continue;
      const a = k * step + w * 0.3 + step / 2;
      const x = ring.r * Math.cos(a);
      const z = ring.r * Math.sin(a);
      const m = polar(ring.r, a, moundY(x, z) - 0.12);
      const hh = 0.2 + ring.h * (0.6 + 1.2 * rand());
      b.add(
        shaft(ring.tower * 1.2, ring.tower * 1.05, 0.12, 14),
        p.darkStone,
        m,
        dark,
      );
      b.add(shaft(ring.tower * 1.05, ring.tower, hh, 14), p.stone, m, stone);
    }
  }

  // The keep: the shell of its lower stage, open to the sky.
  const y0 = moundY(0, 0) - 0.05;
  b.add(shaft(0.62, 0.58, 0.1, 8), p.darkStone, polar(0, 0, y0), dark);
  const sides = 8;
  const len = 2 * 0.5 * Math.sin(Math.PI / sides);
  for (let k = 0; k < sides; k++) {
    const a = ((k + 0.5) / sides) * TAU;
    const m = polar(0.5 * Math.cos(Math.PI / sides), a, y0 + 0.08, Math.PI / 2);
    const hh = k % 3 === 0 ? 0.12 : 0.3 + 0.55 * rand();
    b.add(box(len + 0.02, hh, 0.09), p.stone, m, stone);
  }

  // Stones scattered on the mound.
  for (let i = 0; i < 40; i++) {
    const a = rand() * TAU;
    const r = 0.7 + rand() * 1.5;
    const x = r * Math.cos(a);
    const z = r * Math.sin(a);
    const g = new THREE.IcosahedronGeometry(0.02 + rand() * rand() * 0.06, 0);
    g.scale(1, 0.6 + rand() * 0.4, 0.7 + rand() * 0.5);
    b.add(g, p.rock, polar(r, a, moundY(x, z) - 0.01, rand() * TAU), {
      kind: 2,
      top: p.top,
      topCover: p.topCover,
    });
  }

  return { built: b.build() };
}
