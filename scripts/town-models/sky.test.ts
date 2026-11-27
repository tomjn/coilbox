/**
 * Renders Persepolis's skybox: the same town buildings carried on past the
 * map's edge as a city in every direction, seen from above the map's middle,
 * fading into haze. Writes one 2:1 panorama, which the engine turns into a
 * cube map itself, and a smaller preview.
 *
 * The engine looks up a direction d in the panorama at
 * u = atan2(d.z, d.x) / 2pi + 0.5, v = acos(d.y) / pi with v = 0 on the top
 * row (EquiRectConverterFS.glsl, with CubeMapVS.glsl's y flip when drawn).
 * x is east, z south, y up, as on the map.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { test } from "vitest";
import { seeded } from "../../src/conquest/galaxy3d/landmarks/kit";
import { TOWN_PALETTES } from "../../src/conquest/galaxy3d/landmarks/palettes";
import {
  BUILDINGS,
  type BuildingModel,
} from "../../src/conquest/galaxy3d/towns3d/buildings";
import {
  footprint,
  OPEN_GRID,
} from "../../src/conquest/galaxy3d/towns3d/layout";
import {
  dress,
  type Livery,
  liveryFor,
} from "../../src/conquest/galaxy3d/towns3d/liveries";
import { built, png } from "./townkit";

const OUT_DIR = new URL(
  "../../docs/reports/town-models/persepolis-sky/",
  import.meta.url,
).pathname;
const SCALE = 512;
const MAP = 14 * 512;
const LOT = OPEN_GRID.lot * SCALE;
const BLOCK: [number, number] = [
  OPEN_GRID.blockLots[0] * LOT,
  OPEN_GRID.blockLots[1] * LOT,
];
const STREET = 192;
const AVENUE = 320;
const PLANET = "temperate";

// Look choices, set by eye from the preview.
/** The eye's height over the streets, in elmos. */
const EYE_Y = Number(process.env.EYE_Y ?? 900);
/** How far the city reaches from the map's middle. */
const REACH = Number(process.env.REACH ?? 48000);
/** Buildings nearer than this are drawn whole, further ones as boxes. */
const DETAIL = Number(process.env.DETAIL ?? 24000);
/**
 * How much taller than its model a tower stands at the far edge of the city,
 * so the skyline clears the map's ring. It grows by the square root of this
 * across, so it keeps its build.
 */
const STRETCH = Number(process.env.STRETCH ?? 4);
/** The distance over which haze takes away all but 1/e of a colour. */
const HAZE = Number(process.env.HAZE ?? 30000);
const FACE = 2048;
const W = 4096;
const H = 2048;

const HORIZON: [number, number, number] = [0.7, 0.72, 0.8];
const ZENITH: [number, number, number] = [0.33, 0.47, 0.74];
const GROUND: [number, number, number] = [0.3, 0.3, 0.32];
/** The engine's default sunDir, (0, 1, 2) normalised, as mapinfo leaves it. */
const SUN = new THREE.Vector3(0, 1, 2).normalize();

const toSrgb = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const fract = (x: number) => x - Math.floor(x);
const hash2 = (x: number, y: number) =>
  fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
/** Smooth value noise from 0 to 1. */
function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const s = (t: number) => t * t * (3 - 2 * t);
  const tx = s(x - ix);
  const ty = s(y - iy);
  const a = hash2(ix, iy) + (hash2(ix + 1, iy) - hash2(ix, iy)) * tx;
  const b =
    hash2(ix, iy + 1) + (hash2(ix + 1, iy + 1) - hash2(ix, iy + 1)) * tx;
  return a + (b - a) * ty;
}

interface Mesh {
  /** Triangle corners in elmos, model frame, nine numbers a triangle. */
  tri: Float32Array;
  /** Each triangle's linear colour, three a triangle, with a negative red for glow. */
  rgb: Float32Array;
  /** Each triangle's outward normal. Three a triangle. */
  nrm: Float32Array;
}

/** Lit sRGB colour for a linear colour on a face with normal n, glow unlit. */
function shade(c: number[], n: THREE.Vector3, glow: boolean): number[] {
  const light = glow ? 1 : 0.42 + 0.7 * Math.max(0, n.dot(SUN));
  return c.map((v) => Math.min(1, toSrgb(Math.min(1, v * light))));
}

const meshes = new Map<string, { whole: Mesh; box: Mesh }>();
function meshOf(model: BuildingModel, livery: Livery) {
  const key = `${model.id}|${livery.id}`;
  const got = meshes.get(key);
  if (got) return got;
  const [w, d] = footprint(model, OPEN_GRID);
  let g = built((b) => model.build(b, w, d, TOWN_PALETTES[PLANET]));
  dress(g, 1, livery);
  if (g.index) g = g.toNonIndexed();
  const pos = g.getAttribute("position");
  const col = g.getAttribute("color");
  const nor = g.getAttribute("normal");
  const kind = g.getAttribute("kind");
  const n = pos.count / 3;
  const tri = new Float32Array(n * 9);
  const rgb = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const vn = new THREE.Vector3();
  const mean = [0, 0, 0];
  let area = 0;
  for (let t = 0; t < n; t++) {
    a.fromBufferAttribute(pos, t * 3).multiplyScalar(SCALE);
    b.fromBufferAttribute(pos, t * 3 + 1).multiplyScalar(SCALE);
    c.fromBufferAttribute(pos, t * 3 + 2).multiplyScalar(SCALE);
    tri.set([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], t * 9);
    const gn = b.clone().sub(a).cross(c.clone().sub(a));
    const ar = gn.length() / 2;
    gn.normalize();
    vn.set(0, 0, 0);
    for (let k = 0; k < 3; k++)
      vn.add(new THREE.Vector3().fromBufferAttribute(nor, t * 3 + k));
    if (gn.dot(vn) < 0) gn.negate();
    nrm.set([gn.x, gn.y, gn.z], t * 3);
    const lin = [0, 1, 2].map(
      (k) =>
        (col.getComponent(t * 3, k) +
          col.getComponent(t * 3 + 1, k) +
          col.getComponent(t * 3 + 2, k)) /
        3,
    );
    rgb.set(
      kind.getX(t * 3) === -1 ? [-lin[0] - 1e-6, lin[1], lin[2]] : lin,
      t * 3,
    );
    for (let k = 0; k < 3; k++) mean[k] += lin[k] * ar;
    area += ar;
  }
  // The far stand-in: the model's bounds, five sides, in its mean colour.
  g.computeBoundingBox();
  const bb = (g.boundingBox as THREE.Box3).clone();
  bb.min.multiplyScalar(SCALE);
  bb.max.multiplyScalar(SCALE);
  const avg = mean.map((v) => v / area);
  const sides: [THREE.Vector3, THREE.Vector3[]][] = [];
  const { min: lo, max: hi } = bb;
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  sides.push([
    P(0, 1, 0),
    [
      P(lo.x, hi.y, lo.z),
      P(lo.x, hi.y, hi.z),
      P(hi.x, hi.y, hi.z),
      P(hi.x, hi.y, lo.z),
    ],
  ]);
  sides.push([
    P(1, 0, 0),
    [
      P(hi.x, lo.y, lo.z),
      P(hi.x, hi.y, lo.z),
      P(hi.x, hi.y, hi.z),
      P(hi.x, lo.y, hi.z),
    ],
  ]);
  sides.push([
    P(-1, 0, 0),
    [
      P(lo.x, lo.y, hi.z),
      P(lo.x, hi.y, hi.z),
      P(lo.x, hi.y, lo.z),
      P(lo.x, lo.y, lo.z),
    ],
  ]);
  sides.push([
    P(0, 0, 1),
    [
      P(hi.x, lo.y, hi.z),
      P(hi.x, hi.y, hi.z),
      P(lo.x, hi.y, hi.z),
      P(lo.x, lo.y, hi.z),
    ],
  ]);
  sides.push([
    P(0, 0, -1),
    [
      P(lo.x, lo.y, lo.z),
      P(lo.x, hi.y, lo.z),
      P(hi.x, hi.y, lo.z),
      P(hi.x, lo.y, lo.z),
    ],
  ]);
  const box: Mesh = {
    tri: new Float32Array(10 * 9),
    rgb: new Float32Array(30),
    nrm: new Float32Array(30),
  };
  sides.forEach(([nv, q], s) => {
    for (const [k, [i, j, l]] of [
      [0, [0, 1, 2]],
      [1, [0, 2, 3]],
    ] as [number, number[]][]) {
      const t = s * 2 + k;
      box.tri.set(
        [q[i], q[j], q[l]].flatMap((v) => [v.x, v.y, v.z]),
        t * 9,
      );
      box.nrm.set([nv.x, nv.y, nv.z], t * 3);
      box.rgb.set(avg, t * 3);
    }
  });
  const made = { whole: { tri, rgb, nrm }, box };
  meshes.set(key, made);
  return made;
}

// --- the cube's faces ----------------------------------------------------------

/** Forward, right and up for each face. Any frame works, as the panorama is read back through the same one. */
const FACES: [THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [
  [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 1, 0),
  ],
  [
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 1, 0),
  ],
  [
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
  ],
  [
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
  ],
  [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, -1),
  ],
  [
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 1),
  ],
];
const faceRgb = FACES.map(() => new Uint8Array(FACE * FACE * 3));
/** 1 / forward distance of the nearest surface on each pixel, 0 where there is none. */
const faceInv = FACES.map(() => new Float32Array(FACE * FACE));
const NEAR = 1;

/** Draw one triangle, given eye-relative corners, onto every face it reaches. */
function drawTri(p: number[], r: number, g: number, b: number) {
  for (let f = 0; f < 6; f++) {
    const [F, R, U] = FACES[f];
    // Corners in the face's frame: x right, y up, w forward.
    let poly: number[][] = [];
    let behind = 0;
    for (let k = 0; k < 3; k++) {
      const x = p[k * 3];
      const y = p[k * 3 + 1];
      const z = p[k * 3 + 2];
      const w = x * F.x + y * F.y + z * F.z;
      if (w < NEAR) behind++;
      poly.push([x * R.x + y * R.y + z * R.z, x * U.x + y * U.y + z * U.z, w]);
    }
    if (behind === 3) continue;
    if (poly.every((v) => v[0] > v[2]) || poly.every((v) => -v[0] > v[2]))
      continue;
    if (poly.every((v) => v[1] > v[2]) || poly.every((v) => -v[1] > v[2]))
      continue;
    if (behind > 0) {
      const clipped: number[][] = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k];
        const c = poly[(k + 1) % poly.length];
        if (a[2] >= NEAR) clipped.push(a);
        if (a[2] >= NEAR !== c[2] >= NEAR) {
          const t = (NEAR - a[2]) / (c[2] - a[2]);
          clipped.push([
            a[0] + (c[0] - a[0]) * t,
            a[1] + (c[1] - a[1]) * t,
            NEAR,
          ]);
        }
      }
      poly = clipped;
    }
    const s = poly.map(([x, y, w]) => [
      ((x / w + 1) / 2) * FACE,
      ((1 - y / w) / 2) * FACE,
      1 / w,
    ]);
    for (let k = 1; k + 1 < s.length; k++)
      fill(f, s[0], s[k], s[k + 1], r, g, b);
  }
}

function fill(
  f: number,
  a: number[],
  b: number[],
  c: number[],
  r: number,
  g: number,
  bl: number,
) {
  const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(area) < 1e-9) return;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const x1 = Math.min(FACE - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const y1 = Math.min(FACE - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const rgb = faceRgb[f];
  const inv = faceInv[f];
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const w1 =
        ((px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])) / area;
      const w2 =
        ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) / area;
      const w0 = 1 - w1 - w2;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = a[2] * w0 + b[2] * w1 + c[2] * w2;
      const o = y * FACE + x;
      if (z <= inv[o]) continue;
      inv[o] = z;
      rgb[o * 3] = r * 255;
      rgb[o * 3 + 1] = g * 255;
      rgb[o * 3 + 2] = bl * 255;
    }
  }
}

// --- the engine's cube map -----------------------------------------------------

/** Each face of the DDS cube map is this many texels square. */
const CUBE = 1024;
let ddsCheck = "";

/**
 * An uncompressed BGRA DDS cube map of `sample`, laid out for the engine.
 * A 2D panorama goes through a GPU conversion that drew black on zink, so the
 * sky ships as the cube map most maps use.
 *
 * GL picks a face by the direction's largest axis and reads (s, t) on it, with
 * t = 0 on the face's first row. The engine draws the sky looking up
 * (d.x, -d.y, d.z) for a view direction d (CubeMapVS.glsl's uvFlip), and its
 * DDS loader flips each face top to bottom and swaps the +Y and -Y faces
 * (nv_dds.cpp). So each file face holds what GL will read from the other Y
 * face, upside down.
 */
function cubeDds(
  sample: (d: THREE.Vector3) => [number, number, number],
): Buffer {
  // The direction GL reads at (sc, tc) from -1 to 1 on each GL face, +X -X +Y -Y +Z -Z.
  const lookup: ((sc: number, tc: number) => [number, number, number])[] = [
    (sc, tc) => [1, -tc, -sc],
    (sc, tc) => [-1, -tc, sc],
    (sc, tc) => [sc, 1, tc],
    (sc, tc) => [sc, -1, -tc],
    (sc, tc) => [sc, -tc, 1],
    (sc, tc) => [-sc, -tc, -1],
  ];
  const header = Buffer.alloc(128);
  header.write("DDS ", 0, "ascii");
  const u32 = (field: number, v: number) =>
    header.writeUInt32LE(v >>> 0, 4 + field * 4);
  u32(0, 124); // header size
  u32(1, 0x1 | 0x2 | 0x4 | 0x8 | 0x1000); // caps, height, width, pitch, pixel format
  u32(2, CUBE);
  u32(3, CUBE);
  u32(4, CUBE * 4);
  u32(18, 32); // pixel format size
  u32(19, 0x41); // RGB with alpha
  u32(21, 32); // bits a pixel
  u32(22, 0x00ff0000);
  u32(23, 0x0000ff00);
  u32(24, 0x000000ff);
  u32(25, 0xff000000);
  u32(26, 0x1000 | 0x8); // texture, complex
  u32(27, 0x200 | 0xfc00); // cube map, all faces
  const body = Buffer.alloc(6 * CUBE * CUBE * 4);
  const d = new THREE.Vector3();
  for (let fileFace = 0; fileFace < 6; fileFace++) {
    const glFace = fileFace === 2 ? 3 : fileFace === 3 ? 2 : fileFace;
    for (let row = 0; row < CUBE; row++)
      for (let col = 0; col < CUBE; col++) {
        const glRow = CUBE - 1 - row;
        const acc = [0, 0, 0];
        for (const [a, b] of [
          [0.25, 0.25],
          [0.75, 0.25],
          [0.25, 0.75],
          [0.75, 0.75],
        ]) {
          const [x, y, z] = lookup[glFace](
            ((col + a) / CUBE) * 2 - 1,
            ((glRow + b) / CUBE) * 2 - 1,
          );
          // GL's direction is the view direction with y turned over.
          const c = sample(d.set(x, -y, z).normalize());
          for (let k = 0; k < 3; k++) acc[k] += c[k] / 4;
        }
        const o = ((fileFace * CUBE + row) * CUBE + col) * 4;
        body[o] = Math.round(acc[2] * 255);
        body[o + 1] = Math.round(acc[1] * 255);
        body[o + 2] = Math.round(acc[0] * 255);
        body[o + 3] = 255;
      }
  }
  return Buffer.concat([header, body]);
}

// --- the city beyond the map ---------------------------------------------------

test("persepolis sky", () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const rand = seeded(20261116);
  const mid = MAP / 2;
  const ordinary = BUILDINGS.filter((m) => !m.filler && !m.landmark);
  const landmarks = BUILDINGS.filter((m) => m.landmark);
  const liveries = new Map<string, Livery[]>();
  for (const m of BUILDINGS) {
    const set = new Map<string, Livery>();
    for (let i = 0; i < 12 && set.size < 3; i++) {
      const l = liveryFor(rand(), m.height);
      set.set(l.id, l);
    }
    liveries.set(m.id, [...set.values()]);
  }
  const pick = (
    lots: [number, number],
    lo: number,
    hi: number,
  ): BuildingModel => {
    const fits = ordinary.filter(
      (m) => m.lots[0] === lots[0] && m.lots[1] === lots[1],
    );
    const band = fits.filter((m) => m.height <= hi && m.height >= lo);
    const from =
      band.length > 0
        ? band
        : [
            fits.reduce((a, b) =>
              Math.abs(a.height - hi) < Math.abs(b.height - hi) ? a : b,
            ),
          ];
    return from[Math.floor(rand() * from.length)];
  };

  let whole = 0;
  let boxes = 0;
  let tris = 0;
  const eye = [mid, EYE_Y, mid];
  const corner = new Float32Array(9);
  const normal = new THREE.Vector3();
  const place = (
    model: BuildingModel,
    x: number,
    z: number,
    quarter: number,
    stretch: number,
  ) => {
    const ls = liveries.get(model.id) as Livery[];
    const m = meshOf(model, ls[Math.floor(rand() * ls.length)]);
    const dist = Math.hypot(x - mid, z - mid);
    const mesh = dist < DETAIL ? m.whole : m.box;
    if (dist < DETAIL) whole++;
    else boxes++;
    const cos = Math.round(Math.cos((quarter * Math.PI) / 2));
    const sin = Math.round(Math.sin((quarter * Math.PI) / 2));
    const n = mesh.rgb.length / 3;
    for (let t = 0; t < n; t++) {
      const wide = Math.sqrt(stretch);
      const nx = (mesh.nrm[t * 3] * cos + mesh.nrm[t * 3 + 2] * sin) / wide;
      const ny = mesh.nrm[t * 3 + 1] / stretch;
      const nz = (-mesh.nrm[t * 3] * sin + mesh.nrm[t * 3 + 2] * cos) / wide;
      for (let k = 0; k < 3; k++) {
        const lx = mesh.tri[t * 9 + k * 3] * wide;
        const lz = mesh.tri[t * 9 + k * 3 + 2] * wide;
        corner[k * 3] = x + lx * cos + lz * sin - eye[0];
        corner[k * 3 + 1] = mesh.tri[t * 9 + k * 3 + 1] * stretch - eye[1];
        corner[k * 3 + 2] = z - lx * sin + lz * cos - eye[2];
      }
      // Faces turned away from the eye are hidden behind the building's front.
      if (nx * corner[0] + ny * corner[1] + nz * corner[2] >= 0) continue;
      tris++;
      // Lit after turning, so the light comes from the sun whichever way the building faces.
      const red = mesh.rgb[t * 3];
      normal.set(nx, ny, nz).normalize();
      const [r, g, b] = shade(
        [Math.abs(red), mesh.rgb[t * 3 + 1], mesh.rgb[t * 3 + 2]],
        normal,
        red < 0,
      );
      drawTri(Array.from(corner), r, g, b);
    }
  };

  // Blocks on the map's own grid, carried outwards, with an avenue every third street.
  const along = (block: number) => {
    const starts: number[] = [];
    let x = mid - block / 2;
    for (let i = 0; x - mid < REACH; i++) {
      starts.push(x);
      x += block + (i % 3 === 2 ? AVENUE : STREET);
    }
    x = mid - block / 2;
    for (let i = 0; mid - x < REACH; i++) {
      x -= block + (i % 3 === 2 ? AVENUE : STREET);
      starts.push(x);
    }
    return starts;
  };
  const margin = 2 * LOT;
  let landmarkCount = 0;
  for (const x0 of along(BLOCK[0]))
    for (const z0 of along(BLOCK[1])) {
      const cx = x0 + BLOCK[0] / 2;
      const cz = z0 + BLOCK[1] / 2;
      if (
        cx > -margin &&
        cx < MAP + margin &&
        cz > -margin &&
        cz < MAP + margin
      )
        continue;
      const dist = Math.hypot(cx - mid, cz - mid);
      if (dist > REACH) continue;
      // Districts of towers in a sea of mid-rises.
      const district = noise(cx / 7000 + 31.7, cz / 7000 - 12.3) ** 2.2;
      const hi = 1.0 + 5.2 * district;
      const lo = hi * 0.4;
      // Rising with distance, the tower districts most.
      const out = Math.min(1, Math.max(0, (dist - 6000) / 16000));
      const stretch = 1 + (STRETCH - 1) * out * (0.3 + 0.7 * district);
      if (landmarks.length > 0 && district > 0.62 && rand() < 0.04) {
        place(
          landmarks[landmarkCount++ % landmarks.length],
          cx - LOT,
          cz,
          Math.floor(rand() * 4),
          stretch,
        );
        place(
          pick([2, 2], lo, hi),
          cx + LOT,
          cz,
          Math.floor(rand() * 4),
          stretch,
        );
        continue;
      }
      for (const half of [0, 2]) {
        const sx = x0 + half * LOT;
        if (rand() < 0.2 + 0.3 * district) {
          place(
            pick([2, 2], lo, hi),
            sx + LOT,
            z0 + LOT,
            Math.floor(rand() * 4),
            stretch,
          );
          continue;
        }
        for (const row of [0, 1]) {
          const z = z0 + row * LOT + LOT / 2;
          const q = row === 0 ? 2 : 0;
          if (rand() < 0.35)
            place(pick([2, 1], lo, hi), sx + LOT, z, q, stretch);
          else
            for (const col of [0, 1])
              place(
                pick([1, 1], lo, hi),
                sx + col * LOT + LOT / 2,
                z,
                q,
                stretch,
              );
        }
      }
    }

  // --- the panorama ---------------------------------------------------------------
  const sample = (d: THREE.Vector3): [number, number, number] => {
    let f = 0;
    const ax = Math.abs(d.x);
    const ay = Math.abs(d.y);
    const az = Math.abs(d.z);
    if (ax >= ay && ax >= az) f = d.x > 0 ? 0 : 1;
    else if (az >= ay) f = d.z > 0 ? 2 : 3;
    else f = d.y > 0 ? 4 : 5;
    const [F, R, U] = FACES[f];
    const w = d.dot(F);
    const sx = d.dot(R) / w;
    const sy = d.dot(U) / w;
    const px = Math.min(
      FACE - 1,
      Math.max(0, Math.floor(((sx + 1) / 2) * FACE)),
    );
    const py = Math.min(
      FACE - 1,
      Math.max(0, Math.floor(((1 - sy) / 2) * FACE)),
    );
    const o = py * FACE + px;
    const inv = faceInv[f][o];
    if (inv > 0) {
      const dist = (1 / inv) * Math.hypot(1, sx, sy);
      const h = 1 - Math.exp(-dist / HAZE);
      const rgb = faceRgb[f];
      return [0, 1, 2].map(
        (k) => (rgb[o * 3 + k] / 255) * (1 - h) + HORIZON[k] * h,
      ) as [number, number, number];
    }
    if (d.y < 0) {
      const h = 1 - Math.exp(-EYE_Y / -d.y / HAZE);
      return [0, 1, 2].map((k) => GROUND[k] * (1 - h) + HORIZON[k] * h) as [
        number,
        number,
        number,
      ];
    }
    const t = Math.sqrt(Math.asin(Math.min(1, d.y)) / (Math.PI / 2));
    const sun = Math.max(0, d.dot(SUN));
    const glow = 0.55 * sun ** 400 + 0.18 * sun ** 12;
    return [0, 1, 2].map((k) =>
      Math.min(1, HORIZON[k] + (ZENITH[k] - HORIZON[k]) * t + glow),
    ) as [number, number, number];
  };
  const pano = new Uint8Array(W * H * 4);
  const d = new THREE.Vector3();
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const acc = [0, 0, 0];
      for (const [di, dj] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ]) {
        const lon = ((i + di) / W - 0.5) * 2 * Math.PI;
        const lat = ((j + dj) / H) * Math.PI;
        d.set(
          Math.cos(lon) * Math.sin(lat),
          Math.cos(lat),
          Math.sin(lon) * Math.sin(lat),
        );
        const c = sample(d);
        for (let k = 0; k < 3; k++) acc[k] += c[k] / 4;
      }
      pano.set([...acc.map((v) => Math.round(v * 255)), 255], (j * W + i) * 4);
    }
  writeFileSync(`${OUT_DIR}persepolis_sky.png`, png(pano, W, H));
  const dds = cubeDds(sample);
  writeFileSync(`${OUT_DIR}persepolis_sky.dds`, dds);
  // Read the file back as the engine would, written forwards from the GL
  // spec's face table, and compare it with the renderer in random directions.
  // The same read without the engine's y flip is scored too, for contrast.
  const engineRead = (dir: THREE.Vector3, flipY: boolean): number[] => {
    const [rx, ry, rz] = [dir.x, flipY ? -dir.y : dir.y, dir.z];
    const ax = Math.abs(rx);
    const ay = Math.abs(ry);
    const az = Math.abs(rz);
    let face: number, sc: number, tc: number, ma: number;
    if (ax >= ay && ax >= az)
      [face, sc, tc, ma] = rx > 0 ? [0, -rz, -ry, ax] : [1, rz, -ry, ax];
    else if (ay >= az)
      [face, sc, tc, ma] = ry > 0 ? [2, rx, rz, ay] : [3, rx, -rz, ay];
    else [face, sc, tc, ma] = rz > 0 ? [4, rx, -ry, az] : [5, -rx, -ry, az];
    const col = Math.min(CUBE - 1, Math.floor(((sc / ma + 1) / 2) * CUBE));
    const glRow = Math.min(CUBE - 1, Math.floor(((tc / ma + 1) / 2) * CUBE));
    // The loader swapped the Y faces and flipped every face top to bottom.
    const fileFace = face === 2 ? 3 : face === 3 ? 2 : face;
    const o = 128 + ((fileFace * CUBE + (CUBE - 1 - glRow)) * CUBE + col) * 4;
    return [dds[o + 2] / 255, dds[o + 1] / 255, dds[o] / 255];
  };
  const checkRand = seeded(5);
  let err = 0;
  let errUnflipped = 0;
  const N_CHECK = 20000;
  for (let n = 0; n < N_CHECK; n++) {
    d.set(
      checkRand() * 2 - 1,
      checkRand() * 2 - 1,
      checkRand() * 2 - 1,
    ).normalize();
    const want = sample(d);
    const got = engineRead(d, true);
    const gotUnflipped = engineRead(d, false);
    for (let k = 0; k < 3; k++) {
      err += Math.abs(got[k] - want[k]) / (3 * N_CHECK);
      errUnflipped += Math.abs(gotUnflipped[k] - want[k]) / (3 * N_CHECK);
    }
  }
  ddsCheck = `ddsMeanError ${err.toFixed(4)} withoutYFlip ${errUnflipped.toFixed(4)}`;
  // A preview at a quarter of the size, for a look without the full image.
  const PW = W / 4;
  const PH = H / 4;
  const prev = new Uint8Array(PW * PH * 4);
  for (let j = 0; j < PH; j++)
    for (let i = 0; i < PW; i++)
      for (let k = 0; k < 4; k++) {
        let s = 0;
        for (let b = 0; b < 4; b++)
          for (let a = 0; a < 4; a++)
            s += pano[((j * 4 + b) * W + i * 4 + a) * 4 + k];
        prev[(j * PW + i) * 4 + k] = s / 16;
      }
  writeFileSync(`${OUT_DIR}preview.png`, png(prev, PW, PH));
  // The map fogs its far ground to the horizon's haze, so the two meet.
  writeFileSync(`${OUT_DIR}fog.txt`, `${HORIZON.join(" ")}\n`);
  writeFileSync(
    `${OUT_DIR}summary.txt`,
    `eyeY ${EYE_Y} stretch ${STRETCH} reach ${REACH} detail ${DETAIL} haze ${HAZE}\nwhole ${whole} boxes ${boxes} facingTriangles ${tris} models ${meshes.size}\n${ddsCheck}\n`,
  );
}, 3_600_000);
