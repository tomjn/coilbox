/**
 * The scratch game a built unit is tested in.
 *
 * The engine loads units from a game, so seeing one on a map means putting it
 * in a game. Writing into the user's install to do that would be rude and hard
 * to undo, so coilbox keeps one `.sdd` of its own that depends on whichever
 * game the unit is tested against. The base game supplies the sides, the rules
 * and everything else. The scratch archive adds only what the builder exported.
 *
 * It is a plain folder under the content root's `games/`, so deleting that
 * folder undoes everything this flow ever wrote.
 */

import { luaString } from "./unitDef";

/**
 * The scratch archive's folder name. Fixed, so repeated tests reuse one folder
 * rather than leaving a trail of them, and so the Rust side can refuse any name
 * that is not this shape.
 */
export const SCRATCH_FOLDER = "coilbox-lego-test.sdd";

/** What the archive calls itself. The engine appends the version to this. */
const SCRATCH_NAME = "Coilbox unit test";

/** Rewritten on every test launch, so it carries no state worth versioning. */
const SCRATCH_VERSION = "scratch";

/**
 * The scratch archive's `modinfo.lua`.
 *
 * `modtype = 1` is what makes it a game the engine can be launched with.
 * Anything lower and it would never be offered as a start-script `GameType`.
 * The single `depend` entry is the name unitsync reports for the base game,
 * which is the same string a start script names, so the two cannot drift apart.
 */
export function buildModInfo(baseGame: string): string {
  const lines = [
    "-- The scratch game coilbox's unit builder tests units in.",
    "-- Rewritten on every test launch. Delete this folder to undo it.",
    "",
    "return {",
    `  name = ${luaString(SCRATCH_NAME)},`,
    '  shortname = "coilbox_lego_test",',
    `  game = ${luaString(SCRATCH_NAME)},`,
    `  version = ${luaString(SCRATCH_VERSION)},`,
    `  description = ${luaString(`Units built with coilbox, on top of ${baseGame}.`)},`,
    "  modtype = 1,",
    "  depend = {",
    `    ${luaString(baseGame)},`,
    "  },",
    "}",
  ];
  return `${lines.join("\n")}\n`;
}

/** Whether a scanned archive is the scratch game, by its archive file name. */
export function isScratchArchive(archiveName: string): boolean {
  return archiveName.toLowerCase() === SCRATCH_FOLDER;
}
