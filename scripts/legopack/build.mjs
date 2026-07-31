#!/usr/bin/env bun
/**
 * Builds the lego parts pack from KaiserJ's original v2 lego parts library.
 *
 * Run once, output committed. The app never parses OBJ, so this is the only
 * place that knows the source format:
 *
 *   bun run lego:pack --obj <legosv2.obj> --atlas <lego2skin.png>
 *
 * Add `--verify <partId|sourceName>` to dump one part as OBJ and stop. Look at
 * it in Blender before trusting a full run: a UV or winding mistake in the
 * conversion would otherwise be baked into every part in the pack.
 *
 * Sources are not checked in. They come from KaiserJ's v2 lego release,
 * reused under the terms recorded in the pack's LICENCE.txt.
 */

import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COLOURWAYS, categorise } from "./categorise.mjs";
import { buildMesh } from "./mesh.mjs";
import { readObj } from "./obj.mjs";
import { writePack } from "./writePack.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_OUT = join(ROOT, "src-tauri/legoparts");
const OVERRIDES = join(
  dirname(fileURLToPath(import.meta.url)),
  "overrides.json",
);

const LICENCE = [
  "Geometry and texture from KaiserJ's original v2 lego parts library.",
  "Release thread: https://springrts.com/phpbb/viewtopic.php?t=22283",
  "",
  'KaiserJ released the parts in that thread with "do whatever the heck you\'d like with these".',
  "",
  "The pack format is documented in docs/lego-parts-pack.md. Any pack following it can replace this one.",
].join("\n");

main();

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.obj) {
    fail("--obj <path to legosv2.obj> is required");
  }

  const objBytes = readFileSync(args.obj);
  log(`reading ${basename(args.obj)} (${mb(objBytes.length)})`);
  const source = readObj(objBytes.toString("utf8"));
  log(
    `  ${source.objects.length} objects, ${source.positions.length} positions, ${source.uvs.length} uvs, ${source.normals.length} normals`,
  );

  const { parts, stats } = buildParts(source, args.verify);

  if (args.verify) {
    const match = parts.find(
      ({ mesh, sourceNames }) =>
        mesh.id === args.verify || sourceNames.includes(args.verify),
    );
    if (!match) fail(`no part matched --verify ${args.verify}`);
    const out = join(process.cwd(), `${match.mesh.id}.obj`);
    writeFileSync(out, toObj(match.mesh, match.sourceNames[0]));
    log(`wrote ${out} (${match.mesh.stats.triangles} triangles)`);
    return;
  }

  if (!args.atlas) {
    fail("--atlas <path to the atlas .png> is required");
  }
  const atlasBytes = readFileSync(args.atlas);
  const atlas = readPngSize(atlasBytes);
  log(
    `reading ${basename(args.atlas)} (${mb(atlasBytes.length)}, ${atlas.width}x${atlas.height})`,
  );

  const overrides = readOverrides();
  const meta = categorise(parts, overrides);
  const audit = auditParts(parts);

  const outDir = args.out ?? DEFAULT_OUT;
  const written = writePack({
    outDir,
    packId: "splinterfaction-legosv2",
    version: args.version ?? "1",
    source: {
      obj: basename(args.obj),
      objSha256: sha256(objBytes),
      atlas: basename(args.atlas),
      atlasSha256: sha256(atlasBytes),
    },
    licence: LICENCE,
    parts: parts.map(({ mesh }, i) => ({ mesh, meta: meta[i] })),
    atlas,
    categories: COLOURWAYS,
  });
  // The atlas already is a PNG, so it goes across untouched.
  copyFileSync(args.atlas, join(outDir, "atlas.png"));
  writeFileSync(join(outDir, "LICENCE.txt"), `${LICENCE}\n`);

  report(stats, written, meta, audit, atlasBytes.length);
}

function buildParts(source, quiet) {
  const byId = new Map();
  const stats = {
    objects: source.objects.length,
    empty: 0,
    failed: 0,
    duplicates: 0,
    triangles: 0,
    fanFallbacks: 0,
    flipped: 0,
    degenerate: 0,
    cornersWithoutUv: 0,
  };

  for (const object of source.objects) {
    let mesh;
    try {
      mesh = buildMesh(object, source);
    } catch (error) {
      stats.failed++;
      if (!quiet) log(`  ! ${object.name}: ${error.message}`);
      continue;
    }
    if (!mesh) {
      stats.empty++;
      continue;
    }

    const existing = byId.get(mesh.id);
    if (existing) {
      existing.sourceNames.push(object.name);
      stats.duplicates++;
      continue;
    }

    byId.set(mesh.id, { mesh, sourceNames: [object.name] });
    stats.triangles += mesh.stats.triangles;
    stats.fanFallbacks += mesh.stats.fanFallbacks;
    stats.flipped += mesh.stats.flipped;
    stats.degenerate += mesh.stats.degenerate;
    stats.cornersWithoutUv += mesh.stats.cornersWithoutUv;
  }

  return { parts: [...byId.values()], stats };
}

/**
 * Checks the pack against the invariant every shipped s3o model holds to: a
 * triangle's winding agrees with its own vertex normals. Runs on the finished
 * data rather than on the way there, so it catches a mistake anywhere in the
 * conversion.
 */
function auditParts(parts) {
  let triangles = 0;
  const badParts = [];

  for (const { mesh, sourceNames } of parts) {
    let bad = 0;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      triangles++;
      const at = [0, 1, 2].map((k) => mesh.indices[t + k] * 8);
      const edge = (a, b) =>
        [0, 1, 2].map((c) => mesh.vertices[a + c] - mesh.vertices[b + c]);
      const [ux, uy, uz] = edge(at[1], at[0]);
      const [wx, wy, wz] = edge(at[2], at[0]);
      const face = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
      const mean = [0, 1, 2].map(
        (c) =>
          (mesh.vertices[at[0] + 3 + c] +
            mesh.vertices[at[1] + 3 + c] +
            mesh.vertices[at[2] + 3 + c]) /
          3,
      );
      if (face[0] * mean[0] + face[1] * mean[1] + face[2] * mean[2] <= 0) bad++;
    }
    if (bad) badParts.push({ id: mesh.id, name: sourceNames[0], bad });
  }

  return {
    triangles,
    disagreeing: badParts.reduce((sum, part) => sum + part.bad, 0),
    parts: badParts.length,
    worst: badParts.sort((a, b) => b.bad - a.bad)[0],
  };
}

/**
 * Nothing is silently dropped, so anything that did not make it into the pack
 * is named here rather than left for someone to notice later.
 */
function report(stats, written, meta, audit, atlasBytes) {
  log("");
  log(`objects read            ${stats.objects}`);
  log(`  no geometry           ${stats.empty}`);
  log(`  failed to convert     ${stats.failed}`);
  log(
    `  duplicate geometry    ${stats.duplicates}  (collapsed by content hash)`,
  );
  log(`parts written           ${written.parts}`);
  log(`triangles               ${stats.triangles}`);
  log("");
  log(
    `fan fallbacks           ${stats.fanFallbacks}  (faces ear clipping could not split)`,
  );
  log(
    `triangles turned round  ${stats.flipped}  (wound against their own normals in the source)`,
  );
  log(
    `degenerate dropped      ${stats.degenerate}  (zero area, draws nothing)`,
  );
  log(`corners with no uv      ${stats.cornersWithoutUv}`);

  const share = ((100 * audit.disagreeing) / audit.triangles).toFixed(3);
  log(
    `winding audit           ${audit.disagreeing} of ${audit.triangles} triangles (${share}%) disagree with their own normals, across ${audit.parts} parts`,
  );
  if (audit.worst) {
    log(
      `  worst offender        ${audit.worst.name} (${audit.worst.id}), ${audit.worst.bad} triangles`,
    );
  }
  log("");
  log(
    `parts.bin               ${mb(written.blobBytes)} raw, ${mb(written.gzippedBytes)} gzipped`,
  );
  log(`atlas.png               ${mb(atlasBytes)}`);
  log(`pack.json               ${mb(written.manifestBytes)}`);
  log("");

  for (const field of ["colourway", "shape"]) {
    const counts = new Map();
    for (const part of meta)
      counts.set(part[field], (counts.get(part[field]) ?? 0) + 1);
    log(
      `${field.padEnd(10)} ${[...counts].map(([key, n]) => `${key} ${n}`).join(", ")}`,
    );
  }
}

function readPngSize(bytes) {
  const magic = [0x89, 0x50, 0x4e, 0x47];
  if (magic.some((b, i) => bytes[i] !== b)) {
    fail("the atlas must be a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function readOverrides() {
  try {
    return JSON.parse(readFileSync(OVERRIDES, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

/** For eyeballing one part in an external tool before trusting the bulk run. */
function toObj(mesh, sourceName) {
  const lines = [
    `# ${sourceName} (${mesh.id}), exported by scripts/legopack`,
    "o part",
  ];
  const count = mesh.vertices.length / 8;
  for (let i = 0; i < count; i++) {
    const at = i * 8;
    lines.push(
      `v ${mesh.vertices[at]} ${mesh.vertices[at + 1]} ${mesh.vertices[at + 2]}`,
    );
  }
  for (let i = 0; i < count; i++) {
    const at = i * 8;
    lines.push(
      `vn ${mesh.vertices[at + 3]} ${mesh.vertices[at + 4]} ${mesh.vertices[at + 5]}`,
    );
  }
  for (let i = 0; i < count; i++) {
    const at = i * 8;
    lines.push(`vt ${mesh.vertices[at + 6]} ${mesh.vertices[at + 7]}`);
  }
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const face = [0, 1, 2].map((k) => {
      const v = mesh.indices[i + k] + 1;
      return `${v}/${v}/${v}`;
    });
    lines.push(`f ${face.join(" ")}`);
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--")) fail(`unexpected argument ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stderr.write(`lego:pack: ${message}\n`);
  process.exit(1);
}
