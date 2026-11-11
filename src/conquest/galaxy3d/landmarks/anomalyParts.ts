/**
 * What the standing anomalies share: a skin lofted through worn sections, the
 * wear that eats into it, the heaped ground at its foot and the rubble on it.
 */
import * as THREE from "three";
import {
  type Builder,
  box,
  faceOut,
  noise3,
  type Paint,
  type Rgb,
  smooth,
  sweep,
  TAU,
} from "./kit";

/** How far an anomaly reaches from its origin: the edge of its heaped ground. */
export const ANOMALY_REACH = 1.5;
/** How far its shadow may fall: it stands about twice as tall as it reaches. */
export const ANOMALY_SHADOW_REACH = 3.2;
/** How far a standing mass goes down into the ground. */
export const SINK = 0.4;

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * A point on a rectangle of half sizes `a` by `b` with corners of radius `r`,
 * `s` of the way round it from 0 to 1. Points are spread evenly along the
 * outline, so a long thin section still has vertices on its long faces.
 */
export function roundRect(
  a: number,
  b: number,
  r: number,
  s: number,
): [number, number] {
  const c = Math.max(1e-4, Math.min(r, a, b));
  const sx = 2 * (a - c);
  const sy = 2 * (b - c);
  const arc = (Math.PI / 2) * c;
  let d = (s - Math.floor(s)) * (2 * sx + 2 * sy + 4 * arc);
  const turn = (cx: number, cy: number, from: number): [number, number] => [
    cx + c * Math.cos(from + d / c),
    cy + c * Math.sin(from + d / c),
  ];
  if (d < sy) return [a, -(b - c) + d];
  d -= sy;
  if (d < arc) return turn(a - c, b - c, 0);
  d -= arc;
  if (d < sx) return [a - c - d, b];
  d -= sx;
  if (d < arc) return turn(-(a - c), b - c, Math.PI / 2);
  d -= arc;
  if (d < sy) return [-a, b - c - d];
  d -= sy;
  if (d < arc) return turn(-(a - c), -(b - c), Math.PI);
  d -= arc;
  if (d < sx) return [-(a - c) + d, -b];
  d -= sx;
  return turn(a - c, -(b - c), Math.PI * 1.5);
}

/** One cut through a lofted skin: a rounded rectangle in the plane of two axes. */
export interface Section {
  c: THREE.Vector3;
  ua: THREE.Vector3;
  ub: THREE.Vector3;
  a: number;
  b: number;
  r: number;
}

/**
 * A closed skin through `rows` sections, `segs` points round each. `shape`
 * may move each point: `inward` points at the section's centre, `t` runs 0 to
 * 1 along the skin and `k` is 1 on the skin and less on the caps that close
 * its two ends. A ring has no ends: its last section must match its first.
 */
export function loft(
  rows: number,
  segs: number,
  section: (t: number) => Section,
  shape?: (
    p: THREE.Vector3,
    inward: THREE.Vector3,
    t: number,
    k: number,
  ) => void,
  opts: { ring?: boolean; caps?: number } = {},
): THREE.BufferGeometry {
  const caps = opts.ring ? 0 : (opts.caps ?? 5);
  const total = rows + 2 * caps;
  const p = new THREE.Vector3();
  const inward = new THREE.Vector3();
  let row = -1;
  let sec: Section | null = null;
  return faceOut(
    sweep(total, segs, (i, s) => {
      const body = Math.min(rows - 1, Math.max(0, i - caps));
      const t = body / (rows - 1);
      if (body !== row || !sec) {
        sec = section(t);
        row = body;
      }
      const k =
        i < caps ? i / caps : i >= caps + rows ? (total - 1 - i) / caps : 1;
      const [a, b] = roundRect(sec.a, sec.b, sec.r, s / segs);
      p.copy(sec.c)
        .addScaledVector(sec.ua, a * k)
        .addScaledVector(sec.ub, b * k);
      inward.copy(sec.c).sub(p).normalize();
      shape?.(p, inward, t, k);
      return [p.x, p.y, p.z];
    }),
  );
}

/**
 * How far wear has eaten into a skin at a point: chips that leave a flat
 * floor and a sharp lip, smaller chips, and grain.
 */
export function wear(x: number, y: number, z: number, seed: number): number {
  const o = (seed % 89) + 0.5;
  return (
    smooth(0.56, 0.6, noise3(x * 2.3 + o, y * 2.3, z * 2.3)) * 0.035 +
    smooth(0.6, 0.64, noise3(x * 5.5, y * 5.5 + o, z * 5.5)) * 0.018 +
    (noise3(x * 15, y * 15, z * 15 + o) - 0.5) * 0.012
  );
}

/** Noise cut into `steps` flat levels, 0 to 1: a broken edge, not a wavy one. */
export const terraced = (n: number, steps: number) =>
  Math.floor(Math.min(0.999, Math.max(0, n)) * steps) / (steps - 1);

/** Dirt where a standing mass meets the ground, as a multiplier on its colour. */
export const footGrime = (y: number) => 0.62 + 0.38 * smooth(-0.05, 0.55, y);

/** A placement: turned `yaw`, then leant `lean` over towards bearing `to`. */
export function stand(
  yaw: number,
  lean = 0,
  to = 0,
  x = 0,
  y = 0,
  z = 0,
): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(x, y, z)
    .multiply(new THREE.Matrix4().makeRotationY(yaw))
    .multiply(
      new THREE.Matrix4().makeRotationAxis(
        new THREE.Vector3(Math.sin(to), 0, -Math.cos(to)),
        lean,
      ),
    );
}

/** A function of a point, asked in the frame a placement `m` put the part in. */
export function inFrame(
  m: THREE.Matrix4,
  fn: (x: number, y: number, z: number) => number,
): (x: number, y: number, z: number) => number {
  const inv = m.clone().invert();
  const v = new THREE.Vector3();
  return (x, y, z) => {
    v.set(x, y, z).applyMatrix4(inv);
    return fn(v.x, v.y, v.z);
  };
}

/** A heap of fallen stuff on the ground: where, how high and how wide. */
export interface Heap {
  x: number;
  z: number;
  h: number;
  w: number;
}

/**
 * The ground heaped round an anomaly's foot, and its height at a point. It
 * lies on the terrain, takes the ground's own colour towards its edge and
 * fades out there, so the anomaly has no plinth.
 */
export function addApron(
  b: Builder,
  ground: (x: number, z: number) => number,
  rock: Rgb,
  top: Rgb,
  topCover: number,
  heaps: Heap[],
  edgeColour?: (x: number, z: number) => Rgb | undefined,
): (x: number, z: number) => number {
  const FADE_FROM = 0.3;
  const FADE_TO = 1.25;
  const heightAt = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    let y =
      ground(x, z) +
      0.1 * (1 - smooth(0.15, 1.2, r)) +
      (noise3(x * 3 + 9, 2, z * 3) - 0.5) * 0.05 * (1 - smooth(1, 1.5, r));
    for (const h of heaps) {
      const d = Math.hypot(x - h.x, z - h.z) / h.w;
      if (d < 1.6) y += h.h * Math.exp(-d * d * 2.2);
    }
    return y;
  };
  const ROWS = 34;
  const SEGS = 112;
  b.add(
    sweep(ROWS, SEGS, (i, s) => {
      const a = (s / SEGS) * TAU;
      const r = (i / (ROWS - 1)) * ANOMALY_REACH;
      const x = r * Math.cos(a);
      const z = r * Math.sin(a);
      const sink = 0.03 * smooth(0.85, 1, i / (ROWS - 1));
      return [x, heightAt(x, z) - 0.01 - sink, z];
    }),
    rock,
    new THREE.Matrix4(),
    {
      kind: 2,
      top,
      topCover: topCover * 0.35,
      clean: true,
      fade: (x, _y, z) => {
        const r = Math.hypot(x, z) + (noise3(x * 3.4, 5, z * 3.4) - 0.5) * 0.3;
        return (
          1 - Math.min(1, Math.max(0, (r - FADE_FROM) / (FADE_TO - FADE_FROM)))
        );
      },
      blend: edgeColour,
      blendWeight: (x, z) => 0.7 * smooth(0.1, 1, Math.hypot(x, z)),
    },
    "crag",
  );
  return heightAt;
}

/** An angular lump of broken stone, about `w` by `h` by `d`, round its origin. */
export function chunk(
  w: number,
  h: number,
  d: number,
  seed: number,
): THREE.BufferGeometry {
  const size = Math.min(w, h, d);
  const g = box(w, h, d, 0, Math.max(w, h, d) / 3);
  g.translate(0, -h / 2, 0);
  const pos = g.getAttribute("position");
  const f = 2.2 / size;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = (o: number) =>
      (noise3(x * f + seed + o, y * f + o, z * f - o) - 0.5) * size * 0.7;
    pos.setXYZ(i, x + n(0), y + n(17), z + n(31));
  }
  return g;
}

/**
 * Broken stone strewn on the ground: `count` lumps between `from` and `to`
 * of the origin, each sunk a little, bigger ones nearer in.
 */
export function addRubble(
  b: Pick<Builder, "add">,
  rand: () => number,
  heightAt: (x: number, z: number) => number,
  colour: Rgb,
  paint: Paint,
  count: number,
  from: number,
  to: number,
  centre: [number, number] = [0, 0],
): void {
  for (let i = 0; i < count; i++) {
    const a = rand() * TAU;
    const far = rand();
    const r = from + (to - from) * far * far;
    const x = centre[0] + r * Math.cos(a);
    const z = centre[1] + r * Math.sin(a);
    const size = (0.07 + 0.16 * rand()) * (1.15 - 0.6 * far);
    const m = new THREE.Matrix4()
      .makeTranslation(x, heightAt(x, z) + size * 0.15, z)
      .multiply(
        new THREE.Matrix4().makeRotationFromEuler(
          new THREE.Euler(rand() * TAU, rand() * TAU, rand() * TAU),
        ),
      );
    b.add(
      chunk(
        size * (1 + rand()),
        size * (0.6 + 0.5 * rand()),
        size * (0.8 + 0.6 * rand()),
        i * 7.3 + from,
      ),
      colour,
      m,
      paint,
    );
  }
}
