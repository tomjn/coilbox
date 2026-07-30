#!/usr/bin/env bun
/**
 * Convert a unit's s3o into the builder's reference model, for scale.
 *
 * Run once, output committed. The app never parses s3o, so this is the only
 * place that knows the source format. The exact command that produced the
 * committed file is in `src/lego/reference/LICENCE.txt`, which also records who
 * made the model and under what terms.
 *
 * The source model is not checked in, only what this writes. Fetch it from the
 * game it ships with, and record its licence before committing anything derived
 * from it: attribution and share-alike travel with the geometry, not with the
 * code that reads it.
 *
 * What comes out is one flat triangle soup in world space: the piece tree is
 * baked away because a reference object never animates, and UVs and textures
 * are dropped because it is drawn in a single flat colour. Sizes are left
 * exactly as the file states them, in elmos, since the whole point of the
 * object is that it is the real unit's size.
 *
 * Read with a parser written from docs/s3o-format.md, sharing no code with
 * `crates/coilbox-s3o`, on the same reasoning as `scripts/reads3o.mjs`.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(ROOT, "src/lego/reference/armsolar.json");

/** Positions to a millimetre of an elmo, normals to four places. Rounding
 *  keeps the committed file readable without moving any vertex visibly. */
const POSITION_PLACES = 3;
const NORMAL_PLACES = 4;

main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.s3o) fail("--s3o <path to the unit's .s3o> is required");
  if (!args.footprint) {
    fail("--footprint <n> is required, from the unit's own unitdef Lua");
  }
  // Written into the output so the terms travel with the geometry, wherever a
  // copy of it ends up.
  for (const flag of ["source", "author", "licence"]) {
    if (!args[flag]) fail(`--${flag} is required`);
  }

  const buf = readFileSync(args.s3o);
  const model = readS3o(buf);
  const mesh = bake(model.root);

  const out = args.out ?? DEFAULT_OUT;
  const json = {
    source: args.source,
    author: args.author,
    licence: args.licence,
    footprintSteps: Number(args.footprint),
    positions: mesh.positions.map((n) => round(n, POSITION_PLACES)),
    normals: mesh.normals.map((n) => round(n, NORMAL_PLACES)),
    indices: mesh.indices,
  };
  writeFileSync(out, `${JSON.stringify(json, null, 2)}\n`);
  // The output is committed, and `bun run check` formats every JSON in src, so
  // hand it straight to the formatter rather than leaving a failing check
  // behind. Biome packs the number arrays several to a line.
  spawnSync("bunx", ["biome", "format", "--write", out], { stdio: "inherit" });

  const box = bounds(mesh.positions);
  log(
    `${mesh.positions.length / 3} vertices, ${mesh.indices.length / 3} triangles`,
  );
  log(
    `size in elmos: ${(box.max[0] - box.min[0]).toFixed(3)} wide, ` +
      `${box.max[1].toFixed(3)} tall, ${(box.max[2] - box.min[2]).toFixed(3)} deep`,
  );
  log(`footprint: ${args.footprint} x ${args.footprint} steps`);
  log(`header says radius ${model.radius}, height ${model.height}`);
  log(`wrote ${out}`);
}

/**
 * Parse the pieces out of an s3o. Only what a reference object needs: the
 * tree, its offsets, positions, normals and indices.
 */
function readS3o(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = buf.subarray(0, 12).toString("latin1");
  if (magic !== "Spring unit\0")
    fail(`not an s3o: magic ${JSON.stringify(magic)}`);
  if (view.getInt32(12, true) !== 0) fail("unknown s3o version");

  function cstring(at) {
    if (at === 0) return "";
    let end = at;
    while (end < buf.length && buf[end] !== 0) end++;
    return buf.subarray(at, end).toString("latin1");
  }

  function piece(at) {
    const name = cstring(view.getUint32(at, true));
    const childCount = view.getUint32(at + 4, true);
    const childTable = view.getUint32(at + 8, true);
    const vertCount = view.getUint32(at + 12, true);
    const vertAt = view.getUint32(at + 16, true);
    const primitiveType = view.getUint32(at + 24, true);
    const indexCount = view.getUint32(at + 28, true);
    const indexAt = view.getUint32(at + 32, true);
    const offset = [40, 44, 48].map((o) => view.getFloat32(at + o, true));

    // Strips and quads are legal s3o and the engine trianglizes them on load.
    // Nothing here does, so refuse rather than write nonsense.
    if (vertCount > 0 && primitiveType !== 0) {
      fail(
        `piece ${name}: primitive type ${primitiveType}, expected triangles`,
      );
    }

    const vertices = [];
    for (let i = 0; i < vertCount; i++) {
      const v = vertAt + i * 32;
      vertices.push({
        pos: [0, 4, 8].map((o) => view.getFloat32(v + o, true)),
        normal: [12, 16, 20].map((o) => view.getFloat32(v + o, true)),
      });
    }

    const indices = [];
    for (let i = 0; i < indexCount; i++) {
      const index = view.getUint32(indexAt + i * 4, true);
      if (index >= vertCount)
        fail(`piece ${name}: index ${index} addresses nothing`);
      indices.push(index);
    }
    if (indices.length % 3 !== 0) {
      fail(`piece ${name}: ${indices.length} indices is not whole triangles`);
    }

    const children = [];
    for (let i = 0; i < childCount; i++) {
      children.push(piece(view.getUint32(childTable + i * 4, true)));
    }

    return { name, offset, vertices, indices, children };
  }

  return {
    radius: view.getFloat32(16, true),
    height: view.getFloat32(20, true),
    root: piece(view.getUint32(36, true)),
  };
}

/**
 * Flatten the piece tree into one indexed mesh in model space, with each
 * piece's chain of offsets added into its vertex positions.
 */
function bake(root) {
  const positions = [];
  const normals = [];
  const indices = [];

  function walk(piece, parentOrigin) {
    const origin = piece.offset.map(
      (value, axis) => value + parentOrigin[axis],
    );
    const base = positions.length / 3;

    for (const vertex of piece.vertices) {
      positions.push(...vertex.pos.map((value, axis) => value + origin[axis]));
      normals.push(...vertex.normal);
    }
    // Indices are piece-local, so they shift by where this piece's vertices
    // landed in the merged array.
    for (const index of piece.indices) indices.push(base + index);

    for (const child of piece.children) walk(child, origin);
  }

  walk(root, [0, 0, 0]);
  return { positions, normals, indices };
}

function bounds(positions) {
  const min = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  const max = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i + axis]);
      max[axis] = Math.max(max[axis], positions[i + axis]);
    }
  }
  return { min, max };
}

function round(value, places) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith("--")) fail(`unexpected argument ${flag}`);
    args[flag.slice(2)] = argv[++i];
  }
  return args;
}

function log(message) {
  console.log(message);
}

function fail(message) {
  console.error(`reference-model: ${message}`);
  process.exit(2);
}
