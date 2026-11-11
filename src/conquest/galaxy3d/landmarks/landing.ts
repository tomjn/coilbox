/**
 * The landing pad that stands on a run's start: a wide eight-sided deck with
 * painted markings, and a control tower or two beside it.
 *
 * A map has one. Its seed picks one of four: the deck raised on a pedestal or
 * lying on a foundation cut into the ground, with one tower or two. Like a
 * depot it is painted metal that looks the same on every planet but for its
 * foundation's stone and what has settled on it.
 *
 * Built with the road arriving along +x. The layer turns it.
 */
import * as THREE from "three";
import { dish } from "./depot";
import {
  at,
  Builder,
  type BuiltLandmark,
  block,
  box,
  faceOut,
  on,
  type Paint,
  seeded,
  shaft,
  TAU,
} from "./kit";
import type { LandingPalette } from "./palettes";

/** How far a landing pad reaches from its origin. A test holds every part inside it. */
export const LANDING_REACH = 2.4;

export const LANDING_PADS = ["raised", "flush"] as const;
export const LANDING_TOWERS = [1, 2] as const;

export interface Landing {
  built: BuiltLandmark;
  pad: (typeof LANDING_PADS)[number];
  towers: (typeof LANDING_TOWERS)[number];
}

/** The deck's middle, a little towards the road, which leaves the towers room behind it. */
const DECK_X = 0.2;
/** From the deck's middle to the middle of each of its eight sides. */
const DECK_R = 1.2;
const DECK_THICK = 0.07;
/** From the deck's side to the middle of a tower. */
const TOWER_GAP = 0.62;
/** How much taller than its cab a tower's stem stands. */
const STEM = 0.38;
/** How far a raised deck's top stands above the highest ground under it. */
const RAISED = 0.78;
/** How far a part's foot goes below the lowest ground under it. */
const FOOT = 0.12;
const BEACON: [number, number, number] = [255, 84, 54];

/**
 * An eight-sided plate standing on y = 0, a side facing each axis, `r` from
 * its middle to the middle of a side. Its top is cut into rings, so what
 * settles on it has vertices to land on.
 */
function octagon(r: number, h: number, rFoot = r) {
  const out = r / Math.cos(Math.PI / 8);
  const foot = rFoot / Math.cos(Math.PI / 8);
  const rings = 5;
  const profile = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(foot, 0),
    ...Array.from(
      { length: rings + 1 },
      (_, i) => new THREE.Vector2((out * (rings - i)) / rings, h),
    ),
  ];
  return faceOut(new THREE.LatheGeometry(profile, 8)).rotateY(Math.PI / 8);
}

/**
 * Build a landing pad round its origin. `ground` is the terrain's height under
 * a point, less the height at the origin.
 */
export function buildLanding(
  ground: (x: number, z: number) => number,
  p: LandingPalette,
  seed: number,
): Landing {
  const b = new Builder();
  const rand = seeded(seed);
  const pad = LANDING_PADS[Math.floor(rand() * LANDING_PADS.length)];
  const towers = LANDING_TOWERS[Math.floor(rand() * LANDING_TOWERS.length)];
  const side = rand() < 0.5 ? 1 : -1;
  const aim = rand() * TAU;

  const settled = { top: p.top, topCover: p.topCover * 0.4 };
  /** Painted plate with seams, standing on the ground or a foundation. */
  const panel: Paint = { kind: 11, ...settled };
  /** The same, on a part that stands on another. */
  const fitted: Paint = { kind: 11, clean: true, ...settled };
  /** Painted and curved, or painted on: a drum, a dish, a marking. */
  const curved: Paint = { kind: 12, clean: true, ...settled };
  const bare: Paint = { kind: 13, clean: true };
  const cast: Paint = { kind: 8, top: p.top, topCover: p.topCover };

  /** The lowest and highest ground under a ring of radius `r` round x, z. */
  const under = (x: number, z: number, r: number) => {
    let lo = ground(x, z);
    let hi = lo;
    let sum = lo;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * TAU;
      const g = ground(x + r * Math.cos(a), z + r * Math.sin(a));
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
      sum += g;
    }
    return { lo, hi, mean: sum / 9 };
  };

  // The deck.
  const base = under(DECK_X, 0, DECK_R);
  // A flush deck's foundation is cut halfway into the slope, as a depot's slab is.
  const flushTop = (base.mean + base.hi) / 2 + 0.06;
  const top = pad === "raised" ? base.hi + RAISED : flushTop + 0.05;
  const D = at(DECK_X, top, 0);
  b.add(octagon(DECK_R, DECK_THICK), p.deck, on(D, 0, -DECK_THICK, 0), fitted);
  // A dark edge under it, and the frame the deck lies on.
  b.add(
    octagon(DECK_R + 0.03, 0.035),
    p.metal,
    on(D, 0, -DECK_THICK - 0.02, 0),
    bare,
  );

  // The markings: a square ring with its corners cut, open at the middle of
  // each side, round a cross that stops short of the centre.
  const mark = (m: THREE.Matrix4, len: number) =>
    b.add(box(len, 0.008, 0.09), p.mark, on(m, 0, -0.002, 0), curved);
  for (let k = 0; k < 4; k++) {
    const A = on(D, 0, 0, 0, (k * Math.PI) / 2);
    for (const s of [-1, 1]) mark(on(A, 0.72, 0, s * 0.36, Math.PI / 2), 0.4);
    mark(on(A, 0.64, 0, 0.64, Math.PI / 4), 0.3);
    mark(on(A, 0.27, 0, 0), 0.3);
  }
  // A short aerial at every other corner of the deck.
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 2 + (side > 0 ? 0 : Math.PI / 4);
    const r = DECK_R / Math.cos(Math.PI / 8) - 0.03;
    b.add(
      shaft(0.007, 0.004, 0.16, 5),
      p.metal,
      on(D, r * Math.cos(a), 0, r * Math.sin(a)),
      bare,
    );
  }

  if (pad === "raised") {
    // A fat pedestal under the middle, flared at its foot and its head.
    const under0 = top - DECK_THICK - 0.02;
    const foot = base.lo - FOOT;
    const P = at(DECK_X, 0, 0);
    const mid = under(DECK_X, 0, 0.6);
    b.add(shaft(0.44, 0.38, under0 - foot, 16), p.metal, on(P, 0, foot, 0), {
      kind: 13,
    });
    b.add(
      shaft(0.72, 0.46, mid.hi + 0.2 - (mid.lo - FOOT), 16),
      p.metal,
      on(P, 0, mid.lo - FOOT, 0),
      { kind: 13 },
    );
    b.add(
      shaft(0.4, 0.4, 0.07, 16),
      p.shell,
      on(P, 0, under0 - 0.36, 0),
      curved,
    );
    b.add(shaft(0.4, 0.8, 0.22, 16), p.metal, on(P, 0, under0 - 0.22, 0), bare);
    // Four buttresses between them.
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const x = DECK_X + 0.62 * Math.cos(a);
      const z = 0.62 * Math.sin(a);
      const g = ground(x, z) - FOOT;
      b.add(
        block(0.4, mid.hi + 0.34 - g, 0.16, 0.3),
        p.shell,
        at(x, g, z, -a),
        {
          kind: 11,
        },
      );
    }
    // A leg under each diagonal side, and a spike hanging beside it.
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const x = DECK_X + 0.92 * Math.cos(a);
      const z = 0.92 * Math.sin(a);
      const g = ground(x, z);
      const L = at(x, 0, z, -a);
      b.add(block(0.3, 0.16, 0.3, 0.6), p.pad, on(L, 0, g - FOOT, 0), cast);
      b.add(shaft(0.09, 0.07, under0 - g, 10), p.metal, on(L, 0, g, 0), {
        kind: 13,
      });
      b.add(shaft(0.07, 0.17, 0.12, 10), p.shell, on(L, 0, under0 - 0.12, 0), {
        ...curved,
      });
      b.add(
        block(0.02, 0.26, 0.02, 4),
        p.metal,
        on(D, 1.1 * Math.cos(a), -DECK_THICK - 0.28, 1.1 * Math.sin(a)),
        bare,
      );
    }
  } else {
    // A cast foundation, wider at its foot, with a block at each diagonal side.
    const foot = base.lo - FOOT;
    b.add(
      octagon(DECK_R + 0.1, flushTop - foot, DECK_R + 0.22),
      p.pad,
      at(DECK_X, foot, 0),
      cast,
    );
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const r = DECK_R + 0.14;
      const x = DECK_X + r * Math.cos(a);
      const z = r * Math.sin(a);
      const g = ground(x, z) - FOOT;
      b.add(
        block(0.2, flushTop + 0.03 - g, 0.5, 0.75),
        p.pad,
        at(x, g, z, -a),
        cast,
      );
      b.add(
        box(0.1, 0.03, 0.34, 0.008),
        p.metal,
        at(x, flushTop + 0.03, z, -a),
        bare,
      );
    }
  }

  /**
   * A round control tower at x, z, `s` of full size: a waisted stem under a
   * banded drum. The first carries a dish and a tall mast, the second a dome.
   */
  const tower = (x: number, z: number, s: number, first: boolean) => {
    const g = under(x, z, 0.4 * s);
    const tag = "tower" as const;
    const T = at(x, g.hi, z, 0, s);
    b.add(
      shaft(0.42 * s, 0.38 * s, g.hi - g.lo + FOOT + 0.06, 12),
      p.pad,
      at(x, g.lo - FOOT, z),
      cast,
      tag,
    );
    // The stem is tall enough to lift the cab clear of a raised deck.
    const U = on(T, 0, STEM, 0);
    b.add(
      shaft(0.36, 0.23, 0.46 + STEM, 18),
      p.shell,
      on(T, 0, 0.06, 0),
      panel,
      tag,
    );
    b.add(shaft(0.24, 0.24, 0.1, 18), p.metal, on(U, 0, 0.52, 0), bare, tag);
    b.add(shaft(0.23, 0.38, 0.18, 18), p.shell, on(U, 0, 0.62, 0), curved, tag);
    b.add(shaft(0.38, 0.38, 0.34, 22), p.shell, on(U, 0, 0.8, 0), curved, tag);
    for (const y of [0.86, 0.98])
      b.add(shaft(0.386, 0.386, 0.05, 22), p.metal, on(U, 0, y, 0), bare, tag);
    b.add(
      shaft(0.384, 0.384, 0.03, 22),
      p.mark,
      on(U, 0, 1.08, 0),
      curved,
      tag,
    );
    b.add(shaft(0.4, 0.3, 0.07, 22), p.metal, on(U, 0, 1.14, 0), bare, tag);
    const R = on(U, 0, 1.21, 0, first ? aim : aim + 2);
    // A plant cabinet against its foot, away from the deck.
    b.add(
      box(0.2, 0.26, 0.26, 0.02),
      p.metal,
      on(T, -0.4, 0.02, 0),
      { kind: 13 },
      tag,
    );
    if (first) {
      b.add(
        box(0.14, 0.1, 0.16, 0.015),
        p.shell,
        on(R, 0.1, 0, 0),
        fitted,
        tag,
      );
      const d = dish(0.27, 0.95);
      const O = on(R, 0.12, 0.13, 0);
      b.add(d.bowl, p.shell, O, curved, tag);
      b.add(d.boom, p.metal, O, bare, tag);
      b.add(d.feed, p.mark, O, fitted, tag);
      b.add(
        new THREE.SphereGeometry(0.075, 14, 8),
        p.shell,
        on(R, -0.12, 0.06, 0.14),
        curved,
        tag,
      );
      // The mast, with two whips and a few cross arms.
      const M = on(R, -0.16, 0, -0.08);
      b.add(shaft(0.042, 0.03, 0.3, 8), p.shell, M, fitted, "mast");
      b.add(
        shaft(0.024, 0.01, 0.9, 6),
        p.metal,
        on(M, 0, 0.3, 0),
        bare,
        "mast",
      );
      for (const [y, w] of [
        [0.5, 0.2],
        [0.66, 0.14],
        [0.82, 0.1],
      ])
        b.add(box(w, 0.012, 0.012), p.metal, on(M, 0, y, 0), bare, "mast");
      for (const sx of [-1, 1])
        b.add(
          shaft(0.004, 0.003, 0.5, 4),
          p.metal,
          on(M, sx * 0.07, 0.66, 0),
          bare,
          "mast",
        );
      b.glow(box(0.016, 0.016, 0.016), BEACON, on(M, 0, 1.205, 0), 1.2);
    } else {
      b.add(
        new THREE.SphereGeometry(0.2, 22, 10, 0, TAU, 0, Math.PI * 0.6),
        p.shell,
        on(R, 0, 0.06, 0),
        curved,
        tag,
      );
      b.add(shaft(0.22, 0.22, 0.03, 22), p.metal, R, bare, tag);
      b.add(
        shaft(0.005, 0.003, 0.3, 4),
        p.metal,
        on(R, 0.22, 0, 0.1),
        bare,
        tag,
      );
    }
  };

  // The towers stand off the deck's two back corners.
  const off = (DECK_R + TOWER_GAP) * Math.SQRT1_2;
  tower(DECK_X - off, side * off, 1, true);
  if (towers === 2) tower(DECK_X - off, -side * off, 0.78, false);

  return { built: b.build(), pad, towers };
}
