/**
 * Emits the parts pack: a manifest, a geometry blob and the atlas.
 *
 * The blob has no directory of its own. `pack.json` carries the index, so
 * search and filtering never touch the geometry, and the app can show a full
 * picker before the blob has finished arriving.
 *
 * It ships gzipped because that is what both the repository and the installer
 * pay for it. The frontend inflates it once with fflate, already a dependency.
 *
 * The vertex record is deliberately the same 32 bytes as the s3o vertex record,
 * so exporting a part is a transform and a copy rather than a conversion.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

export const PACK_SCHEMA_VERSION = 1;
export const BLOB_MAGIC = "CBLEGO\0\0";
export const BLOB_VERSION = 1;
export const VERTEX_STRIDE = 32;

const BLOB_HEADER_SIZE = 32;

/**
 * @param {object} options
 * @param {string} options.outDir
 * @param {string} options.packId
 * @param {string} options.version
 * @param {object} options.source provenance: file names and hashes
 * @param {string} options.licence
 * @param {Array<{ mesh: import("./mesh.mjs").PartMesh, meta: object }>} options.parts
 * @param {{ width: number, height: number }} options.atlas
 * @param {Array<{ id: string, label: string }>} options.categories
 */
export function writePack({
  outDir,
  packId,
  version,
  source,
  licence,
  parts,
  atlas,
  categories,
}) {
  mkdirSync(outDir, { recursive: true });

  const vertexChunks = [];
  const indexChunks = [];
  let vertexCursor = 0;
  let indexCursor = 0;
  const index = [];

  for (const { mesh, meta } of parts) {
    const indexBytes = mesh.indices.byteLength;
    // Keep every run 4-byte aligned so a Uint16Array view never straddles.
    const padding = (4 - (indexBytes % 4)) % 4;

    vertexChunks.push(
      Buffer.from(
        mesh.vertices.buffer,
        mesh.vertices.byteOffset,
        mesh.vertices.byteLength,
      ),
    );
    indexChunks.push(
      Buffer.from(mesh.indices.buffer, mesh.indices.byteOffset, indexBytes),
    );
    if (padding) indexChunks.push(Buffer.alloc(padding));

    index.push({
      ...meta,
      shapeId: mesh.shapeId,
      vFirst: vertexCursor / VERTEX_STRIDE,
      vCount: mesh.vertices.length / 8,
      iFirst: indexCursor / 2,
      iCount: mesh.indices.length,
      bbox: { min: trim(mesh.bbox.min), max: trim(mesh.bbox.max) },
      uvBox: { min: trim(mesh.uvBox.min), max: trim(mesh.uvBox.max) },
      pivot: meta.pivot ?? [0, 0, 0],
      uvIncomplete:
        mesh.stats.cornersWithoutUv > 0
          ? mesh.stats.cornersWithoutUv
          : undefined,
    });

    vertexCursor += mesh.vertices.byteLength;
    indexCursor += indexBytes + padding;
  }

  const header = Buffer.alloc(BLOB_HEADER_SIZE);
  header.write(BLOB_MAGIC, 0, "latin1");
  header.writeUInt32LE(BLOB_VERSION, 8);
  header.writeUInt32LE(parts.length, 12);
  header.writeUInt32LE(BLOB_HEADER_SIZE, 16);
  header.writeUInt32LE(vertexCursor, 20);
  header.writeUInt32LE(BLOB_HEADER_SIZE + vertexCursor, 24);
  header.writeUInt32LE(indexCursor, 28);

  const blob = Buffer.concat([header, ...vertexChunks, ...indexChunks]);
  const gzipped = gzipSync(blob, { level: 9 });

  writeFileSync(join(outDir, "parts.bin.gz"), gzipped);

  const manifest = {
    schemaVersion: PACK_SCHEMA_VERSION,
    id: packId,
    version,
    source,
    licence,
    atlas,
    textures: { tex1: "atlas.png" },
    geometry: {
      file: "parts.bin.gz",
      encoding: "gzip",
      bytes: blob.length,
      sha256: createHash("sha256").update(blob).digest("hex"),
      vertexStride: VERTEX_STRIDE,
    },
    categories,
    parts: index,
  };
  // Pretty printed on purpose. It is the file a curation change shows up in, so
  // it should produce a readable diff rather than one enormous line.
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(join(outDir, "pack.json"), json);

  return {
    parts: parts.length,
    blobBytes: blob.length,
    gzippedBytes: gzipped.length,
    manifestBytes: Buffer.byteLength(json),
  };
}

/** Four decimals is well under float32 precision and keeps the manifest small. */
function trim(values) {
  return values.map((v) => Math.round(v * 10000) / 10000);
}
