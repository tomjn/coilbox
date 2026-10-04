#!/usr/bin/env bun
/**
 * Draws the three images of the sample hand-made map in
 * `docs/examples/handmade-map/`: the map picture, the province image and the
 * heightmap. It also writes `cairn.gltf`, the one model the sample places.
 * The art is made here, from the numbers below, so it belongs to this repo
 * and a change to it shows up as a change to this file.
 *
 * The map is two land masses with sea between them. Each land mass is split
 * into provinces by nearest seed point. `map.json` in the same folder is
 * written by hand and lists the same colours, so change both together.
 *
 * Run with `bun scripts/build-sample-handmade-map.mjs`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs/examples/handmade-map");

const WIDTH = 160;
const HEIGHT = 96;

/** Each land mass: an ellipse with a wavy coast, and its province seeds. */
const LANDS = [
  {
    cx: 42,
    cy: 48,
    rx: 30,
    ry: 38,
    wave: 1,
    provinces: [
      { color: [0xc8, 0x50, 0x50], x: 40, y: 22 }, // Northmarch
      { color: [0xd9, 0xa4, 0x41], x: 22, y: 48 }, // Westhaven
      { color: [0x7a, 0xb8, 0x5a], x: 46, y: 48 }, // Midvale
      { color: [0x4f, 0x9d, 0xa6], x: 64, y: 46 }, // Eastcliff
      { color: [0x8a, 0x6f, 0xc2], x: 42, y: 74 }, // Southreach
    ],
  },
  {
    cx: 122,
    cy: 46,
    rx: 28,
    ry: 36,
    wave: 2.3,
    provinces: [
      { color: [0xb5, 0x5f, 0x9a], x: 104, y: 44 }, // Ironcoast
      { color: [0x5c, 0x7f, 0xd0], x: 124, y: 24 }, // Highmoor
      { color: [0xc9, 0x7b, 0x3c], x: 126, y: 66 }, // Redfield
      { color: [0x3f, 0xa3, 0x74], x: 140, y: 44 }, // Farwatch
    ],
  },
];

/** The ridge that the blocked border between Northmarch and Midvale follows. */
const RIDGE = { from: LANDS[0].provinces[0], to: LANDS[0].provinces[2] };

/** Which land mass a pixel is on, or null for sea. */
function landAt(x, y) {
  for (const land of LANDS) {
    const dx = (x + 0.5 - land.cx) / land.rx;
    const dy = (y + 0.5 - land.cy) / land.ry;
    const angle = Math.atan2(dy, dx);
    const coast =
      1 +
      0.1 * Math.sin(3 * angle + land.wave) +
      0.05 * Math.sin(7 * angle + 2 * land.wave);
    if (Math.hypot(dx, dy) <= coast) return land;
  }
  return null;
}

/** The province of a land pixel: the nearest seed on its land mass. */
function provinceAt(land, x, y) {
  let best = land.provinces[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const p of land.provinces) {
    const distance = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = p;
    }
  }
  return best;
}

/** Height from 0 to 1: rolling hills, with a ridge between two provinces. */
function heightAt(land, x, y) {
  const dx = (x + 0.5 - land.cx) / land.rx;
  const dy = (y + 0.5 - land.cy) / land.ry;
  const inland = Math.max(0, 1 - Math.hypot(dx, dy));
  const hills = 0.5 + 0.5 * Math.sin(x / 6 + land.wave) * Math.cos(y / 7);
  let height = 0.15 + 0.45 * inland + 0.15 * hills * inland;
  if (land === LANDS[0]) {
    // How much nearer one ridge seed is than the other. 0 on the border.
    const a = Math.hypot(x - RIDGE.from.x, y - RIDGE.from.y);
    const b = Math.hypot(x - RIDGE.to.x, y - RIDGE.to.y);
    const p = provinceAt(land, x, y);
    if (p === RIDGE.from || p === RIDGE.to) {
      height += 0.4 * Math.max(0, 1 - Math.abs(a - b) / 5);
    }
  }
  return Math.min(1, height);
}

const provinces = new Uint8Array(WIDTH * HEIGHT * 4);
const picture = new Uint8Array(WIDTH * HEIGHT * 3);
const heightmap = new Uint8Array(WIDTH * HEIGHT);

const mix = (a, b, t) => Math.round(a + (b - a) * t);

for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const i = y * WIDTH + x;
    const land = landAt(x, y);
    if (!land) {
      // Sea: transparent on the province image, flat blue on the picture.
      picture.set([0x2b, 0x4f, 0x73], i * 3);
      continue;
    }
    const [r, g, b] = provinceAt(land, x, y).color;
    provinces.set([r, g, b, 255], i * 4);
    // Eight height steps keep the picture small and the relief readable.
    const height = Math.round(heightAt(land, x, y) * 7) / 7;
    heightmap[i] = Math.round(height * 255);
    picture.set(
      [
        mix(0x6f, 0xd8, height),
        mix(0x8f, 0xd2, height),
        mix(0x4e, 0xc0, height),
      ],
      i * 3,
    );
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, "latin1");
  Buffer.from(body).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** An 8-bit PNG. `channels` is 1 for grey, 3 for RGB and 4 for RGBA. */
function png(pixels, channels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = { 1: 0, 3: 2, 4: 6 }[channels];
  const row = WIDTH * channels;
  // Each row starts with a filter byte. 0 is no filter.
  const raw = Buffer.alloc((row + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    Buffer.from(pixels.buffer, y * row, row).copy(raw, y * (row + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, pixels, channels] of [
  ["provinces.png", provinces, 4],
  ["picture.png", picture, 3],
  ["heightmap.png", heightmap, 1],
]) {
  const bytes = png(pixels, channels);
  writeFileSync(join(OUT, name), bytes);
  console.log(`${name}: ${bytes.length} bytes`);
}

/**
 * The sample's placed model: a stone cairn, which is a four sided pyramid 40
 * map units across and 60 tall with its origin under the middle of its base.
 * glTF has y up. The buffer is inside the file, so the model is one file.
 */
function cairnGltf() {
  const positions = [
    [-20, 0, -20],
    [20, 0, -20],
    [20, 0, 20],
    [-20, 0, 20],
    [0, 60, 0],
  ];
  // Four sides, then the base as two triangles. Each is anticlockwise seen
  // from outside.
  const indices = [3, 2, 4, 2, 1, 4, 1, 0, 4, 0, 3, 4, 0, 1, 2, 0, 2, 3];
  const indexBytes = indices.length * 2;
  const buffer = Buffer.alloc(indexBytes + positions.length * 12);
  indices.forEach((index, i) => {
    buffer.writeUInt16LE(index, i * 2);
  });
  positions.flat().forEach((value, i) => {
    buffer.writeFloatLE(value, indexBytes + i * 4);
  });
  const gltf = {
    asset: { version: "2.0", generator: "coilbox sample map script" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "cairn", mesh: 0 }],
    meshes: [
      {
        primitives: [{ attributes: { POSITION: 1 }, indices: 0, material: 0 }],
      },
    ],
    materials: [
      {
        name: "stone",
        pbrMetallicRoughness: {
          baseColorFactor: [0.62, 0.6, 0.56, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5123,
        count: indices.length,
        type: "SCALAR",
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: positions.length,
        type: "VEC3",
        min: [-20, 0, -20],
        max: [20, 60, 20],
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: indexBytes, target: 34963 },
      {
        buffer: 0,
        byteOffset: indexBytes,
        byteLength: positions.length * 12,
        target: 34962,
      },
    ],
    buffers: [
      {
        byteLength: buffer.length,
        uri: `data:application/octet-stream;base64,${buffer.toString("base64")}`,
      },
    ],
  };
  return Buffer.from(`${JSON.stringify(gltf, null, 2)}\n`);
}

const cairn = cairnGltf();
writeFileSync(join(OUT, "cairn.gltf"), cairn);
console.log(`cairn.gltf: ${cairn.length} bytes`);
