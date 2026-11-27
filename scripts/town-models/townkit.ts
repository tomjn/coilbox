import { deflateSync } from "node:zlib";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Builder } from "../../src/conquest/galaxy3d/landmarks/kit";
import {
  GROOVE_DEPTH,
  RECESS_DEPTH,
  SEAM_DEPTH,
} from "../../src/conquest/galaxy3d/landmarks/material";

export const OUT = new URL(
  "../../docs/reports/town-models/out/",
  import.meta.url,
).pathname;
/** STL and OBJ have no units and slicers read millimetres: one world unit is written as 100 mm. */
export const MM = 100;
/** Texels per world unit, and the largest atlas side. */
export const DENSITY = Number(process.env.DENSITY ?? 512);
const MAX_SIDE = 2048;
/** Empty texels round each chart, so filtering never reaches the next one. */
const PAD = 2;
export const OPEN_PLANETS = ["temperate", "desert", "ice"] as const;

// --- geometry ------------------------------------------------------------

/** Every part of a model in one geometry: position, normal, colour (rgb, linear) and kind, glow as kind -1. */
export function built(fill: (b: Builder) => void): THREE.BufferGeometry {
  const b = new Builder();
  fill(b);
  const r = b.build();
  const parts: THREE.BufferGeometry[] = [];
  for (const g of [r.solid, r.soft, r.glow]) {
    if (!g) continue;
    const pos = g.getAttribute("position");
    const p = new THREE.BufferGeometry();
    p.setAttribute("position", pos);
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    p.setAttribute("normal", g.getAttribute("normal"));
    const src = g.getAttribute("color");
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++)
      for (let c = 0; c < 3; c++)
        col[i * 3 + c] = src.array[i * src.itemSize + c];
    p.setAttribute("color", new THREE.BufferAttribute(col, 3));
    p.setAttribute(
      "kind",
      g.getAttribute("kind") ??
        new THREE.BufferAttribute(new Float32Array(pos.count).fill(-1), 1),
    );
    parts.push(p);
  }
  return mergeGeometries(parts);
}

/** A point in the files' frame: millimetres, Z up. */
export const out = (
  x: number,
  y: number,
  z: number,
): [number, number, number] => [x * MM, -z * MM, y * MM];

export function stl(g: THREE.BufferGeometry): Buffer {
  const pos = g.getAttribute("position");
  const tris = pos.count / 3;
  const buf = Buffer.alloc(84 + tris * 50);
  buf.write("coilbox town model", 0, "ascii");
  buf.writeUInt32LE(tris, 80);
  const v = [0, 1, 2].map(() => new THREE.Vector3());
  const n = new THREE.Vector3();
  const e = new THREE.Vector3();
  let o = 84;
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++)
      v[k].set(
        ...out(pos.getX(t * 3 + k), pos.getY(t * 3 + k), pos.getZ(t * 3 + k)),
      );
    n.subVectors(v[1], v[0]).cross(e.subVectors(v[2], v[0])).normalize();
    for (const c of [n, ...v]) {
      buf.writeFloatLE(c.x, o);
      buf.writeFloatLE(c.y, o + 4);
      buf.writeFloatLE(c.z, o + 8);
      o += 12;
    }
    o += 2;
  }
  return buf;
}

// --- unwrap --------------------------------------------------------------

export interface Unwrap {
  /** Atlas size in texels. */
  w: number;
  h: number;
  /** Texel coordinates per vertex, x then y, y down. */
  uv: Float32Array;
  density: number;
}

/** The axis a face is projected along: 0 x, 1 y, 2 z, and its sign. */
function axisOf(n: THREE.Vector3): [number, number] {
  const a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
  const k = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2;
  return [k, Math.sign(n.getComponent(k)) || 1];
}

/**
 * Charts are faces joined at an edge that face the same way along the same
 * axis, each projected flat along it, then packed in shelves.
 */
export function unwrap(g: THREE.BufferGeometry): Unwrap {
  const pos = g.getAttribute("position");
  const tris = pos.count / 3;
  const v = [0, 1, 2].map(() => new THREE.Vector3());
  const n = new THREE.Vector3();
  const e = new THREE.Vector3();
  const group: number[] = [];
  const proj = new Float32Array(pos.count * 2);
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, t * 3 + k);
    n.subVectors(v[1], v[0]).cross(e.subVectors(v[2], v[0]));
    const [axis, sign] = axisOf(n);
    group.push(axis * 2 + (sign > 0 ? 1 : 0));
    for (let k = 0; k < 3; k++) {
      const p = v[k];
      const [u, w] =
        axis === 0
          ? [p.z * -sign, -p.y]
          : axis === 1
            ? [p.x, p.z * sign]
            : [p.x * sign, -p.y];
      proj[(t * 3 + k) * 2] = u;
      proj[(t * 3 + k) * 2 + 1] = w;
    }
  }
  // Join faces through shared edges.
  const parent = Array.from({ length: tris }, (_, i) => i);
  const find = (i: number): number => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const key = (i: number) =>
    `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
  const edges = new Map<string, number>();
  for (let t = 0; t < tris; t++)
    for (let k = 0; k < 3; k++) {
      const a = key(t * 3 + k);
      const b = key(t * 3 + ((k + 1) % 3));
      const ek = `${group[t]}|${a < b ? `${a}|${b}` : `${b}|${a}`}`;
      const other = edges.get(ek);
      if (other === undefined) edges.set(ek, t);
      else parent[find(t)] = find(other);
    }
  const charts = new Map<
    number,
    { tris: number[]; min: [number, number]; max: [number, number] }
  >();
  for (let t = 0; t < tris; t++) {
    const r = find(t);
    let c = charts.get(r);
    if (!c) {
      c = { tris: [], min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
      charts.set(r, c);
    }
    c.tris.push(t);
    for (let k = 0; k < 3; k++)
      for (let d = 0; d < 2; d++) {
        const x = proj[(t * 3 + k) * 2 + d];
        c.min[d] = Math.min(c.min[d], x);
        c.max[d] = Math.max(c.max[d], x);
      }
  }
  const list = [...charts.values()];
  // Shelf-pack at a density, or null if it will not fit in MAX_SIDE.
  const pack = (density: number) => {
    const rects = list
      .map((c, i) => ({
        i,
        w: Math.ceil((c.max[0] - c.min[0]) * density) + 2 * PAD + 1,
        h: Math.ceil((c.max[1] - c.min[1]) * density) + 2 * PAD + 1,
      }))
      .sort((a, b) => b.h - a.h);
    const area = rects.reduce((s, r) => s + r.w * r.h, 0);
    const widest = Math.max(...rects.map((r) => r.w));
    let side = 64;
    while (side < Math.max(widest, Math.sqrt(area))) side *= 2;
    for (; side <= MAX_SIDE; side *= 2) {
      const at = new Map<number, [number, number]>();
      let x = 0,
        y = 0,
        shelf = 0;
      for (const r of rects) {
        if (x + r.w > side) {
          x = 0;
          y += shelf;
          shelf = 0;
        }
        at.set(r.i, [x, y]);
        x += r.w;
        shelf = Math.max(shelf, r.h);
      }
      const h = y + shelf;
      if (h <= side) {
        let hh = 64;
        while (hh < h) hh *= 2;
        return { w: side, h: hh, at };
      }
    }
    return null;
  };
  let density = DENSITY;
  let packed = pack(density);
  while (!packed) {
    density *= 0.9;
    packed = pack(density);
  }
  const uv = new Float32Array(pos.count * 2);
  list.forEach((c, i) => {
    const [ox, oy] = packed.at.get(i) as [number, number];
    for (const t of c.tris)
      for (let k = 0; k < 3; k++) {
        const j = t * 3 + k;
        uv[j * 2] = ox + PAD + (proj[j * 2] - c.min[0]) * density;
        uv[j * 2 + 1] = oy + PAD + (proj[j * 2 + 1] - c.min[1]) * density;
      }
  });
  return { w: packed.w, h: packed.h, uv, density };
}

export function obj(
  name: string,
  g: THREE.BufferGeometry,
  u: Unwrap,
  texture: string,
): { obj: string; mtl: string } {
  const pos = g.getAttribute("position");
  const lines = [`mtllib ${name}.mtl`, `o ${name}`];
  for (let i = 0; i < pos.count; i++)
    lines.push(
      `v ${out(pos.getX(i), pos.getY(i), pos.getZ(i))
        .map((x) => x.toFixed(4))
        .join(" ")}`,
    );
  for (let i = 0; i < pos.count; i++)
    lines.push(
      `vt ${(u.uv[i * 2] / u.w).toFixed(6)} ${(1 - u.uv[i * 2 + 1] / u.h).toFixed(6)}`,
    );
  lines.push(`usemtl ${name}`, "s off");
  for (let t = 0; t < pos.count / 3; t++) {
    const a = t * 3 + 1;
    lines.push(`f ${a}/${a} ${a + 1}/${a + 1} ${a + 2}/${a + 2}`);
  }
  const mtl = [
    `newmtl ${name}`,
    "Ka 0 0 0",
    "Kd 1 1 1",
    "Ks 0 0 0",
    "d 1",
    "illum 1",
    `map_Kd textures/${texture}.png`,
    "",
  ].join("\n");
  return { obj: `${lines.join("\n")}\n`, mtl };
}

// --- bake ----------------------------------------------------------------

const fract = (x: number) => x - Math.floor(x);
const hash2 = (x: number, y: number) =>
  fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
const hash3 = (x: number, y: number, z: number) =>
  fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  const s = (f: number) => f * f * (3 - 2 * f);
  const fx = s(x - ix),
    fy = s(y - iy),
    fz = s(z - iz);
  const h = (a: number, b: number, c: number) => hash3(ix + a, iy + b, iz + c);
  return mix(
    mix(mix(h(0, 0, 0), h(1, 0, 0), fx), mix(h(0, 1, 0), h(1, 1, 0), fx), fy),
    mix(mix(h(0, 0, 1), h(1, 0, 1), fx), mix(h(0, 1, 1), h(1, 1, 1), fx), fy),
    fz,
  );
}

/**
 * The shade the landmark material multiplies a surface's colour by at a
 * point, before any lighting: a port of the pattern half of its fragment
 * shader. `step` is one texel in world units, standing in for fwidth.
 */
function pattern(
  kind: number,
  p: THREE.Vector3,
  n: THREE.Vector3,
  step: number,
  _outpost: boolean,
): number {
  const side = Math.abs(n.y) < 0.75;
  const u = Math.abs(n.x) > Math.abs(n.z) ? p.z : p.x;
  const cell = (size: [number, number], offsetRows: boolean, flat = false) => {
    const bx0 = (flat ? p.x : u) / size[0];
    const by = (flat ? p.z : p.y) / size[1];
    const bx = offsetRows ? bx0 + 0.5 * (((Math.floor(by) % 2) + 2) % 2) : bx0;
    const fx = fract(bx),
      fy = fract(by);
    const edge = Math.min(
      Math.min(fx, 1 - fx) * size[0],
      Math.min(fy, 1 - fy) * size[1],
    );
    const fade = clamp01(1 - Math.max(step / size[0], step / size[1]) * 1.6);
    return { edge, fade, h: hash2(Math.floor(bx), Math.floor(by)) };
  };
  let s = 1;
  if (kind < 0) return 1;
  if (kind < 0.5) {
    if (Math.abs(n.y) < 0.6) {
      const c = cell([0.13, 0.065], true);
      const mortar = 1 - smoothstep(0.004, 0.012, c.edge);
      const fade = clamp01(1 - (step / 0.065) * 0.9);
      s = mix(1, (0.76 + 0.48 * c.h) * (1 - 0.4 * mortar), fade);
    }
  } else if (kind < 1.5) {
    if (side) {
      const c = cell([0.018, 0.007], true);
      s = mix(1, 0.86 + 0.28 * c.h, c.fade);
    }
  } else if (kind > 2.5 && kind < 3.5) {
    if (side) {
      const c = cell([0.035, 0.05], false);
      const seam = 1 - smoothstep(0.001, 0.004, c.edge);
      s = mix(1, (0.78 + 0.44 * c.h) * (1 - 0.4 * seam), c.fade);
    }
  } else if ((kind > 7.5 && kind < 8.5) || (kind > 4.5 && kind < 5.5)) {
    const c = side
      ? cell([0.17, 0.36], false)
      : cell([0.31, 0.31], false, true);
    const seam = 1 - smoothstep(0.0015, 0.006, c.edge);
    const shade = c.h > 0.9 ? 0.85 : 0.95 + 0.09 * c.h;
    s = mix(1, shade * (1 - 0.16 * seam), c.fade);
  } else if (kind > 5.5 && kind < 6.5) {
    if (side) {
      const duty = 0.34;
      const b = p.y / 0.11;
      const w = step / 0.11;
      const f = fract(b);
      const groove = smoothstep(0, w, f) * (1 - smoothstep(duty, duty + w, f));
      const fade = clamp01(1.6 - w * 2.2);
      s = 1 - 0.42 * mix(duty, groove, fade);
    }
  } else if (kind > 10.5 && kind < 11.5) {
    const c = side
      ? cell([0.09, 0.075], false)
      : cell([0.09, 0.075], false, true);
    const seam = 1 - smoothstep(0.001, 0.004, c.edge);
    s = mix(1, (0.96 + 0.07 * c.h) * (1 - 0.3 * seam), c.fade);
  } else if (kind > 13.5) {
    const uu = side ? u + p.y : p.x + p.z;
    const b = uu / 0.06;
    const w = step / 0.06;
    const f = fract(b);
    const band =
      smoothstep(0.5 - w, 0.5 + w, f) * (1 - smoothstep(1 - w, 1, f));
    const fade = clamp01(1.6 - w * 2.2);
    s = mix(1 - (1 - 0.12) / 2, mix(1, 0.12, band), fade);
  }
  return s;
}

/**
 * How far a surface stands proud at a point, in world units, 0 at its face:
 * the joints, grooves and frames `pattern` draws, as relief a normal map can
 * light. It reads the same cells as `pattern`, so the two always line up.
 */
function relief(
  kind: number,
  p: THREE.Vector3,
  n: THREE.Vector3,
  step: number,
): number {
  const side = Math.abs(n.y) < 0.75;
  const u = Math.abs(n.x) > Math.abs(n.z) ? p.z : p.x;
  const cell = (size: [number, number], offsetRows: boolean, flat = false) => {
    const bx0 = (flat ? p.x : u) / size[0];
    const by = (flat ? p.z : p.y) / size[1];
    const bx = offsetRows ? bx0 + 0.5 * (((Math.floor(by) % 2) + 2) % 2) : bx0;
    const fx = fract(bx),
      fy = fract(by);
    const edge = Math.min(
      Math.min(fx, 1 - fx) * size[0],
      Math.min(fy, 1 - fy) * size[1],
    );
    const fade = clamp01(1 - Math.max(step / size[0], step / size[1]) * 1.6);
    return { edge, fade, h: hash2(Math.floor(bx), Math.floor(by)) };
  };
  // A joint is at least a texel wide, so the bake can see it.
  const joint = (edge: number, width: number) =>
    1 - smoothstep(0, Math.max(width, step), edge);
  if (kind < 0) return 0;
  if (kind < 0.5) {
    if (Math.abs(n.y) >= 0.6) return 0;
    const c = cell([0.13, 0.065], true);
    return (
      -SEAM_DEPTH * joint(c.edge, 0.008) * clamp01(1 - (step / 0.065) * 0.9)
    );
  }
  if (kind < 1.5) {
    if (!side) return 0;
    const c = cell([0.018, 0.007], true);
    return -SEAM_DEPTH * 0.5 * joint(c.edge, 0.001) * c.fade;
  }
  if (kind > 2.5 && kind < 3.5) {
    // A pane sits back from the frame round it.
    if (!side) return 0;
    const c = cell([0.035, 0.05], false);
    return SEAM_DEPTH * joint(c.edge, 0.003) * c.fade;
  }
  if ((kind > 7.5 && kind < 8.5) || (kind > 4.5 && kind < 5.5)) {
    const c = side
      ? cell([0.17, 0.36], false)
      : cell([0.31, 0.31], false, true);
    // The panels `pattern` shades darker are the recessed ones.
    const recess = c.h > 0.9 ? -RECESS_DEPTH * smoothstep(0, 0.012, c.edge) : 0;
    return (recess - SEAM_DEPTH * joint(c.edge, 0.004)) * c.fade;
  }
  if (kind > 5.5 && kind < 6.5) {
    if (!side) return 0;
    const duty = 0.34;
    const w = Math.max(step, 0.006) / 0.11;
    const f = fract(p.y / 0.11);
    const groove = smoothstep(0, w, f) * (1 - smoothstep(duty, duty + w, f));
    return -GROOVE_DEPTH * groove * clamp01(1.6 - (step / 0.11) * 2.2);
  }
  if (kind > 10.5 && kind < 11.5) {
    const c = side
      ? cell([0.09, 0.075], false)
      : cell([0.09, 0.075], false, true);
    return -SEAM_DEPTH * 0.6 * joint(c.edge, 0.003) * c.fade;
  }
  return 0;
}

/** Paint worn through to the primer on an open town's painted metal: how far, 0 to 1. */
function scuff(
  kind: number,
  p: THREE.Vector3,
  step: number,
  outpost: boolean,
): number {
  if (outpost || !((kind > 10.5 && kind < 12.5) || kind > 13.5)) return 0;
  const near = clamp01(1 - step * 30);
  const sc =
    noise3(p.x * 9, p.y * 9, p.z * 9) * 0.6 +
    noise3(p.x * 31, p.y * 31, p.z * 31) * 0.4;
  return 0.75 * smoothstep(0.66, 0.74, sc) * near;
}

const toSrgb = (c: number) => {
  const x = clamp01(c);
  return Math.round(
    255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055),
  );
};

/**
 * A surface's second texture as Recoil's model shaders read it: red glow,
 * green metalness, blue roughness, and an alpha of 255 so nothing is cut out.
 */
function material(
  kind: number,
  worn: number,
): [number, number, number, number] {
  const k = Math.round(kind);
  const [glow, metal, rough] =
    k < 0
      ? [1, 0, 0.5] // a lamp
      : k === 3
        ? [0, 0.1, 0.12] // glass
        : k === 13
          ? [0, 0.9, 0.3] // bare metal
          : k >= 11
            ? [0, 0.5 * (1 - worn), 0.45 + 0.4 * worn] // painted metal, dull where worn through
            : k === 7
              ? [0, 0.6, 0.4] // bare trim
              : [0, 0, 0.85]; // concrete, stone and brick
  return [
    Math.round(glow * 255),
    Math.round(metal * 255),
    Math.round(rough * 255),
    255,
  ];
}

/**
 * Visit every texel a model's triangles cover, each once: `cover` is 255
 * where a triangle holds the texel's centre and 254 where it only reaches
 * within half a texel of its edge. `visit` gets the triangle's first vertex
 * index, the texel's offset in an RGBA image, and its point on the surface.
 */
function rasterise(
  g: THREE.BufferGeometry,
  u: Unwrap,
  visit: (
    i0: number,
    o: number,
    p: THREE.Vector3,
    w: [number, number, number],
    inside: boolean,
  ) => void,
): Uint8Array {
  const pos = g.getAttribute("position");
  const cover = new Uint8Array(u.w * u.h);
  const p = new THREE.Vector3();
  const w: [number, number, number] = [0, 0, 0];
  const pts = [0, 1, 2].map(() => new THREE.Vector3());
  for (let t = 0; t < pos.count / 3; t++) {
    const i0 = t * 3;
    for (let k = 0; k < 3; k++) pts[k].fromBufferAttribute(pos, i0 + k);
    const ax = u.uv[i0 * 2],
      ay = u.uv[i0 * 2 + 1];
    const bx = u.uv[i0 * 2 + 2],
      by = u.uv[i0 * 2 + 3];
    const cx = u.uv[i0 * 2 + 4],
      cy = u.uv[i0 * 2 + 5];
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    // Cover every texel the triangle touches, reaching half a texel past its
    // edges so no texel inside a chart is left empty.
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1));
    const x1 = Math.min(u.w - 1, Math.ceil(Math.max(ax, bx, cx) + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1));
    const y1 = Math.min(u.h - 1, Math.ceil(Math.max(ay, by, cy) + 1));
    const tol = 0.75 / Math.sqrt(Math.abs(area));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5,
          py = y + 0.5;
        let w1 = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / area;
        let w2 = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / area;
        let w0 = 1 - w1 - w2;
        if (w0 < -tol || w1 < -tol || w2 < -tol) continue;
        const at = y * u.w + x;
        const inside = w0 >= 0 && w1 >= 0 && w2 >= 0;
        if (cover[at] === 255 || (!inside && cover[at] > 0)) continue;
        w0 = Math.max(0, w0);
        w1 = Math.max(0, w1);
        w2 = Math.max(0, w2);
        const sum = w0 + w1 + w2;
        w[0] = w0 / sum;
        w[1] = w1 / sum;
        w[2] = w2 / sum;
        p.set(0, 0, 0)
          .addScaledVector(pts[0], w[0])
          .addScaledVector(pts[1], w[1])
          .addScaledVector(pts[2], w[2]);
        cover[at] = inside ? 255 : 254;
        visit(i0, at * 4, p, w, inside);
      }
  }
  return cover;
}

/** How much an outside corner is lightened, 0 to 1. */
export const EDGE_STRENGTH = Number(process.env.EDGE_STRENGTH ?? 0.35);
/** How wide the lightened strip is, in texels. */
export const EDGE_WIDTH = Number(process.env.EDGE_WIDTH ?? 2);
/** Faces meeting at more than this angle form a corner: 60 degrees, so an octagon's 45 degree facets do not. */
const CORNER_COS = Math.cos(Math.PI / 3);

function distToSegment(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
): number {
  const abx = b.x - a.x,
    aby = b.y - a.y,
    abz = b.z - a.z;
  const len = abx * abx + aby * aby + abz * abz;
  const t =
    len > 0
      ? clamp01(
          ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len,
        )
      : 0;
  return Math.hypot(
    p.x - a.x - abx * t,
    p.y - a.y - aby * t,
    p.z - a.z - abz * t,
  );
}

/**
 * Per triangle corner k, whether the edge from vertex k to vertex k + 1 is an
 * outside corner: shared with a triangle facing more than 60 degrees away
 * whose far vertex lies behind this triangle's plane.
 */
function convexEdges(g: THREE.BufferGeometry): Uint8Array {
  const pos = g.getAttribute("position");
  const tris = pos.count / 3;
  const out = new Uint8Array(pos.count);
  const key = (i: number) =>
    `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
  const normals: THREE.Vector3[] = [];
  const v = [0, 1, 2].map(() => new THREE.Vector3());
  const e = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, t * 3 + k);
    normals.push(
      new THREE.Vector3()
        .subVectors(v[1], v[0])
        .cross(e.subVectors(v[2], v[0]))
        .normalize(),
    );
  }
  const edges = new Map<string, number[]>();
  for (let t = 0; t < tris; t++)
    for (let k = 0; k < 3; k++) {
      const a = key(t * 3 + k);
      const b = key(t * 3 + ((k + 1) % 3));
      const ek = a < b ? `${a}|${b}` : `${b}|${a}`;
      const list = edges.get(ek);
      if (list) list.push(t * 3 + k);
      else edges.set(ek, [t * 3 + k]);
    }
  const far = new THREE.Vector3();
  const on = new THREE.Vector3();
  for (const list of edges.values()) {
    if (list.length !== 2) continue;
    const [i, j] = list;
    const ti = Math.floor(i / 3),
      tj = Math.floor(j / 3);
    if (normals[ti].dot(normals[tj]) > CORNER_COS) continue;
    // The far vertex of tj, against ti's plane.
    far.fromBufferAttribute(pos, tj * 3 + (((j % 3) + 2) % 3));
    on.fromBufferAttribute(pos, i);
    if (far.sub(on).dot(normals[ti]) < 0) out[i] = out[j] = 1;
  }
  return out;
}

/**
 * Bake a model's colours and patterns into its atlas. Given `pbr`, the same
 * size as the result, it is filled with the matching second texture. Given
 * `ao` from `bakeAo` on the same unwrap, colours are darkened by it at
 * `AO_STRENGTH`, except on lamps and glass.
 */
export function bake(
  g: THREE.BufferGeometry,
  u: Unwrap,
  outpost: boolean,
  pbr?: Uint8Array,
  ao?: Float32Array,
  edges = EDGE_STRENGTH,
): Uint8Array {
  const nor = g.getAttribute("normal");
  const col = g.getAttribute("color");
  const kinds = g.getAttribute("kind");
  const img = new Uint8Array(u.w * u.h * 4);
  const step = 1 / u.density;
  const n = new THREE.Vector3();
  const primer = [0.16, 0.11, 0.08];
  const pos = g.getAttribute("position");
  const convex = convexEdges(g);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const width = EDGE_WIDTH / u.density;
  rasterise(g, u, (i0, o, p, w, inside) => {
    n.fromBufferAttribute(nor, i0).normalize();
    const kind = kinds.getX(i0);
    const s = pattern(kind, p, n, step, outpost);
    const worn = scuff(kind, p, step, outpost);
    const shaded = kind >= 0 && Math.round(kind) !== 3;
    const open = ao && shaded ? ao[o / 4] : 1;
    const lit = mix(1, open, AO_STRENGTH);
    // A catch-light along outside corners, fading over EDGE_WIDTH texels.
    let edge = 0;
    if (shaded)
      for (let k = 0; k < 3; k++) {
        if (!convex[i0 + k]) continue;
        a.fromBufferAttribute(pos, i0 + k);
        b.fromBufferAttribute(pos, i0 + ((k + 1) % 3));
        edge = Math.max(edge, 1 - smoothstep(0, width, distToSegment(p, a, b)));
      }
    // A box standing on a roof has an outside corner at its foot, but the roof hides it: AO tells the two apart.
    if (ao) edge *= smoothstep(0.6, 0.85, open);
    for (let c = 0; c < 3; c++) {
      const base =
        col.getComponent(i0, c) * w[0] +
        col.getComponent(i0 + 1, c) * w[1] +
        col.getComponent(i0 + 2, c) * w[2];
      const paint = mix(base * s, primer[c], worn) * lit;
      img[o + c] = toSrgb(
        mix(paint, Math.min(1, paint * 1.6 + 0.08), edges * edge),
      );
    }
    img[o + 3] = inside ? 255 : 254;
    if (pbr) {
      // Occluded corners are rougher and less metallic, so they do not catch reflections the AO has darkened.
      const m = material(kind, worn);
      if (shaded && ao) {
        const hidden = (1 - open) * AO_STRENGTH;
        m[1] = Math.round(m[1] * (1 - hidden));
        m[2] = Math.round(mix(m[2], 255, hidden));
      }
      pbr.set(m, o);
    }
  });
  // Grow each chart into its padding so filtering at a seam takes its own colour.
  for (let pass = 0; pass < PAD; pass++) {
    const prev = img.slice();
    const prevPbr = pbr?.slice();
    for (let y = 0; y < u.h; y++)
      for (let x = 0; x < u.w; x++) {
        const o = (y * u.w + x) * 4;
        if (prev[o + 3] > 0) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= u.w || ny >= u.h) continue;
          const q = (ny * u.w + nx) * 4;
          if (prev[q + 3] === 0) continue;
          img[o] = prev[q];
          img[o + 1] = prev[q + 1];
          img[o + 2] = prev[q + 2];
          img[o + 3] = 253;
          if (pbr && prevPbr) pbr.set(prevPbr.subarray(q, q + 4), o);
          break;
        }
      }
  }
  return img;
}

/** How far an outside corner's normal leans over its edge, 0 to 1, where 1 is halfway to the next face. */
export const BEVEL_STRENGTH = 0.7;

/**
 * Bake a model's normal map on the same unwrap as `bake`: the relief of its
 * joints and grooves, and outside corners rounded over `EDGE_WIDTH` texels.
 * Tangent space as BAR and Splinter Faction read it: red along the texture's
 * u, green along the normal crossed with that, and blue out of the face.
 * Given `ao`, a corner the model hides is not rounded, as `bake` lights it.
 */
export function bakeNormals(
  g: THREE.BufferGeometry,
  u: Unwrap,
  ao?: Float32Array,
): Uint8Array {
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const kinds = g.getAttribute("kind");
  const img = new Uint8Array(u.w * u.h * 4);
  // A flat face everywhere no chart reaches, the floors' patch among them.
  for (let o = 0; o < img.length; o += 4) img.set([128, 128, 255, 0], o);
  const step = 1 / u.density;
  const convex = convexEdges(g);
  const n = new THREE.Vector3();
  const t = new THREE.Vector3();
  const b = new THREE.Vector3();
  const q = new THREE.Vector3();
  const lean = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const a = new THREE.Vector3();
  const c = new THREE.Vector3();
  const width = EDGE_WIDTH / u.density;
  let tri = -1;
  rasterise(g, u, (i0, o, p) => {
    if (i0 !== tri) {
      // The triangle's tangent: the way its texture's u runs, as the engine finds it.
      tri = i0;
      n.fromBufferAttribute(nor, i0).normalize();
      e1.fromBufferAttribute(pos, i0 + 1).sub(a.fromBufferAttribute(pos, i0));
      e2.fromBufferAttribute(pos, i0 + 2).sub(a);
      const du1 = u.uv[i0 * 2 + 2] - u.uv[i0 * 2],
        dv1 = u.uv[i0 * 2 + 3] - u.uv[i0 * 2 + 1];
      const du2 = u.uv[i0 * 2 + 4] - u.uv[i0 * 2],
        dv2 = u.uv[i0 * 2 + 5] - u.uv[i0 * 2 + 1];
      const d = du1 * dv2 - du2 * dv1;
      t.copy(e1)
        .multiplyScalar(dv2)
        .addScaledVector(e2, -dv1)
        .multiplyScalar(Math.sign(d) || 1);
      t.addScaledVector(n, -n.dot(t)).normalize();
      b.crossVectors(n, t);
    }
    const kind = kinds.getX(i0);
    // The slope of the relief along the tangent and the bitangent.
    const h = (dt: number, db: number) =>
      relief(
        kind,
        q.copy(p).addScaledVector(t, dt).addScaledVector(b, db),
        n,
        step,
      );
    const st = (h(step / 2, 0) - h(-step / 2, 0)) / step;
    const sb = (h(0, step / 2) - h(0, -step / 2)) / step;
    let x = -st,
      y = -sb,
      z = 1;
    // Lean towards each outside corner close by, as a rounded edge does.
    const open = ao ? smoothstep(0.6, 0.85, ao[o / 4]) : 1;
    if (kind >= 0 && Math.round(kind) !== 3 && open > 0)
      for (let k = 0; k < 3; k++) {
        if (!convex[i0 + k]) continue;
        a.fromBufferAttribute(pos, i0 + k);
        c.fromBufferAttribute(pos, i0 + ((k + 1) % 3)).sub(a);
        // The way out over the edge, square to it in the face. It is taken
        // from the edge, not the texel: a texel on the chart's border sits on
        // the edge itself, where the way to it is lost in rounding.
        lean.crossVectors(c, n).normalize();
        // The triangle's third corner is on the inside of the edge.
        if (lean.dot(q.fromBufferAttribute(pos, i0 + ((k + 2) % 3)).sub(a)) > 0)
          lean.negate();
        const dist = Math.abs(lean.dot(q.copy(p).sub(a)));
        if (dist >= width) continue;
        const s = BEVEL_STRENGTH * open * (1 - smoothstep(0, width, dist));
        x += lean.dot(t) * s;
        y += lean.dot(b) * s;
      }
    const len = Math.hypot(x, y, z);
    x /= len;
    y /= len;
    z /= len;
    img[o] = Math.round((x * 0.5 + 0.5) * 255);
    img[o + 1] = Math.round((y * 0.5 + 0.5) * 255);
    img[o + 2] = Math.round((z * 0.5 + 0.5) * 255);
    img[o + 3] = 255;
  });
  // Grow each chart into its padding, as bake does.
  for (let pass = 0; pass < PAD; pass++) {
    const prev = img.slice();
    for (let y = 0; y < u.h; y++)
      for (let x = 0; x < u.w; x++) {
        const o = (y * u.w + x) * 4;
        if (prev[o + 3] > 0) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= u.w || ny >= u.h) continue;
          const r = (ny * u.w + nx) * 4;
          if (prev[r + 3] === 0) continue;
          img.set(prev.subarray(r, r + 3), o);
          img[o + 3] = 254;
          break;
        }
      }
  }
  // Alpha is a height to BAR's raptor option only: opaque everywhere.
  for (let o = 3; o < img.length; o += 4) img[o] = 255;
  return img;
}

// --- ambient occlusion -----------------------------------------------------

/** How far the AO darkens toward fully shaded, 0 to 1. */
export const AO_STRENGTH = Number(process.env.AO_STRENGTH ?? 0.8);
/** Rays per texel. */
export const AO_RAYS = Number(process.env.AO_RAYS ?? 256);
/** How far a ray looks for something in the way, in world units. */
export const AO_REACH = Number(process.env.AO_REACH ?? 0.3);

/** A bounding volume hierarchy over a model's triangles, for shadow rays. */
interface Bvh {
  /** Triangle corners, nine floats each, in leaf order. */
  tri: Float32Array;
  /** Per node: min xyz, max xyz. */
  box: Float32Array;
  /** Per node: first child, or for a leaf the first triangle. */
  start: Uint32Array;
  /** Per node: 0 for an inner node with children start and start + 1, else the leaf's triangle count. */
  count: Uint32Array;
}

function buildBvh(g: THREE.BufferGeometry): Bvh {
  const pos = g.getAttribute("position");
  const n = pos.count / 3;
  const src = new Float32Array(n * 9);
  const centre = new Float32Array(n * 3);
  for (let t = 0; t < n; t++)
    for (let k = 0; k < 3; k++) {
      src[t * 9 + k * 3] = pos.getX(t * 3 + k);
      src[t * 9 + k * 3 + 1] = pos.getY(t * 3 + k);
      src[t * 9 + k * 3 + 2] = pos.getZ(t * 3 + k);
      for (let a = 0; a < 3; a++)
        centre[t * 3 + a] += src[t * 9 + k * 3 + a] / 3;
    }
  const order = Uint32Array.from({ length: n }, (_, i) => i);
  const nodes = Math.max(1, 2 * n);
  const box = new Float32Array(nodes * 6);
  const start = new Uint32Array(nodes);
  const count = new Uint32Array(nodes);
  let used = 1;
  // Split each node at the median along its longest side until four or fewer triangles are left.
  const stack: [number, number, number][] = [[0, 0, n]];
  while (stack.length > 0) {
    const [node, lo, hi] = stack.pop() as [number, number, number];
    const b = node * 6;
    box.fill(Infinity, b, b + 3);
    box.fill(-Infinity, b + 3, b + 6);
    for (let i = lo; i < hi; i++)
      for (let v = 0; v < 9; v++) {
        const x = src[order[i] * 9 + v];
        const a = v % 3;
        if (x < box[b + a]) box[b + a] = x;
        if (x > box[b + 3 + a]) box[b + 3 + a] = x;
      }
    if (hi - lo <= 4) {
      start[node] = lo;
      count[node] = hi - lo;
      continue;
    }
    const ext = [0, 1, 2].map((a) => box[b + 3 + a] - box[b + a]);
    const axis =
      ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
    const part = Array.from(order.subarray(lo, hi)).sort(
      (p, q) => centre[p * 3 + axis] - centre[q * 3 + axis],
    );
    order.set(part, lo);
    const mid = (lo + hi) >> 1;
    start[node] = used;
    count[node] = 0;
    stack.push([used, lo, mid], [used + 1, mid, hi]);
    used += 2;
  }
  const tri = new Float32Array(n * 9);
  for (let i = 0; i < n; i++)
    tri.set(src.subarray(order[i] * 9, order[i] * 9 + 9), i * 9);
  return { tri, box, start, count };
}

/** Whether a ray from o along unit d meets a triangle before `reach`. */
function blocked(
  bvh: Bvh,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  reach: number,
  stack: Uint32Array,
): boolean {
  const ix = 1 / dx,
    iy = 1 / dy,
    iz = 1 / dz;
  const { tri, box, start, count } = bvh;
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const node = stack[--top];
    const b = node * 6;
    let t0 = (box[b] - ox) * ix,
      t1 = (box[b + 3] - ox) * ix;
    let near = Math.min(t0, t1),
      far = Math.max(t0, t1);
    t0 = (box[b + 1] - oy) * iy;
    t1 = (box[b + 4] - oy) * iy;
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
    t0 = (box[b + 2] - oz) * iz;
    t1 = (box[b + 5] - oz) * iz;
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
    if (far < Math.max(near, 0) || near > reach) continue;
    if (count[node] === 0) {
      stack[top++] = start[node];
      stack[top++] = start[node] + 1;
      continue;
    }
    for (let i = start[node], end = i + count[node]; i < end; i++) {
      // Möller-Trumbore, from either side.
      const q = i * 9;
      const ax = tri[q],
        ay = tri[q + 1],
        az = tri[q + 2];
      const e1x = tri[q + 3] - ax,
        e1y = tri[q + 4] - ay,
        e1z = tri[q + 5] - az;
      const e2x = tri[q + 6] - ax,
        e2y = tri[q + 7] - ay,
        e2z = tri[q + 8] - az;
      const px = dy * e2z - dz * e2y,
        py = dz * e2x - dx * e2z,
        pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const sx = ox - ax,
        sy = oy - ay,
        sz = oz - az;
      const bu = (sx * px + sy * py + sz * pz) * inv;
      if (bu < 0 || bu > 1) continue;
      const qx = sy * e1z - sz * e1y,
        qy = sz * e1x - sx * e1z,
        qz = sx * e1y - sy * e1x;
      const bv = (dx * qx + dy * qy + dz * qz) * inv;
      if (bv < 0 || bu + bv > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 0 && t < reach) return true;
    }
  }
  return false;
}

/**
 * How much open sky each texel sees, 1 open to 0 enclosed: the share of
 * cosine-weighted rays that travel `AO_REACH` without meeting the model or
 * the ground at height `ground`. It depends only on the shape, so one map
 * serves every colourway of a model on the same unwrap.
 */
export function bakeAo(
  g: THREE.BufferGeometry,
  u: Unwrap,
  ground: number,
): Float32Array {
  const bvh = buildBvh(g);
  const nor = g.getAttribute("normal");
  const ao = new Float32Array(u.w * u.h).fill(1);
  const stack = new Uint32Array(256);
  const n = new THREE.Vector3();
  const t1 = new THREE.Vector3();
  const t2 = new THREE.Vector3();
  const lift = 0.5 / u.density;
  // A square grid of strata, turned and shifted per texel so neighbours do not share a pattern.
  const side = Math.ceil(Math.sqrt(AO_RAYS));
  const pos = g.getAttribute("position");
  const centre = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const cover = rasterise(g, u, (i0, o, p) => {
    // Sample half a texel in from the triangle's edges: a point on an edge
    // where a wall meets a ledge can round into the ledge and see no sky.
    centre.set(0, 0, 0);
    for (let k = 0; k < 3; k++)
      centre.add(corner.fromBufferAttribute(pos, i0 + k));
    centre.divideScalar(3).sub(p);
    const gap = centre.length();
    if (gap > 0) p.addScaledVector(centre, Math.min(lift, gap / 2) / gap);
    n.fromBufferAttribute(nor, i0).normalize();
    t1.set(Math.abs(n.x) > 0.9 ? 0 : 1, Math.abs(n.x) > 0.9 ? 1 : 0, 0)
      .cross(n)
      .normalize();
    t2.crossVectors(n, t1);
    const ox = p.x + n.x * lift,
      oy = p.y + n.y * lift,
      oz = p.z + n.z * lift;
    const jx = hash3(p.x * 913.1, p.y * 571.7, p.z * 337.3);
    const jy = hash3(p.z * 419.9, p.x * 283.3, p.y * 761.1);
    let open = 0;
    for (let s = 0; s < side * side; s++) {
      const r = Math.sqrt(fract(((s % side) + jx) / side));
      const phi = 2 * Math.PI * fract((Math.floor(s / side) + jy) / side);
      const a = r * Math.cos(phi),
        b = r * Math.sin(phi),
        c = Math.sqrt(Math.max(0, 1 - r * r));
      const dx = t1.x * a + t2.x * b + n.x * c;
      const dy = t1.y * a + t2.y * b + n.y * c;
      const dz = t1.z * a + t2.z * b + n.z * c;
      if (dy < 0 && (ground - oy) / dy < AO_REACH) continue;
      if (!blocked(bvh, ox, oy, oz, dx, dy, dz, AO_REACH, stack)) open++;
    }
    ao[o / 4] = open / (side * side);
  });
  // Grow each chart into its padding, as bake does.
  for (let pass = 0; pass < PAD; pass++) {
    const prev = cover.slice();
    for (let y = 0; y < u.h; y++)
      for (let x = 0; x < u.w; x++) {
        if (prev[y * u.w + x] > 0) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = x + dx,
            ny = y + dy;
          if (
            nx < 0 ||
            ny < 0 ||
            nx >= u.w ||
            ny >= u.h ||
            prev[ny * u.w + nx] === 0
          )
            continue;
          ao[y * u.w + x] = ao[ny * u.w + nx];
          cover[y * u.w + x] = 253;
          break;
        }
      }
  }
  return ao;
}

/** An AO map as an opaque grey RGBA image, for `png`. */
export function aoImage(ao: Float32Array): Uint8Array {
  const img = new Uint8Array(ao.length * 4);
  for (let i = 0; i < ao.length; i++) {
    const v = Math.round(clamp01(ao[i]) * 255);
    img[i * 4] = v;
    img[i * 4 + 1] = v;
    img[i * 4 + 2] = v;
    img[i * 4 + 3] = 255;
  }
  return img;
}

// --- s3o -----------------------------------------------------------------

/**
 * A Recoil .s3o: one piece, triangles, Y up, in elmos at `scale` per world
 * unit, with UVs read top down as a PNG is. The textures are file names in
 * the archive's unittextures/ folder.
 */
export function s3o(
  g: THREE.BufferGeometry,
  u: Unwrap,
  texture: string,
  texture2: string,
  scale: number,
): { bytes: Buffer; box: THREE.Box3 } {
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const count = pos.count;
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++)
    box.expandByPoint(p.fromBufferAttribute(pos, i).multiplyScalar(scale));
  const mid = box.getCenter(new THREE.Vector3());
  let radius = 0;
  for (let i = 0; i < count; i++)
    radius = Math.max(
      radius,
      p.fromBufferAttribute(pos, i).multiplyScalar(scale).distanceTo(mid),
    );
  const name = Buffer.from("base\0");
  const tex1 = Buffer.from(`${texture}\0`);
  const tex2 = Buffer.from(`${texture2}\0`);
  const HEADER = 52;
  const PIECE = 52;
  const nameAt = HEADER + PIECE;
  const vertAt =
    nameAt + name.length + ((4 - ((nameAt + name.length) % 4)) % 4);
  const indexAt = vertAt + count * 32;
  const tex1At = indexAt + count * 4;
  const tex2At = tex1At + tex1.length;
  const buf = Buffer.alloc(tex2At + tex2.length);
  buf.write("Spring unit\0", 0, "latin1");
  buf.writeInt32LE(0, 12);
  buf.writeFloatLE(radius, 16);
  buf.writeFloatLE(box.max.y, 20);
  buf.writeFloatLE(mid.x, 24);
  buf.writeFloatLE(mid.y, 28);
  buf.writeFloatLE(mid.z, 32);
  buf.writeUInt32LE(HEADER, 36);
  buf.writeUInt32LE(0, 40);
  buf.writeUInt32LE(tex1At, 44);
  buf.writeUInt32LE(tex2At, 48);
  buf.writeUInt32LE(nameAt, HEADER);
  buf.writeUInt32LE(0, HEADER + 4);
  buf.writeUInt32LE(0, HEADER + 8);
  buf.writeUInt32LE(count, HEADER + 12);
  buf.writeUInt32LE(vertAt, HEADER + 16);
  buf.writeUInt32LE(0, HEADER + 20);
  buf.writeUInt32LE(0, HEADER + 24);
  buf.writeUInt32LE(count, HEADER + 28);
  buf.writeUInt32LE(indexAt, HEADER + 32);
  buf.writeUInt32LE(0, HEADER + 36);
  name.copy(buf, nameAt);
  for (let i = 0; i < count; i++) {
    const o = vertAt + i * 32;
    buf.writeFloatLE(pos.getX(i) * scale, o);
    buf.writeFloatLE(pos.getY(i) * scale, o + 4);
    buf.writeFloatLE(pos.getZ(i) * scale, o + 8);
    buf.writeFloatLE(nor.getX(i), o + 12);
    buf.writeFloatLE(nor.getY(i), o + 16);
    buf.writeFloatLE(nor.getZ(i), o + 20);
    buf.writeFloatLE(u.uv[i * 2] / u.w, o + 24);
    buf.writeFloatLE(u.uv[i * 2 + 1] / u.h, o + 28);
    buf.writeUInt32LE(i, indexAt + i * 4);
  }
  tex1.copy(buf, tex1At);
  tex2.copy(buf, tex2At);
  return { bytes: buf, box };
}

// --- png -----------------------------------------------------------------

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** An 8-bit PNG: RGB, or with `alpha` RGBA, taking that alpha from the buffer. */
export function png(
  rgba: Uint8Array,
  w: number,
  h: number,
  alpha = false,
): Buffer {
  const ch = alpha ? 4 : 3;
  const raw = Buffer.alloc((w * ch + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < ch; c++)
        raw[y * (w * ch + 1) + 1 + x * ch + c] = rgba[(y * w + x) * 4 + c];
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A 16-bit greyscale PNG, samples big-endian as the format wants. */
export function png16(gray: Uint16Array, w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 2 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      raw.writeUInt16BE(gray[y * w + x], y * (w * 2 + 1) + 1 + x * 2);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 16;
  ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- run -----------------------------------------------------------------
