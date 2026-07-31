/**
 * The meshes of a unit imported from somebody else's `.s3o`.
 *
 * They live in a sidecar, `lego/geometry/<projectId>.bin.gz`, rather than in
 * the document, because a document is one JSON file rewritten whole on every
 * autosave and undo keeps sixty copies of it. The largest model measured is
 * 15.0 MB as JSON against 3.1 MiB packed, so raw floats in the document would
 * be a gigabyte of live objects after a session's worth of edits. The document
 * keeps a piece's name, its place in the tree and its transform, plus a key
 * into this, and undo stays as cheap as it already is.
 *
 * The blob is the parts pack's format with a directory in it and 32-bit
 * indices, which is blob version 2. `crates/tauri-plugin-coilbox-lego/src/
 * import.rs` writes it and documents the layout, and this reads it. The vertex
 * record is the same 32 bytes, so a mesh uploads as one interleaved buffer
 * exactly as a part does.
 */

import { gunzipSync } from "fflate";
import * as THREE from "three";

import { legoGeometryUrl } from "../lib/assetUrl";
import type { LegoPiece } from "./model";

const BLOB_MAGIC = "CBLEGO\0\0";
/** Raw imported geometry. The parts pack is version 1 and is a different shape. */
const SUPPORTED_BLOB_VERSION = 2;
/** x, y, z, nx, ny, nz, u, v as float32, the s3o vertex record. */
const FLOATS_PER_VERTEX = 8;
/** Magic, version, mesh count, and four block offsets with their lengths. */
const BLOB_HEADER_SIZE = 40;

/** One mesh's slice of the blob, and the box around it. */
export interface RawMesh {
  id: string;
  vFirst: number;
  vCount: number;
  iFirst: number;
  iCount: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
}

/** One imported unit's meshes, as the viewport and the exporter read them. */
export interface RawGeometry {
  byId: Map<string, RawMesh>;
  /** Every mesh's vertices, back to back. Shared by every geometry. */
  vertices: Float32Array;
  /** Per-mesh runs, addressing the mesh's own vertices. */
  indices: Uint32Array;
}

/**
 * Parse an inflated geometry blob, or throw saying what is wrong with it.
 *
 * Refusing loudly matters more here than anywhere else in the builder. The blob
 * is the only copy of an imported unit's geometry, so a unit drawn with half
 * its meshes missing would look like the import lost them.
 */
export function parseRawGeometry(blob: Uint8Array): RawGeometry {
  if (blob.length < BLOB_HEADER_SIZE) {
    throw new Error("the geometry file is too short to be one");
  }
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const magic = String.fromCharCode(...blob.subarray(0, 8));
  if (magic !== BLOB_MAGIC) {
    throw new Error("the geometry file does not start with the expected magic");
  }
  const version = view.getUint32(8, true);
  if (version !== SUPPORTED_BLOB_VERSION) {
    throw new Error(
      `the geometry file is version ${version}, this build understands ${SUPPORTED_BLOB_VERSION}`,
    );
  }

  const vertexOffset = view.getUint32(16, true);
  const vertexBytes = view.getUint32(20, true);
  const indexOffset = view.getUint32(24, true);
  const indexBytes = view.getUint32(28, true);
  const directoryOffset = view.getUint32(32, true);
  const directoryBytes = view.getUint32(36, true);
  if (directoryOffset + directoryBytes > blob.length) {
    throw new Error("the geometry file is truncated");
  }

  // Copy rather than view: the blob comes out of gunzip at an arbitrary byte
  // offset, and a Float32Array needs 4-byte alignment. Same as the pack.
  const vertices = new Float32Array(
    blob.slice(vertexOffset, vertexOffset + vertexBytes).buffer,
  );
  const indices = new Uint32Array(
    blob.slice(indexOffset, indexOffset + indexBytes).buffer,
  );

  const directory = new TextDecoder().decode(
    blob.subarray(directoryOffset, directoryOffset + directoryBytes),
  );
  let meshes: RawMesh[];
  try {
    meshes = JSON.parse(directory) as RawMesh[];
  } catch {
    throw new Error("the geometry file's index is not readable");
  }

  return {
    byId: new Map(meshes.map((mesh) => [mesh.id, mesh])),
    vertices,
    indices,
  };
}

/** Read one project's geometry sidecar, or throw saying why it could not be. */
export async function loadRawGeometry(projectId: string): Promise<RawGeometry> {
  const response = await fetch(legoGeometryUrl(projectId));
  if (!response.ok) {
    throw new Error(
      `this unit's geometry file is missing (${response.status}). It was written when the model was imported, and it is the only copy of the meshes.`,
    );
  }
  const packed = new Uint8Array(await response.arrayBuffer());
  return parseRawGeometry(gunzipSync(packed));
}

/**
 * Geometry for one mesh, cached the way a part's is, and for the same reason.
 * Every mesh shares one interleaved buffer so the GPU gets a single upload
 * however many pieces are on screen.
 *
 * Three's interleaved attributes cannot carry a base offset past the stride, so
 * the mesh's own offset goes into the indices instead, which is the small array.
 */
const geometryCache = new WeakMap<
  RawGeometry,
  Map<string, THREE.BufferGeometry>
>();
const bufferCache = new WeakMap<RawGeometry, THREE.InterleavedBuffer>();

export function getMeshGeometry(
  raw: RawGeometry,
  meshId: string,
): THREE.BufferGeometry | null {
  const mesh = raw.byId.get(meshId);
  if (!mesh) return null;

  let cache = geometryCache.get(raw);
  if (!cache) {
    cache = new Map();
    geometryCache.set(raw, cache);
  }
  const cached = cache.get(meshId);
  if (cached) return cached;

  let buffer = bufferCache.get(raw);
  if (!buffer) {
    buffer = new THREE.InterleavedBuffer(raw.vertices, FLOATS_PER_VERTEX);
    bufferCache.set(raw, buffer);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.InterleavedBufferAttribute(buffer, 3, 0),
  );
  geometry.setAttribute(
    "normal",
    new THREE.InterleavedBufferAttribute(buffer, 3, 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.InterleavedBufferAttribute(buffer, 2, 6),
  );

  const indices = new Uint32Array(mesh.iCount);
  for (let i = 0; i < mesh.iCount; i++) {
    indices[i] = raw.indices[mesh.iFirst + i] + mesh.vFirst;
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  // From the directory, not computed: computing would run over the whole shared
  // buffer and give every mesh the bounds of the entire model.
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(...mesh.bbox.min),
    new THREE.Vector3(...mesh.bbox.max),
  );
  geometry.boundingSphere = new THREE.Sphere();
  geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);

  cache.set(meshId, geometry);
  return geometry;
}

/** Free every geometry built from an imported unit. Call on teardown. */
export function disposeRawGeometry(raw: RawGeometry): void {
  const cache = geometryCache.get(raw);
  if (!cache) return;
  for (const geometry of cache.values()) geometry.dispose();
  cache.clear();
}

/**
 * The mesh a piece draws, if it has one and the geometry holds it.
 *
 * Null covers three cases the caller treats alike: a piece with no geometry by
 * design, a unit that is not an import, and a mesh key the sidecar does not
 * have. The last is reported separately by `rawGeometryProblems`.
 */
export function pieceMesh(
  raw: RawGeometry | null,
  piece: LegoPiece,
): RawMesh | null {
  if (!raw || !piece.meshId) return null;
  return raw.byId.get(piece.meshId) ?? null;
}

/**
 * Pieces naming a mesh the sidecar does not hold, as sentences meant to be
 * shown.
 *
 * The same call `projectPackProblems` makes for a missing part: keep the piece,
 * report the gap. A piece pasted out of another imported unit is the way to get
 * one, since a mesh key only means anything inside the unit it came from.
 */
export function rawGeometryProblems(
  pieces: LegoPiece[],
  raw: RawGeometry | null,
): string[] {
  const missing = pieces.filter(
    (piece) => piece.meshId !== undefined && !pieceMesh(raw, piece),
  ).length;
  if (missing === 0) return [];
  return [
    missing === 1
      ? "1 piece names geometry this unit does not have, so it shows nothing. Geometry belongs to the unit it was imported into."
      : `${missing} pieces name geometry this unit does not have, so they show nothing. Geometry belongs to the unit it was imported into.`,
  ];
}
