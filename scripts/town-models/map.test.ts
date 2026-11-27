/**
 * Builds a test Recoil map that is all city: the conquest open-town buildings
 * as features on a flat 12 by 12 map, at 512 elmos per world unit. Writes the
 * map's source images and its archive folder. mapconv is run afterwards.
 *
 * Run with DENSITY=256 so textures match the exported set's resolution.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { test } from "vitest";
import {
  at,
  Builder,
  box,
  type Kind,
  type Paint,
  type PartTag,
  seeded,
  shaft,
  smooth,
} from "../../src/conquest/galaxy3d/landmarks/kit";
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
import { column, round } from "../../src/conquest/galaxy3d/towns3d/parts";
import {
  bake,
  bakeAo,
  bakeNormals,
  built,
  DENSITY,
  png,
  png16,
  s3o,
  unwrap,
} from "./townkit";

const ROOT = new URL(
  "../../docs/reports/town-models/persepolis/",
  import.meta.url,
).pathname;
const ARCHIVE = `${ROOT}persepolis.sdd/`;
const SRC = `${ROOT}src/`;
/** The skybox sky.test.ts renders. Run that first. */
const SKY = new URL(
  "../../docs/reports/town-models/persepolis-sky/",
  import.meta.url,
).pathname;

/** Elmos per conquest world unit. */
const SCALE = 512;
/** Map size in map units of 512 elmos. */
const MAP_UNITS = 14;
const MAP = MAP_UNITS * 512;
const LOT = OPEN_GRID.lot * SCALE;
const BLOCK: [number, number] = [
  OPEN_GRID.blockLots[0] * LOT,
  OPEN_GRID.blockLots[1] * LOT,
];
/** Two of Splinter Faction's footprint 6 units side by side, and a wider road every third gap. */
const STREET = 192;
const AVENUE = 320;
/** The solid ring of towers round the map's edge, two lots deep, and the street inside it. */
const RING = 2 * LOT;
/** The bands in front of the ring, one lot deep each, their heights in world units, and where the last ends. */
const FRONT_BANDS: [number, number][] = [
  [1.4, 2.4],
  [0.6, 1.4],
];
const SOUTH_BANDS: [number, number][] = [
  [0.5, 1.0],
  [0.3, 0.7],
];
const FRONT = FRONT_BANDS.length * LOT;
const INNER = RING + FRONT;
const EDGE = INNER + STREET;
/** The tallest an interior band reaches, at the centre, and the tallest at the interior's edge, in world units. */
const INTERIOR_MAX = 4.7;
const INTERIOR_MIN = 1.2;
/** The south ring's mid-rises, in world units. */
const SOUTH_RING: [number, number] = [0.6, 1.2];
/** Liveries each building model is built in. */
const LIVERIES_PER_MODEL = 2;
const PLANET = "temperate";
/** The slab a lot is paved with, in world units: the conquest town layer's own figure. */
const PAVEMENT = 0.02;
/** Heights in elmos: the streets, and a pit floor's two levels. */
const STREET_Y = 40;
const PIT_HIGH = 34;
const PIT_LOW = 4;
/** How far a slab reaches below the street, past the bottom of the pit. */
const SLAB_DEPTH = 48;

/** How far the three start spots stand from the start position, clear of the commander and inside the painted ring. */
const START_SPOT_RADIUS = 200;
/** The metal spot marking's outer radius, the extractor's reach. */
const SPOT_MARK = 48;
/**
 * The sidewalk round every built block, in elmos, taken from the street. Two
 * leave a 192 street 144 wide. Of Splinter Faction 0.1.97's 55 ground units
 * only the Juggernaut, 184 elmos wide, is wider, and it keeps to the avenues.
 * Bollards stand along its street edge in rows one footprint square deep,
 * BOLLARD_STEP, which block the whole row, with a post about every BOLLARD_GAP.
 */
const SIDEWALK = 24;
const BOLLARD_STEP = 16;
const BOLLARD_GAP = 35;
const BOLLARD_H = 10;
/** A walk's kiosk, its length along the walk in elmos. */
const KIOSK = 48;
/**
 * The release, and the .smf and .smt base name, which carries it: two releases
 * sharing one file name are told apart only by their mapinfo, and tools that
 * key on the file confuse them. mapconv must be run with `-o ${MAPFILE}`.
 */
const VERSION = "v1.7";
const MAPFILE = `persepolis_${VERSION.replace(/\./g, "_")}`;
/** The map's Lua, copied into the archive. */
const LUA = new URL("./persepolis-lua/", import.meta.url).pathname;

/**
 * Baked buildings kept between exports, outside ROOT, which each export
 * deletes. An entry is keyed on the finished geometry it was baked from, every
 * vertex attribute of it, and on the bake code in townkit.ts, so a change to
 * a model or to the bake bakes afresh what it touches.
 */
const BAKE_CACHE = new URL(
  "../../docs/reports/town-models/persepolis-bake-cache/",
  import.meta.url,
).pathname;
/**
 * "i/n", as bake-parallel.sh sets it: bake only every nth feature type into
 * the cache, starting at the ith, and write no archive. Shards run side by side
 * and a run without SHARD afterwards finds every bake in the cache.
 */
const SHARD = process.env.SHARD
  ? (process.env.SHARD.split("/").map(Number) as [number, number])
  : undefined;
let bakeCalls = 0;
let bakeSourceHash: string | undefined;
function sourceHash(): string {
  if (bakeSourceHash) return bakeSourceHash;
  bakeSourceHash = createHash("sha256")
    .update(readFileSync(new URL("./townkit.ts", import.meta.url).pathname))
    // The relief depths the normal bake shares with the app.
    .update(
      readFileSync(
        new URL(
          "../../src/conquest/galaxy3d/landmarks/material.ts",
          import.meta.url,
        ).pathname,
      ),
    )
    .digest("hex");
  return bakeSourceHash;
}
function geometryHash(g: THREE.BufferGeometry): string {
  const h = createHash("sha256");
  if (g.index)
    h.update(
      new Uint8Array(
        g.index.array.buffer,
        g.index.array.byteOffset,
        g.index.array.byteLength,
      ),
    );
  for (const name of Object.keys(g.attributes).sort()) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    h.update(name).update(
      new Uint8Array(a.array.buffer, a.array.byteOffset, a.array.byteLength),
    );
  }
  return h.digest("hex");
}
/**
 * Each colour channel above TONE_KNEE keeps only TONE_SLOPE of its rise, so
 * white bakes to 80% and the pale towers no longer flare under BAR's bloom.
 * Mid tones, glass and trim are untouched.
 */
const TONE_KNEE = 0.55;
const TONE_SLOPE = 0.55;
function toneDown(rgba: Uint8Array): Uint8Array {
  const knee = TONE_KNEE * 255;
  for (let i = 0; i < rgba.length; i++) {
    if (i % 4 === 3 || rgba[i] <= knee) continue;
    rgba[i] = Math.round(knee + (rgba[i] - knee) * TONE_SLOPE);
  }
  return rgba;
}
interface BakedArt {
  colour: Uint8Array;
  pbr: Uint8Array;
  normals: Uint8Array;
  s3o: Uint8Array;
  /** The part above the plinth, for buildings taller than it. */
  s3oTop?: Uint8Array;
  meta: {
    texels: number;
    maxY: number;
    size: [number, number, number];
    floorTriangles?: number;
    top?: { size: [number, number, number] };
  };
}
/** Write a feature's textures and model into the archive, from the cache if its inputs are unchanged. */
function bakedOnce(
  name: string,
  inputs: unknown[],
  make: () => BakedArt,
): { hit: boolean; meta: BakedArt["meta"] } {
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        sourceHash(),
        name,
        inputs,
        DENSITY,
        SCALE,
        PAVEMENT,
        SLAB_DEPTH,
        PLANET,
        TONE_KNEE,
        TONE_SLOPE,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
  const dir = `${BAKE_CACHE}${name}-${key}/`;
  const files: [keyof BakedArt, string][] = [
    ["colour", `unittextures/${name}.png`],
    ["pbr", `unittextures/${name}_2.png`],
    ["normals", `unittextures/${name}_normals.png`],
    ["s3o", `objects3d/${name}.s3o`],
    ["s3oTop", `objects3d/${topName(name)}.s3o`],
  ];
  // Counted over every call, hit or not, so each shard deals the same hand.
  const mine = !SHARD || bakeCalls++ % SHARD[1] === SHARD[0];
  if (existsSync(`${dir}meta.json`)) {
    if (!SHARD)
      for (const [k, path] of files)
        if (existsSync(`${dir}${k}`))
          copyFileSync(`${dir}${k}`, `${ARCHIVE}${path}`);
    return {
      hit: true,
      meta: JSON.parse(readFileSync(`${dir}meta.json`, "utf8")),
    };
  }
  // Another shard bakes it. Nothing reads this meta, as a shard stops before it writes the map.
  if (!mine)
    return { hit: false, meta: { texels: 0, maxY: 0, size: [0, 0, 0] } };
  const art = make();
  // Stale entries for this name go, so the cache holds one per feature type.
  if (existsSync(BAKE_CACHE))
    for (const old of readdirSync(BAKE_CACHE))
      if (old.startsWith(`${name}-`))
        rmSync(`${BAKE_CACHE}${old}`, { recursive: true });
  mkdirSync(dir, { recursive: true });
  for (const [k, path] of files) {
    if (!art[k]) continue;
    if (!SHARD) writeFileSync(`${ARCHIVE}${path}`, art[k] as Uint8Array);
    writeFileSync(`${dir}${k}`, art[k] as Uint8Array);
  }
  // Written last, so an export stopped part way leaves no entry that looks whole.
  writeFileSync(`${dir}meta.json`, JSON.stringify(art.meta));
  return { hit: false, meta: art.meta };
}
/**
 * Recoil holds a fighter or bomber below the highest terrain plus five times
 * its cruise height (StrafeAirMoveType.cpp). Splinter Faction's lowest cruise
 * height is 75: the summary counts the buildings too tall for it to clear.
 */
const STRAFE_CEILING_CRUISE = 75;
/**
 * The most the ground under a building rises above the street. High enough
 * to block a ground unit's line of sight across a block, low enough that the
 * camera, which follows the ground, does not ride up and down over the city.
 */
const RAISE_CAP = 160;
/** Raised ground inside a building: the least solid height worth raising, and how far below the solid it stays, in elmos. */
const SOLID_MIN = 24;
const SOLID_MARGIN = 4;
let heightRange: [number, number] = [0, 0];
let heightCheck = { checked: 0, outside: 0, worst: 0, raised: 0 };
const HEADING = { n: 32768, s: 0 };

type Rgb = [number, number, number];

// --- layout ----------------------------------------------------------------

/** Block starts along one axis, symmetric about the middle, with an avenue every third gap. */
function axis(block: number): number[] {
  const gapAt = (i: number, n: number) =>
    Math.min(i, n - 2 - i) % 3 === 2 ? AVENUE : STREET;
  const span = (k: number) => {
    let s = k * block;
    for (let i = 0; i < k - 1; i++) s += gapAt(i, k);
    return s;
  };
  let n = 1;
  while (span(n + 1) <= MAP - 2 * EDGE) n++;
  const starts: number[] = [];
  let x = (MAP - span(n)) / 2;
  for (let i = 0; i < n; i++) {
    starts.push(x);
    x += block + (i < n - 1 ? gapAt(i, n) : 0);
  }
  return starts;
}

interface Placement {
  model: BuildingModel;
  livery: Livery;
  x: number;
  z: number;
  heading: number;
}
interface Area {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  start?: boolean;
  ring?: boolean;
}

function layout() {
  const xs = axis(BLOCK[0]);
  const zs = axis(BLOCK[1]);
  const nx = xs.length;
  const nz = zs.length;
  const rand = seeded(20261115);
  const placements: Placement[] = [];
  const plazas: Area[] = [];
  const spots: [number, number][] = [];
  const mid = MAP / 2;

  // Each model keeps a couple of liveries, picked as the game picks them.
  const liveries = new Map<string, Livery[]>();
  for (const m of BUILDINGS) {
    const set = new Map<string, Livery>();
    for (let i = 0; i < 12 && set.size < LIVERIES_PER_MODEL; i++) {
      const l = liveryFor(rand(), m.height);
      set.set(l.id, l);
    }
    liveries.set(m.id, [...set.values()]);
  }

  // The map is the same turned half round its middle, so both starts match.
  const mirror = (x: number, z: number): [number, number] => [MAP - x, MAP - z];
  const flip = (h: number) => (h + 32768) % 65536;
  const place = (
    model: BuildingModel,
    x: number,
    z: number,
    heading: number,
    mirrored = true,
  ) => {
    const ls = liveries.get(model.id) as Livery[];
    const livery = ls[Math.floor(rand() * ls.length)];
    placements.push({ model, livery, x, z, heading });
    if (!mirrored) return;
    const [mx, mz] = mirror(x, z);
    placements.push({ model, livery, x: mx, z: mz, heading: flip(heading) });
  };
  const area = (a: Area) => {
    plazas.push(a);
    const [x0, z0] = mirror(a.x1, a.z1);
    const [x1, z1] = mirror(a.x0, a.z0);
    plazas.push({ x0, z0, x1, z1, start: a.start });
  };
  const spot = (x: number, z: number) => {
    // On the middle of a metal map texel, 16 elmos, so the marking and the
    // metal under it line up. The mirror of a texel's middle is a texel's middle.
    const snap = (v: number) => Math.floor(v / 16) * 16 + 8;
    spots.push([snap(x), snap(z)], mirror(snap(x), snap(z)));
  };

  // A start square covers two blocks across and four deep, near a corner,
  // with the streets between them paved over.
  const startBlocks = new Set<string>();
  const sx = [0, 1];
  const sz = [1, 2, 3, 4];
  for (const i of sx) for (const j of sz) startBlocks.add(`${i},${j}`);
  {
    const x0 = xs[sx[0]];
    const x1 = xs[sx[sx.length - 1]] + BLOCK[0];
    const z0 = zs[sz[0]];
    const z1 = zs[sz[sz.length - 1]] + BLOCK[1];
    area({ x0, z0, x1, z1, start: true });
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    // Three spots round the start position, inside the painted ring, as most
    // maps give a commander, and a fourth up the square towards the map's edge.
    for (const a of [0, 1, 2]) {
      const angle = Math.PI / 2 + (a * 2 * Math.PI) / 3;
      spot(
        cx + Math.cos(angle) * START_SPOT_RADIUS,
        cz + Math.sin(angle) * START_SPOT_RADIUS,
      );
    }
    spot(cx, z0 + (cz - z0) * 0.3);
    // A fifth, the fourth's mirror across the start position, down the square.
    spot(cx, z1 - (z1 - cz) * 0.3);
  }
  // Plazas spread over the city, each with two spots. Some join a second
  // block, given as its step from the first, paving the road between them.
  const plazaBlocks = new Set<string>();
  const plazaPlan: [number, number, number, number][] = [
    [3, 2, 0, 0],
    [6, 5, 0, 0],
    [1, 8, 0, 0],
    [4, 9, 0, 0],
    [7, 1, 0, 0],
  ];
  for (const [i, j, di, dj] of plazaPlan) {
    if (i >= nx || j >= nz) continue;
    // A block whose mirror is already a plaza is one already, with its spots.
    if (plazaBlocks.has(`${nx - 1 - i},${nz - 1 - j}`)) continue;
    const [i2, j2] = [i + di, j + dj];
    for (const k of new Set([`${i},${j}`, `${i2},${j2}`])) {
      if (startBlocks.has(k) || plazaBlocks.has(k))
        throw new Error(`plaza block ${k} is taken`);
      plazaBlocks.add(k);
    }
    const x0 = Math.min(xs[i], xs[i2]);
    const z0 = Math.min(zs[j], zs[j2]);
    const x1 = Math.max(xs[i], xs[i2]) + BLOCK[0];
    const z1 = Math.max(zs[j], zs[j2]) + BLOCK[1];
    area({ x0, z0, x1, z1 });
    if (di === 0 && dj === 0) {
      spot(xs[i] + BLOCK[0] * 0.3, zs[j] + BLOCK[1] / 2);
      spot(xs[i] + BLOCK[0] * 0.7, zs[j] + BLOCK[1] / 2);
    } else {
      // A joined plaza keeps two spots, one in the middle of each block.
      spot(xs[i] + BLOCK[0] / 2, zs[j] + BLOCK[1] / 2);
      spot(xs[i2] + BLOCK[0] / 2, zs[j2] + BLOCK[1] / 2);
    }
  }
  // Each plaza is laid down with its mirror, so no plaza block may be another's mirror.
  for (const k of plazaBlocks) {
    const [i, j] = k.split(",").map(Number);
    if (plazaBlocks.has(`${nx - 1 - i},${nz - 1 - j}`))
      throw new Error(`plaza block ${k} is another plaza's mirror`);
    if (startBlocks.has(`${nx - 1 - i},${nz - 1 - j}`))
      throw new Error(`plaza block ${k} is in the other start square`);
  }
  // Pedestrian plazas in place of the road between two built blocks, one above
  // the other, joining them. Each is given by its north block, and laid down
  // with its mirror. They have no metal spots, and each takes the place of a
  // street, never an avenue, which would cut the avenue in two.
  const walks: Area[] = [];
  const walkPlan: [number, number][] = [
    [3, 6],
    [5, 3],
  ];
  for (const [i, j] of walkPlan) {
    if (zs[j + 1] - zs[j] - BLOCK[1] !== STREET)
      throw new Error(`walk ${i},${j} would cross an avenue`);
    for (const k of [`${i},${j}`, `${i},${j + 1}`]) {
      const [a, b] = k.split(",").map(Number);
      const m = `${nx - 1 - a},${nz - 1 - b}`;
      for (const c of [k, m])
        if (startBlocks.has(c) || plazaBlocks.has(c))
          throw new Error(`walk block ${c} is not a built block`);
    }
    const w = {
      x0: xs[i],
      z0: zs[j] + BLOCK[1],
      x1: xs[i] + BLOCK[0],
      z1: zs[j + 1],
    };
    const [mx0, mz0] = mirror(w.x1, w.z1);
    const [mx1, mz1] = mirror(w.x0, w.z0);
    if (walks.some((o) => o.x0 === mx0 && o.z0 === mz0))
      throw new Error(`walk ${i},${j} is another walk's mirror`);
    walks.push(w, { x0: mx0, z0: mz0, x1: mx1, z1: mz1 });
  }

  const maxD = Math.hypot(mid - EDGE, mid - EDGE);
  const ordinary = BUILDINGS.filter((m) => !m.filler && !m.landmark);
  /** A model for `lots` between heights `lo` and `hi`, or the nearest to `hi` if none is. */
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
  const quarter = () => [0, 16384, 32768, 49152][Math.floor(rand() * 4)];
  /** Fill a square of two by two lots, its corner at x0, z0. */
  const fillSquare = (
    x0: number,
    z0: number,
    lo: number,
    hi: number,
    mirrored: boolean,
    whole: number,
  ) => {
    if (rand() < whole) {
      place(pick([2, 2], lo, hi), x0 + LOT, z0 + LOT, quarter(), mirrored);
      return;
    }
    for (const row of [0, 1]) {
      const z = z0 + row * LOT + LOT / 2;
      const facing = row === 0 ? HEADING.n : HEADING.s;
      if (rand() < 0.35)
        place(pick([2, 1], lo, hi), x0 + LOT, z, facing, mirrored);
      else
        for (const col of [0, 1])
          place(
            pick([1, 1], lo, hi),
            x0 + col * LOT + LOT / 2,
            z,
            facing,
            mirrored,
          );
    }
  };

  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      // Each block and its mirror are filled once, from the first of the pair.
      const mi = nx - 1 - i;
      const mj = nz - 1 - j;
      if (i * nz + j > mi * nz + mj) continue;
      if (i * nz + j === mi * nz + mj)
        throw new Error("a block is its own mirror");
      const open = (k: string) => startBlocks.has(k) || plazaBlocks.has(k);
      if (open(`${i},${j}`) || open(`${mi},${mj}`)) continue;
      const x0 = xs[i];
      const z0 = zs[j];
      // Low in the middle, rising to the tower cap towards the ring.
      const d = Math.min(
        1,
        Math.hypot(x0 + BLOCK[0] / 2 - mid, z0 + BLOCK[1] / 2 - mid) / maxD,
      );
      // Supertalls in the middle, falling away towards the bands round the ring.
      const hi = INTERIOR_MIN + (INTERIOR_MAX - INTERIOR_MIN) * (1 - d) ** 1.5;
      for (const half of [0, 2])
        fillSquare(
          x0 + half * LOT,
          z0,
          hi * 0.35,
          hi,
          true,
          0.3 * (1 - d) + 0.1,
        );
    }

  // The ring round the edge, in squares of two by two lots. Its footprint is
  // solid all round, so it is fair without mirroring, and its heights fall
  // from the skyline along the north edge, behind the camera's view, to
  // mid-rises along the south edge, nearest the camera.
  // The ring's strips, each taking in the band of mid-rises in front of it.
  const ring: Area[] = [
    { x0: 0, z0: 0, x1: MAP, z1: INNER, ring: true },
    { x0: 0, z0: MAP - INNER, x1: MAP, z1: MAP, ring: true },
    { x0: 0, z0: INNER, x1: INNER, z1: MAP - INNER, ring: true },
    { x0: MAP - INNER, z0: INNER, x1: MAP, z1: MAP - INNER, ring: true },
  ];
  const landmarks = BUILDINGS.filter((m) => m.landmark);
  const cells = MAP / RING;
  for (let c = 0; c < cells; c++) {
    const x0 = c * RING;
    // The two landmark towers stand in the middle of the north edge.
    const landmark = c - (cells / 2 - 1);
    if (landmark >= 0 && landmark < landmarks.length)
      place(landmarks[landmark], x0 + LOT, LOT, HEADING.s, false);
    else fillSquare(x0, 0, 2.2, 6.2, false, 0.6);
    fillSquare(x0, MAP - RING, SOUTH_RING[0], SOUTH_RING[1], false, 0.3);
  }
  for (let z0 = RING; z0 < MAP - RING; z0 += RING) {
    const t = (z0 - RING) / (MAP - 3 * RING);
    const hi = 3 - (3 - 1.4) * t;
    fillSquare(0, z0, hi * 0.5, hi, false, 0.5);
    fillSquare(MAP - RING, z0, hi * 0.5, hi, false, 0.5);
  }
  // Bands one lot deep in front of the ring, each lower than the one behind
  // it, stepping down from the skyline to the streets. The south bands, before
  // the ring's own mid-rises, are lower still.
  FRONT_BANDS.forEach(([lo, hi], k) => {
    const [slo, shi] = SOUTH_BANDS[k];
    const d0 = RING + k * LOT;
    for (let x0 = d0; x0 < MAP - d0; x0 += 2 * LOT) {
      const along = (z: number, facing: number, a: number, b: number) => {
        if (rand() < 0.35)
          place(pick([2, 1], a, b), x0 + LOT, z, facing, false);
        else
          for (const col of [0, 1])
            place(
              pick([1, 1], a, b),
              x0 + col * LOT + LOT / 2,
              z,
              facing,
              false,
            );
      };
      along(d0 + LOT / 2, HEADING.s, lo, hi);
      along(MAP - d0 - LOT / 2, HEADING.n, slo, shi);
    }
    for (let z0 = d0 + LOT; z0 < MAP - d0 - LOT; z0 += LOT) {
      const z = z0 + LOT / 2;
      place(pick([1, 1], lo, hi), d0 + LOT / 2, z, 16384, false);
      place(pick([1, 1], lo, hi), MAP - d0 - LOT / 2, z, 49152, false);
    }
  });
  // A row of bollards along the street edge of each built block's sidewalk.
  // The rows along x run past the block's ends to close its corners. The
  // ring's inner face gets rows too, in lengths of 256.
  const bollards: Bollards[] = [];
  /** Street furniture that blocks nothing: lamps, signals and trees. */
  const props: Prop[] = [];
  const mid16 = SIDEWALK - BOLLARD_STEP / 2;
  const isBuilt = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false;
    const k = `${i},${j}`;
    const m = `${nx - 1 - i},${nz - 1 - j}`;
    return !(
      startBlocks.has(k) ||
      startBlocks.has(m) ||
      plazaBlocks.has(k) ||
      plazaBlocks.has(m)
    );
  };
  /** The road between a block and its neighbour on one side: the gap to it, or to the ring's bands at the edge. */
  const gapX = (i: number, side: -1 | 1) =>
    side < 0
      ? xs[i] - (i > 0 ? xs[i - 1] + BLOCK[0] : INNER)
      : (i < nx - 1 ? xs[i + 1] : MAP - INNER) - xs[i] - BLOCK[0];
  const gapZ = (j: number, side: -1 | 1) =>
    side < 0
      ? zs[j] - (j > 0 ? zs[j - 1] + BLOCK[1] : INNER)
      : (j < nz - 1 ? zs[j + 1] : MAP - INNER) - zs[j] - BLOCK[1];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      if (!isBuilt(i, j)) continue;
      const x0 = xs[i];
      const z0 = zs[j];
      const x1 = x0 + BLOCK[0];
      const z1 = z0 + BLOCK[1];
      // No row on a side that faces a walk: the walk is paved up to the buildings.
      const facesWalk = (z: number) =>
        walks.some((w) => w.x0 === x0 && (w.z0 === z || w.z1 === z));
      for (const [edge, z, side] of [
        [z0, z0 - mid16, -1],
        [z1, z1 + mid16, 1],
      ] as const) {
        if (facesWalk(edge)) continue;
        const avenue = gapZ(j, side) >= AVENUE;
        bollards.push({
          x: (x0 + x1) / 2,
          z,
          alongX: true,
          len: BLOCK[0] + 2 * SIDEWALK,
          avenue,
        });
        // Two lamps along each long side, on the sidewalk inside the bollards, their arms over the street.
        for (const v of [-BLOCK[0] / 4, BLOCK[0] / 4])
          props.push({
            name: `psp_street_lamp_${side < 0 ? "n" : "s"}`,
            x: (x0 + x1) / 2 + v,
            z: edge + side * 4,
          });
      }
      for (const [x, side] of [
        [x0 - mid16, -1],
        [x1 + mid16, 1],
      ] as const)
        bollards.push({
          x,
          z: (z0 + z1) / 2,
          alongX: false,
          len: BLOCK[1],
          avenue: gapX(i, side) >= AVENUE,
        });
    }
  for (let v = INNER + 128, n = 0; v < MAP - INNER; v += 256, n++) {
    bollards.push(
      { x: v, z: INNER + mid16, alongX: true, len: 256 },
      { x: v, z: MAP - INNER - mid16, alongX: true, len: 256 },
    );
    bollards.push(
      { x: INNER + mid16, z: v, alongX: false, len: 256 },
      { x: MAP - INNER - mid16, z: v, alongX: false, len: 256 },
    );
    // A lamp on every other segment of the ring's face. The ring is its own mirror.
    if (n % 2 === 0)
      props.push(
        { name: "psp_street_lamp_s", x: v, z: INNER + 4 },
        { name: "psp_street_lamp_n", x: MAP - v, z: MAP - INNER - 4 },
        { name: "psp_street_lamp_e", x: INNER + 4, z: MAP - v },
        { name: "psp_street_lamp_w", x: MAP - INNER - 4, z: v },
      );
  }
  // Each row's style, the same for a row and its mirror, which only changes
  // what stands on the sidewalk: every style blocks the whole row alike. Bus
  // shelters stand only on avenues, and rows beside a start square are painted
  // yellow.
  const startAreas = plazas.filter((a) => a.start);
  for (const b of bollards) {
    const [mx, mz] = mirror(b.x, b.z);
    const [cx, cz] =
      b.x < mx || (b.x === mx && b.z < mz) ? [b.x, b.z] : [mx, mz];
    const s = Math.sin(cx * 12.9898 + cz * 78.233) * 43758.5453;
    const r = s - Math.floor(s);
    b.style =
      r < 0.55
        ? "bollards"
        : r < 0.75
          ? "railing"
          : r < 0.9
            ? "cabinet"
            : "mailbox";
    if (b.avenue && r < 0.25) b.style = "shelter";
    b.yellow = startAreas.some((a) => {
      const ox = Math.max(a.x0 - b.x, 0, b.x - a.x1);
      const oz = Math.max(a.z0 - b.z, 0, b.z - a.z1);
      return Math.hypot(ox, oz) <= STREET + SIDEWALK + b.len / 2;
    });
  }
  // Traffic signals at each junction with roads leaving it all four ways: on
  // the corner of the block to its north-west and of the block to its south-east.
  for (let i = 0; i < nx - 1; i++)
    for (let j = 0; j < nz - 1; j++) {
      if (
        ![
          isBuilt(i, j),
          isBuilt(i + 1, j),
          isBuilt(i, j + 1),
          isBuilt(i + 1, j + 1),
        ].every(Boolean)
      )
        continue;
      // A walk between rows j and j+1 next to the junction closes its east or west road.
      if (
        walks.some(
          (w) =>
            w.z0 === zs[j] + BLOCK[1] && (w.x0 === xs[i] || w.x0 === xs[i + 1]),
        )
      )
        continue;
      props.push(
        {
          name: "psp_street_signal_e",
          x: xs[i] + BLOCK[0] + 4,
          z: zs[j] + BLOCK[1] + 4,
        },
        { name: "psp_street_signal_w", x: xs[i + 1] - 4, z: zs[j + 1] - 4 },
      );
    }
  // In each walk, a kiosk against the north block a little in from the west
  // end, and two rows of tall thin trees in grated pits, one along each side.
  // The kiosk blocks movement as the bollards do. Each walk is worked out on
  // its own, which mirrors it, as the list holds each walk and its mirror.
  const trees: [number, number][] = [];
  for (const [n, w] of walks.entries()) {
    const first = n % 2 === 0;
    const kx = first ? w.x0 + 64 : w.x1 - 64;
    const kz = first ? w.z0 + mid16 : w.z1 - mid16;
    bollards.push({ x: kx, z: kz, alongX: true, len: KIOSK, style: "kiosk" });
    for (const z of [w.z0 + mid16, w.z1 - mid16])
      for (let x = w.x0 + 32; x < w.x1; x += 64) {
        if (Math.abs(z - kz) < 1 && Math.abs(x - kx) < KIOSK / 2 + 16) continue;
        trees.push([x, z]);
        props.push({ name: "psp_street_tree", x, z });
      }
  }
  for (const b of bollards) {
    // The blocking map's squares are 8 elmos, and the footprint must sit on them.
    const [hx, hz] = b.alongX
      ? [b.len / 2, BOLLARD_STEP / 2]
      : [BOLLARD_STEP / 2, b.len / 2];
    if ((b.x - hx) % 8 !== 0 || (b.z - hz) % 8 !== 0)
      throw new Error(`bollards at ${b.x},${b.z} are off the 8 elmo grid`);
    for (const [sx, sz] of spots) {
      const ox = Math.max(Math.abs(sx - b.x) - hx, 0);
      const oz = Math.max(Math.abs(sz - b.z) - hz, 0);
      if (Math.hypot(ox, oz) < SPOT_MARK)
        throw new Error(`bollards at ${b.x},${b.z} are on a metal spot`);
    }
  }
  // Everything paved and built on: the interior blocks and the ring's four strips.
  const blocks: Area[] = [
    ...xs.flatMap((x0) =>
      zs.map((z0) => ({ x0, z0, x1: x0 + BLOCK[0], z1: z0 + BLOCK[1] })),
    ),
    ...ring,
  ];
  // No two spot markings may overlap, as a doubled plaza once made them.
  for (let a = 0; a < spots.length; a++)
    for (let b = a + 1; b < spots.length; b++)
      if (
        Math.hypot(spots[a][0] - spots[b][0], spots[a][1] - spots[b][1]) <
        2 * SPOT_MARK
      )
        throw new Error(`metal spots at ${spots[a]} and ${spots[b]} overlap`);
  return {
    placements,
    plazas,
    walks,
    spots,
    xs,
    zs,
    blocks,
    bollards,
    props,
    trees,
  };
}

/** A row of bollards: its footprint's middle, which way it runs, and its length in elmos. */
interface Bollards {
  x: number;
  z: number;
  alongX: boolean;
  len: number;
  /**
   * What stands along the row: bollards, a railing, or bollards with a utility
   * cabinet, a mailbox or a bus shelter among them. A kiosk in a walk is a row
   * of its own, blocking as the rows do.
   */
  style?: "bollards" | "railing" | "cabinet" | "mailbox" | "shelter" | "kiosk";
  /** Whether the row faces an avenue, where bus shelters stand. */
  avenue?: boolean;
  /** Painted yellow, beside a start square. */
  yellow?: boolean;
}
/** Street furniture that blocks nothing, by its feature name, which carries the way it faces. */
interface Prop {
  name: string;
  x: number;
  z: number;
}
const bollardName = (
  b: Pick<Bollards, "alongX" | "len" | "style" | "yellow">,
) =>
  `psp_bollards_${b.alongX ? "ew" : "ns"}${b.len}${b.style && b.style !== "bollards" ? `_${b.style}` : ""}${b.yellow ? "_y" : ""}`;
/**
 * Splinter Faction's unit shaders (cus_gl4.lua) treat a feature whose name
 * holds `_x`, `_dead` or `_heap` as a wreck and darken it to a tenth from its
 * UVs, which drew x-direction bollard rows near black. Every name is checked,
 * and every def also asks for the plain feature shading through `uniformbin`.
 */
function checkFeatureName(name: string): string {
  for (const bad of ["_x", "_dead", "_heap"])
    if (name.includes(bad))
      throw new Error(
        `feature name "${name}" holds "${bad}", which Splinter Faction shades as a wreck`,
      );
  if (name.length > 31)
    throw new Error(
      `feature name "${name}" is ${name.length} characters, the engine reads 31`,
    );
  return name;
}
/**
 * Where a row's posts stand, along it from its middle. A block's long sides
 * run past its corners and carry a post on each, and its short sides keep the
 * same gap to those corner posts. A ring row has the gap a short side has.
 */
function postsAlong(len: number): number[] {
  const corners = len > BLOCK[0];
  const span = corners ? len - BOLLARD_STEP : len + 2 * BOLLARD_STEP;
  const gaps = Math.round(span / BOLLARD_GAP);
  const gap = span / gaps;
  const out: number[] = [];
  for (let k = corners ? 0 : 1; k <= (corners ? gaps : gaps - 1); k++)
    out.push(-span / 2 + k * gap);
  return out;
}

// --- solid mass --------------------------------------------------------------

/** A Builder that keeps each solid part's own geometry, placed, as the model adds it. */
class PartRecorder extends Builder {
  parts: { tris: Float32Array; min: THREE.Vector3; max: THREE.Vector3 }[] = [];
  override add(
    g: THREE.BufferGeometry,
    color: Rgb,
    m: THREE.Matrix4,
    paint: Paint = {},
    tag?: PartTag,
  ): void {
    // Parts drawn see-through at their edges are not solid.
    if (!paint.fade) {
      const flat = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(m);
      const pos = flat.getAttribute("position");
      const tris = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++)
        tris.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3);
      flat.computeBoundingBox();
      const bb = flat.boundingBox as THREE.Box3;
      this.parts.push({ tris, min: bb.min.clone(), max: bb.max.clone() });
    }
    super.add(g, color, m, paint, tag);
  }
}

/**
 * How high a model is solid from its base at a point, in world units: the top
 * of the run of solid parts that starts at the ground there. A part counts as
 * solid along a vertical line only where the line crosses it an even number
 * of times, so an open shell is left out rather than guessed at.
 */
function solidTop(parts: PartRecorder["parts"], x: number, z: number): number {
  const intervals: [number, number][] = [];
  for (const p of parts) {
    if (x < p.min.x || x > p.max.x || z < p.min.z || z > p.max.z) continue;
    const t = p.tris;
    const hits: number[] = [];
    for (let i = 0; i < t.length; i += 9) {
      const ax = t[i],
        az = t[i + 2],
        bx = t[i + 3],
        bz = t[i + 5],
        cx = t[i + 6],
        cz = t[i + 8];
      const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(den) < 1e-12) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      hits.push(l1 * t[i + 1] + l2 * t[i + 4] + l3 * t[i + 7]);
    }
    if (hits.length === 0) continue;
    hits.sort((a, b) => a - b);
    // Most parts stand on the ground open underneath, a loft with a roof and
    // no floor. A line crosses one of those an odd number of times, and its
    // floor is its lowest point.
    if (hits.length % 2 !== 0) {
      if (p.min.y >= hits[0] - 1e-6) continue;
      hits.unshift(p.min.y);
    }
    for (let i = 0; i < hits.length; i += 2)
      intervals.push([hits[i], hits[i + 1]]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  // Climb from the base through runs that touch, allowing a gap of two elmos.
  const gap = 2 / SCALE;
  let top = 0;
  for (let grew = true; grew; ) {
    grew = false;
    for (const [lo, hi] of intervals)
      if (lo <= top + gap && hi > top) {
        top = hi;
        grew = true;
      }
  }
  return top;
}

/**
 * Whether a point lies inside any part, by a ray along +x crossing the part's
 * walls an odd number of times. Independent of `solidTop`, which looks down.
 */
function insideAny(
  parts: PartRecorder["parts"],
  x: number,
  y: number,
  z: number,
): boolean {
  for (const p of parts) {
    if (
      x < p.min.x ||
      x > p.max.x ||
      y < p.min.y ||
      y > p.max.y ||
      z < p.min.z ||
      z > p.max.z
    )
      continue;
    const t = p.tris;
    let crossings = 0;
    for (let i = 0; i < t.length; i += 9) {
      const ay = t[i + 1],
        az = t[i + 2],
        by = t[i + 4],
        bz = t[i + 5],
        cy = t[i + 7],
        cz = t[i + 8];
      const den = (bz - cz) * (ay - cy) + (cy - by) * (az - cz);
      if (Math.abs(den) < 1e-12) continue;
      const l1 = ((bz - cz) * (y - cy) + (cy - by) * (z - cz)) / den;
      const l2 = ((cz - az) * (y - cy) + (ay - cy) * (z - cz)) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue;
      if (l1 * t[i] + l2 * t[i + 3] + l3 * t[i + 6] > x) crossings++;
    }
    if (crossings % 2 === 1) return true;
  }
  return false;
}

/** Fine samples of a lot's solid height, 2 elmos apart, the same whichever way the model is turned. */
const SOLID_STEP = 2;
/** How far round a heightmap vertex its lowest sample is taken, in elmos: its own square and a margin past it. */
const SOLID_WINDOW = 12;
interface SolidGrid {
  nx: number;
  nz: number;
  /** World units above the base, row by row along x. */
  top: Float32Array;
}
const solidGrids = new Map<string, SolidGrid>();
function solidGrid(model: BuildingModel): SolidGrid {
  const cached = solidGrids.get(model.id);
  if (cached) return cached;
  const [w, d] = footprint(model, OPEN_GRID);
  const recorder = new PartRecorder();
  model.build(recorder, w, d, TOWN_PALETTES[PLANET]);
  const nx = (model.lots[0] * LOT) / SOLID_STEP;
  const nz = (model.lots[1] * LOT) / SOLID_STEP;
  const step = SOLID_STEP / SCALE;
  const raw = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      // A hair off the sample point, so the line never runs exactly down an edge.
      const x = -(nx * step) / 2 + (i + 0.5) * step + 1.3e-6;
      const z = -(nz * step) / 2 + (j + 0.5) * step + 0.7e-6;
      raw[j * nx + i] = solidTop(recorder.parts, x, z);
    }
  // A building may stand half turned, and a square one quarter turned, so a
  // sample keeps the lowest of the turns it can take.
  const top = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      let v = Math.min(raw[j * nx + i], raw[(nz - 1 - j) * nx + (nx - 1 - i)]);
      if (nx === nz)
        v = Math.min(v, raw[i * nx + (nx - 1 - j)], raw[(nx - 1 - i) * nx + j]);
      top[j * nx + i] = v;
    }
  const grid = { nx, nz, top };
  solidGrids.set(model.id, grid);
  return grid;
}

/**
 * Floors inside a building, so a camera that ends up inside one sees a floor
 * below it rather than the ground at the bottom of a hollow shell. A floor
 * every FLOOR_STEP elmos fills the cells of an elmo grid whose middle and four
 * neighbours are all inside a solid part, so no floor reaches a wall. The
 * floors face up and are added after the bake, with every vertex on one patch
 * of the atlas, so they take no texture space from the walls.
 */
const FLOOR_STEP = 48;
const FLOOR_CELL = 8;
/** Off the grid of round heights, so no floor lies in a setback's roof. */
const FLOOR_OFFSET = 0.37;
/** Bumped when the floors change, as they are not part of the baked geometry. */
const FLOORS_VERSION = "floors-2, plinth-1";
function floorTriangles(model: BuildingModel): Float32Array {
  const [w, d] = footprint(model, OPEN_GRID);
  const recorder = new PartRecorder();
  model.build(recorder, w, d, TOWN_PALETTES[PLANET]);
  const parts = recorder.parts;
  if (parts.length === 0) return new Float32Array(0);
  const max = parts.reduce(
    (m, p) => m.max(p.max),
    new THREE.Vector3(-Infinity, -Infinity, -Infinity),
  );
  const nx = Math.round((model.lots[0] * LOT) / FLOOR_CELL);
  const nz = Math.round((model.lots[1] * LOT) / FLOOR_CELL);
  const cell = FLOOR_CELL / SCALE;
  const x0 = -(nx * cell) / 2;
  const z0 = -(nz * cell) / 2;
  const out: number[] = [];
  for (
    let level = FLOOR_STEP + FLOOR_OFFSET;
    level / SCALE < max.y;
    level += FLOOR_STEP
  ) {
    const y = level / SCALE;
    const inside = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++)
        inside[j * nx + i] = insideAny(
          parts,
          x0 + (i + 0.5) * cell + 1.3e-6,
          y,
          z0 + (j + 0.5) * cell + 0.7e-6,
        )
          ? 1
          : 0;
    const at = (i: number, j: number) =>
      i < 0 || j < 0 || i >= nx || j >= nz ? 0 : inside[j * nx + i];
    const floor = (i: number, j: number) =>
      at(i, j) & at(i - 1, j) & at(i + 1, j) & at(i, j - 1) & at(i, j + 1);
    // Runs along each row, joined with the same run in the rows after it.
    const open = new Map<string, number>();
    const emit = (i0: number, i1: number, j0: number, j1: number) => {
      const [ax, bx, az, bz] = [
        x0 + i0 * cell,
        x0 + i1 * cell,
        z0 + j0 * cell,
        z0 + j1 * cell,
      ];
      out.push(
        ax,
        y,
        az,
        ax,
        y,
        bz,
        bx,
        y,
        bz,
        ax,
        y,
        az,
        bx,
        y,
        bz,
        bx,
        y,
        az,
      );
    };
    for (let j = 0; j <= nz; j++) {
      const runs = new Set<string>();
      for (let i = 0; j < nz && i < nx; ) {
        if (!floor(i, j)) {
          i++;
          continue;
        }
        let k = i;
        while (k < nx && floor(k, j)) k++;
        runs.add(`${i},${k}`);
        i = k;
      }
      for (const [run, start] of open)
        if (!runs.has(run)) {
          const [i0, i1] = run.split(",").map(Number);
          emit(i0, i1, start, j);
          open.delete(run);
        }
      for (const run of runs) if (!open.has(run)) open.set(run, j);
    }
  }
  return new Float32Array(out);
}

/**
 * The model with its floors, for the s3o: the floors' texture coordinates all
 * point at a patch painted in the building's light exterior colour, in an empty
 * corner of the atlas.
 */
function withFloors(
  g: THREE.BufferGeometry,
  u: ReturnType<typeof unwrap>,
  colour: Uint8Array,
  floors: Float32Array,
) {
  if (floors.length === 0) return { g, u, patch: null };
  // An empty square in a corner: no chart's texels reach into it.
  const SIDE = 8;
  const corners: [number, number][] = [
    [u.w - SIDE, u.h - SIDE],
    [0, u.h - SIDE],
    [u.w - SIDE, 0],
  ];
  const free = corners.find(([cx, cy]) => {
    for (let t = 0; t < u.uv.length / 6; t++) {
      let [mnx, mny, mxx, mxy] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let k = 0; k < 3; k++) {
        const x = u.uv[(t * 3 + k) * 2],
          y = u.uv[(t * 3 + k) * 2 + 1];
        [mnx, mny, mxx, mxy] = [
          Math.min(mnx, x),
          Math.min(mny, y),
          Math.max(mxx, x),
          Math.max(mxy, y),
        ];
      }
      // Charts keep 2 texels of padding, so a chart's box grows by that much.
      if (
        mxx + 2 > cx &&
        mnx - 2 < cx + SIDE &&
        mxy + 2 > cy &&
        mny - 2 < cy + SIDE
      )
        return false;
    }
    return true;
  });
  if (!free) throw new Error("no empty corner in the atlas for the floors");
  const [cx, cy] = free;
  // The building's own light exterior: the mean of the brighter half of its
  // baked texels, leaving out the empty ones between charts.
  const lums: [number, number][] = [];
  for (let i = 0; i < colour.length; i += 4) {
    const l =
      colour[i] * 0.2126 + colour[i + 1] * 0.7152 + colour[i + 2] * 0.0722;
    if (l > 0) lums.push([l, i]);
  }
  lums.sort((a, b) => a[0] - b[0]);
  const bright = lums.slice(Math.floor(lums.length / 2));
  const floorColour = [0, 1, 2].map((c) =>
    Math.round(
      bright.reduce((sum, [, i]) => sum + colour[i + c], 0) /
        Math.max(1, bright.length),
    ),
  );
  for (let y = cy; y < cy + SIDE; y++)
    for (let x = cx; x < cx + SIDE; x++)
      colour.set(floorColour, (y * u.w + x) * 4);
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const n = pos.count;
  const m = floors.length / 3;
  const positions = new Float32Array((n + m) * 3);
  const normals = new Float32Array((n + m) * 3);
  for (let i = 0; i < n; i++) {
    positions.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3);
    normals.set([nor.getX(i), nor.getY(i), nor.getZ(i)], i * 3);
  }
  positions.set(floors, n * 3);
  for (let i = 0; i < m; i++) normals[(n + i) * 3 + 1] = 1;
  const uv = new Float32Array((n + m) * 2);
  uv.set(u.uv);
  for (let i = 0; i < m; i++)
    uv.set([cx + SIDE / 2, cy + SIDE / 2], (n + i) * 2);
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  out.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return {
    g: out,
    u: { ...u, uv },
    patch: [cx + SIDE / 2, cy + SIDE / 2] as [number, number],
  };
}

/**
 * Each building is two features: a plinth up to PLINTH elmos above its base,
 * and the rest above it, which a player's view can fade out. The ground raised
 * inside a building stops RAISE_CAP above the street, so the plinth always
 * hides it. The cut is off the grid of round heights, as the floors are.
 */
const PLINTH = RAISE_CAP + 40;
const CUT = PLINTH + FLOOR_OFFSET;
/** The feature name of a building's part above the plinth: as long as its own, so it fits the engine's 31 characters. */
const topName = (name: string) => `pst_${name.slice(4)}`;

interface Mesh {
  pos: number[];
  nor: number[];
  uv: number[];
}

/** A geometry's triangles cut by the plane y = `y`, into the parts below and above it. */
function splitMesh(
  g: THREE.BufferGeometry,
  uv: Float32Array,
  y: number,
): { below: Mesh; above: Mesh } {
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const below: Mesh = { pos: [], nor: [], uv: [] };
  const above: Mesh = { pos: [], nor: [], uv: [] };
  type V = number[]; // x y z nx ny nz u v
  const vert = (i: number): V => [
    pos.getX(i),
    pos.getY(i),
    pos.getZ(i),
    nor.getX(i),
    nor.getY(i),
    nor.getZ(i),
    uv[i * 2],
    uv[i * 2 + 1],
  ];
  const lerp = (a: V, b: V) => {
    const t = (y - a[1]) / (b[1] - a[1]);
    const v = a.map((x, k) => x + (b[k] - x) * t);
    v[1] = y;
    const l = Math.hypot(v[3], v[4], v[5]) || 1;
    for (let k = 3; k < 6; k++) v[k] /= l;
    return v;
  };
  // The polygon a triangle leaves on one side of the plane, fanned into triangles.
  const clip = (tri: V[], keepBelow: boolean, out: Mesh) => {
    const inside = (v: V) => (keepBelow ? v[1] <= y : v[1] >= y);
    const poly: V[] = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      if (inside(a)) poly.push(a);
      if (inside(a) !== inside(b)) poly.push(lerp(a, b));
    }
    for (let k = 1; k + 1 < poly.length; k++)
      for (const v of [poly[0], poly[k], poly[k + 1]]) {
        out.pos.push(v[0], v[1], v[2]);
        out.nor.push(v[3], v[4], v[5]);
        out.uv.push(v[6], v[7]);
      }
  };
  for (let t = 0; t < pos.count / 3; t++) {
    const tri = [vert(t * 3), vert(t * 3 + 1), vert(t * 3 + 2)];
    clip(tri, true, below);
    clip(tri, false, above);
  }
  return { below, above };
}

/**
 * The cross-section of a model's solid parts at y, facing up, as triangles in
 * world units. Each part is closed, so the edges where its triangles cross the
 * plane join into loops. A loop inside an odd number of others is a hole.
 */
function capTriangles(model: BuildingModel, y: number): number[] {
  const [w, d] = footprint(model, OPEN_GRID);
  const recorder = new PartRecorder();
  model.build(recorder, w, d, TOWN_PALETTES[PLANET], "close");
  const out: number[] = [];
  const key = (x: number, z: number) =>
    `${Math.round(x * 1e6)},${Math.round(z * 1e6)}`;
  for (const part of recorder.parts) {
    if (part.min.y > y || part.max.y < y) continue;
    const t = part.tris;
    const next = new Map<string, string[]>();
    const point = new Map<string, [number, number]>();
    for (let i = 0; i < t.length; i += 9) {
      const hits: [number, number][] = [];
      for (let k = 0; k < 3; k++) {
        const a = i + k * 3;
        const b = i + ((k + 1) % 3) * 3;
        const ya = t[a + 1],
          yb = t[b + 1];
        if (ya < y === yb < y) continue;
        const f = (y - ya) / (yb - ya);
        hits.push([
          t[a] + (t[b] - t[a]) * f,
          t[a + 2] + (t[b + 2] - t[a + 2]) * f,
        ]);
      }
      if (hits.length !== 2) continue;
      const [ka, kb] = [key(...hits[0]), key(...hits[1])];
      if (ka === kb) continue;
      point.set(ka, hits[0]);
      point.set(kb, hits[1]);
      for (const [from, to] of [
        [ka, kb],
        [kb, ka],
      ])
        next.set(from, [...(next.get(from) ?? []), to]);
    }
    // Walk the edges into loops.
    const used = new Set<string>();
    const loops: THREE.Vector2[][] = [];
    for (const start of next.keys()) {
      if (used.has(start)) continue;
      const loop: THREE.Vector2[] = [];
      let at: string | undefined = start;
      while (at !== undefined) {
        used.add(at);
        const [x, z] = point.get(at) as [number, number];
        loop.push(new THREE.Vector2(x, z));
        at = (next.get(at) ?? []).find((to) => !used.has(to));
      }
      if (loop.length >= 3) loops.push(loop);
    }
    const inPoly = (p: THREE.Vector2, poly: THREE.Vector2[]) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
        if (
          poly[i].y > p.y !== poly[j].y > p.y &&
          p.x <
            ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) /
              (poly[j].y - poly[i].y) +
              poly[i].x
        )
          c = !c;
      return c;
    };
    const depth = loops.map(
      (l, i) => loops.filter((o, j) => j !== i && inPoly(l[0], o)).length,
    );
    loops.forEach((outer, i) => {
      if (depth[i] % 2 === 1) return;
      const holes = loops.filter(
        (h, j) => depth[j] === depth[i] + 1 && inPoly(h[0], outer),
      );
      const contour = THREE.ShapeUtils.isClockWise(outer)
        ? [...outer].reverse()
        : outer;
      const hs = holes.map((h) =>
        THREE.ShapeUtils.isClockWise(h) ? h : [...h].reverse(),
      );
      const all = [...contour, ...hs.flat()];
      for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, hs)) {
        // Facing up: in x, z with y up, a counter-clockwise turn seen from above.
        const [p, q, r] = [all[a], all[b], all[c]];
        const up = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x) < 0;
        for (const v of up ? [p, q, r] : [p, r, q]) out.push(v.x, y, v.y);
      }
    });
  }
  return out;
}

/** An s3o from a mesh, with any cap triangles textured from the floor patch. */
function meshS3o(
  m: Mesh,
  cap: number[],
  patch: [number, number] | null,
  u: ReturnType<typeof unwrap>,
  name: string,
  scale: number,
) {
  const n = m.pos.length / 3 + cap.length / 3;
  const positions = new Float32Array([...m.pos, ...cap]);
  const normals = new Float32Array(n * 3);
  normals.set(m.nor);
  for (let i = m.pos.length / 3; i < n; i++) normals[i * 3 + 1] = 1;
  const uv = new Float32Array(n * 2);
  uv.set(m.uv);
  if (cap.length > 0) {
    if (!patch)
      throw new Error(`${name}: a cap with no floor patch to texture it`);
    for (let i = m.pos.length / 3; i < n; i++) uv.set(patch, i * 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return s3o(g, { ...u, uv }, `${name}.png`, `${name}_2.png`, scale);
}

// --- ground ------------------------------------------------------------------

function ground(lay: ReturnType<typeof layout>): Uint8Array {
  const N = MAP;
  const img = new Uint8Array(N * N * 4);
  const asphalt: Rgb = [58, 60, 63];
  const dash: Rgb = [210, 205, 190];
  const kerb: Rgb = [150, 148, 142];
  const pavement = TOWN_PALETTES[PLANET].pavement as Rgb;
  const plaza: Rgb = [176, 170, 158];
  const apron: Rgb = [128, 132, 136];
  const grain = (x: number, z: number) => {
    const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return 0.94 + 0.12 * (h - Math.floor(h));
  };
  const set = (x: number, z: number, c: Rgb, k: number) => {
    const o = (z * N + x) * 4;
    for (let i = 0; i < 3; i++)
      img[o + i] = Math.max(
        0,
        Math.min(255, Math.round(c[i] * k * grain(x, z))),
      );
  };
  /** Paint a rectangle. A painter returning null leaves the pixel as it was. */
  const fill = (
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    paint: (x: number, z: number) => [Rgb, number] | null,
  ) => {
    for (
      let z = Math.max(0, Math.floor(z0));
      z < Math.min(N, Math.ceil(z1));
      z++
    )
      for (
        let x = Math.max(0, Math.floor(x0));
        x < Math.min(N, Math.ceil(x1));
        x++
      ) {
        const got = paint(x, z);
        if (got) set(x, z, got[0], got[1]);
      }
  };
  // The roads along each axis, as [start, end]: the gaps between blocks, and
  // the street between the outermost blocks and the bands round the ring.
  const roadsOn = (starts: number[], block: number): [number, number][] => [
    [INNER, starts[0]],
    ...starts
      .slice(0, -1)
      .map((s, i): [number, number] => [s + block, starts[i + 1]]),
    [starts[starts.length - 1] + block, MAP - INNER],
  ];
  const xRoads = roadsOn(lay.xs, BLOCK[0]);
  const zRoads = roadsOn(lay.zs, BLOCK[1]);
  const roadAt = (roads: [number, number][], v: number) =>
    roads.find(([a, b]) => v >= a && v < b);
  /** Open road: on a road, inside the ring's bands, and not paved over by a plaza or start square. */
  const openRoad = (x: number, z: number) =>
    x >= INNER &&
    x < MAP - INNER &&
    z >= INNER &&
    z < MAP - INNER &&
    (roadAt(xRoads, x) !== undefined || roadAt(zRoads, z) !== undefined) &&
    ![...lay.plazas, ...lay.walks].some(
      (a) => x >= a.x0 && x < a.x1 && z >= a.z0 && z < a.z1,
    );
  // Where an x road and a z road overlap is a junction only if roads leave it
  // both ways. Where the crossing road is paved over or closed off, the other
  // runs straight through with no crossings.
  const junction = xRoads.map(([xa, xb]) =>
    zRoads.map(([za, zb]) => {
      const xm = (xa + xb) / 2;
      const zm = (za + zb) / 2;
      const alongX = openRoad(xm, za - 1) || openRoad(xm, zb);
      const alongZ = openRoad(xa - 1, zm) || openRoad(xb, zm);
      return alongX && alongZ;
    }),
  );
  const xIndex = (x: number) => xRoads.findIndex(([a, b]) => x >= a && x < b);
  const zIndex = (z: number) => zRoads.findIndex(([a, b]) => z >= a && z < b);
  /** How far v lies from the nearest junction on its road. */
  const toJunction = (
    crossing: [number, number][],
    isJunction: (k: number) => boolean,
    v: number,
  ) =>
    Math.min(
      Infinity,
      ...crossing.map(([a, b], k) =>
        !isJunction(k) ? Infinity : v < a ? a - v : v >= b ? v - b + 1 : 0,
      ),
    );
  const yellow: Rgb = [196, 164, 72];
  const ZEBRA = [6, 34];
  const STOP = [40, 44];
  const EDGE_LINE = [10, 13];
  /**
   * The marking at a point on a road `w` wide, `u` across it and `v` along it,
   * `j` from the nearest junction: a colour, or null for bare asphalt.
   */
  const marking = (
    road: number,
    width: number,
    v: number,
    j: number,
  ): Rgb | null => {
    // The markings are laid out on the carriageway between the sidewalks.
    const u = road - SIDEWALK;
    const w = width - 2 * SIDEWALK;
    if (u < 0 || u >= w) return null;
    const inset = 8;
    if (j >= ZEBRA[0] && j < ZEBRA[1])
      return u > inset && u < w - inset && Math.floor((u - inset) / 8) % 2 === 0
        ? dash
        : null;
    if (j < STOP[1])
      return j >= STOP[0] && u > inset && u < w / 2 - 4 ? dash : null;
    if (
      (u >= EDGE_LINE[0] && u < EDGE_LINE[1]) ||
      (u > w - EDGE_LINE[1] && u <= w - EDGE_LINE[0])
    )
      return dash;
    const c = w / 2;
    if (width >= AVENUE) {
      if (Math.abs(u - (c - 4)) < 1.5 || Math.abs(u - (c + 4)) < 1.5)
        return yellow;
      if (
        (Math.abs(u - w / 4) < 1.5 || Math.abs(u - (3 * w) / 4) < 1.5) &&
        v % 48 < 24
      )
        return dash;
      return null;
    }
    return Math.abs(u - c) < 1.5 && v % 64 < 32 ? dash : null;
  };
  // Asphalt mottled in broad patches, darker where tyres run, and markings worn thin in places.
  const vnoise = (x: number, z: number) => {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const h = (a: number, b: number) => {
      const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const fx = x - xi;
    const fz = z - zi;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const top = h(xi, zi) + (h(xi + 1, zi) - h(xi, zi)) * sx;
    const bottom = h(xi, zi + 1) + (h(xi + 1, zi + 1) - h(xi, zi + 1)) * sx;
    return top + (bottom - top) * sz;
  };
  fill(0, 0, N, N, (x, z) => {
    const mottle =
      0.9 + 0.1 * vnoise(x / 160, z / 160) + 0.06 * vnoise(x / 23, z / 23);
    const xi = xIndex(x);
    const zi = zIndex(z);
    let xr = xi >= 0 ? xRoads[xi] : undefined;
    let zr = zi >= 0 ? zRoads[zi] : undefined;
    if (xr && zr) {
      if (junction[xi][zi]) return [asphalt, mottle * 0.97];
      // Not a junction: the road that leaves the box carries straight through it.
      const [xa, xb] = xr;
      const xm = (xa + xb) / 2;
      const [za, zb] = zr;
      if (openRoad(xm, za - 1) || openRoad(xm, zb)) zr = undefined;
      else xr = undefined;
    }
    let mark: Rgb | null = null;
    let wear = 1;
    if (xr) {
      const [a, b] = xr;
      const u = x - a;
      const w = b - a;
      mark = marking(
        u,
        w,
        z,
        toJunction(zRoads, (k) => junction[xi][k], z),
      );
      const lane = Math.abs((((u / w) * 4) % 2) - 1);
      wear = 1 - 0.05 * smooth(0.55, 0.95, lane);
    } else if (zr) {
      const [a, b] = zr;
      const u = z - a;
      const w = b - a;
      mark = marking(
        u,
        w,
        x,
        toJunction(xRoads, (k) => junction[k][zi], x),
      );
      const lane = Math.abs((((u / w) * 4) % 2) - 1);
      wear = 1 - 0.05 * smooth(0.55, 0.95, lane);
    }
    if (mark) {
      // Paint wears through to the asphalt in patches.
      const t = 0.55 + 0.45 * smooth(0.25, 0.6, vnoise(x / 9, z / 9));
      return [
        mark.map(
          (m, i) => asphalt[i] * mottle + (m - asphalt[i] * mottle) * t,
        ) as Rgb,
        1,
      ];
    }
    return [asphalt, mottle * wear];
  });
  // Every block is paved, and its buildings stand on the paving. Round it runs
  // a sidewalk of square flags, a kerb on its street edge, and the bollards
  // stand just inside the kerb.
  const K = SIDEWALK;
  const KERB = 3;
  const flag: Rgb = [164, 160, 152];
  /** A paving stone's own shade, from its row and column. */
  const tone = (i: number, j: number) => {
    const s = Math.sin(i * 91.7 + j * 47.3) * 43758.5453;
    return 0.94 + 0.09 * (s - Math.floor(s));
  };
  for (const { x0, z0, x1, z1 } of lay.blocks)
    fill(x0 - K, z0 - K, x1 + K, z1 + K, (x, z) => {
      const edge = Math.min(
        x - (x0 - K),
        x1 + K - 1 - x,
        z - (z0 - K),
        z1 + K - 1 - z,
      );
      if (edge < KERB) return [kerb, edge < 1 ? 0.72 : 1];
      if (x >= x0 && x < x1 && z >= z0 && z < z1) {
        const slab = (x - x0) % 32 < 1 || (z - z0) % 32 < 1;
        return [pavement, slab ? 0.88 : 1];
      }
      const seam = (x - x0 + 64) % 16 < 1 || (z - z0 + 64) % 16 < 1;
      return [
        flag,
        (seam ? 0.84 : 1) *
          tone(Math.floor((x + 64) / 16), Math.floor((z + 64) / 16)),
      ];
    });
  // A walk joining two blocks is laid in small warm brick, basketweave, with a
  // granite band where it meets the street at each end, so it reads apart from
  // the grey flags of a metal spot plaza.
  const brick: Rgb = [164, 128, 106];
  const granite: Rgb = [112, 110, 108];
  for (const a of lay.walks)
    fill(a.x0 - K, a.z0, a.x1 + K, a.z1, (x, z) => {
      const end = Math.min(x - (a.x0 - K), a.x1 + K - 1 - x);
      if (end < 8)
        return [granite, x % 8 < 1 || z % 8 < 1 ? 0.8 : tone(x >> 3, z >> 3)];
      // A tree pit: a dark iron grate in rings round the trunk, in a granite frame.
      for (const [tx, tz] of lay.trees) {
        const dx = Math.abs(x + 0.5 - tx);
        const dz = Math.abs(z + 0.5 - tz);
        if (dx >= 8 || dz >= 8) continue;
        if (dx >= 6.5 || dz >= 6.5) return [granite, 0.9];
        const r = Math.hypot(dx, dz);
        if (r < 2) return [[46, 38, 30], 1];
        return [[52, 54, 58], r % 2 < 0.9 ? 0.55 : 1];
      }
      // A drainage channel down the middle: granite kerbs either side of a slotted grate.
      const mid = (a.z0 + a.z1) / 2;
      const off = Math.abs(z + 0.5 - mid);
      if (off < 3) return [[58, 60, 64], x % 4 < 1.5 ? 0.5 : 1];
      if (off < 5) return [granite, tone(x >> 3, 7)];
      // Each 8 elmo square holds two 8 by 4 bricks, turned a quarter from its neighbours'.
      const across = (Math.floor(x / 8) + Math.floor(z / 8)) % 2 === 0;
      const [p, q] = across ? [x, z] : [z, x];
      const joint = p % 8 < 1 || q % 4 < 1;
      return [
        brick,
        joint
          ? 0.7
          : tone(Math.floor(p / 8) * 3 + 1, Math.floor(q / 4) * 5 + 2) * 0.97,
      ];
    });
  // Plazas are paved in flags, and a start square in large concrete slabs
  // with a hazard-striped border and a ring painted at its centre. Every seam
  // lies on the map's own 16 elmo build grid, so what snaps to that grid, a
  // geothermal vent or a building, lines up with the paving.
  const hazard: Rgb = [206, 168, 44];
  const hazardDark: Rgb = [42, 42, 44];
  const paint: Rgb = [218, 214, 202];
  const worn = (x: number, z: number) =>
    0.6 + 0.4 * smooth(0.25, 0.6, vnoise(x / 9, z / 9));
  const over = (base: Rgb, k: number, top: Rgb, t: number): Rgb =>
    base.map((b, i) => b * k + (top[i] - b * k) * t) as Rgb;
  for (const a of lay.plazas)
    fill(a.x0, a.z0, a.x1, a.z1, (x, z) => {
      const mottle = 0.94 + 0.06 * vnoise(x / 120, z / 120);
      if (!a.start) {
        const seam = x % 32 < 1 || z % 32 < 1;
        return [
          plaza,
          mottle *
            tone(Math.floor(x / 32), Math.floor(z / 32)) *
            (seam ? 0.86 : 1),
        ];
      }
      const seam = x % 64 < 2 || z % 64 < 2;
      const k =
        mottle *
        tone(Math.floor(x / 64), Math.floor(z / 64)) *
        (seam ? 0.8 : 1);
      const edge = Math.min(x - a.x0, a.x1 - 1 - x, z - a.z0, a.z1 - 1 - z);
      if (edge < 24)
        return [
          over(apron, k, (x + z) % 32 < 16 ? hazard : hazardDark, worn(x, z)),
          1,
        ];
      if (edge >= 28 && edge < 32)
        return [over(apron, k, paint, worn(x, z)), 1];
      const cx = (a.x0 + a.x1) / 2;
      const cz = (a.z0 + a.z1) / 2;
      const r = Math.hypot(x - cx, z - cz);
      const R = Math.min(a.x1 - a.x0, a.z1 - a.z0) * 0.3;
      const ring = (r > R - 8 && r <= R) || (r > R - 28 && r <= R - 24);
      const tick =
        r > R + 12 &&
        r < R + 56 &&
        (Math.abs(x - cx) < 4 || Math.abs(z - cz) < 4);
      if (ring || tick)
        return [
          over(apron, k, ring && r <= R - 24 ? hazard : paint, worn(x, z)),
          1,
        ];
      return [apron, k];
    });
  // Each metal spot is a bright steel plate in a dark socket, bolted into a
  // collar inside a hazard-striped ring as wide as the extractor's reach, so
  // it reads as a place to build rather than a drain or a vent.
  for (const [sx, sz] of lay.spots)
    fill(
      sx - SPOT_MARK,
      sz - SPOT_MARK,
      sx + SPOT_MARK,
      sz + SPOT_MARK,
      (x, z) => {
        const dx = x + 0.5 - sx;
        const dz = z + 0.5 - sz;
        const r = Math.hypot(dx, dz);
        if (r > SPOT_MARK) return null;
        const angle = Math.atan2(dz, dx);
        if (r > SPOT_MARK - 9) {
          const band = Math.floor((angle / (2 * Math.PI)) * 24 + r / 12);
          return [((band % 2) + 2) % 2 === 0 ? hazard : hazardDark, 1];
        }
        if (r > SPOT_MARK - 11) return [[24, 24, 26], 1];
        if (r > 24) {
          // Eight bolts round the collar.
          const at = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
          const bolt =
            Math.hypot(dx - Math.cos(at) * 31.5, dz - Math.sin(at) * 31.5) < 3;
          return [bolt ? [36, 38, 42] : [128, 134, 144], 1];
        }
        if (r > 19) return [[22, 22, 26], 1];
        // The plate, lit from one side, with rings turned into it.
        const lit = 0.82 + 0.18 * Math.cos(angle + Math.PI / 4) * (r / 19);
        const groove = r % 6 < 1 ? 0.8 : 1;
        return [
          [222, 228, 236].map((c) => Math.min(255, c * lit * groove)) as Rgb,
          1,
        ];
      },
    );
  return img;
}

// --- run ---------------------------------------------------------------------

test("city map", () => {
  // A shard writes only the bake cache, so the shards can run side by side.
  if (!SHARD) {
    rmSync(ROOT, { recursive: true, force: true });
    for (const d of [
      "maps",
      "features",
      "objects3d",
      "unittextures",
      "mapconfig",
    ])
      mkdirSync(`${ARCHIVE}${d}`, { recursive: true });
    mkdirSync(SRC, { recursive: true });
  }
  const lay = layout();
  if (!SHARD) {
    copyFileSync(
      `${SKY}persepolis_sky.dds`,
      `${ARCHIVE}maps/persepolis_sky.dds`,
    );
    // The engine adds its detail texture, times two less one, to the ground's
    // colour, and without one uses its own noise, which looks like carpet up
    // close. Flat grey at the engine's own neutral value adds nothing.
    writeFileSync(
      `${ARCHIVE}maps/persepolis_detail.png`,
      png(new Uint8Array(64 * 64 * 4).fill(127), 64, 64),
    );
    // The gadget that lifts aircraft over the buildings and sets the bollards, and the opening camera widget.
    cpSync(`${LUA}LuaRules`, `${ARCHIVE}LuaRules`, { recursive: true });
    cpSync(`${LUA}LuaUI`, `${ARCHIVE}LuaUI`, { recursive: true });
  }
  const fog = readFileSync(`${SKY}fog.txt`, "utf8")
    .trim()
    .split(" ")
    .map(Number);

  // One feature type per model and livery used.
  const types = new Map<string, { model: BuildingModel; livery: Livery }>();
  // The engine keeps each SMF feature type name in a 32-byte slot and reads at
  // most 31 characters of it. A longer name splits in two and throws every
  // later name and placement out of step, which crashes the engine on load.
  const typeName = (p: Placement) => {
    const name = `psp_${p.model.id}_${p.livery.id}`.replace(/-/g, "_");
    return checkFeatureName(name);
  };
  for (const p of lay.placements)
    types.set(typeName(p), { model: p.model, livery: p.livery });

  const defs: string[] = [];
  let texels = 0;
  /** The tallest building's roof above its base, in elmos. */
  let tallestRoof = 0;
  /** Each building type's roof above its base, in elmos. */
  const roofOf = new Map<string, number>();
  let cacheHits = 0;
  /** Each building type's floor triangles. */
  const floorTris = new Map<string, number>();
  /** The building types taller than the plinth, which have a part above it. */
  const splitTypes = new Set<string>();
  for (const [name, { model, livery }] of types) {
    // The lot's slab of pavement, as the conquest map stands each building on.
    // It is built apart from the building so the livery leaves it alone.
    const [sw, sd] = [
      model.lots[0] * OPEN_GRID.lot,
      model.lots[1] * OPEN_GRID.lot,
    ];
    // Building the geometry is quick. Baking it is the slow part, so the bake
    // is cached on the finished geometry itself, and a change to one model
    // bakes that model alone.
    const [w, d] = footprint(model, OPEN_GRID);
    const building = built((b) =>
      model.build(b, w, d, TOWN_PALETTES[PLANET], "close"),
    );
    dress(building, 1, livery);
    const slab = built((b) =>
      b.add(
        box(sw, PAVEMENT + SLAB_DEPTH / SCALE, sd, 0, 0.4),
        TOWN_PALETTES[PLANET].pavement,
        at(0, -SLAB_DEPTH / SCALE, 0),
        { kind: 7, clean: true },
      ),
    );
    const g = mergeGeometries([building, slab]);
    const art = bakedOnce(name, [geometryHash(g), FLOORS_VERSION], () => {
      const u = unwrap(g);
      const pbr = new Uint8Array(u.w * u.h * 4);
      // The terrain round the slab is at the model's origin.
      const ao = bakeAo(g, u, 0);
      const colour = toneDown(bake(g, u, false, pbr, ao));
      const normals = bakeNormals(g, u, ao);
      const floors = floorTriangles(model);
      const full = withFloors(g, u, colour, floors);
      // The first texture's alpha is the team colour mask: 0 keeps the building's own colour.
      for (let i = 3; i < colour.length; i += 4) colour[i] = 0;
      // Texels outside every chart still need an opaque alpha, or the shader cuts them out.
      for (let i = 3; i < pbr.length; i += 4) pbr[i] = 255;
      const roof =
        new THREE.Box3().setFromBufferAttribute(
          full.g.getAttribute("position") as THREE.BufferAttribute,
        ).max.y * SCALE;
      const cut = CUT / SCALE;
      const split = roof > CUT;
      const parts = split ? splitMesh(full.g, full.u.uv, cut) : null;
      const whole: Mesh = {
        pos: [...(full.g.getAttribute("position").array as Float32Array)],
        nor: [...(full.g.getAttribute("normal").array as Float32Array)],
        uv: [...full.u.uv],
      };
      const base = meshS3o(
        parts ? parts.below : whole,
        split ? capTriangles(model, cut) : [],
        full.patch,
        full.u,
        name,
        SCALE,
      );
      const top = parts
        ? meshS3o(parts.above, [], full.patch, full.u, name, SCALE)
        : null;
      const size = base.box.getSize(new THREE.Vector3());
      const topSize = top?.box.getSize(new THREE.Vector3());
      return {
        colour: png(colour, u.w, u.h, true),
        pbr: png(pbr, u.w, u.h, true),
        normals: png(normals, u.w, u.h, true),
        s3o: base.bytes,
        s3oTop: top?.bytes,
        meta: {
          texels: u.w * u.h,
          maxY: roof,
          size: [size.x, size.y, size.z],
          floorTriangles: floors.length / 9,
          top: topSize
            ? { size: [topSize.x, topSize.y, topSize.z] }
            : undefined,
        },
      };
    });
    if (art.hit) cacheHits++;
    texels += art.meta.texels;
    floorTris.set(name, art.meta.floorTriangles ?? 0);
    tallestRoof = Math.max(tallestRoof, art.meta.maxY);
    roofOf.set(name, art.meta.maxY);
    // The plinth, and the part above it when the building is taller: both
    // block units and shots, and only the part above may fade from view.
    const parts: [string, [number, number, number], string][] = [
      [name, art.meta.size, art.meta.top ? "plinth" : "whole"],
    ];
    if (art.meta.top) {
      parts.push([
        checkFeatureName(topName(name)),
        art.meta.top.size,
        "above the plinth",
      ]);
      splitTypes.add(name);
    }
    for (const [feature, size, part] of parts)
      defs.push(
        `  ${feature} = {
    description = "${model.id}, ${livery.id}, ${part}",
    object = "${feature}.s3o",
    footprintX = ${Math.round((sw * SCALE) / 16)},
    footprintZ = ${Math.round((sd * SCALE) / 16)},
    blocking = true,
    reclaimable = false,
    autoreclaimable = false,
    indestructible = true,
    flammable = false,
    damage = 1000000,
    metal = 0,
    energy = 0,
    upright = true,
    collisionVolumeType = "box",
    collisionVolumeScales = { ${size[0].toFixed(1)}, ${size[1].toFixed(1)}, ${size[2].toFixed(1)} },
    collisionVolumeOffsets = { 0, 0, 0 },
    customparams = { blockingoverride = "1", uniformbin = "feature", normaltex = "unittextures/${name}_normals.png"${feature === name ? "" : `, plinth = "${PLINTH}"`} },
  },`,
      );
  }
  // Street furniture, one model for each length, direction and style of row
  // and each way a prop faces, so none depends on how the engine turns a
  // feature. Every model is drawn in elmos and scaled to world units, and its
  // bake is cached on its geometry as the buildings' are.
  const e = 1 / SCALE;
  /** A box `w` by `d` from `y0` to `y1` round `cx, cz`, in elmos. */
  const slab = (w: number, d: number, y0: number, y1: number, cx = 0, cz = 0) =>
    box(w * e, (y1 - y0) * e, d * e).translate(cx * e, y0 * e, cz * e);
  /** An octagon of radius `r` round `cx, cz`, in world units for column(). */
  const octagon = (cx: number, cz: number, r: number): [number, number][] =>
    Array.from({ length: 8 }, (_, s): [number, number] => {
      const a = (s / 8) * 2 * Math.PI + Math.PI / 8;
      return [(cx + r * Math.cos(a)) * e, (cz + r * Math.sin(a)) * e];
    });
  const paint = (kind: Kind = 8) => ({ kind, clean: true });
  const origin = at(0, 0, 0);
  let furnitureHits = 0;
  const furniture = (
    name: string,
    g: THREE.BufferGeometry,
    fx: number,
    fz: number,
    blocking: boolean,
    description: string,
  ) => {
    checkFeatureName(name);
    const art = bakedOnce(name, [geometryHash(g)], () => {
      const u = unwrap(g);
      const pbr = new Uint8Array(u.w * u.h * 4);
      const ao = bakeAo(g, u, 0);
      const colour = toneDown(bake(g, u, false, pbr, ao));
      const normals = bakeNormals(g, u, ao);
      for (let i = 3; i < colour.length; i += 4) colour[i] = 0;
      for (let i = 3; i < pbr.length; i += 4) pbr[i] = 255;
      const { bytes, box: bounds } = s3o(
        g,
        u,
        `${name}.png`,
        `${name}_2.png`,
        SCALE,
      );
      const size = bounds.getSize(new THREE.Vector3());
      return {
        colour: png(colour, u.w, u.h, true),
        pbr: png(pbr, u.w, u.h, true),
        normals: png(normals, u.w, u.h, true),
        s3o: bytes,
        meta: {
          texels: u.w * u.h,
          maxY: bounds.max.y,
          size: [size.x, size.y, size.z],
        },
      };
    });
    if (art.hit) furnitureHits++;
    texels += art.meta.texels;
    const [sx, sy, sz] = art.meta.size;
    defs.push(
      `  ${name} = {
    description = "${description}",
    object = "${name}.s3o",
    footprintX = ${fx / 16},
    footprintZ = ${fz / 16},
    blocking = ${blocking},
    reclaimable = false,
    autoreclaimable = false,
    indestructible = true,
    flammable = false,
    damage = 1000000,
    metal = 0,
    energy = 0,
    upright = true,
    collisionVolumeType = "box",
    collisionVolumeScales = { ${sx.toFixed(1)}, ${sy.toFixed(1)}, ${sz.toFixed(1)} },
    collisionVolumeOffsets = { 0, 0, 0 },
    customparams = { blockingoverride = "1", uniformbin = "feature", normaltex = "unittextures/${name}_normals.png" },
  },`,
    );
  };

  // The rows. A bollard is a steel octagon with a pale cap, yellow with a
  // dark cap beside a start square. A railing is thinner posts carrying two
  // rails. A cabinet, a mailbox or a bus shelter stands in a bollard row in
  // place of the posts it would touch. A kiosk is a row of its own.
  const rowKinds = new Map<string, Bollards>();
  for (const b of lay.bollards) rowKinds.set(bollardName(b), b);
  for (const [name, row] of rowKinds) {
    const style = row.style ?? "bollards";
    const along = (v: number): [number, number] =>
      row.alongX ? [v, 0] : [0, v];
    /** A box `l` along the row, `w` across it, from `y` up `h`, its middle `v` along the row and `u` across it. */
    const bar = (
      b: Builder,
      v: number,
      l: number,
      w: number,
      h: number,
      y: number,
      colour: Rgb,
      u = 0,
    ) => {
      const [cx, cz] = row.alongX ? [v, u] : [u, v];
      b.add(
        slab(row.alongX ? l : w, row.alongX ? w : l, y, y + h, cx, cz),
        colour,
        origin,
        paint(),
      );
    };
    const [body, cap] = row.yellow
      ? ([
          [206, 168, 44],
          [36, 36, 38],
        ] as Rgb[])
      : ([
          [62, 64, 68],
          [214, 208, 190],
        ] as Rgb[]);
    const posts = style === "kiosk" ? [] : postsAlong(row.len);
    const g = built((b) => {
      if (style === "kiosk") {
        // Two-sided, so it needs no facing: a cream booth on a plinth with a
        // teal base band, a serving window and counter on each long side under
        // a striped awning, a pale roof and a teal sign along its ridge.
        const teal: Rgb = [44, 138, 146];
        bar(b, 0, 42, 16, 1.5, 0, [150, 150, 146]);
        bar(b, 0, 40, 14, 19.5, 1.5, [226, 218, 198]);
        bar(b, 0, 40.6, 14.6, 3, 1.5, teal);
        bar(b, 0, 30, 14.8, 6, 10, [78, 104, 118]);
        bar(b, 0, 32, 17, 1, 9, teal);
        bar(b, 0, 44, 20, 1.6, 21, [214, 214, 208]);
        bar(b, 0, 30, 3, 5, 22.6, teal);
        bar(b, 0, 26, 3.4, 2, 24, [238, 232, 210]);
        for (const side of [-1, 1])
          for (let k = 0; k < 8; k++) {
            const [cx] = along(-18 + 2.25 + k * 4.5);
            // A flat awning from the booth's wall out 7, in two steps so it falls outward.
            const colour: Rgb = k % 2 === 0 ? [238, 234, 224] : teal;
            b.add(
              slab(4.5, 4, 15.6, 16.4, cx, side * 9),
              colour,
              origin,
              paint(),
            );
            b.add(
              slab(4.5, 3.4, 14.8, 15.6, cx, side * 12.3),
              colour,
              origin,
              paint(),
            );
          }
        return;
      }
      if (style === "railing") {
        const colour: Rgb = row.yellow ? [206, 168, 44] : [138, 142, 146];
        for (const v of posts) {
          const [cx, cz] = along(v);
          b.add(
            column(octagon(cx, cz, 1.4), 0, (BOLLARD_H + 1) * e),
            colour,
            origin,
            paint(12),
          );
        }
        const [first, last] = [posts[0], posts[posts.length - 1]];
        for (const y of [5, BOLLARD_H - 0.5])
          bar(b, (first + last) / 2, last - first + 3, 1.6, 1.6, y, colour);
        return;
      }
      // A cabinet a fifth of the way along, a mailbox past the middle, a shelter further on.
      const thing =
        style === "cabinet"
          ? { v: -row.len * 0.2, half: 8 }
          : style === "mailbox"
            ? { v: row.len * 0.15, half: 4 }
            : style === "shelter"
              ? { v: row.len * 0.25, half: 22 }
              : null;
      const at0 = thing
        ? posts.reduce(
            (a, p) => (Math.abs(p - thing.v) < Math.abs(a - thing.v) ? p : a),
            posts[0],
          )
        : 0;
      for (const v of posts) {
        if (thing && Math.abs(v - at0) < thing.half + 6) continue;
        const [cx, cz] = along(v);
        b.add(
          column(octagon(cx, cz, 2.5), 0, (BOLLARD_H - 2) * e),
          body,
          origin,
          paint(),
        );
        b.add(
          column(
            octagon(cx, cz, 2.5),
            (BOLLARD_H - 2) * e,
            BOLLARD_H * e,
            octagon(cx, cz, 1.8),
          ),
          cap,
          origin,
          paint(),
        );
      }
      if (style === "cabinet") {
        // A green-grey utility cabinet with a darker lid.
        bar(b, at0, 16, 9, 13, 0, [104, 118, 108]);
        bar(b, at0, 17, 10, 1.2, 13, [66, 74, 70]);
      } else if (style === "mailbox") {
        // A red pillar box on a dark plinth, under a rounded cap.
        const [cx, cz] = along(at0);
        b.add(
          shaft(4.2 * e, 4.2 * e, 1 * e, 12),
          [40, 40, 42],
          at(cx * e, 0, cz * e),
          paint(),
        );
        b.add(
          shaft(3.6 * e, 3.6 * e, 11 * e, 12),
          [172, 36, 32],
          at(cx * e, 0, cz * e),
          paint(9),
        );
        b.add(
          shaft(3.9 * e, 1.2 * e, 2.6 * e, 12),
          [160, 32, 30],
          at(cx * e, 11 * e, cz * e),
          paint(9),
        );
      } else if (style === "shelter") {
        // A bus shelter, open both ways: four posts, a dark roof, glass at
        // each end, an advert panel at one, and a bench.
        for (const dv of [-20, 20])
          for (const du of [-5, 5]) {
            const [cx, cz] = row.alongX ? [at0 + dv, du] : [du, at0 + dv];
            b.add(
              column(octagon(cx, cz, 0.9), 0, 20 * e),
              [150, 154, 158],
              origin,
              paint(12),
            );
          }
        bar(b, at0, 46, 14, 1.6, 20, [64, 70, 76]);
        bar(b, at0 - 20, 0.8, 9, 15, 3, [150, 186, 204]);
        bar(b, at0 + 20, 1.2, 9, 15, 3, [224, 204, 132]);
        bar(b, at0, 30, 4, 1.4, 5, [124, 98, 72]);
        for (const dv of [-12, 12])
          bar(b, at0 + dv, 1.5, 3, 5, 0, [90, 92, 96]);
      }
    });
    const [fx, fz] = row.alongX
      ? [row.len, BOLLARD_STEP]
      : [BOLLARD_STEP, row.len];
    furniture(name, g, fx, fz, true, style === "kiosk" ? "Kiosk" : "Bollards");
  }

  // The props, which block nothing. A lamp's arm and a signal's arm reach
  // the way the name's last letter says: n is -z, s is +z, e is +x, w is -x.
  const dirOf = (name: string): [number, number] =>
    ({ n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] })[name.slice(-1)] as [
      number,
      number,
    ];
  for (const name of new Set(lay.props.map((p) => p.name))) {
    let g: THREE.BufferGeometry;
    if (name.startsWith("psp_street_lamp_")) {
      const [dx, dz] = dirOf(name);
      g = built((b) => {
        b.add(
          column(octagon(0, 0, 1.5), 0, 2 * e),
          [52, 54, 58],
          origin,
          paint(),
        );
        b.add(
          column(octagon(0, 0, 1.1), 2 * e, 40 * e, octagon(0, 0, 0.8)),
          [92, 96, 102],
          origin,
          paint(12),
        );
        // The arm, out past the bollards, and the lamp hanging from its end.
        const ax = dx * 8;
        const az = dz * 8;
        b.add(
          slab(dx ? 16 : 1.4, dz ? 16 : 1.4, 39, 40.4, ax, az),
          [92, 96, 102],
          origin,
          paint(12),
        );
        b.add(
          slab(dx ? 7 : 3.6, dz ? 7 : 3.6, 37, 39, dx * 15, dz * 15),
          [236, 228, 196],
          origin,
          paint(),
        );
      });
      furniture(name, g, 16, 16, false, "Street lamp");
    } else if (name.startsWith("psp_street_signal_")) {
      const [dx] = dirOf(name);
      g = built((b) => {
        b.add(
          column(octagon(0, 0, 1.8), 0, 34 * e, octagon(0, 0, 1.4)),
          [58, 62, 66],
          origin,
          paint(12),
        );
        b.add(
          slab(44, 1.6, 30, 31.6, dx * 22, 0),
          [58, 62, 66],
          origin,
          paint(12),
        );
        // Two signal heads, one over the near lane and one at the arm's end,
        // their lenses showing on both faces.
        for (const along of [20, 40]) {
          const x = dx * along;
          b.add(slab(3, 3, 20.5, 30, x, 0), [30, 32, 34], origin, paint());
          for (const [y, colour] of [
            [27.5, [208, 44, 34]],
            [25, [226, 164, 32]],
            [22.5, [44, 184, 84]],
          ] as [number, Rgb][])
            b.add(slab(2.2, 3.4, y - 1, y + 1, x, 0), colour, origin, paint());
        }
      });
      furniture(name, g, 16, 16, false, "Traffic signal");
    } else if (name === "psp_street_tree") {
      const palette = TOWN_PALETTES[PLANET];
      g = built((b) => {
        b.add(shaft(1.3 * e, 1 * e, 14 * e, 8), [86, 70, 56], origin, paint(7));
        // A tall thin spindle of leaves, widest a third of the way up.
        b.add(
          column(
            round(6 * e, 6 * e, 10),
            10 * e,
            22 * e,
            round(10 * e, 10 * e, 10),
          ),
          palette.tree,
          origin,
          paint(7),
        );
        b.add(
          column(
            round(10 * e, 10 * e, 10),
            22 * e,
            48 * e,
            round(2 * e, 2 * e, 10),
          ),
          palette.tree,
          origin,
          paint(7),
        );
      });
      furniture(name, g, 16, 16, false, "Tree");
    } else {
      throw new Error(`no model for prop ${name}`);
    }
  }
  if (SHARD) return;
  writeFileSync(
    `${ARCHIVE}features/persepolis.lua`,
    `-- Generated by scripts/town-models/map.test.ts\nreturn {\n${defs.join("\n")}\n}\n`,
  );

  // mapconv's feature list: name x y z rotation, with a y below -490000 meaning on the ground.
  // mapconv reads the rotation in degrees and stores 32767 - degrees / 360 * 65535, which the
  // engine reads as a signed 16-bit heading. So each heading is written as the degrees that
  // store it exactly.
  const degreesFor = (heading: number) => {
    const signed = heading > 32767 ? heading - 65536 : heading;
    return (((32767 - signed) / 65535) * 360).toFixed(6);
  };
  writeFileSync(
    `${SRC}features.txt`,
    [
      ...lay.placements.flatMap((p) =>
        (splitTypes.has(typeName(p))
          ? [typeName(p), topName(typeName(p))]
          : [typeName(p)]
        ).map(
          (n) =>
            `${n} ${p.x.toFixed(0)} ${STREET_Y} ${p.z.toFixed(0)} ${degreesFor(p.heading)}`,
        ),
      ),
      ...lay.bollards.map(
        (b) => `${bollardName(b)} ${b.x} ${STREET_Y} ${b.z} ${degreesFor(0)}`,
      ),
      ...lay.props.map(
        (p) => `${p.name} ${p.x} ${STREET_Y} ${p.z} ${degreesFor(0)}`,
      ),
    ].join("\n"),
  );

  const tex = ground(lay);
  writeFileSync(`${SRC}texture.png`, png(tex, MAP, MAP));
  // A plan for checking the layout: the ground at one pixel per 8 elmos, each
  // building's footprint shaded from mid grey (low) to near white (tall), as
  // concrete roofs. Orange and red read as lava to someone new to the map.
  const P = MAP / 8;
  const plan = new Uint8Array(P * P * 4);
  for (let z = 0; z < P; z++)
    for (let x = 0; x < P; x++) {
      const o = (z * 8 * MAP + x * 8) * 4;
      plan.set(tex.subarray(o, o + 3), (z * P + x) * 4);
    }
  for (const p of lay.placements) {
    const [w, d] = footprint(p.model, OPEN_GRID);
    const turned = p.heading === 16384 || p.heading === 49152;
    const hw = ((turned ? d : w) * SCALE) / 16;
    const hd = ((turned ? w : d) * SCALE) / 16;
    const t = Math.min(1, p.model.height / 4);
    for (let z = Math.floor(p.z / 8 - hd); z < p.z / 8 + hd; z++)
      for (let x = Math.floor(p.x / 8 - hw); x < p.x / 8 + hw; x++)
        plan.set(
          [
            Math.round(140 + 95 * t),
            Math.round(143 + 95 * t),
            Math.round(150 + 92 * t),
            255,
          ],
          (z * P + x) * 4,
        );
  }
  writeFileSync(`${ROOT}plan.png`, png(plan, P, P));
  // The minimap is the plan at 1024 square, the size mapconv stores.
  const M = 1024;
  const mini = new Uint8Array(M * M * 4);
  for (let z = 0; z < M; z++)
    for (let x = 0; x < M; x++) {
      const o = (Math.floor((z * P) / M) * P + Math.floor((x * P) / M)) * 4;
      mini.set(plan.subarray(o, o + 3), (z * M + x) * 4);
    }
  writeFileSync(`${SRC}minimap.png`, png(mini, M, M));
  // The ground is flat at street level, except under each built block: there a
  // pit inside a rim one heightmap square wide, its floor a checkerboard of
  // high and low cells. That is too steep to drive or build on, and too uneven
  // for Splinter Faction's random metal spots. The slabs hide it.
  const hm = MAP / 8 + 1;
  /** Heights in elmos, one per heightmap vertex. */
  const elev = new Float32Array(hm * hm).fill(STREET_Y);
  const open = (cx: number, cz: number) =>
    lay.plazas.some((a) => cx > a.x0 && cx < a.x1 && cz > a.z0 && cz < a.z1);
  const checkerHigh = (vx: number, vz: number) =>
    (Math.floor((vx * 8) / 16) + Math.floor((vz * 8) / 16)) % 2 === 0;
  const pit = (vx: number, vz: number) => {
    elev[vz * hm + vx] = checkerHigh(vx, vz) ? PIT_HIGH : PIT_LOW;
  };
  for (const { x0, z0, x1, z1, ring } of lay.blocks) {
    if (ring || open((x0 + x1) / 2, (z0 + z1) / 2)) continue;
    for (let vz = Math.ceil((z0 + 8) / 8); vz <= Math.floor((z1 - 8) / 8); vz++)
      for (
        let vx = Math.ceil((x0 + 8) / 8);
        vx <= Math.floor((x1 - 8) / 8);
        vx++
      )
        pit(vx, vz);
  }
  // The ring is one pit out to the map's edge, with a rim only along its inside.
  for (let vz = 0; vz < hm; vz++)
    for (let vx = 0; vx < hm; vx++) {
      const x = vx * 8;
      const z = vz * 8;
      if (
        x <= INNER - 8 ||
        x >= MAP - INNER + 8 ||
        z <= INNER - 8 ||
        z >= MAP - INNER + 8
      )
        pit(vx, vz);
    }
  // Line of sight is cast over the terrain alone, so the ground inside each
  // building is raised to just under its solid mass, where the building hides
  // it. Each vertex takes the lowest solid height within a heightmap square of
  // it, so the slopes between vertices stay inside the walls too, less a margin
  // that keeps the terrain clear of roofs.
  const F = MAP / SOLID_STEP;
  const fine = new Float32Array(F * F);
  for (const p of lay.placements) {
    const g = solidGrid(p.model);
    const fx0 = (p.x - (g.nx * SOLID_STEP) / 2) / SOLID_STEP;
    const fz0 = (p.z - (g.nz * SOLID_STEP) / 2) / SOLID_STEP;
    if (!Number.isInteger(fx0) || !Number.isInteger(fz0))
      throw new Error(`${p.model.id} lot is off the solid grid`);
    for (let j = 0; j < g.nz; j++)
      for (let i = 0; i < g.nx; i++)
        fine[(fz0 + j) * F + fx0 + i] = g.top[j * g.nx + i] * SCALE;
  }
  const solidUnder = (vx: number, vz: number) => {
    let low = Infinity;
    // The fine samples whose centres lie within SOLID_WINDOW of the vertex.
    const lo = (v: number) =>
      Math.ceil((8 * v - SOLID_WINDOW - SOLID_STEP / 2) / SOLID_STEP);
    const hi = (v: number) =>
      Math.floor((8 * v + SOLID_WINDOW - SOLID_STEP / 2) / SOLID_STEP);
    for (let fz = lo(vz); fz <= hi(vz); fz++)
      for (let fx = lo(vx); fx <= hi(vx); fx++)
        low =
          fx < 0 || fz < 0 || fx >= F || fz >= F
            ? 0
            : Math.min(low, fine[fz * F + fx]);
    return low;
  };
  let raisedCount = 0;
  const solidAt = new Float32Array(hm * hm);
  for (let vz = 0; vz < hm; vz++)
    for (let vx = 0; vx < hm; vx++) {
      const solid = solidUnder(vx, vz);
      solidAt[vz * hm + vx] = solid;
      if (solid < SOLID_MIN) continue;
      // The checkerboard stays, so the raised ground is never flat enough for
      // a metal spot or a building.
      const top =
        STREET_Y +
        Math.min(solid - SOLID_MARGIN, RAISE_CAP) -
        (checkerHigh(vx, vz) ? 0 : PIT_HIGH - PIT_LOW);
      if (top > elev[vz * hm + vx]) {
        elev[vz * hm + vx] = top;
        raisedCount++;
      }
    }
  // The engine stands a map feature on the ground under its centre, whatever
  // height the feature list gives. A pad at street level under each centre,
  // covering every vertex the engine interpolates there, keeps buildings level.
  for (const p of lay.placements)
    for (
      let vz = Math.floor((p.z - 8) / 8);
      vz <= Math.ceil((p.z + 8) / 8);
      vz++
    )
      for (
        let vx = Math.floor((p.x - 8) / 8);
        vx <= Math.ceil((p.x + 8) / 8);
        vx++
      ) {
        elev[vz * hm + vx] = STREET_Y;
        solidAt[vz * hm + vx] = 0;
      }
  // Fighters and bombers are held below the highest terrain plus five times
  // their cruise height, which over a flat city is far below the towers. One
  // vertex deep inside the tallest building's solid mass is raised as high as
  // that mass goes, out of sight, so they can climb over every roof. The
  // camera only notices it when its focus sits within a square of it.
  let spike = 0;
  for (let i = 1; i < solidAt.length; i++)
    if (solidAt[i] > solidAt[spike]) spike = i;
  const spikeTop = STREET_Y + solidAt[spike] - SOLID_MARGIN;
  if (spikeTop <= STREET_Y + RAISE_CAP)
    throw new Error(`the ceiling vertex reaches only ${spikeTop.toFixed(0)}`);
  elev[spike] = spikeTop;
  // A building's spire can rise past its solid mass. An aircraft clears a roof
  // when its cruise height is at least a quarter of the roof's rise over the
  // ceiling vertex, so these buildings stay too tall for the lowest cruise.
  const ceilingCruise = Math.max(0, (STREET_Y + tallestRoof - spikeTop) / 4);
  const tooTall = lay.placements.filter(
    (p) =>
      STREET_Y + (roofOf.get(typeName(p)) ?? 0) >
      spikeTop + 4 * STRAFE_CEILING_CRUISE,
  ).length;
  const spikeAt: [number, number] = [
    (spike % hm) * 8,
    Math.floor(spike / hm) * 8,
  ];
  // Every block, plaza, metal spot and the other start must be reachable on
  // the ground from the first start. A square is open where all four of its
  // corners are at street level and no bollard row stands on it. The pits keep
  // units out of the blocks whatever the game does to the buildings.
  const S = MAP / 8;
  const open8 = new Uint8Array(S * S);
  for (let z = 0; z < S; z++)
    for (let x = 0; x < S; x++) {
      const flat = [
        elev[z * hm + x],
        elev[z * hm + x + 1],
        elev[(z + 1) * hm + x],
        elev[(z + 1) * hm + x + 1],
      ].every((h) => Math.abs(h - STREET_Y) < 0.5);
      open8[z * S + x] = flat ? 1 : 0;
    }
  for (const b of lay.bollards) {
    const [hx, hz] = b.alongX
      ? [b.len / 2, BOLLARD_STEP / 2]
      : [BOLLARD_STEP / 2, b.len / 2];
    for (let z = (b.z - hz) / 8; z < (b.z + hz) / 8; z++)
      for (let x = (b.x - hx) / 8; x < (b.x + hx) / 8; x++)
        open8[z * S + x] = 0;
  }
  const startCentres = lay.plazas
    .filter((a) => a.start)
    .map((a) => [(a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2]);
  /** The squares a unit `fp` footprint units wide can have its middle on, flooded from the first start. */
  const reachable = (fp: number) => {
    const n = fp * 2;
    const sat = new Int32Array((S + 1) * (S + 1));
    for (let z = 0; z < S; z++)
      for (let x = 0; x < S; x++)
        sat[(z + 1) * (S + 1) + x + 1] =
          open8[z * S + x] +
          sat[z * (S + 1) + x + 1] +
          sat[(z + 1) * (S + 1) + x] -
          sat[z * (S + 1) + x];
    const fits = (x: number, z: number) => {
      const x0 = x - Math.floor(n / 2);
      const z0 = z - Math.floor(n / 2);
      if (x0 < 0 || z0 < 0 || x0 + n > S || z0 + n > S) return false;
      const sum =
        sat[(z0 + n) * (S + 1) + x0 + n] -
        sat[z0 * (S + 1) + x0 + n] -
        sat[(z0 + n) * (S + 1) + x0] +
        sat[z0 * (S + 1) + x0];
      return sum === n * n;
    };
    const seen = new Uint8Array(S * S);
    const [sx, sz] = startCentres[0].map((v) => Math.floor(v / 8));
    if (!fits(sx, sz)) throw new Error("the first start is not open ground");
    const stack = [sz * S + sx];
    seen[sz * S + sx] = 1;
    while (stack.length > 0) {
      const c = stack.pop() as number;
      const x = c % S;
      const z = Math.floor(c / S);
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx2 = x + dx;
        const nz2 = z + dz;
        if (nx2 < 0 || nz2 < 0 || nx2 >= S || nz2 >= S) continue;
        const k = nz2 * S + nx2;
        if (!seen[k] && fits(nx2, nz2)) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    return seen;
  };
  /** Whether a reached square has its middle within `d` elmos of the rectangle. */
  const touches = (
    seen: Uint8Array,
    a: { x0: number; z0: number; x1: number; z1: number },
    d: number,
  ) => {
    for (
      let z = Math.max(0, Math.floor((a.z0 - d) / 8));
      z < Math.min(S, Math.ceil((a.z1 + d) / 8));
      z++
    )
      for (
        let x = Math.max(0, Math.floor((a.x0 - d) / 8));
        x < Math.min(S, Math.ceil((a.x1 + d) / 8));
        x++
      ) {
        if (!seen[z * S + x]) continue;
        const cx = x * 8 + 4;
        const cz = z * 8 + 4;
        const ox = Math.max(a.x0 - cx, 0, cx - a.x1);
        const oz = Math.max(a.z0 - cz, 0, cz - a.z1);
        if (Math.hypot(ox, oz) <= d) return true;
      }
    return false;
  };
  const interior = lay.blocks.filter((b) => !("ring" in b));
  const reachReport: string[] = [];
  for (const fp of [2, 8, 12]) {
    const seen = reachable(fp);
    // A unit can reach a block if its middle gets within half its width and a square of the bollards round it.
    const d = SIDEWALK + fp * 8 + 8;
    const blocksOut = interior.filter((b) => !touches(seen, b, d)).length;
    const plazasOut = lay.plazas.filter((a) => !touches(seen, a, 0)).length;
    const spotsOut = lay.spots.filter(
      ([x, z]) => !touches(seen, { x0: x, z0: z, x1: x, z1: z }, SPOT_MARK),
    ).length;
    const otherStart = touches(
      seen,
      {
        x0: startCentres[1][0],
        z0: startCentres[1][1],
        x1: startCentres[1][0],
        z1: startCentres[1][1],
      },
      16,
    );
    reachReport.push(
      `footprint ${fp}: blocksOut ${blocksOut}/${interior.length} plazasOut ${plazasOut} spotsOut ${spotsOut} otherStart ${otherStart ? "yes" : "no"}`,
    );
    if (
      fp === 2 &&
      (blocksOut > 0 || plazasOut > 0 || spotsOut > 0 || !otherStart)
    )
      throw new Error(
        `not everything is reachable: ${reachReport[reachReport.length - 1]}`,
      );
  }
  // A 16-bit heightmap: mapconv stretches the image's lowest and highest values
  // onto -minh and -maxh, and 8 bits over this range would round away the pits.
  let hMin = Infinity;
  let hMax = -Infinity;
  for (const h of elev) {
    hMin = Math.min(hMin, h);
    hMax = Math.max(hMax, h);
  }
  const gray = new Uint16Array(hm * hm);
  for (let i = 0; i < hm * hm; i++)
    gray[i] = Math.round(((elev[i] - hMin) / (hMax - hMin)) * 65535);
  writeFileSync(`${SRC}height.png`, png16(gray, hm, hm));
  writeFileSync(`${SRC}height-range.txt`, `${hMin} ${hMax}\n`);
  heightRange = [hMin, hMax];
  // Check the raised ground against the buildings themselves, between the
  // samples as well as on them: no point of the terrain surface, as the engine
  // interpolates it, may stand outside the solid mass of its building.
  const parts = new Map<string, PartRecorder["parts"]>();
  const partsOf = (m: BuildingModel) => {
    let got = parts.get(m.id);
    if (!got) {
      const [w, d] = footprint(m, OPEN_GRID);
      const r = new PartRecorder();
      m.build(r, w, d, TOWN_PALETTES[PLANET]);
      got = r.parts;
      parts.set(m.id, got);
    }
    return got;
  };
  const lotOf = (x: number, z: number) =>
    lay.placements.find((p) => {
      const hw = (p.model.lots[0] * LOT) / 2;
      const hd = (p.model.lots[1] * LOT) / 2;
      return Math.abs(x - p.x) < hw && Math.abs(z - p.z) < hd;
    });
  const terrainAt = (x: number, z: number) => {
    const fx = x / 8;
    const fz = z / 8;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const e = (a: number, b: number) => elev[b * hm + a];
    return (
      (e(ix, iz) * (1 - tx) + e(ix + 1, iz) * tx) * (1 - tz) +
      (e(ix, iz + 1) * (1 - tx) + e(ix + 1, iz + 1) * tx) * tz
    );
  };
  const rand = seeded(7);
  let checked = 0;
  let outside = 0;
  const failures: string[] = [];
  let worst = 0;
  // Random points over the city, then a fine grid over the squares round the ceiling vertex.
  const SPIKE_GRID = 17;
  for (let n = 0; n < 300000 + SPIKE_GRID * SPIKE_GRID; n++) {
    const s = n - 300000;
    const x =
      s < 0
        ? INNER / 2 + rand() * (MAP - INNER)
        : spikeAt[0] - 8 + ((s % SPIKE_GRID) + 0.5) * (16 / SPIKE_GRID);
    const z =
      s < 0
        ? INNER / 2 + rand() * (MAP - INNER)
        : spikeAt[1] -
          8 +
          (Math.floor(s / SPIKE_GRID) + 0.5) * (16 / SPIKE_GRID);
    const h = terrainAt(x, z);
    if (h <= STREET_Y + PAVEMENT * SCALE) continue;
    const p = lotOf(x, z);
    checked++;
    if (!p) {
      outside++;
      continue;
    }
    // Every turn the building may take, as the solid grid allowed for.
    const lx = (x - p.x) / SCALE;
    const lz = (z - p.z) / SCALE;
    const turns: [number, number][] =
      p.model.lots[0] === p.model.lots[1]
        ? [
            [lx, lz],
            [-lx, -lz],
            [lz, -lx],
            [-lz, lx],
          ]
        : [
            [lx, lz],
            [-lx, -lz],
          ];
    const y = (h - STREET_Y) / SCALE;
    if (
      !turns.every(([a, b]) =>
        insideAny(partsOf(p.model), a + 1.1e-6, y, b + 0.9e-6),
      )
    ) {
      outside++;
      const room =
        Math.min(...turns.map(([a, b]) => solidTop(partsOf(p.model), a, b))) *
          SCALE +
        STREET_Y;
      worst = Math.max(worst, h - room);
      if (failures.length < 40)
        failures.push(
          `${p.model.id} local ${(lx * SCALE).toFixed(1)},${(lz * SCALE).toFixed(1)} terrain ${(h - STREET_Y).toFixed(1)} solidTop ${(room - STREET_Y).toFixed(1)} inside ${turns.map(([a, b]) => (insideAny(partsOf(p.model), a + 1.1e-6, y, b + 0.9e-6) ? "y" : "n")).join("")}`,
        );
    }
  }
  heightCheck = { checked, outside, worst, raised: raisedCount };
  writeFileSync(`${ROOT}terrain-failures.txt`, failures.join("\n"));
  // Metal: a pure red disc at each spot, a metal map texel being 16 elmos.
  const mm = MAP / 16;
  const metal = new Uint8Array(mm * mm * 4);
  for (const [sx, sz] of lay.spots)
    for (let z = 0; z < mm; z++)
      for (let x = 0; x < mm; x++)
        if (Math.hypot(x + 0.5 - sx / 16, z + 0.5 - sz / 16) <= 2.5)
          metal[(z * mm + x) * 4] = 255;
  writeFileSync(`${SRC}metal.png`, png(metal, mm, mm));

  const startAreas = lay.plazas.filter((a) => a.start);
  const starts = startAreas.map((a) => [(a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2]);
  // Zero-K reads start boxes rather than mapinfo's start positions: one box
  // per ally team, each the start square itself, named the way Zero-K names
  // the boxes a lobby sends.
  const boxName = (cx: number, cz: number): [string, string] => {
    const u = cx / MAP;
    const v = cz / MAP;
    const ns = v < 0.33 ? ["North", "N"] : v > 0.66 ? ["South", "S"] : ["", ""];
    const we = u < 0.33 ? ["West", "W"] : u > 0.66 ? ["East", "E"] : ["", ""];
    const long = [ns[0], we[0]].filter(Boolean).join("-") || "Center";
    const short = ns[1] + we[1] || "Center";
    return [long, short];
  };
  writeFileSync(
    `${ARCHIVE}mapconfig/map_startboxes.lua`,
    `-- Start boxes for Zero-K, which reads these instead of mapinfo.lua's start positions.
return {
${startAreas
  .map((a, i) => {
    const [cx, cz] = starts[i];
    const [long, short] = boxName(cx, cz);
    return `  [${i}] = {
    boxes = {
      { { ${a.x0}, ${a.z0} }, { ${a.x0}, ${a.z1} }, { ${a.x1}, ${a.z1} }, { ${a.x1}, ${a.z0} } },
    },
    startpoints = { { ${cx}, ${cz} } },
    nameLong = "${long}",
    nameShort = "${short}",
  },`;
  })
  .join("\n")}
}
`,
  );
  writeFileSync(
    `${ARCHIVE}mapinfo.lua`,
    `local mapinfo = {
  name = "Persepolis",
  shortname = "Persepolis",
  description = "A city ringed by towers, built from the conquest town buildings",
  author = "AF",
  version = "${VERSION}",
  mapfile = "maps/${MAPFILE}.smf",
  modtype = 3,
  depend = { "Map Helper v1" },
  maphardness = 100,
  notDeformable = false,
  gravity = 130,
  tidalStrength = 0,
  maxMetal = 2.05,
  extractorRadius = 50,
  voidWater = false,
  autoShowMetal = true,
  atmosphere = {
    skyBox = "persepolis_sky.dds",
    fogColor = { ${fog.join(", ")} },
    skyColor = { ${fog.join(", ")} },
  },
  resources = { detailTex = "persepolis_detail.png" },
  smf = { minheight = ${heightRange[0]}, maxheight = ${heightRange[1]} },
  -- The engine's model lighting, ambient 0.4 and sun 0.7, sums past white on
  -- a pale tower's sunlit face, which BAR's bloom then spreads. Models are
  -- lit less. The ground keeps the engine's 0.5 and 0.5.
  lighting = {
    unitAmbientColor = { 0.3, 0.3, 0.32 },
    unitDiffuseColor = { 0.52, 0.51, 0.49 },
    unitSpecularColor = { 0.35, 0.35, 0.35 },
  },
  teams = {
${starts.map((s, i) => `    [${i}] = { startpos = { x = ${s[0].toFixed(0)}, z = ${s[1].toFixed(0)} } },`).join("\n")}
  },
}
return mapinfo
`,
  );
  writeFileSync(
    `${ROOT}summary.txt`,
    [
      `blocks ${lay.xs.length}x${lay.zs.length}`,
      `features ${lay.placements.length}, of which taller than the ${PLINTH} elmo plinth ${lay.placements.filter((p) => splitTypes.has(typeName(p))).length}`,
      `featureTypes ${types.size}`,
      `textureTexels ${texels}`,
      `plazas ${lay.plazas.length}`,
      `metalSpots ${lay.spots.length}`,
      `heights ${heightRange[0]}..${heightRange[1]} raisedVertices ${heightCheck.raised}`,
      `terrainCheck sampled ${heightCheck.checked} outsideBuilding ${heightCheck.outside} worstElmos ${heightCheck.worst.toFixed(1)}`,
      `starts ${starts.map((s) => s.map((v) => v.toFixed(0)).join(",")).join(" ")}`,
      `mapfile maps/${MAPFILE}.smf`,
      `bollard rows ${lay.bollards.length}, walks ${lay.walks.length}`,
      `buildings from the bake cache ${cacheHits}/${types.size}, street furniture models from it ${furnitureHits}`,
      `floor triangles: most in one type ${Math.max(...floorTris.values())}, across every placed building ${lay.placements.reduce((s, p) => s + (floorTris.get(typeName(p)) ?? 0), 0)}, types with none ${[...floorTris.values()].filter((n) => n === 0).length}`,
      `props ${[...new Set(lay.props.map((p) => p.name))].map((n) => `${n} ${lay.props.filter((p) => p.name === n).length}`).join(", ")}`,
      `tallestRoof ${(STREET_Y + tallestRoof).toFixed(0)} ceilingVertex ${spikeAt.join(",")} at ${spikeTop.toFixed(0)}`,
      `strafe aircraft clear every roof from cruise ${ceilingCruise.toFixed(0)}; buildings too tall for cruise ${STRAFE_CEILING_CRUISE}: ${tooTall}`,
      ...reachReport,
    ].join("\n"),
  );
});

// The layout alone, in seconds: the plazas, walks, spots and bollards and their checks.
test("layout", () => {
  const lay = layout();
  writeFileSync(
    new URL(
      "../../docs/reports/town-models/persepolis-layout.json",
      import.meta.url,
    ).pathname,
    JSON.stringify({
      xs: lay.xs,
      zs: lay.zs,
      plazas: lay.plazas,
      walks: lay.walks,
      spots: lay.spots,
      bollards: lay.bollards,
    }),
  );
});

// The ground texture alone, cropped round a junction and a walk, to check the paving before an export.
test("ground crops", () => {
  const lay = layout();
  const tex = ground(lay);
  const crop = (name: string, x0: number, z0: number, w: number, h: number) => {
    const out = new Uint8Array(w * h * 4);
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        const o = ((z0 + z) * MAP + x0 + x) * 4;
        out.set([tex[o], tex[o + 1], tex[o + 2], 255], (z * w + x) * 4);
      }
    writeFileSync(
      new URL(
        `../../docs/reports/town-models/persepolis-crop-${name}.png`,
        import.meta.url,
      ).pathname,
      png(out, w, h),
    );
  };
  const w = lay.walks[0];
  crop("walk", w.x0 - 320, w.z0 - 320, w.x1 - w.x0 + 640, w.z1 - w.z0 + 640);
  crop(
    "junction",
    lay.xs[3] + BLOCK[0] - 200,
    lay.zs[7] + BLOCK[1] - 200,
    600,
    600,
  );
});

// Each model's cap at the plinth cut against the solid area sampled on a 2 elmo grid, to check the loops and holes.
test("plinth caps", () => {
  const lines: string[] = [];
  const cut = CUT / SCALE;
  const step = 2 / SCALE;
  for (const model of BUILDINGS) {
    const cap = capTriangles(model, cut);
    let area = 0;
    for (let i = 0; i < cap.length; i += 9) {
      const [ax, az, bx, bz, cx, cz] = [
        cap[i],
        cap[i + 2],
        cap[i + 3],
        cap[i + 5],
        cap[i + 6],
        cap[i + 8],
      ];
      area += ((bz - az) * (cx - ax) - (bx - ax) * (cz - az)) / 2;
    }
    const [w, d] = footprint(model, OPEN_GRID);
    const recorder = new PartRecorder();
    model.build(recorder, w, d, TOWN_PALETTES[PLANET], "close");
    const nx = Math.round((model.lots[0] * LOT) / 2);
    const nz = Math.round((model.lots[1] * LOT) / 2);
    const capped = (x: number, z: number) => {
      for (let i = 0; i < cap.length; i += 9) {
        const [ax, az, bx, bz, cx, cz] = [
          cap[i],
          cap[i + 2],
          cap[i + 3],
          cap[i + 5],
          cap[i + 6],
          cap[i + 8],
        ];
        const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
        const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
        const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)))
          return true;
      }
      return false;
    };
    let inside = 0,
      extra = 0,
      missing = 0;
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const x = -(nx * step) / 2 + (i + 0.5) * step + 1.3e-6;
        const z = -(nz * step) / 2 + (j + 0.5) * step + 0.7e-6;
        const solid = insideAny(recorder.parts, x, cut, z);
        const c = capped(x, z);
        if (solid) inside++;
        if (c && !solid) extra++;
        if (solid && !c) missing++;
      }
    lines.push(
      `${model.id}: samples inside ${inside}, capped outside the solid ${extra}, inside but uncapped ${missing}, summed cap area / sampled ${(inside > 0 ? area / (inside * step * step) : 0).toFixed(3)}, ${cap.length / 9} triangles`,
    );
  }
  writeFileSync(
    new URL(
      "../../docs/reports/town-models/persepolis-caps.txt",
      import.meta.url,
    ).pathname,
    lines.join("\n"),
  );
});
