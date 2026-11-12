/**
 * Parts for the landmarks that stand on the terrain map, and the builder that
 * merges them into one geometry.
 *
 * A landmark is built round its own origin, standing on y = 0, in its own
 * units. The layer places, turns and scales it. Every vertex carries its
 * colour, the kind of surface it is (which the material draws a pattern for)
 * and the part it belongs to.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** sRGB, 0 to 255. */
export type Rgb = [number, number, number];

/**
 * 0 masonry, 1 brick, 2 rock, 3 glass, 5 a second cast concrete drawn as 8 is,
 * 6 cast concrete in broad ribs, 7 bare trim, 8 cast concrete panels, 9 an
 * anomaly's worn skin, 10 the same skin worn smooth, 11 painted metal plate with seams, 12
 * painted metal with none, as on a tank or a dome, 13 bare metal.
 */
export type Kind = 0 | 1 | 2 | 3 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

/** What a part is, so a test can find it. */
export type PartTag = "body" | "tower" | "mast" | "crag";
const TAGS: PartTag[] = ["body", "tower", "mast", "crag"];

export interface Paint {
  kind?: Kind;
  /** What settles on upward faces: moss, snow, ash. */
  top?: Rgb;
  /** 0 to 1: how much of the upward faces it covers. */
  topCover?: number;
  /** Skip the grime at the part's foot, for parts that stand on other parts. */
  clean?: boolean;
  /** A multiplier on the colour at a point. */
  tint?: (x: number, y: number, z: number) => number;
  /** Opacity at a point. Given, the part is drawn see-through at its edges. */
  fade?: (x: number, y: number, z: number) => number;
  /** A colour to pull the part towards at a point, such as the ground's own. */
  blend?: (x: number, z: number) => Rgb | undefined;
  /** 0 to 1: how far towards `blend` a point is pulled. */
  blendWeight?: (x: number, z: number) => number;
  /** What has bled onto the part: rust, oxide, soot. Later ones lie over earlier. */
  stains?: Stain[];
}

export interface Stain {
  colour: Rgb;
  /** 0 to 1: how much of it shows at a point. */
  at: (x: number, y: number, z: number) => number;
}

export const TAU = Math.PI * 2;
/** How far each part's shade drifts from the next: masonry varies more. */
const DRIFT = 0.14;
const MASONRY_DRIFT = 0.3;
/** Paint is one colour from the tin, so metal parts drift less than cast ones. */
const METAL_DRIFT = 0.05;

const hash3 = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Value noise, 0 to 1. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const f = (t: number) => t * t * (3 - 2 * t);
  const u = f(x - xi);
  const v = f(y - yi);
  const w = f(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) =>
    hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** A random number source that gives the same run for the same seed. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const linear = (c: Rgb) =>
  new THREE.Color().setRGB(
    c[0] / 255,
    c[1] / 255,
    c[2] / 255,
    THREE.SRGBColorSpace,
  );

/** A placement: at x, y, z, turned `ry` about the vertical, scaled `s`. */
export const at = (x: number, y: number, z: number, ry = 0, s = 1) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
    new THREE.Vector3(s, s, s),
  );

/** A placement relative to another. */
export const on = (m: THREE.Matrix4, x: number, y: number, z: number, ry = 0) =>
  m.clone().multiply(at(x, y, z, ry));

/** A placement `r` out along bearing `a`, turned to face out from the centre. */
export const polar = (r: number, a: number, y = 0, turn = 0) =>
  at(r * Math.cos(a), y, r * Math.sin(a), -a + turn);

/** A box standing on y = 0, with enough vertices to take weathering. */
export function box(
  w: number,
  h: number,
  d: number,
  bevel = 0,
  /** The largest a face's cells may be, so weathering has vertices to land on. */
  cell = 0.25,
): THREE.BufferGeometry {
  const g =
    bevel > 0
      ? new RoundedBoxGeometry(w, h, d, 2, Math.min(bevel, w / 2, h / 2, d / 2))
      : new THREE.BoxGeometry(
          w,
          h,
          d,
          Math.max(1, Math.round(w / cell)),
          Math.max(1, Math.round(h / cell)),
          Math.max(1, Math.round(d / cell)),
        );
  g.translate(0, h / 2, 0);
  return g;
}

/** A round or many-sided shaft standing on y = 0. */
export function shaft(
  rBottom: number,
  rTop: number,
  h: number,
  sides = 20,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(
    rTop,
    rBottom,
    h,
    sides,
    Math.max(1, Math.round(h / 0.2)),
  );
  g.translate(0, h / 2, 0);
  return g;
}

/** A shaft lying along +x from the origin, its far end raised by `lift` radians. */
export function tube(r: number, len: number, sides = 8, lift = 0, rEnd = r) {
  return shaft(r, rEnd, len, sides).rotateZ(-(Math.PI / 2 - lift));
}

/** A block with battered sides: `k` below 1 narrows the top, above 1 widens it. */
export function block(w: number, h: number, d: number, k: number) {
  const big = Math.max(1, k);
  return shaft(1 / big, k / big, h, 4)
    .rotateY(Math.PI / 4)
    .scale((w * big) / Math.SQRT2, 1, (d * big) / Math.SQRT2);
}

/** A closed band of `rows` rings of `segs` points each, from a function. */
export function sweep(
  rows: number,
  segs: number,
  fn: (i: number, s: number) => [number, number, number],
): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < rows; i++)
    for (let s = 0; s < segs; s++) pos.push(...fn(i, s));
  for (let i = 0; i < rows - 1; i++)
    for (let s = 0; s < segs; s++) {
      const a0 = i * segs + s;
      const a1 = i * segs + ((s + 1) % segs);
      idx.push(a0, a1, a0 + segs, a1, a1 + segs, a0 + segs);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Turn a closed skin so its faces look outwards, whichever way it was wound.
 * The sign of the volume it encloses says which way that is.
 */
export function faceOut(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute("position");
  const idx = g.index;
  if (!idx) return g;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let volume = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    volume += a.dot(b.cross(c));
  }
  if (volume < 0)
    for (let i = 0; i < idx.count; i += 3) {
      const first = idx.getX(i);
      idx.setX(i, idx.getX(i + 1));
      idx.setX(i + 1, first);
    }
  return g;
}

/** What {@link Builder.build} gives back: geometries, with no material yet. */
export interface BuiltLandmark {
  solid: THREE.BufferGeometry;
  /** Parts drawn see-through at their edges, or none. */
  soft: THREE.BufferGeometry | null;
  /** Parts that shine, or none. */
  glow: THREE.BufferGeometry | null;
  triangles: number;
  /** The box round every vertex of the parts with a tag, or null for none. */
  bounds(tag: PartTag): THREE.Box3 | null;
  /** Every vertex of the parts with a tag, x y z after x y z. */
  vertices(tag: PartTag): Float32Array;
}

export class Builder {
  private solid: THREE.BufferGeometry[] = [];
  private lit: THREE.BufferGeometry[] = [];
  private soft: THREE.BufferGeometry[] = [];
  private n = 0;

  add(
    g: THREE.BufferGeometry,
    color: Rgb,
    m: THREE.Matrix4,
    paint: Paint = {},
    tag: PartTag = "body",
  ): void {
    const flat = g.index ? g.toNonIndexed() : g;
    flat.deleteAttribute("uv");
    flat.applyMatrix4(m);
    flat.computeVertexNormals();
    flat.computeBoundingBox();
    const bb = flat.boundingBox as THREE.Box3;
    const pos = flat.getAttribute("position");
    const nor = flat.getAttribute("normal");
    const count = pos.count;
    const size = paint.fade ? 4 : 3;
    const col = new Float32Array(count * size);
    const kind = new Float32Array(count).fill(paint.kind ?? 8);
    const part = new Float32Array(count).fill(TAGS.indexOf(tag));
    const base = linear(color);
    const top = paint.top ? linear(paint.top) : null;
    const cover = paint.topCover ?? 0.5;
    const stains = (paint.stains ?? []).map((s) => ({
      colour: linear(s.colour),
      at: s.at,
    }));
    const shade = hash3(this.n++, 3.1, 7.7);
    const metal = (paint.kind ?? 8) >= 11;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const ny = nor.getY(i);
      c.copy(base);
      // No two parts the same shade, and each drifts a little warm or cool.
      const drift =
        (shade - 0.5) *
        (paint.kind === 0 ? MASONRY_DRIFT : metal ? METAL_DRIFT : DRIFT);
      c.r *= 1 + drift * 1.2;
      c.g *= 1 + drift;
      c.b *= 1 + drift * 0.7;
      // Weathering in broad patches and fine grain.
      const broad = noise3(x * 1.3, y * 1.3, z * 1.3);
      const fine = noise3(x * 7, y * 7, z * 7);
      // Paint weathers less than stone does.
      c.multiplyScalar(
        metal
          ? 0.93 + broad * 0.1 + fine * 0.04
          : 0.84 + broad * 0.24 + fine * 0.1,
      );
      if (ny < 0.4) {
        // Streaks down the walls from the top edge.
        const streak = noise3(x * 9, 0.5, z * 9);
        const down = 1 - smooth(0, 0.7, bb.max.y - y);
        c.multiplyScalar(
          1 - (metal ? 0.12 : 0.22) * down * smooth(0.45, 0.8, streak),
        );
        // Grime where the part meets what it stands on.
        if (!paint.clean)
          c.multiplyScalar(
            metal
              ? 0.78 + 0.22 * smooth(0, 0.12, y - bb.min.y)
              : 0.6 + 0.4 * smooth(0, 0.3, y - bb.min.y),
          );
      } else {
        c.multiplyScalar(metal ? 1.04 : 1.1);
        if (top) {
          const settled = noise3(x * 2.2, y * 2.2, z * 2.2) * 0.7 + fine * 0.3;
          c.lerp(
            top,
            smooth(1 - cover - 0.15, 1 - cover + 0.15, settled) *
              smooth(0.4, 0.9, ny),
          );
        }
      }
      for (const stain of stains) c.lerp(stain.colour, stain.at(x, y, z));
      if (paint.tint) c.multiplyScalar(paint.tint(x, y, z));
      const towards = paint.blend?.(x, z);
      if (towards) c.lerp(linear(towards), paint.blendWeight?.(x, z) ?? 0);
      col[i * size] = c.r;
      col[i * size + 1] = c.g;
      col[i * size + 2] = c.b;
      if (paint.fade) col[i * size + 3] = paint.fade(x, y, z);
    }
    flat.setAttribute("color", new THREE.BufferAttribute(col, size));
    flat.setAttribute("kind", new THREE.BufferAttribute(kind, 1));
    flat.setAttribute("part", new THREE.BufferAttribute(part, 1));
    (paint.fade ? this.soft : this.solid).push(flat);
  }

  /** A part that shines: a lamp, a collar of light. */
  glow(g: THREE.BufferGeometry, color: Rgb, m: THREE.Matrix4, gain = 1): void {
    const flat = g.index ? g.toNonIndexed() : g;
    flat.deleteAttribute("uv");
    flat.deleteAttribute("normal");
    flat.applyMatrix4(m);
    const count = flat.getAttribute("position").count;
    const col = new Float32Array(count * 3);
    const c = linear(color).multiplyScalar(gain);
    for (let i = 0; i < count; i++) col.set([c.r, c.g, c.b], i * 3);
    flat.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.lit.push(flat);
  }

  build(): BuiltLandmark {
    const solid = mergeGeometries(this.solid);
    const soft = this.soft.length > 0 ? mergeGeometries(this.soft) : null;
    const glow = this.lit.length > 0 ? mergeGeometries(this.lit) : null;
    for (const g of [...this.solid, ...this.soft, ...this.lit]) g.dispose();
    const sheets = soft ? [solid, soft] : [solid];
    const vertices = (tag: PartTag): Float32Array => {
      const want = TAGS.indexOf(tag);
      const out: number[] = [];
      for (const g of sheets) {
        const pos = g.getAttribute("position");
        const part = g.getAttribute("part");
        for (let i = 0; i < pos.count; i++)
          if (part.getX(i) === want)
            out.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      }
      return new Float32Array(out);
    };
    return {
      solid,
      soft,
      glow,
      triangles:
        sheets.reduce((n, g) => n + g.getAttribute("position").count, 0) / 3,
      bounds: (tag) => {
        const v = vertices(tag);
        if (v.length === 0) return null;
        return new THREE.Box3().setFromArray(v);
      },
      vertices,
    };
  }
}
