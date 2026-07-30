/**
 * Loads the unit builder's parts packs and hands out three.js geometry for
 * individual parts.
 *
 * There is one base pack and any number of extension packs, and the loaded
 * result merges them into a single library. Every pack samples the base pack's
 * atlas, because an s3o names one texture and every piece in the model uses it,
 * so parts from different packs mix freely inside one unit. An extension pack
 * that brings its own atlas is not loaded, and says so.
 *
 * Packs are fetched once and cached for the session. `pack.json` is the
 * searchable index, so filtering never touches the geometry blob, and the
 * picker can render as soon as the manifests arrive.
 *
 * Format: docs/lego-parts-pack.md.
 */

import { gunzipSync } from "fflate";
import * as THREE from "three";

import { legoExtraPackUrl, legoPackUrl } from "../lib/assetUrl";
import { legoPacks } from "./bindings";
import type { LegoProject } from "./model";

const BLOB_MAGIC = "CBLEGO\0\0";
const SUPPORTED_SCHEMA = 1;
const SUPPORTED_BLOB_VERSION = 1;
/** x, y, z, nx, ny, nz, u, v as float32. Deliberately the s3o vertex record. */
const FLOATS_PER_VERTEX = 8;

export interface LegoPartInfo {
  id: string;
  /**
   * Which pack the part came from. Filled in when a pack is loaded rather than
   * written in `pack.json`, since a pack cannot name itself per part.
   */
  packId: string;
  /**
   * Shared by parts that use the same geometry, which is often but not always
   * a colourway family: some parts share a shapeId incidentally, through the
   * mesh rather than through any relationship worth browsing by. Used to look
   * up a part's siblings (`shapeVariants`), not to group the parts browser.
   */
  shapeId: string;
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
  /**
   * The base pack this one adds parts to, by id. Only extension packs have it.
   * An extension pack uses its base pack's atlas rather than bringing one of
   * its own, which is what lets its parts sit in the same unit as the base
   * pack's.
   */
  extends?: string;
  geometry: {
    file: string;
    encoding: string;
    bytes: number;
    vertexStride: number;
  };
  categories: { id: string; label: string }[];
  parts: LegoPartInfo[];
}

/**
 * A manifest as `pack.json` holds it. An extension pack leaves out the atlas
 * and the textures, because it uses its base pack's, so those two are only
 * present once inheritance has been applied.
 */
export type RawPackManifest = Omit<LegoPackManifest, "atlas" | "textures"> &
  Partial<Pick<LegoPackManifest, "atlas" | "textures">>;

/** One pack's manifest and geometry, before packs are merged into a library. */
export interface PackSource {
  manifest: LegoPackManifest;
  vertices: Float32Array;
  indices: Uint16Array;
}

/** Which packs are in play, and anything that stopped one from loading. */
export interface PackLibrary {
  /** Every pack that loaded, base pack first, then extensions by folder name. */
  packs: LegoPackManifest[];
  /** Where extension packs are installed, so the UI can say where to put one. */
  dir: string;
  /**
   * What could not be loaded, as sentences meant to be shown. A pack that
   * cannot join the library is skipped rather than fatal: the base pack still
   * works, and a silent skip would leave a pack author with nothing to go on.
   */
  problems: string[];
}

export interface LoadedPack {
  /**
   * The base pack's manifest, carrying every loaded pack's parts and
   * categories. Singular because every pack shares one atlas, so there is one
   * texture to sample and one to export however many packs are installed.
   */
  manifest: LegoPackManifest;
  parts: LegoPartInfo[];
  byId: Map<string, LegoPartInfo>;
  /** Every part's vertices, back to back. Shared by every geometry. */
  vertices: Float32Array;
  indices: Uint16Array;
  library: PackLibrary;
}

/** Every pack's parts as one library, plus what merging had to leave out. */
export interface MergedPacks extends Omit<LoadedPack, "library"> {
  problems: string[];
}

let pending: Promise<LoadedPack> | null = null;

/** Load every installed pack, or return the library already loaded. */
export function loadPack(): Promise<LoadedPack> {
  pending ??= fetchLibrary().catch((error) => {
    // A failed load must not be cached, or a transient miss would persist for
    // the whole session with no way back.
    pending = null;
    throw error;
  });
  return pending;
}

/**
 * Whether an extension pack can join `base`, and why not when it cannot.
 *
 * The atlas check is the one that matters: an s3o names a single texture, so
 * mixing parts from two atlases in one unit is not something the format can
 * express. Rejecting a pack that brings its own atlas here is what keeps that
 * unreachable, rather than letting it fail at export.
 */
export function extensionProblem(
  base: LegoPackManifest,
  raw: RawPackManifest,
  folder: string,
): string | null {
  if (raw.schemaVersion !== SUPPORTED_SCHEMA) {
    return `"${folder}" uses pack schema ${raw.schemaVersion}, and this build understands ${SUPPORTED_SCHEMA}.`;
  }
  if (!raw.id) {
    return `"${folder}" has no pack id.`;
  }
  if (raw.id === base.id) {
    return `"${folder}" calls itself "${raw.id}", which is the base pack's own id.`;
  }
  if (!raw.extends) {
    return `"${folder}" names no base pack, so it cannot be added to one. An extension pack sets "extends" to the id of the pack whose atlas it uses.`;
  }
  if (raw.extends !== base.id) {
    return `"${folder}" extends "${raw.extends}", and the installed base pack is "${base.id}".`;
  }
  if (raw.textures && raw.textures.tex1 !== base.textures.tex1) {
    return `"${folder}" names its own texture, "${raw.textures.tex1}", rather than the base pack's "${base.textures.tex1}". A unit samples one texture, so a pack with its own atlas cannot be mixed into another.`;
  }
  return null;
}

/**
 * Merge every loaded pack's parts into one library, `sources[0]` being the base.
 *
 * Part ids stay flat and global, and the first pack to claim an id keeps it. A
 * later pack's part with a taken id is skipped and reported. That is the only
 * rule that stops two packs quietly meaning different geometry by the same id,
 * which would swap what a saved unit draws. It also leaves saved documents
 * alone: they store a bare part id, and after a merge that id still resolves to
 * exactly the part it always did.
 *
 * Part ids in the bundled pack are content hashes, so an id two packs share is
 * the same geometry twice and keeping the first is the right answer anyway.
 */
export function mergePacks(sources: PackSource[]): MergedPacks {
  const base = sources[0];
  const problems: string[] = [];
  const parts: LegoPartInfo[] = [];
  const byId = new Map<string, LegoPartInfo>();
  const vertexBlocks: Float32Array[] = [];
  const indexBlocks: Uint16Array[] = [];
  // Where this pack's geometry starts once the blocks are back to back, in
  // vertices and in indices. A part's own offsets are relative to its pack.
  let vertexBase = 0;
  let indexBase = 0;

  for (const source of sources) {
    let taken = 0;
    for (const part of source.manifest.parts) {
      if (byId.has(part.id)) {
        taken++;
        continue;
      }
      const moved: LegoPartInfo = {
        ...part,
        packId: source.manifest.id,
        vFirst: part.vFirst + vertexBase,
        iFirst: part.iFirst + indexBase,
      };
      parts.push(moved);
      byId.set(moved.id, moved);
    }
    if (taken > 0) {
      problems.push(
        `"${source.manifest.id}" reuses ${taken} part ${taken === 1 ? "id" : "ids"} an earlier pack already uses. Those parts were skipped, so a part id always means the same geometry.`,
      );
    }
    vertexBlocks.push(source.vertices);
    indexBlocks.push(source.indices);
    vertexBase += source.vertices.length / FLOATS_PER_VERTEX;
    indexBase += source.indices.length;
  }

  // Categories are the picker's own cut of the parts, so a category id an
  // extension pack shares with the base pack is the same shelf, not a second
  // one. First label wins, in the same order the packs loaded.
  const categories = [...base.manifest.categories];
  const known = new Set(categories.map((category) => category.id));
  for (const source of sources.slice(1)) {
    for (const category of source.manifest.categories) {
      if (known.has(category.id)) continue;
      known.add(category.id);
      categories.push(category);
    }
  }

  return {
    manifest: { ...base.manifest, categories, parts },
    parts,
    byId,
    vertices: concatFloat32(vertexBlocks),
    indices: concatUint16(indexBlocks),
    problems,
  };
}

/**
 * What is wrong between a saved unit and the packs installed, as sentences
 * meant to be shown.
 *
 * Neither case refuses to open the unit. A piece whose part is missing keeps
 * its name, its place in the hierarchy and its transform, all of which is real
 * work, and an unresolved `partId` is already how the viewport draws a piece
 * with no geometry. This is the same call paste makes for a piece from another
 * pack: report it, do not drop it.
 */
export function projectPackProblems(
  project: LegoProject,
  pack: LoadedPack,
): string[] {
  const problems: string[] = [];
  const installed = pack.library.packs.map((manifest) => manifest.id);
  if (project.packId && !installed.includes(project.packId)) {
    problems.push(
      `This unit was built against the "${project.packId}" pack, and that pack is not installed.`,
    );
  }

  const missing = project.pieces.filter(
    (piece) => piece.partId !== null && !pack.byId.has(piece.partId),
  ).length;
  if (missing > 0) {
    problems.push(
      missing === 1
        ? "1 piece names a part no installed pack has, so it shows no geometry."
        : `${missing} pieces name parts no installed pack has, so they show no geometry.`,
    );
  }
  return problems;
}

function concatFloat32(blocks: Float32Array[]): Float32Array {
  if (blocks.length === 1) return blocks[0];
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const block of blocks) {
    out.set(block, at);
    at += block.length;
  }
  return out;
}

function concatUint16(blocks: Uint16Array[]): Uint16Array {
  if (blocks.length === 1) return blocks[0];
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const out = new Uint16Array(total);
  let at = 0;
  for (const block of blocks) {
    out.set(block, at);
    at += block.length;
  }
  return out;
}

/**
 * Read the base pack, then every extension pack installed, and merge them.
 *
 * Only a missing or broken base pack is fatal. An extension pack that will not
 * load is skipped with a reason, because the rest of the library still works
 * and there would otherwise be no way to fix the one at fault.
 */
async function fetchLibrary(): Promise<LoadedPack> {
  const base = await fetchPack((file) => legoPackUrl(file));
  const problems: string[] = [];
  const sources: PackSource[] = [base];

  let dir = "";
  let names: string[] = [];
  try {
    const installed = await legoPacks({});
    dir = installed.dir;
    names = installed.names;
  } catch (error) {
    problems.push(
      `Could not look for extension packs: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const folder of names) {
    try {
      sources.push(
        await fetchExtension(base.manifest, folder, (file) =>
          legoExtraPackUrl(folder, file),
        ),
      );
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  const merged = mergePacks(sources);
  return {
    manifest: merged.manifest,
    parts: merged.parts,
    byId: merged.byId,
    vertices: merged.vertices,
    indices: merged.indices,
    library: {
      packs: sources.map((source) => source.manifest),
      dir,
      problems: [...problems, ...merged.problems],
    },
  };
}

/** An extension pack, with the base pack's atlas filled in. */
async function fetchExtension(
  base: LegoPackManifest,
  folder: string,
  url: (file: string) => string,
): Promise<PackSource> {
  const raw = await fetchJson<RawPackManifest>(url("pack.json"));
  const problem = extensionProblem(base, raw, folder);
  if (problem) throw new Error(problem);
  return fetchPack(url, { ...raw, atlas: base.atlas, textures: base.textures });
}

async function fetchPack(
  url: (file: string) => string,
  known?: LegoPackManifest,
): Promise<PackSource> {
  const manifest =
    known ?? (await fetchJson<LegoPackManifest>(url("pack.json")));
  if (manifest.schemaVersion !== SUPPORTED_SCHEMA) {
    throw new Error(
      `parts pack uses schema ${manifest.schemaVersion}, this build understands ${SUPPORTED_SCHEMA}`,
    );
  }

  const response = await fetch(url(manifest.geometry.file));
  if (!response.ok) {
    throw new Error(
      `could not read ${manifest.geometry.file}: ${response.status}`,
    );
  }
  const raw = new Uint8Array(await response.arrayBuffer());
  const blob = manifest.geometry.encoding === "gzip" ? gunzipSync(raw) : raw;

  // The manifest holds every part's offset into the blob, so a manifest paired
  // with the wrong blob indexes the wrong bytes and draws nonsense rather than
  // failing. That happens whenever a pack is replaced under a running app.
  if (blob.length !== manifest.geometry.bytes) {
    throw new Error(
      `parts pack "${manifest.id}" is inconsistent: the manifest describes ${manifest.geometry.bytes} bytes of geometry but ${manifest.geometry.file} holds ${blob.length}. Reload, and rebuild the pack if it persists.`,
    );
  }

  return { ...readBlob(blob), manifest };
}

function readBlob(blob: Uint8Array) {
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

  return { vertices, indices };
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

/** A part's three dimensions, longest first, which is how its name reads. */
export function partDimensions(part: LegoPartInfo): number[] {
  return part.bbox.max
    .map((max, i) => max - part.bbox.min[i])
    .sort((a, b) => b - a);
}

/** Every colourway a shape is available in, in the order the pack lists them. */
export function shapeVariants(
  pack: LoadedPack,
  shapeId: string,
): LegoPartInfo[] {
  return pack.parts.filter((part) => part.shapeId === shapeId);
}

/** Free every geometry built from a pack. Call when tearing down the last view. */
export function disposePackGeometry(pack: LoadedPack): void {
  const cache = geometryCache.get(pack);
  if (!cache) return;
  for (const geometry of cache.values()) geometry.dispose();
  cache.clear();
}
