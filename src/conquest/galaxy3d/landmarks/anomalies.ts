/**
 * The standing anomalies of a run: things nobody built in living memory, each
 * one of a kind on its map. A monolith, a shard of plate sunk in the ground, a
 * slab with a hole clean through it, a stem that carries a head out over
 * nothing, the stump of a drum on roots, and a great ball sunk in the ground
 * with a hole bored into it.
 *
 * Each is one worn skin with a broken edge somewhere, standing in its own
 * rubble on ground heaped at its foot. The seed varies its proportions, its
 * lean and what has broken off, so two runs never show quite the same one.
 */
import * as THREE from "three";
import {
  ANOMALY_REACH,
  ANOMALY_SHADOW_REACH,
  addApron,
  addRubble,
  chunk,
  footGrime,
  type Heap,
  inFrame,
  loft,
  mix,
  SINK,
  stand,
  terraced,
  wear,
} from "./anomalyParts";
import type { AnomalyKind } from "./kinds";
import {
  Builder,
  type BuiltLandmark,
  faceOut,
  noise3,
  type Paint,
  type Rgb,
  seeded,
  smooth,
  sweep,
  TAU,
} from "./kit";
import type { AnomalyPalette } from "./palettes";

export { ANOMALY_REACH, ANOMALY_SHADOW_REACH };

export type StandingAnomaly = Exclude<AnomalyKind, "ruin">;

const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

interface Ctx {
  b: Builder;
  p: AnomalyPalette;
  rand: () => number;
  seed: number;
  /** Heaps to raise on the ground, gathered before the ground is built. */
  heaps: Heap[];
  /** Work that needs the ground's height, run once the ground is built. */
  after: ((heightAt: (x: number, z: number) => number) => void)[];
}

/** Rust that runs down a face in streaks and gathers in patches. */
const rustAt =
  (seed: number, strength: number) => (x: number, y: number, z: number) =>
    strength *
    Math.max(
      smooth(0.5, 0.75, noise3(x * 9 + seed, y * 0.7, z * 9)),
      smooth(0.55, 0.8, noise3(x * 1.9, y * 1.9 + seed, z * 1.9)),
    );

/**
 * A tall slab, tapered or square, cracked through and leaning. One of three:
 * an obelisk broken off at a slant, a tower with a slot down it, or a stele
 * with panels cut into its faces and its foot fallen away.
 */
function monolith({ b, p, rand, seed, heaps, after }: Ctx): void {
  const variant = seed % 3;
  const h = (variant === 1 ? 2.8 : 2.4) + rand() * 0.5;
  const w0 = variant === 0 ? 0.3 + rand() * 0.05 : 0.33 + rand() * 0.09;
  const d0 = variant === 1 ? 0.27 + rand() * 0.05 : 0.19 + rand() * 0.05;
  const taper = variant === 0 ? 0.42 + rand() * 0.1 : 0.1 + rand() * 0.1;
  const colour =
    variant === 0
      ? mix(p.concrete, p.slate, 0.25)
      : variant === 1
        ? p.slate
        : mix(p.concrete, p.rust, 0.45);
  const yaw = (rand() - 0.5) * 1.2;
  const m = stand(yaw, 0.03 + rand() * 0.07, rand() * TAU);
  const half = (t: number) => {
    const k = (1 - taper * t) * (1 + 0.22 * smooth(0.3, 0, t));
    return [w0 * k, d0 * k];
  };
  // A slant the top broke off along, and one or two cracks the upper part
  // has slipped along.
  const breakTo = rand() * TAU;
  const breakBy = variant === 0 ? 0.9 + rand() * 0.8 : 0.25 + rand() * 0.5;
  const cracks = [0.45 + rand() * 0.15, 0.72 + rand() * 0.1].map((at) => ({
    y: at * h,
    tilt: (rand() - 0.5) * 0.7,
    slip: 0.02 + rand() * 0.025,
  }));
  const slotX = (rand() - 0.5) * 0.2;
  const bite = { x: rand() < 0.5 ? -1 : 1, z: rand() < 0.5 ? -1 : 1 };
  const biteSize = variant === 2 ? 0.75 : 0.45;
  const top = (x: number, z: number) =>
    h -
    breakBy *
      Math.max(0, x * Math.cos(breakTo) + z * Math.sin(breakTo) + 0.08) -
    0.16 * terraced(noise3(x * 7 + seed, 3, z * 7), 4);

  b.add(
    loft(
      104,
      96,
      (t) => {
        const [a, d] = half(t);
        return {
          c: new THREE.Vector3(0, -SINK + t * (h + SINK), 0),
          ua: X,
          ub: Z,
          a,
          b: d,
          r: 0.035,
        };
      },
      (v, inward, t, k) => {
        const [a, d] = half(t);
        const face = Math.sign(v.z) * smooth(0.6, 0.95, Math.abs(v.z) / d);
        if (variant === 1) {
          // A slot down each broad face.
          const inSlot =
            smooth(0.075, 0.05, Math.abs(v.x - slotX)) *
            smooth(0.8, 0.9, v.y) *
            smooth(h - 0.35, h - 0.5, v.y);
          v.z -= face * inSlot * 0.1;
        } else if (variant === 2) {
          // Panels cut one inside the other.
          const band = smooth(0.55, 0.62, v.y) * smooth(h - 0.3, h - 0.4, v.y);
          const outer = smooth(0.78, 0.7, Math.abs(v.x) / a) * band;
          const inner =
            smooth(0.46, 0.38, Math.abs(v.x) / a) *
            smooth(0.85, 0.92, v.y) *
            smooth(h - 0.6, h - 0.7, v.y);
          v.z -= face * (outer + inner) * 0.028;
        }
        // The foot has fallen away at one corner.
        const bd =
          Math.hypot(v.x - bite.x * w0, (v.y - 0.25) * 0.8, v.z - bite.z * d0) /
          biteSize;
        if (bd < 1) {
          const eat =
            (1 - bd) *
            (0.5 + 0.6 * terraced(noise3(v.x * 6, v.y * 6 + seed, v.z * 6), 3));
          v.x *= 1 - 0.75 * eat;
          v.z *= 1 - 0.5 * eat;
        }
        if (k === 1) {
          // Corners and edges go first.
          const corner =
            smooth(0.07, 0, a - Math.abs(v.x)) *
            smooth(0.07, 0, d - Math.abs(v.z));
          const notch =
            corner *
            0.07 *
            smooth(0.45, 0.55, noise3(v.x * 3, v.y * 3.5 + seed, v.z * 3));
          v.addScaledVector(
            inward,
            wear(v.x, v.y, v.z, seed) * (1 + 2 * corner) + notch,
          );
        }
        for (const c of cracks)
          if (v.y > c.y + c.tilt * v.x + 0.3 * v.z) {
            v.x += c.slip;
            v.z -= c.slip * 0.7;
          }
        v.y = Math.min(v.y, top(v.x, v.z));
      },
    ),
    colour,
    m,
    {
      kind: 9,
      top: p.top,
      topCover: p.topCover * 0.7,
      tint: (_x, y) => footGrime(y),
      stains: [
        { colour: p.rust, at: rustAt(seed, variant === 2 ? 0.55 : 0.3) },
      ],
    },
    "tower",
  );

  // What broke off lies where it fell, half buried.
  const fallTo = breakTo + yaw + (rand() - 0.5) * 0.6;
  const fx = Math.cos(fallTo) * (0.75 + rand() * 0.2);
  const fz = Math.sin(fallTo) * (0.75 + rand() * 0.2);
  heaps.push(
    { x: bite.x * w0 * 1.2, z: bite.z * d0 * 1.6, h: 0.2, w: 0.5 },
    { x: fx, z: fz, h: 0.1, w: 0.45 },
  );
  const stone: Paint = { kind: 9, top: p.top, topCover: p.topCover * 0.5 };
  after.push((heightAt) => {
    b.add(
      chunk(0.75 + rand() * 0.3, w0 * 1.1, d0 * 1.5, seed),
      colour,
      new THREE.Matrix4()
        .makeTranslation(fx, heightAt(fx, fz) + 0.02, fz)
        .multiply(
          new THREE.Matrix4().makeRotationFromEuler(
            new THREE.Euler(0.3, -fallTo + 0.5, 0.18),
          ),
        ),
      stone,
    );
    addRubble(b, rand, heightAt, colour, stone, 16, 0.12, 0.55, [
      bite.x * w0 * 1.4,
      bite.z * d0 * 1.8,
    ]);
    addRubble(b, rand, heightAt, p.rock, stone, 14, 0.45, 1.25);
  });
}

/**
 * A vast plate come down edge first and sunk at a slant: dark, strapped,
 * rusted, its upper edge raked to a point.
 */
function shard({ b, p, rand, seed, heaps, after }: Ctx): void {
  const len = 2.1 + rand() * 0.5;
  const tall = 3.1 + rand() * 0.6;
  const thick = 0.1 + rand() * 0.03;
  const tilt = 0.5 + rand() * 0.25;
  const rake = 0.3 + rand() * 0.25;
  const peak = rand() < 0.5 ? -1 : 1;
  const m = stand((rand() - 0.5) * 1.4, 0, 0, 0, -0.45, -0.8).multiply(
    new THREE.Matrix4()
      .makeRotationX(tilt)
      .multiply(new THREE.Matrix4().makeRotationZ((rand() - 0.5) * 0.3)),
  );
  // The edge it broke along rises to a point at one end.
  const edge = (x: number) =>
    tall * (1 - rake * (0.5 - (peak * x) / len)) -
    0.2 * terraced(noise3(x * 5 + seed, 1, 4), 4);
  const plate = (scale: number, off: number, straps: boolean) =>
    loft(
      Math.round(84 * scale),
      Math.round(150 * scale),
      (t) => {
        // It narrows towards the buried end, like a blade.
        const a = (len / 2) * scale * (0.62 + 0.38 * smooth(0, 0.5, t));
        return {
          c: new THREE.Vector3(0, t * tall * scale, off),
          ua: X,
          ub: Z,
          a,
          b: thick * (off === 0 ? 1 : 0.6),
          r: 0.03,
        };
      },
      (v, inward, _t, k) => {
        const side = Math.sign(v.z - off);
        if (straps) {
          // Straps across it, and a thicker rim at each end.
          const strap = smooth(0.42, 0.46, Math.abs(((v.y * 1.5) % 1) - 0.5));
          const rim = smooth(len / 2 - 0.22, len / 2 - 0.18, Math.abs(v.x));
          v.z += side * 0.03 * Math.max(strap, rim);
        }
        if (k === 1) v.addScaledVector(inward, wear(v.x, v.y, v.z, seed) * 0.8);
        v.y = Math.min(v.y, edge(v.x) * scale);
      },
    );
  const local = (fn: (x: number, y: number, z: number) => number) =>
    inFrame(m, fn);
  const paint: Paint = {
    kind: 9,
    top: p.top,
    topCover: p.topCover * 0.5,
    // Plates of slightly different metal, and dirt where it goes under.
    tint: (x, y, z) =>
      footGrime(y) *
      local(
        (lx, ly) =>
          0.86 +
          0.22 * noise3(Math.floor(lx * 1.9) * 7.1, Math.floor(ly * 1.4), seed),
      )(x, y, z),
    stains: [
      {
        colour: p.rust,
        at: local(
          (lx, ly, lz) =>
            Math.max(
              rustAt(seed, 0.5)(lx, ly, lz),
              // Rust along the broken edge and the ends.
              0.55 * smooth(0.35, 0.05, edge(lx) - ly),
              0.45 * smooth(len / 2 - 0.25, len / 2, Math.abs(lx)),
            ) *
            (0.55 + 0.45 * noise3(lx * 6, ly * 6, lz * 6 + seed)),
        ),
      },
    ],
  };
  b.add(plate(1, 0, true), p.slate, m, paint, "tower");
  // A second skin on its upper face, shorter, where the plating was doubled.
  b.add(
    plate(0.72, -thick * 1.5, false),
    mix(p.slate, p.concrete, 0.2),
    m,
    paint,
    "tower",
  );
  // Ground has drifted against the face it leans away from.
  heaps.push(
    { x: 0, z: -0.75, h: 0.3, w: 0.9 },
    { x: 0, z: -0.3, h: 0.16, w: 1.2 },
  );
  after.push((heightAt) => {
    const scrap: Paint = { kind: 9, stains: paint.stains };
    addRubble(b, rand, heightAt, p.slate, scrap, 10, 0.5, 1.2);
    addRubble(b, rand, heightAt, p.rock, { kind: 9, top: p.top }, 10, 0.4, 1.3);
  });
}

/**
 * A fluted slab with a round hole through it and its top cleft into two
 * spires, one broken short.
 */
function gate({ b, p, rand, seed, heaps, after }: Ctx): void {
  const hole = 0.44 + rand() * 0.1;
  const cy = 1.2 + rand() * 0.2;
  const wide = 0.74 + rand() * 0.1;
  const thick = 0.17 + rand() * 0.04;
  const tall = 2.7 + rand() * 0.4;
  // One spire has broken short.
  const shortSide = rand() < 0.5 ? -1 : 1;
  const shortBy = 0.35 + rand() * 0.5;
  const cleft = cy + hole + 0.3 + rand() * 0.2;
  const topAt = (x: number) => {
    const spire =
      Math.sign(x) === shortSide
        ? tall - shortBy - 0.18 * terraced(noise3(x * 9 + seed, 2, 5), 4)
        : tall - 0.3 * smooth(0.25, wide, Math.abs(x));
    return cleft + (spire - cleft) * smooth(0.04, 0.24, Math.abs(x));
  };
  const widthAt = (y: number) => wide * (1 - 0.2 * smooth(cy, tall, y));
  const inside = (x: number, y: number) =>
    y > -SINK && Math.abs(x) < widthAt(y) && y < topAt(x);
  /** How far the slab runs from the hole's centre along a bearing. */
  const outer = (u: number) => {
    const cx = Math.cos(u);
    const sy = Math.sin(u);
    let r = hole + 0.05;
    while (r < 4 && inside(r * cx, cy + r * sy)) r += 0.008;
    return r;
  };
  const m = stand((rand() - 0.5) * 0.8, 0.02 + rand() * 0.05, rand() * TAU);
  const colour = mix(p.slate, p.concrete, 0.3 + rand() * 0.25);
  b.add(
    loft(
      220,
      132,
      (t) => {
        const u = t * TAU;
        const dir = new THREE.Vector3(Math.cos(u), Math.sin(u), 0);
        const far = outer(u);
        return {
          c: new THREE.Vector3(0, cy, 0).addScaledVector(dir, (hole + far) / 2),
          ua: dir,
          ub: Z,
          a: (far - hole) / 2,
          b: thick,
          r: 0.05,
        };
      },
      (v, inward) => {
        const from = Math.hypot(v.x, v.y - cy);
        const face = smooth(0.5, 0.9, Math.abs(v.z) / thick);
        // A heavy collar round the hole, and flutes down the faces above it.
        const collar = smooth(hole + 0.24, hole + 0.2, from);
        const flute =
          smooth(0.2, 0.36, Math.abs((((v.x / 0.19) % 1) + 1) % 1) - 0.5) *
          (1 - collar);
        v.z *= 1 + face * (0.42 * collar - 0.2 * flute);
        v.addScaledVector(inward, wear(v.x, v.y, v.z, seed));
      },
      { ring: true },
    ),
    colour,
    m,
    {
      kind: 9,
      top: p.top,
      topCover: p.topCover * 0.6,
      tint: (_x, y) => footGrime(y),
      stains: [{ colour: p.rust, at: rustAt(seed, 0.28) }],
    },
    "tower",
  );
  heaps.push(
    { x: shortSide * 0.5, z: 0.5, h: 0.14, w: 0.5 },
    { x: 0, z: 0, h: 0.08, w: 1.1 },
  );
  after.push((heightAt) => {
    const stone: Paint = { kind: 9, top: p.top, topCover: p.topCover * 0.5 };
    addRubble(b, rand, heightAt, colour, stone, 14, 0.1, 0.5, [
      shortSide * 0.55,
      0.5,
    ]);
    addRubble(b, rand, heightAt, p.rock, stone, 12, 0.5, 1.25);
  });
}

/**
 * A stem that bends over and carries a long rounded head out past its own
 * foot, with nothing under it.
 */
function overhang({ b, p, rand, seed, heaps, after }: Ctx): void {
  const stem = 1.55 + rand() * 0.4;
  const bend = 0.5 + rand() * 0.12;
  const head = 0.85 + rand() * 0.35;
  const rise = 0.04 + rand() * 0.1;
  const arc = (Math.PI / 2 - rise) * bend;
  const total = SINK + stem + arc + head;
  const nose = 0.34;
  /** The spine at a distance along it: where it is and which way it runs. */
  const spine = (s: number): [THREE.Vector3, THREE.Vector3] => {
    if (s < SINK + stem)
      return [new THREE.Vector3(0, s - SINK, 0), new THREE.Vector3(0, 1, 0)];
    const turn = Math.min(Math.PI / 2 - rise, (s - SINK - stem) / bend);
    const at = new THREE.Vector3(
      bend * (1 - Math.cos(turn)),
      stem + bend * Math.sin(turn),
      0,
    );
    const dir = new THREE.Vector3(Math.sin(turn), Math.cos(turn), 0);
    const past = s - SINK - stem - arc;
    if (past > 0) at.addScaledVector(dir, past);
    return [at, dir];
  };
  const m = stand(
    (rand() - 0.5) * 1.6,
    0.02 + rand() * 0.04,
    rand() * TAU,
    -0.45,
    0,
    0,
  );
  const colour = mix(p.concrete, p.slate, 0.12 + rand() * 0.2);
  const headFrom = SINK + stem + arc * 0.6;
  b.add(
    loft(
      150,
      92,
      (t) => {
        const s = t * total;
        const [c, dir] = spine(s);
        const up = smooth(SINK + stem * 0.5, headFrom + 0.2, s);
        // Round the nose off.
        const end = Math.max(0, (s - (total - nose)) / nose);
        const round = Math.sqrt(Math.max(0.02, 1 - end * end));
        const flare = 0.3 * smooth(SINK + 0.7, 0, s);
        return {
          c,
          ua: new THREE.Vector3(-dir.y, dir.x, 0),
          ub: Z,
          a: (0.19 + flare * 0.8 + 0.13 * up) * round,
          b: (0.25 + flare + 0.17 * up) * round,
          r: 0.09,
        };
      },
      (v, inward, t, k) => {
        if (k < 1) return;
        const s = t * total;
        const [c, dir] = spine(s);
        const off = (v.x - c.x) * -dir.y + (v.y - c.y) * dir.x;
        const along = smooth(headFrom, headFrom + 0.25, s);
        // A channel along each side of the head, and ribs under it.
        const channel =
          along *
          smooth(0.2, 0.3, Math.abs(v.z)) *
          smooth(0.11, 0.07, Math.abs(off + 0.02));
        const ribs =
          along *
          smooth(-0.12, -0.2, off) *
          smooth(0.3, 0.4, Math.abs(((s * 4.5) % 1) - 0.5));
        // Grooves up the back of the stem.
        const groove =
          (1 - along) *
          smooth(0.05, 0.14, off) *
          smooth(0.3, 0.42, Math.abs((((v.z / 0.13) % 1) + 1) % 1) - 0.5);
        v.addScaledVector(
          inward,
          0.07 * channel +
            0.035 * ribs +
            0.03 * groove +
            wear(v.x, v.y, v.z, seed),
        );
      },
    ),
    colour,
    m,
    {
      kind: 9,
      top: p.top,
      topCover: p.topCover * 0.8,
      tint: (_x, y) => footGrime(y),
      stains: [
        { colour: p.slate, at: rustAt(seed + 3, 0.5) },
        { colour: p.rust, at: rustAt(seed, 0.22) },
      ],
    },
    "tower",
  );
  heaps.push({ x: -0.45, z: 0, h: 0.12, w: 0.8 });
  after.push((heightAt) => {
    const stone: Paint = { kind: 9, top: p.top, topCover: p.topCover * 0.5 };
    addRubble(b, rand, heightAt, p.rock, stone, 18, 0.35, 1.25);
  });
}

/**
 * The stump of a great drum on a trunk that spreads into roots: banded in
 * old copper and rust, its rim broken open and hollow inside.
 */
function stump({ b, p, rand, seed, heaps, after }: Ctx): void {
  const roots = 6 + Math.floor(rand() * 3);
  const trunk = 0.38 + rand() * 0.06;
  const drumAt = 1.15 + rand() * 0.25;
  const drum = trunk + 0.14 + rand() * 0.05;
  const top = drumAt + 0.95 + rand() * 0.3;
  const breach = rand() * TAU;
  const breachBy = 0.3 + rand() * 0.2;
  const twist = rand() * TAU;
  const floor = top - breachBy - 0.4;
  const wall = 0.13;
  const bands = [
    { y: drumAt + 0.38, w: 0.07 },
    { y: drumAt + 0.72, w: 0.06 },
  ];
  const rim = (a: number) => {
    const d = Math.abs(((a - breach + Math.PI * 3) % TAU) - Math.PI);
    return (
      top -
      breachBy * smooth(1.1, 0.25, d) -
      0.14 * terraced(noise3(Math.cos(a) * 3 + seed, Math.sin(a) * 3, 1), 4)
    );
  };
  const radius = (y: number, a: number) => {
    const ridge =
      (0.5 + 0.5 * Math.cos(roots * a + twist + 1.3 * noise3(a * 1.5, y, 4))) **
      2;
    const flare = 0.62 * Math.exp(-Math.max(0, y + 0.2) / 0.34);
    const furrow =
      0.022 *
      smooth(
        0.3,
        0.45,
        Math.abs(
          ((((a / TAU) * 26 + 0.4 * noise3(a * 3, y * 0.8, 9)) % 1) + 1) % 1,
        ) - 0.5,
      ) *
      smooth(drumAt + 0.05, drumAt - 0.15, y);
    let r = trunk + flare * (0.3 + 0.7 * ridge) - furrow;
    // The drum corbels out from the trunk in two steps.
    r +=
      (drum - trunk) *
      (0.5 * smooth(drumAt - 0.04, drumAt, y) +
        0.5 * smooth(drumAt + 0.14, drumAt + 0.18, y));
    for (const band of bands)
      r += 0.035 * smooth(band.w + 0.015, band.w, Math.abs(y - band.y));
    return r;
  };
  const OUT = 96;
  const IN = 14;
  const FLOOR = 4;
  const SEGS = 168;
  const m = stand((rand() - 0.5) * 2, 0.01 + rand() * 0.04, rand() * TAU);
  b.add(
    faceOut(
      sweep(1 + OUT + IN + FLOOR, SEGS, (i, s) => {
        const a = (s / SEGS) * TAU;
        const edge = rim(a);
        let y: number;
        let r: number;
        if (i === 0) return [0, -SINK, 0];
        if (i <= OUT) {
          y = Math.min(-SINK + ((i - 1) / (OUT - 1)) * (top + SINK), edge);
          r = radius(y, a);
          r -= wear(r * Math.cos(a), y, r * Math.sin(a), seed);
        } else if (i <= OUT + IN) {
          y = edge - ((i - OUT - 1) / (IN - 1)) * (edge - floor);
          r = radius(edge, a) - wall;
          r += wear(r * Math.cos(a), y, r * Math.sin(a), seed);
        } else {
          y = floor;
          r = (radius(edge, a) - wall) * (1 - (i - OUT - IN) / FLOOR);
        }
        return [r * Math.cos(a), y, r * Math.sin(a)];
      }),
    ),
    mix(p.slate, p.rust, 0.3),
    m,
    {
      kind: 9,
      top: p.top,
      topCover: p.topCover * 0.6,
      tint: (x, y, z) =>
        footGrime(y) *
        // Dark inside the hollow.
        (Math.hypot(x, z) < drum - wall && y > floor - 0.05 ? 0.5 : 1),
      stains: [
        // Old copper on the drum, in a broad worn band.
        {
          colour: p.oxide,
          at: (x, y, z) =>
            0.8 *
            smooth(drumAt + 0.18, drumAt + 0.24, y) *
            smooth(bands[1].y - 0.05, bands[1].y - 0.1, y) *
            smooth(0.3, 0.55, noise3(x * 3, y * 1.2 + seed, z * 3)),
        },
        // A rusted band above it, and rust run down from both.
        {
          colour: p.rust,
          at: (x, y, z) =>
            Math.max(
              0.85 *
                smooth(bands[1].y - 0.08, bands[1].y - 0.05, y) *
                smooth(bands[1].y + 0.2, bands[1].y + 0.12, y) *
                smooth(0.25, 0.5, noise3(x * 4, y * 2, z * 4 + seed)),
              rustAt(seed, 0.4)(x, y, z) *
                smooth(drumAt + 0.3, drumAt - 0.5, y),
            ),
        },
      ],
    },
    "tower",
  );
  heaps.push({ x: 0, z: 0, h: 0.1, w: 1.2 });
  const fell = breach + (rand() - 0.5) * 0.5;
  after.push((heightAt) => {
    const stone: Paint = { kind: 9, top: p.top, topCover: p.topCover * 0.5 };
    // What came out of the rim lies under the breach.
    addRubble(b, rand, heightAt, mix(p.slate, p.rust, 0.4), stone, 12, 0, 0.4, [
      Math.cos(fell) * 0.95,
      Math.sin(fell) * 0.95,
    ]);
    addRubble(b, rand, heightAt, p.rock, stone, 10, 0.8, 1.3);
  });
}

/**
 * A great ball sunk to its waist in the ground, a round hole bored into it
 * and its shell cracked into plates that have slipped.
 */
function sphere({ b, p, rand, seed, heaps, after }: Ctx): void {
  const R = 1.05 + rand() * 0.13;
  const cy = R * (0.5 + rand() * 0.12);
  const hole = R * (0.3 + rand() * 0.08);
  const deep = R * (0.5 + rand() * 0.15);
  const open = Math.asin(hole / R);
  const yaw = rand() * TAU;
  // The hole looks up and out, so it shows from above.
  const m = stand(yaw, 0.65 + rand() * 0.4, 0, 0, cy, 0);
  // Which way is down, in the ball's own frame, across the face of the hole.
  const down = new THREE.Vector3(0, -1, 0).transformDirection(
    m.clone().invert(),
  );
  down.y = 0;
  down.normalize();
  // Cracks right through it. The shell beyond each has slipped outwards.
  const slips = Array.from({ length: 3 + Math.floor(rand() * 2) }, () => ({
    n: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
    at: (rand() - 0.5) * 0.9,
    by: 0.006 + rand() * 0.006,
  }));
  // A piece has come away from the rim of the hole.
  const chipAt = rand() * TAU;
  const OUT = 120;
  const IN = 16;
  const FLOOR = 5;
  const SEGS = 200;
  const dir = new THREE.Vector3();
  b.add(
    faceOut(
      sweep(1 + OUT + IN + FLOOR, SEGS, (i, s) => {
        const a = (s / SEGS) * TAU;
        if (i === 0) return [0, -R, 0];
        const mouth = R * Math.cos(open);
        if (i <= OUT) {
          const polar = Math.PI - (i / OUT) * (Math.PI - open);
          dir.set(
            Math.sin(polar) * Math.cos(a),
            Math.cos(polar),
            Math.sin(polar) * Math.sin(a),
          );
          // The rim is cut back to a shallow bevel, deeper where it chipped.
          const round = Math.abs(((a - chipAt + Math.PI * 3) % TAU) - Math.PI);
          const chip =
            smooth(0.7, 0.2, round) *
            smooth(open + 0.3, open + 0.05, polar) *
            terraced(noise3(dir.x * 5 + seed, dir.y * 5, dir.z * 5), 3);
          let r = R - 0.035 * smooth(open + 0.09, open, polar) - 0.09 * chip;
          // Only the lowest pair of points sits on the hole's own edge.
          if (i < OUT) {
            for (const c of slips)
              if (
                dir.dot(c.n) >
                c.at + 0.25 * noise3(dir.x * 2, dir.y * 2, dir.z * 2 + seed)
              )
                r += c.by;
            // A ball this size weathers evenly, so its chips stay shallow.
            r -= 0.3 * wear(dir.x * R, dir.y * R, dir.z * R, seed);
          }
          return [dir.x * r, dir.y * r, dir.z * r];
        }
        if (i <= OUT + IN) {
          const y = mouth - ((i - OUT) / IN) * deep;
          const r =
            hole + wear(hole * Math.cos(a), y, hole * Math.sin(a), seed);
          return [r * Math.cos(a), y, r * Math.sin(a)];
        }
        const r = hole * (1 - (i - OUT - IN) / FLOOR);
        return [r * Math.cos(a), mouth - deep, r * Math.sin(a)];
      }),
    ),
    mix(p.concrete, p.slate, 0.1 + rand() * 0.15),
    m,
    {
      kind: 10,
      top: p.top,
      topCover: p.topCover * 0.5,
      tint: (x, y, z) =>
        footGrime(y) *
        // Dark down the hole.
        inFrame(m, (lx, ly, lz) =>
          Math.hypot(lx, lz) < hole * 1.04 && ly > 0
            ? 0.2 - 0.12 * smooth(R, R - deep * 0.6, ly)
            : 1,
        )(x, y, z),
      stains: [
        // What has run out of the hole and down the face under it.
        {
          colour: p.slate,
          at: inFrame(m, (lx, ly, lz) => {
            const out = Math.hypot(lx, lz);
            const under = smooth(hole * 0.9, hole * 1.1, out);
            const reach = smooth(hole * 3.2, hole * 1.1, out);
            const streak = smooth(
              0.42,
              0.7,
              noise3(Math.atan2(lz, lx) * 9, seed, out * 0.6),
            );
            // Only on the side of the hole that is downhill of it.
            const below = smooth(
              0.2,
              0.7,
              (lx * down.x + lz * down.z) / Math.max(1e-4, out),
            );
            return ly > 0 ? 0.75 * under * reach * streak * below : 0;
          }),
        },
        { colour: p.rust, at: rustAt(seed, 0.12) },
      ],
    },
    "tower",
  );
  // It lies in a hollow it made, the ground thrown up round it.
  const waist = Math.sqrt(R * R - cy * cy);
  for (let k = 0; k < 5; k++) {
    const a = rand() * TAU;
    heaps.push({
      x: Math.cos(a) * waist,
      z: Math.sin(a) * waist,
      h: 0.2 + rand() * 0.25,
      w: 0.35 + rand() * 0.3,
    });
  }
  after.push((heightAt) => {
    const stone: Paint = { kind: 9, top: p.top, topCover: p.topCover * 0.5 };
    addRubble(b, rand, heightAt, p.rock, stone, 10, waist * 1.05, 1.35);
  });
}

const MODELS: Record<StandingAnomaly, (ctx: Ctx) => void> = {
  monolith,
  shard,
  gate,
  overhang,
  stump,
  sphere,
};

export interface Anomaly {
  built: BuiltLandmark;
}

/**
 * Build a standing anomaly round its origin. `ground` is the terrain's height
 * under a point, less the height at the origin. `edgeColour` is the ground's
 * own colour at a point, which the heaped ground takes on towards its edge.
 */
export function buildAnomaly(
  kind: StandingAnomaly,
  ground: (x: number, z: number) => number,
  p: AnomalyPalette,
  seed: number,
  edgeColour?: (x: number, z: number) => Rgb | undefined,
): Anomaly {
  const ctx: Ctx = {
    b: new Builder(),
    p,
    rand: seeded(seed),
    seed,
    heaps: [],
    after: [],
  };
  MODELS[kind](ctx);
  const heightAt = addApron(
    ctx.b,
    ground,
    p.rock,
    p.top,
    p.topCover,
    ctx.heaps,
    edgeColour,
  );
  for (const run of ctx.after) run(heightAt);
  return { built: ctx.b.build() };
}
