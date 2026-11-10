/**
 * The file coilbox and the skeleton widget share (issue #5181).
 *
 * Coilbox writes `LuaUI/Config/coilbox_skeletons/<game short name>.json` into a
 * content root. For each unit it knows the body plan of, it holds each plan
 * bone's piece, the bone's id in the plan and its role label, in the player's
 * language, so the widget needs no catalogue of roles. The widget, under
 * `lua/skeleton-widget/`, reads it with `VFS.LoadFile` and matches by unit
 * definition name.
 *
 * ```json
 * {
 *   "version": 1,
 *   "units": {
 *     "armcom": {
 *       "evidence": "fitted",
 *       "pieces": { "lthigh": { "bone": "thigh.l1", "label": "Left thigh" } }
 *     }
 *   }
 * }
 * ```
 *
 * Top level keys other than `version` and `units` belong to later writers, so a
 * merge keeps them as they are. `coilbox_test_unit` is one: the unit Test in
 * game wants the widget to select (issue #5182).
 *
 * Text in, text out. The filesystem is passed in, as `@/blueprint/gameFile`
 * takes it.
 */

import type { BlueprintFileIO } from "@/blueprint/gameFile";
import type { GameItem } from "@/content/bindings";
import { underConfigDir } from "@/content/enginePaths";
import { carriedShortname, rememberedShortname } from "../container/shortnames";
import { roleLabel } from "./animPresets";
import type { LegoProject } from "./model";
import { unitGame } from "./unitGame";

/** Under a content root, the folder holding one file per game. */
export const SKELETON_FILE_DIR = "LuaUI/Config/coilbox_skeletons";

const VERSION = 1;

/**
 * How a unit's bones are known. `built` is a plan coilbox made the pieces
 * from, `fitted` a plan fitted to pieces the unit already had, and `observed`
 * is read off a game's own model without a plan. The widget draws `observed`
 * dashed.
 */
export type SkeletonEvidence = "built" | "fitted" | "observed";

export interface SkeletonPieceEntry {
  /** The bone's id in the body plan, such as `thigh.l1`. */
  bone: string;
  /** The role's label in the player's language, or the piece's name when the
   *  piece has no role. */
  label: string;
}

export interface SkeletonUnitEntry {
  evidence: SkeletonEvidence;
  /** By the piece's name in the model. The widget matches case blind. */
  pieces: Record<string, SkeletonPieceEntry>;
}

export interface SkeletonFile {
  version: number;
  units: Record<string, SkeletonUnitEntry>;
  [other: string]: unknown;
}

/** The file name for a game, with each byte of its UTF-8 that a file name
 *  cannot hold changed to an underscore. `coilbox_skeleton/plan.lua` does the
 *  same to `Game.gameShortName`, which Lua reads a byte at a time, so the two
 *  agree on every name. */
export function skeletonFileName(shortname: string): string {
  let name = "";
  for (const byte of new TextEncoder().encode(shortname)) {
    const char = String.fromCharCode(byte);
    name += /[A-Za-z0-9._-]/.test(char) ? char : "_";
  }
  return `${name}.json`;
}

/** Where a game's file is under a content root. */
export function skeletonFilePath(root: string, shortname: string): string {
  return underConfigDir(
    root,
    `${SKELETON_FILE_DIR}/${skeletonFileName(shortname)}`,
  );
}

/**
 * The plan bones of a unit, or null for a unit with no skeleton or with a
 * skeleton none of whose pieces is a bone. A piece with no role is labelled
 * with its own name, as the builder's skeleton layer does. A piece that came
 * from a game's model under another name is listed under both.
 */
export function unitSkeletonEntry(
  project: LegoProject,
): SkeletonUnitEntry | null {
  if (!project.skeleton) return null;
  const pieces: Record<string, SkeletonPieceEntry> = {};
  for (const piece of project.pieces) {
    if (piece.bone === undefined) continue;
    const record = {
      bone: piece.bone,
      label: piece.role ? roleLabel(piece.role) : piece.name,
    };
    pieces[piece.name] = record;
    // A unit opened from a game runs as the game's own model until it is
    // exported, and that model has the names the file shipped with.
    if (piece.originalName && piece.originalName !== piece.name) {
      pieces[piece.originalName] = record;
    }
  }
  if (Object.keys(pieces).length === 0) return null;
  return {
    evidence: project.skeleton.fitted ? "fitted" : "built",
    pieces,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The file as it is, `null` for no file. A file that is there and will not
 *  read throws: the caller is about to write, and must not write over what it
 *  could not read. */
function readFile(text: string | null): SkeletonFile {
  if (text === null || text.trim() === "")
    return { version: VERSION, units: {} };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`the skeleton file is not JSON: ${detail}`);
  }
  if (!isObject(value)) {
    throw new Error("the skeleton file could not be read: it is not an object");
  }
  if (value.version !== VERSION) {
    throw new Error(
      `the skeleton file is version ${String(value.version)}, and this coilbox reads version ${VERSION}`,
    );
  }
  if (value.units !== undefined && !isObject(value.units)) {
    throw new Error(
      "the skeleton file could not be read: its units are not an object",
    );
  }
  return {
    ...value,
    version: VERSION,
    units: (value.units ?? {}) as Record<string, SkeletonUnitEntry>,
  };
}

/**
 * The file's text with `entries` merged into what is there, and the units whose
 * entry is not what the file held. A unit's entry is replaced by a new one,
 * except that an `observed` entry never replaces a `built` or `fitted` one:
 * coilbox's own record of a unit's plan outranks a reading of its model. Units
 * not named and keys coilbox does not know are kept as they are. Throws for
 * text that is not a skeleton file.
 */
export function mergeSkeleton(
  existing: string | null,
  entries: Readonly<Record<string, SkeletonUnitEntry>>,
): { text: string; changed: string[] } {
  const file = readFile(existing);
  const units = { ...file.units };
  const changed: string[] = [];
  for (const [unitName, entry] of Object.entries(entries)) {
    const held = units[unitName];
    if (
      entry.evidence === "observed" &&
      held &&
      (held.evidence === "built" || held.evidence === "fitted")
    ) {
      continue;
    }
    if (JSON.stringify(held) !== JSON.stringify(entry)) changed.push(unitName);
    units[unitName] = entry;
  }
  return { text: JSON.stringify({ ...file, units }, null, 2), changed };
}

/** Just the text of {@link mergeSkeleton}. */
export function mergeSkeletonFile(
  existing: string | null,
  entries: Readonly<Record<string, SkeletonUnitEntry>>,
): string {
  return mergeSkeleton(existing, entries).text;
}

/**
 * The short name of the game a unit is for, the one the engine reports as
 * `Game.gameShortName`. A mutator is the game it builds on. Null for a unit of
 * no game, or of a game whose short name coilbox has not read.
 */
export function skeletonGameShortname(project: LegoProject): string | null {
  const game = unitGame(project);
  if (!game) return null;
  const own = game.base ?? game;
  return (
    own.shortname?.trim() ||
    rememberedShortname(own.name) ||
    carriedShortname(own.name) ||
    null
  );
}

/**
 * The content root a game folder is in, for a folder at `<root>/games/<name>`,
 * where the engine looks for loose games. Null for a folder anywhere else, which
 * says nothing about where the widget is installed.
 */
export function contentRootOfGameFolder(folder: string): string | null {
  const match = /^(.+)[\\/]games[\\/][^\\/]+[\\/]*$/i.exec(folder);
  return match ? match[1] : null;
}

export interface SkeletonWrite {
  path: string;
  /** The unit definition names whose entry in it changed. */
  units: string[];
}

export interface SkeletonWriteResult {
  /** Each file that changed. A file that already said the same is not here. */
  written: SkeletonWrite[];
  /** Units with a skeleton that no file could be written for, because their
   *  game has no short name that coilbox knows. */
  unplaced: string[];
  /** How many of the units given have a skeleton with a bone, whether or not a
   *  file could be written for them. */
  withSkeleton: number;
}

function samePath(a: string, b: string): boolean {
  const flat = (path: string) =>
    path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return flat(a) === flat(b);
}

/**
 * The short name in the modinfo of the game that lives in `folder`, read from a
 * unitsync scan, which is the code that parses modinfo. Null for a folder no
 * scanned game lives in, as a folder nobody has scanned since it was made, and
 * for a game whose modinfo has no short name.
 */
export function folderGameShortname(
  folder: string,
  games: readonly GameItem[],
): string | null {
  const game = games.find(
    (g) => g.primaryArchive.path && samePath(g.primaryArchive.path, folder),
  );
  return game?.info?.shortname?.trim() || null;
}

export interface SkeletonWriteOptions {
  /**
   * A short name to write every unit's file under as well, the one of the game
   * the units will run in. A match reports the short name of the game it
   * starts, so a mutator or Test in game's scratch game reports its own and the
   * widget looks for that file (issue #5193).
   */
  alsoUnder?: string | null;
}

/**
 * Write the plan bones of every unit that has a skeleton, one file for each
 * game, merging into the file already there. Skips a write when the merge says
 * what the file already does.
 */
export async function writeSkeletonFiles(
  io: BlueprintFileIO,
  root: string,
  projects: readonly LegoProject[],
  options: SkeletonWriteOptions = {},
): Promise<SkeletonWriteResult> {
  const alsoUnder = options.alsoUnder?.trim() || null;
  const byGame = new Map<string, Record<string, SkeletonUnitEntry>>();
  const unplaced: string[] = [];
  let withSkeleton = 0;
  for (const project of projects) {
    const entry = unitSkeletonEntry(project);
    if (!entry) continue;
    withSkeleton += 1;
    const shortnames = new Set(
      [skeletonGameShortname(project), alsoUnder].filter(
        (name): name is string => name !== null,
      ),
    );
    if (shortnames.size === 0) {
      unplaced.push(project.unitName);
      continue;
    }
    for (const shortname of shortnames) {
      const entries = byGame.get(shortname) ?? {};
      entries[project.unitName] = entry;
      byGame.set(shortname, entries);
    }
  }

  const written: SkeletonWrite[] = [];
  for (const [shortname, entries] of byGame) {
    const path = skeletonFilePath(root, shortname);
    const before = await io.read(path);
    const { text, changed } = mergeSkeleton(before, entries);
    if (changed.length === 0) continue;
    await io.write(path, text);
    written.push({ path, units: changed });
  }
  return { written, unplaced, withSkeleton };
}
