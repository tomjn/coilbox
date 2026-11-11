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
  tube,
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
const STEM = 0.8;
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

const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = vec(0, 1, 0);

/** A thin round strut from `a` to `c`. */
function strut(a: THREE.Vector3, c: THREE.Vector3, r: number, sides = 5) {
  const d = c.clone().sub(a);
  const mid = a.clone().add(c).multiplyScalar(0.5);
  return new THREE.CylinderGeometry(r, r, d.length(), sides)
    .applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()),
    )
    .translate(mid.x, mid.y, mid.z);
}

/** A flat ring of radius `r` lying on y = 0. */
const hoop = (r: number, thick: number, sides = 24) =>
  new THREE.TorusGeometry(r, thick, 5, sides).rotateX(Math.PI / 2);

/**
 * The tower's main dish: a bowl of radius `r` opening along +y, then tipped
 * `tilt` towards +x. It has a dark face inside a pale rim, ribs and a hub on
 * its back, and a feed held on three struts.
 */
function scanner(r: number, tilt: number) {
  const depth = r * 0.3;
  const skin = r * 0.05;
  const curve = (x: number) => depth * (x / r) ** 2;
  const steps = 8;
  const skinOf = (reach: number, lift: number, thick: number) => {
    const inner = Array.from({ length: steps + 1 }, (_, i) => {
      const x = (reach * i) / steps;
      return new THREE.Vector2(x, curve(x) + lift);
    });
    const outer = inner
      .map((v) => new THREE.Vector2(v.x, v.y - thick))
      .reverse();
    return faceOut(new THREE.LatheGeometry([...inner, ...outer], 24));
  };
  const bowl = skinOf(r, 0, skin);
  const face = skinOf(r * 0.84, skin * 0.3, skin * 0.25);
  const rim = hoop(r, r * 0.035).translate(0, depth, 0);
  const hub = shaft(r * 0.3, r * 0.2, r * 0.16, 12).translate(0, -r * 0.2, 0);
  const ribs = Array.from({ length: 8 }, (_, k) =>
    box(r * 0.78, r * 0.07, r * 0.035)
      .translate(0, -r * 0.035, 0)
      .rotateZ(0.324)
      .translate(r * 0.56, depth * 0.466 - r * 0.11, 0)
      .rotateY((k * TAU) / 8),
  );
  const feedAt = vec(0, r * 0.82, 0);
  const legs = Array.from({ length: 3 }, (_, k) => {
    const a = (k * TAU) / 3 + 0.5;
    return strut(
      vec(r * 0.8 * Math.cos(a), curve(r * 0.8), r * 0.8 * Math.sin(a)),
      feedAt,
      r * 0.018,
    );
  });
  const horn = shaft(r * 0.05, r * 0.1, r * 0.14, 8).translate(0, r * 0.7, 0);
  const cap = shaft(r * 0.12, r * 0.12, r * 0.03, 10).translate(0, r * 0.84, 0);
  const parts = {
    shell: [bowl, rim, hub],
    dark: [face],
    bare: [...ribs, ...legs, horn, cap],
  };
  for (const g of [...parts.shell, ...parts.dark, ...parts.bare])
    g.rotateZ(-tilt);
  return parts;
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
  // A flush deck lies level with the highest ground under it, so no slope
  // rises through it, and its foundation shows on the downhill side.
  const flushTop = base.hi + 0.02;
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
  // A dark line inside the edge, a hub plate, and a kerb along each side.
  const SIDE = 2 * DECK_R * Math.tan(Math.PI / 8);
  b.add(shaft(0.1, 0.1, 0.006, 16), p.metal, D, bare);
  for (let k = 0; k < 8; k++) {
    const A = on(D, 0, 0, 0, (-k * Math.PI) / 4);
    b.add(box(0.012, 0.006, SIDE * 0.9), p.metal, on(A, 1.08, 0, 0), bare);
    b.add(box(0.05, 0.022, SIDE - 0.14), p.shell, on(A, 1.165, 0, 0), fitted);
    // On the edge's face: a dark plate, two clamps, and on some a pipe run.
    b.add(
      box(0.014, 0.045, 0.22),
      p.metal,
      on(A, DECK_R + 0.002, -0.06, 0),
      bare,
    );
    for (const sz of [-1, 1])
      b.add(
        box(0.07, 0.05, 0.1, 0.008),
        p.metal,
        on(A, DECK_R + 0.02, -0.065, sz * (0.24 + rand() * 0.14)),
        bare,
      );
    if (rand() < 0.6)
      b.add(
        tube(0.014, 0.6, 6),
        p.shell,
        on(A, DECK_R + 0.018, -0.1, 0.3, Math.PI / 2),
        curved,
      );
    b.add(box(0.06, 0.006, 0.06), p.metal, on(A, 0.98, 0, 0), bare);
  }
  // A pod wrapped round each corner. Every other one carries two aerials.
  const CORNER = DECK_R / Math.cos(Math.PI / 8);
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    const C = on(D, CORNER * Math.cos(a), 0, CORNER * Math.sin(a), -a);
    b.add(box(0.16, 0.1, 0.22, 0.012), p.metal, on(C, -0.05, -0.085, 0), bare);
    b.add(box(0.1, 0.03, 0.14, 0.006), p.shell, on(C, -0.07, 0, 0), fitted);
    if ((k + (side > 0 ? 0 : 1)) % 2 === 0) {
      b.add(
        shaft(0.007, 0.004, 0.2, 5),
        p.metal,
        on(C, -0.06, 0.03, 0.03),
        bare,
      );
      b.add(
        shaft(0.006, 0.004, 0.13, 5),
        p.metal,
        on(C, -0.06, 0.03, -0.03),
        bare,
      );
    }
    // Under a raised deck, a fang hangs from each corner.
    if (pad === "raised") {
      const len = k % 2 === 0 ? 0.36 : 0.2;
      b.add(
        shaft(0.004, 0.032, len, 6),
        p.shell,
        on(C, -0.1, -DECK_THICK - 0.02 - len, 0),
        curved,
      );
    }
  }

  if (pad === "raised") {
    // A fat pedestal under the middle, flared at its foot and its head.
    const under0 = top - DECK_THICK - 0.02;
    const foot = base.lo - FOOT;
    const P = at(DECK_X, 0, 0);
    const mid = under(DECK_X, 0, 0.6);
    // An apron under the deck, narrowing towards the pedestal.
    b.add(
      octagon(DECK_R - 0.03, 0.1, DECK_R - 0.34),
      p.metal,
      on(P, 0, under0 - 0.1, 0),
      bare,
    );
    // Fins up the pedestal, and two collars round it.
    for (let k = 0; k < 12; k++)
      b.add(
        box(0.07, (under0 - foot) * 0.62, 0.03),
        p.shell,
        on(P, 0, foot + (under0 - foot) * 0.2, 0, (k * TAU) / 12).multiply(
          at(0.42, 0, 0),
        ),
        fitted,
      );
    for (const t of [0.52, 0.66])
      b.add(
        shaft(0.47, 0.47, 0.035, 16),
        p.metal,
        on(P, 0, foot + (under0 - foot) * t, 0),
        bare,
      );
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
      // A brace from the leg up to the pedestal's head.
      b.add(
        strut(
          vec(x, g + (under0 - g) * 0.4, z),
          vec(DECK_X + 0.45 * Math.cos(a), under0 - 0.16, 0.45 * Math.sin(a)),
          0.028,
          6,
        ),
        p.metal,
        at(0, 0, 0),
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
      // Two ribs against the foundation on the side next to it.
      const a2 = a - Math.PI / 4;
      for (const t of [-0.3, 0.3]) {
        const rx = DECK_X + (DECK_R + 0.19) * Math.cos(a2) - t * Math.sin(a2);
        const rz = (DECK_R + 0.19) * Math.sin(a2) + t * Math.cos(a2);
        const rg = ground(rx, rz) - FOOT;
        b.add(
          block(0.16, flushTop - 0.03 - rg, 0.1, 0.4),
          p.pad,
          at(rx, rg, rz, -a2),
          cast,
        );
      }
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
    // The stem lifts the cab well clear of a raised deck.
    const U = on(T, 0, STEM, 0);
    const stemH = 0.46 + STEM;
    b.add(shaft(0.36, 0.23, stemH, 18), p.shell, on(T, 0, 0.06, 0), panel, tag);
    b.add(
      shaft(0.4, 0.37, 0.1, 18),
      p.metal,
      on(T, 0, 0.04, 0),
      { kind: 13 },
      tag,
    );
    // Ribs up the stem and two collars round it.
    for (let k = 0; k < 8; k++) {
      const a = (k * TAU) / 8;
      b.add(
        strut(
          vec(0.365 * Math.cos(a), 0.08, 0.365 * Math.sin(a)),
          vec(0.24 * Math.cos(a), 0.06 + stemH, 0.24 * Math.sin(a)),
          0.02,
          6,
        ),
        p.metal,
        T,
        bare,
        tag,
      );
    }
    for (const t of [0.36, 0.7]) {
      const r = 0.36 - 0.13 * t + 0.02;
      b.add(
        shaft(r, r, 0.045, 18),
        t < 0.5 ? p.mark : p.metal,
        on(T, 0, 0.06 + stemH * t, 0),
        curved,
        tag,
      );
    }
    b.add(shaft(0.24, 0.24, 0.1, 18), p.metal, on(U, 0, 0.52, 0), bare, tag);
    b.add(shaft(0.23, 0.38, 0.18, 18), p.shell, on(U, 0, 0.62, 0), curved, tag);
    // A gallery round the foot of the cab, with a rail.
    b.add(shaft(0.46, 0.46, 0.02, 22), p.metal, on(U, 0, 0.79, 0), bare, tag);
    b.add(hoop(0.455, 0.007, 22), p.metal, on(U, 0, 0.87, 0), bare, tag);
    for (let k = 0; k < 12; k++) {
      const a = (k * TAU) / 12;
      b.add(
        shaft(0.005, 0.005, 0.07, 4),
        p.metal,
        on(U, 0.455 * Math.cos(a), 0.8, 0.455 * Math.sin(a)),
        bare,
        tag,
      );
    }
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
    b.add(
      box(0.12, 0.16, 0.18, 0.015),
      p.shell,
      on(T, -0.36, 0.02, 0.24),
      panel,
      tag,
    );
    /** A small dish on a post at `m`. */
    const small = (m: THREE.Matrix4, r: number, tilt: number, post: number) => {
      if (post > 0) b.add(shaft(0.012, 0.012, post, 5), p.metal, m, bare, tag);
      const d = dish(r, tilt);
      const O = on(m, 0, post, 0);
      b.add(d.bowl, p.shell, O, curved, tag);
      b.add(d.boom, p.metal, O, bare, tag);
      b.add(d.feed, p.metal, O, bare, tag);
    };
    // On the cab's side: a dish on a bracket, and a pair of panel aerials.
    const S = on(U, 0, 0, 0, first ? aim + 2.4 : aim);
    b.add(box(0.1, 0.04, 0.06), p.metal, on(S, 0.4, 0.9, 0), bare, tag);
    small(on(S, 0.47, 0.94, 0), 0.11, 1.3, 0);
    for (const sz of [-1, 1])
      b.add(
        box(0.03, 0.16, 0.06, 0.006),
        p.shell,
        on(S, -0.4, 0.86, sz * 0.09),
        fitted,
        tag,
      );
    if (first) {
      // The main dish on its mount.
      b.add(shaft(0.08, 0.06, 0.12, 10), p.metal, on(R, 0.06, 0, 0), bare, tag);
      b.add(
        box(0.1, 0.1, 0.2, 0.015),
        p.shell,
        on(R, 0.06, 0.12, 0),
        fitted,
        tag,
      );
      const d = scanner(0.31, 0.95);
      const O = on(R, 0.1, 0.27, 0);
      for (const g of d.shell) b.add(g, p.shell, O, curved, tag);
      for (const g of d.dark) b.add(g, p.metal, O, bare, tag);
      for (const g of d.bare) b.add(g, p.metal, O, bare, tag);
      // Beside it: a radome, a second dish, a cabinet and three whips.
      b.add(
        shaft(0.03, 0.03, 0.05, 8),
        p.metal,
        on(R, -0.13, 0, 0.15),
        bare,
        tag,
      );
      b.add(
        new THREE.SphereGeometry(0.075, 14, 8),
        p.shell,
        on(R, -0.13, 0.1, 0.15),
        curved,
        tag,
      );
      small(on(R, -0.06, 0, -0.2, 2.2), 0.1, 1.15, 0.12);
      b.add(
        box(0.1, 0.07, 0.12, 0.01),
        p.shell,
        on(R, -0.2, 0, -0.02),
        fitted,
        tag,
      );
      for (const [wx, wz, h] of [
        [-0.24, 0.08, 0.5],
        [0.02, 0.25, 0.36],
        [0.2, -0.18, 0.28],
      ])
        b.add(
          shaft(0.006, 0.003, h, 4),
          p.metal,
          on(R, wx, 0, wz),
          bare,
          "mast",
        );

      // The mast stands on the ground beside the tower, braced to it, and
      // rises past the dish.
      const out = z < 0 ? -1 : 1;
      const mz = z + out * 0.52;
      const mg = ground(x, mz);
      const roof = g.hi + STEM + 1.21;
      const M = at(x, mg, mz);
      const low = roof - mg + 0.1;
      b.add(
        block(0.2, 0.1 + FOOT, 0.2, 0.7),
        p.pad,
        on(M, 0, -FOOT, 0),
        cast,
        "mast",
      );
      b.add(
        shaft(0.045, 0.034, low, 8),
        p.shell,
        on(M, 0, 0.08, 0),
        panel,
        "mast",
      );
      b.add(
        shaft(0.03, 0.011, 1.1, 6),
        p.metal,
        on(M, 0, 0.08 + low, 0),
        bare,
        "mast",
      );
      for (const y of [g.hi + 0.5, g.hi + STEM + 0.57])
        b.add(
          strut(vec(x, y, mz), vec(x, y, z + out * 0.2), 0.016),
          p.metal,
          at(0, 0, 0),
          bare,
          "mast",
        );
      const H = on(M, 0, 0.08 + low, 0);
      for (const y of [0.02, 0.3, 0.52])
        b.add(
          shaft(0.075, 0.075, 0.016, 10),
          p.metal,
          on(H, 0, y, 0),
          bare,
          "mast",
        );
      for (const [y, w, turn] of [
        [0.16, 0.24, 0],
        [0.42, 0.18, Math.PI / 2],
        [0.66, 0.14, 0],
        [0.84, 0.1, Math.PI / 2],
      ])
        b.add(
          box(w, 0.012, 0.012),
          p.metal,
          on(H, 0, y, 0, turn),
          bare,
          "mast",
        );
      for (const sx of [-1, 1])
        b.add(
          shaft(0.005, 0.003, 0.6, 4),
          p.metal,
          on(H, sx * 0.08, 0.66, 0),
          bare,
          "mast",
        );
      small(
        on(M, 0, 0.08 + low * 0.62, out * 0.05, (-out * Math.PI) / 2),
        0.09,
        1.35,
        0,
      );
      b.glow(box(0.02, 0.02, 0.02), BEACON, on(H, 0, 1.105, 0), 1.2);
    } else {
      b.add(
        new THREE.SphereGeometry(0.2, 22, 10, 0, TAU, 0, Math.PI * 0.6),
        p.shell,
        on(R, 0, 0.06, 0),
        curved,
        tag,
      );
      b.add(shaft(0.22, 0.22, 0.03, 22), p.metal, R, bare, tag);
      for (const [wx, wz, h] of [
        [0.22, 0.1, 0.34],
        [-0.2, -0.14, 0.22],
      ])
        b.add(shaft(0.006, 0.003, h, 4), p.metal, on(R, wx, 0, wz), bare, tag);
    }
  };

  // The towers stand off the deck's two back corners.
  const off = (DECK_R + TOWER_GAP) * Math.SQRT1_2;
  tower(DECK_X - off, side * off, 1, true);
  if (towers === 2) tower(DECK_X - off, -side * off, 0.78, false);

  return { built: b.build(), pad, towers };
}
