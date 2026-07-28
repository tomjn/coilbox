/**
 * Loads the unit builder's parts pack and hands out three.js geometry for
 * individual parts.
 *
 * The pack is fetched once and cached for the session. `pack.json` is the
 * searchable index, so filtering never touches the geometry blob, and the
 * picker can render as soon as the manifest arrives.
 *
 * Format: docs/lego-parts-pack.md.
 */

import { gunzipSync } from "fflate";
import * as THREE from "three";

import { legoPackUrl } from "../lib/assetUrl";

const BLOB_MAGIC = "CBLEGO\0\0";
const SUPPORTED_SCHEMA = 1;
const SUPPORTED_BLOB_VERSION = 1;
/** x, y, z, nx, ny, nz, u, v as float32. Deliberately the s3o vertex record. */
const FLOATS_PER_VERTEX = 8;

export interface LegoPartInfo {
  id: string;
  name: string;
  category: string;
  colourway: string;
  shape: string;
  material: string;
  tags: string[];
  vFirst: number;
  vCount: number;
  iFirst: number;
  iCount: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  uvBox: { min: [number, number]; max: [number, number] };
  pivot: [number, number, number];
  sourceNames: string[];
  aliasCount: number;
  /** Faces the original model never unwrapped, absent when there are none. */
  uvIncomplete?: number;
}

export interface LegoPackManifest {
  schemaVersion: number;
  id: string;
  version: string;
  licence: string;
  atlas: { width: number; height: number };
  textures: { tex1: string; tex2?: string };
  geometry: {
    file: string;
    encoding: string;
    bytes: number;
    vertexStride: number;
  };
  categories: { id: string; label: string }[];
  parts: LegoPartInfo[];
}

export interface LoadedPack {
  manifest: LegoPackManifest;
  parts: LegoPartInfo[];
  byId: Map<string, LegoPartInfo>;
  /** Every part's vertices, back to back. Shared by every geometry. */
  vertices: Float32Array;
  indices: Uint16Array;
}

let pending: Promise<LoadedPack> | null = null;

/** Load the pack, or return the one already loaded. */
export function loadPack(): Promise<LoadedPack> {
  pending ??= fetchPack().catch((error) => {
    // A failed load must not be cached, or a transient miss would persist for
    // the whole session with no way back.
    pending = null;
    throw error;
  });
  return pending;
}

async function fetchPack(): Promise<LoadedPack> {
  const manifest = await fetchJson<LegoPackManifest>(legoPackUrl("pack.json"));
  if (manifest.schemaVersion !== SUPPORTED_SCHEMA) {
    throw new Error(
      `parts pack uses schema ${manifest.schemaVersion}, this build understands ${SUPPORTED_SCHEMA}`,
    );
  }

  const response = await fetch(legoPackUrl(manifest.geometry.file));
  if (!response.ok) {
    throw new Error(
      `could not read ${manifest.geometry.file}: ${response.status}`,
    );
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  const blob = manifest.geometry.encoding === "gzip" ? gunzipSync(raw) : raw;

  return { ...readBlob(blob, manifest), manifest };
}

function readBlob(blob: Uint8Array, manifest: LegoPackManifest) {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const magic = String.fromCharCode(...blob.subarray(0, 8));
  if (magic !== BLOB_MAGIC) {
    throw new Error("parts blob does not start with the expected magic");
  }
  const version = view.getUint32(8, true);
  if (version !== SUPPORTED_BLOB_VERSION) {
    throw new Error(
      `parts blob is version ${version}, this build understands ${SUPPORTED_BLOB_VERSION}`,
    );
  }

  // Copy rather than view: the blob comes out of gunzip at an arbitrary byte
  // offset, and a Float32Array needs 4-byte alignment.
  const vertexOffset = view.getUint32(16, true);
  const vertexBytes = view.getUint32(20, true);
  const indexOffset = view.getUint32(24, true);
  const indexBytes = view.getUint32(28, true);

  const vertices = new Float32Array(
    blob.slice(vertexOffset, vertexOffset + vertexBytes).buffer,
  );
  const indices = new Uint16Array(
    blob.slice(indexOffset, indexOffset + indexBytes).buffer,
  );

  const byId = new Map(manifest.parts.map((part) => [part.id, part]));
  return { parts: manifest.parts, byId, vertices, indices };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`could not read the parts pack: ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Geometry for one part, cached so repeating a part across a unit, or scrolling
 * it back into the picker, costs nothing.
 *
 * Every part shares one interleaved buffer holding the whole vertex block, so
 * the GPU gets a single upload however many parts are on screen. Three's
 * interleaved attributes cannot carry a base offset past the stride, so the
 * part's own offset goes into the indices instead, which is the small array.
 *
 * The bounding volumes come from the manifest. Computing them would run over
 * the entire shared buffer and give every part the bounds of the whole pack,
 * breaking culling and raycasting.
 */
const geometryCache = new WeakMap<
  LoadedPack,
  Map<string, THREE.BufferGeometry>
>();
const bufferCache = new WeakMap<LoadedPack, THREE.InterleavedBuffer>();

export function getPartGeometry(
  pack: LoadedPack,
  partId: string,
): THREE.BufferGeometry | null {
  const part = pack.byId.get(partId);
  if (!part) return null;

  let cache = geometryCache.get(pack);
  if (!cache) {
    cache = new Map();
    geometryCache.set(pack, cache);
  }
  const cached = cache.get(partId);
  if (cached) return cached;

  let buffer = bufferCache.get(pack);
  if (!buffer) {
    buffer = new THREE.InterleavedBuffer(pack.vertices, FLOATS_PER_VERTEX);
    bufferCache.set(pack, buffer);
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

  const indices = new Uint32Array(part.iCount);
  for (let i = 0; i < part.iCount; i++) {
    indices[i] = pack.indices[part.iFirst + i] + part.vFirst;
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(...part.bbox.min),
    new THREE.Vector3(...part.bbox.max),
  );
  geometry.boundingSphere = new THREE.Sphere();
  geometry.boundingBox.getBoundingSphere(geometry.boundingSphere);

  cache.set(partId, geometry);
  return geometry;
}

/** Longest side of a part's bounding box, for framing it in a viewport. */
export function partSize(part: LegoPartInfo): number {
  return Math.max(...part.bbox.max.map((max, i) => max - part.bbox.min[i]));
}

/** Free every geometry built from a pack. Call when tearing down the last view. */
export function disposePackGeometry(pack: LoadedPack): void {
  const cache = geometryCache.get(pack);
  if (!cache) return;
  for (const geometry of cache.values()) geometry.dispose();
  cache.clear();
}
