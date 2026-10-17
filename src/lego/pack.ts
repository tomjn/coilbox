/**
 * Loads the unit builder's parts packs and hands out three.js geometry for
 * individual parts.
 *
 * There is one base pack and any number of extension packs, and the loaded
 * result merges them into a single library. Every parts pack samples the base
 * pack's atlas, because an s3o names one texture and every piece in the model
 * uses it, so parts from different packs mix freely inside one unit. A parts
 * pack that brings its own atlas is not loaded, and says so.
 *
 * An atlas pack is the other axis: it brings a texture and no parts, redrawing
 * the same sheet the base pack's UVs already point into. That is what makes
 * several atlases possible without ever letting one unit need two of them: the
 * parts library stays one library, and a unit picks which of the installed
 * atlases it samples.
 *
 * Packs are fetched once and cached for the session. `pack.json` is the
 * searchable index, so filtering never touches the geometry blob, and the
 * picker can render as soon as the manifests arrive.
 *
 * Format: docs/reference/lego-parts-pack.md.
 */

import { gunzipSync } from "fflate";
import * as THREE from "three";

import { legoExtraPackUrl, legoPackUrl } from "../lib/assetUrl";
import { type LegoAtlas, unitAtlas } from "./atlas";
import { legoPacks } from "./bindings";
import {
  type LegoConnector,
  readPartConnectors,
  resolveConnections,
} from "./connectors";
import type { LegoProject } from "./model";
import { type Problem, problem } from "./problems";
import {
  isKnownShapeKind,
  type ShapeRoundPanel,
  type ShapeSwatch,
  setShapeRoundPanels,
  setShapeSwatches,
} from "./shapes";

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
  /**
   * Where this part can be joined, when the pack states it. Absent means the
   * connectors are derived from `bbox`. Present means exactly this list, so an
   * empty one is a part nothing joins to. Checked when packs are merged.
   */
  connectors?: LegoConnector[];
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
  /**
   * The pack's step size: the spacing its parts are built on, in the same
   * units as `bbox`. Optional, and a positive number when present. See
   * `partUnit` for what a pack without one gets.
   */
  unit?: number;
  /**
   * The plain rectangles of the atlas a generated shape tiles, one per
   * colourway (#3326). Optional. Only the base pack's count, because an
   * extension pack and an atlas pack use its atlas, and a base pack with none
   * offers no shapes. See `readSwatches`.
   */
  swatches?: ShapeSwatch[];
  /**
   * The round panels of the atlas a shape with round ends can show on them,
   * one per colourway, matched to a swatch by id (#4398). Optional, and only
   * the base pack's count, as with `swatches`. See `readRoundPanels`.
   */
  roundPanels?: ShapeRoundPanel[];
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

/**
 * An atlas pack's manifest as `pack.json` holds it: `reskins`, an atlas and a
 * texture, and nothing else. `parts` and `geometry` are typed here only so a
 * pack that brings them can be told it cannot.
 */
export interface RawAtlasManifest {
  schemaVersion: number;
  id: string;
  version: string;
  licence?: string;
  /** The parts pack whose atlas this one replaces, by id. */
  reskins: string;
  atlas?: { width: number; height: number };
  textures?: { tex1: string; tex2?: string };
  parts?: unknown[];
  geometry?: unknown;
}

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
  /**
   * Every atlas a unit can be built against, the base pack's first. Separate
   * from `packs` because an atlas pack has no parts, so it must never appear as
   * something to filter the parts grid by.
   */
  atlases: LegoAtlas[];
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
   * categories. Singular because every parts pack shares one UV layout, so
   * there is one parts library however many packs are installed. Its
   * `textures.tex1` is the base atlas, which is what a unit samples unless it
   * names one of the alternatives in `library.atlases`.
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

/**
 * The part unit of a pack that states none. 0.25 is the step the most of the
 * bundled pack's parts sit on: 295 of its 373 have all three sides on it, where
 * 207 do on 0.5 (counted from `pack.json`, to within 0.002).
 */
export const DEFAULT_PART_UNIT = 0.25;

/**
 * The step size a unit built from this library moves and slides in. One value
 * for the whole library, the base pack's, because parts from every pack mix in
 * one unit and a piece cannot be on two grids. Always a positive number.
 */
export function partUnit(pack: Pick<LoadedPack, "manifest">): number {
  return pack.manifest.unit ?? DEFAULT_PART_UNIT;
}

/**
 * The swatches a pack lists that a shape can use, and what was wrong with the
 * rest, as the end of a sentence about the pack. A swatch needs an id no other
 * swatch has, a rectangle inside the atlas with its minimum below its maximum,
 * and a positive `tile`.
 */
export function readSwatches(value: unknown): {
  usable: ShapeSwatch[];
  problem: string | null;
} {
  if (value === undefined) return { usable: [], problem: null };
  if (!Array.isArray(value)) {
    return {
      usable: [],
      problem: 'states "swatches" that are not a list, so it offers no shapes.',
    };
  }
  const usable: ShapeSwatch[] = [];
  let refused = 0;
  for (const item of value as unknown[]) {
    const swatch = item as Partial<ShapeSwatch> | null;
    const corner = (c: unknown) =>
      Array.isArray(c) &&
      c.length === 2 &&
      c.every((x) => typeof x === "number" && x >= 0 && x <= 1);
    const min = swatch?.uv?.min;
    const max = swatch?.uv?.max;
    if (
      typeof swatch?.id === "string" &&
      swatch.id !== "" &&
      !usable.some((s) => s.id === swatch.id) &&
      corner(min) &&
      corner(max) &&
      min &&
      max &&
      min[0] < max[0] &&
      min[1] < max[1] &&
      isUnit(swatch.tile)
    ) {
      usable.push({
        id: swatch.id,
        uv: { min: [min[0], min[1]], max: [max[0], max[1]] },
        tile: swatch.tile,
      });
    } else {
      refused++;
    }
  }
  return {
    usable,
    problem:
      refused === 0
        ? null
        : `states ${refused} ${refused === 1 ? "swatch" : "swatches"} that cannot be used, so shapes cannot take ${refused === 1 ? "it" : "them"}.`,
  };
}

/**
 * The round panels a pack lists that a shape can show, and what was wrong with
 * the rest, as the end of a sentence about the pack. A panel needs an id no
 * other panel has, a centre and a positive radius, with the whole circle
 * inside the atlas.
 */
export function readRoundPanels(value: unknown): {
  usable: ShapeRoundPanel[];
  problem: string | null;
} {
  if (value === undefined) return { usable: [], problem: null };
  if (!Array.isArray(value)) {
    return {
      usable: [],
      problem:
        'states "roundPanels" that are not a list, so shapes cannot show them.',
    };
  }
  const usable: ShapeRoundPanel[] = [];
  let refused = 0;
  for (const item of value as unknown[]) {
    const panel = item as Partial<ShapeRoundPanel> | null;
    const centre = panel?.centre;
    const radius = panel?.radius;
    if (
      typeof panel?.id === "string" &&
      panel.id !== "" &&
      !usable.some((p) => p.id === panel.id) &&
      Array.isArray(centre) &&
      centre.length === 2 &&
      isUnit(radius) &&
      centre.every(
        (x) => typeof x === "number" && x - radius >= 0 && x + radius <= 1,
      )
    ) {
      usable.push({ id: panel.id, centre: [centre[0], centre[1]], radius });
    } else {
      refused++;
    }
  }
  return {
    usable,
    problem:
      refused === 0
        ? null
        : `states ${refused} ${refused === 1 ? "round panel" : "round panels"} that cannot be used, so shapes cannot show ${refused === 1 ? "it" : "them"}.`,
  };
}

function isUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
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
 * express. Rejecting a parts pack that brings its own atlas here is what keeps
 * that unreachable, rather than letting it fail at export. A pack whose atlas
 * is a reskin of the base pack's, and which therefore brings no parts of its
 * own, never reaches here: that is `readAtlasPack`.
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
    return `"${folder}" names no base pack, so it cannot be added to one. An extension pack sets "extends" to the id of the pack whose atlas it uses, and an atlas pack sets "reskins" to the id of the pack whose atlas it replaces.`;
  }
  if (raw.extends !== base.id) {
    return `"${folder}" extends "${raw.extends}", and the installed base pack is "${base.id}".`;
  }
  if (raw.textures && raw.textures.tex1 !== base.textures.tex1) {
    return `"${folder}" names its own texture, "${raw.textures.tex1}", rather than the base pack's "${base.textures.tex1}". A unit samples one texture, so a pack with its own atlas cannot be mixed into another.`;
  }
  return null;
}

/** An atlas pack's atlas, or the reason it cannot be installed. */
export type AtlasPackResult = { problem: string } | { atlas: LegoAtlas };

/**
 * Read an atlas pack: a pack that redraws the base pack's atlas and brings no
 * parts of its own.
 *
 * The parts stay the base pack's, so a unit's atlas is a choice of texture and
 * never a choice of inventory. That is what keeps the format's one rule met
 * without a migration: whichever atlas a unit samples, every part it can use is
 * mapped into it, so switching cannot leave a piece with nowhere to sample from.
 * A pack that brings parts as well as an atlas would be a second parts library,
 * which is a different thing and is refused here.
 *
 * `installed` is every atlas accepted so far, base pack first. Two atlases
 * cannot share a file name: they would land on top of each other in a game's
 * `unittextures/`, and a unit naming that file would draw whichever won.
 */
export function readAtlasPack(
  base: LegoPackManifest,
  raw: RawAtlasManifest,
  folder: string,
  installed: LegoAtlas[],
): AtlasPackResult {
  if (raw.schemaVersion !== SUPPORTED_SCHEMA) {
    return {
      problem: `"${folder}" uses pack schema ${raw.schemaVersion}, and this build understands ${SUPPORTED_SCHEMA}.`,
    };
  }
  if (!raw.id) {
    return { problem: `"${folder}" has no pack id.` };
  }
  if (raw.reskins !== base.id) {
    return {
      problem: `"${folder}" reskins "${raw.reskins}", and the installed base pack is "${base.id}".`,
    };
  }
  if (raw.parts !== undefined || raw.geometry !== undefined) {
    return {
      problem: `"${folder}" brings parts as well as an atlas. An atlas pack reskins the parts that are already there, so it has no "parts" and no "geometry" of its own.`,
    };
  }
  const tex1 = raw.textures?.tex1;
  if (!tex1) {
    return {
      problem: `"${folder}" names no texture, so there is no atlas to use. An atlas pack sets "textures.tex1" to the name of the PNG it ships.`,
    };
  }
  const clash = installed.find((atlas) => atlas.tex1 === tex1);
  if (clash) {
    return {
      problem: `"${folder}" ships its atlas as "${tex1}", which is what "${clash.packId}" already calls its own. Two atlases in one game folder need different file names.`,
    };
  }
  return { atlas: { tex1, packId: raw.id, folder } };
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
  // The base pack's unit, or the default when it states none or a bad one. An
  // extension pack cannot move it, so it is settled before the packs are read.
  const baseUnit = base.manifest.unit;
  if (baseUnit !== undefined && !isUnit(baseUnit)) {
    problems.push(
      `"${base.manifest.id}" states a unit of ${baseUnit}, which is not a positive number. The unit is ${DEFAULT_PART_UNIT} instead.`,
    );
  }
  const unit = isUnit(baseUnit) ? baseUnit : DEFAULT_PART_UNIT;
  const swatches = readSwatches(base.manifest.swatches);
  if (swatches.problem) {
    problems.push(`"${base.manifest.id}" ${swatches.problem}`);
  }
  const roundPanels = readRoundPanels(base.manifest.roundPanels);
  if (roundPanels.problem) {
    problems.push(`"${base.manifest.id}" ${roundPanels.problem}`);
  }
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
    const unusable: { name: string; problem: string }[] = [];
    if (
      source !== base &&
      source.manifest.unit !== undefined &&
      source.manifest.unit !== unit
    ) {
      problems.push(
        `"${source.manifest.id}" states a unit of ${source.manifest.unit}, and the library's is ${unit}, the base pack's. A unit built from several packs has one step size, so this one is ignored.`,
      );
    }
    for (const part of source.manifest.parts) {
      if (byId.has(part.id)) {
        taken++;
        continue;
      }
      const { connectors: stated, ...rest } = part;
      const moved: LegoPartInfo = {
        ...rest,
        packId: source.manifest.id,
        vFirst: part.vFirst + vertexBase,
        iFirst: part.iFirst + indexBase,
      };
      if (stated !== undefined) {
        const read = readPartConnectors(stated);
        if ("connectors" in read) moved.connectors = read.connectors;
        else unusable.push({ name: part.name, problem: read.problem });
      }
      parts.push(moved);
      byId.set(moved.id, moved);
    }
    if (taken > 0) {
      problems.push(
        `"${source.manifest.id}" reuses ${taken} part ${taken === 1 ? "id" : "ids"} an earlier pack already uses. Those parts were skipped, so a part id always means the same geometry.`,
      );
    }
    if (unusable.length > 0) {
      const [first] = unusable;
      problems.push(
        `"${source.manifest.id}" states connectors that cannot be used for ${unusable.length} ${unusable.length === 1 ? "part" : "parts"}, which get the connectors their bounding boxes give them. The first is "${first.name}": ${first.problem}.`,
      );
    }
    vertexBlocks.push(source.vertices);
    indexBlocks.push(source.indices);
    vertexBase += source.vertices.length / FLOATS_PER_VERTEX;
    indexBase += source.indices.length;
  }

  // Categories are the picker's own cut of the parts, so a category id an
  // extension pack shares with the base pack is the same shelf, not a second
  // one. First label wins, in the same order the packs loaded. A category no
  // surviving part is in does not appear at all, because a button that filters
  // down to nothing is a dead end.
  const used = new Set(parts.map((part) => part.category));
  const categories: LegoPackManifest["categories"] = [];
  const known = new Set<string>();
  for (const source of sources) {
    for (const category of source.manifest.categories) {
      if (known.has(category.id) || !used.has(category.id)) continue;
      known.add(category.id);
      categories.push(category);
    }
  }

  return {
    manifest: {
      ...base.manifest,
      unit,
      categories,
      parts,
      ...(base.manifest.swatches === undefined
        ? {}
        : { swatches: swatches.usable }),
      ...(base.manifest.roundPanels === undefined
        ? {}
        : { roundPanels: roundPanels.usable }),
    },
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
 * No case refuses to open the unit. A piece whose part is missing keeps its
 * name, its place in the hierarchy and its transform, all of which is real
 * work, and an unresolved `partId` is already how the viewport draws a piece
 * with no geometry. This is the same call paste makes for a piece from another
 * pack: report it, do not drop it. A missing atlas is the same again: the unit
 * keeps naming it, so installing the atlas pack later puts the unit right.
 */
export function projectPackProblems(
  project: LegoProject,
  pack: LoadedPack,
): Problem[] {
  const problems: Problem[] = [];
  const installed = pack.library.packs.map((manifest) => manifest.id);
  if (project.packId && !installed.includes(project.packId)) {
    problems.push(
      problem(
        "pack",
        "warning",
        `This unit was built against the "${project.packId}" pack, and that pack is not installed.`,
      ),
    );
  }

  const atlas = unitAtlas(project, pack.library.atlases);
  if (!atlas.installed) {
    problems.push(
      problem(
        "pack",
        "warning",
        `This unit's atlas, "${atlas.texture}", is not installed, so it is drawn with "${atlas.drawWith.tex1}" instead. An export still names its own.`,
      ),
    );
  }

  const lost = project.pieces.filter(
    (piece) => piece.partId !== null && !pack.byId.has(piece.partId),
  );
  const missing = lost.length;
  if (missing > 0) {
    problems.push(
      problem(
        "pack",
        "warning",
        missing === 1
          ? "1 piece names a part no installed pack has, so it shows no geometry."
          : `${missing} pieces name parts no installed pack has, so they show no geometry.`,
        lost.map((piece) => piece.id),
      ),
    );
  }

  // A shape kind from a newer build is kept, so saving does not lose it, but
  // this build cannot make it.
  const unknown = project.pieces.filter(
    (piece) => piece.shape && !isKnownShapeKind(piece.shape.kind),
  );
  if (unknown.length > 0) {
    problems.push(
      problem(
        "pack",
        "warning",
        unknown.length === 1
          ? "1 piece is a shape this version of coilbox cannot make, so it shows no geometry."
          : `${unknown.length} pieces are shapes this version of coilbox cannot make, so they show no geometry.`,
        unknown.map((piece) => piece.id),
      ),
    );
  }

  // A join on a piece with no parent is the document's own problem, and
  // `projectProblems` says so. This is the join a part swap left behind.
  const { broken } = resolveConnections(project, pack);
  for (const id of broken) {
    const piece = project.pieces.find((p) => p.id === id);
    if (piece?.parentId === null) continue;
    problems.push(
      problem(
        "pack",
        "warning",
        `"${piece?.name}" is joined by a connector that its part or its parent's part does not have, so it stays where it was.`,
        [id],
      ),
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
 * Read the base pack, then every pack installed beside it, and merge them.
 *
 * A pack in that folder is one of two things, and `reskins` is what says which:
 * an extension pack adding parts to the base pack's atlas, or an atlas pack
 * redrawing that atlas and adding no parts.
 *
 * Only a missing or broken base pack is fatal. An installed pack that will not
 * load is skipped with a reason, because the rest of the library still works
 * and there would otherwise be no way to fix the one at fault.
 */
async function fetchLibrary(): Promise<LoadedPack> {
  const base = await fetchPack((file) => legoPackUrl(file));
  const problems: string[] = [];
  const sources: PackSource[] = [base];
  const atlases: LegoAtlas[] = [
    {
      tex1: base.manifest.textures.tex1,
      packId: base.manifest.id,
      folder: null,
    },
  ];

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
    const url = (file: string) => legoExtraPackUrl(folder, file);
    try {
      const raw = await fetchJson<RawPackManifest | RawAtlasManifest>(
        url("pack.json"),
      );
      if ("reskins" in raw) {
        const result = readAtlasPack(base.manifest, raw, folder, atlases);
        if ("problem" in result) throw new Error(result.problem);
        atlases.push(result.atlas);
      } else {
        const problem = extensionProblem(base.manifest, raw, folder);
        if (problem) throw new Error(problem);
        sources.push(
          await fetchPack(url, {
            ...raw,
            atlas: base.manifest.atlas,
            textures: base.manifest.textures,
          }),
        );
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
  }

  const merged = mergePacks(sources);
  setShapeSwatches(merged.manifest.swatches ?? []);
  setShapeRoundPanels(merged.manifest.roundPanels ?? []);
  return {
    manifest: merged.manifest,
    parts: merged.parts,
    byId: merged.byId,
    vertices: merged.vertices,
    indices: merged.indices,
    library: {
      packs: sources.map((source) => source.manifest),
      atlases,
      dir,
      problems: [...problems, ...merged.problems],
    },
  };
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

/**
 * What to call a colourway on screen: the label of the category with its id,
 * or the id itself when no category has it. The bundled pack's red column has
 * the id "green" and the label "Team colour" (#4466).
 */
export function colourwayLabel(
  pack: Pick<LoadedPack, "manifest">,
  colourway: string,
): string {
  return (
    pack.manifest.categories.find((c) => c.id === colourway)?.label ?? colourway
  );
}

/** Free every geometry built from a pack. Call when tearing down the last view. */
export function disposePackGeometry(pack: LoadedPack): void {
  const cache = geometryCache.get(pack);
  if (!cache) return;
  for (const geometry of cache.values()) geometry.dispose();
  cache.clear();
}
