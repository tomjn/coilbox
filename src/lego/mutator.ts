/**
 * A mutator game for built units, written into the content root.
 *
 * The Test drawer, and the modes that let a game maker bring units into a
 * campaign, a conquest or a warpath run (issue #582), all reach the engine the
 * same way: a small game folder that depends on the base game and carries the
 * units, found by unitsync and launched by name. This is the one place that
 * writes it. A caller says which folder, which base game and which units, and
 * gets back the name unitsync scanned the folder as.
 *
 * Rewriting the folder and rescanning is a full unitsync scan of the content
 * root, so neither happens when the folder already holds exactly this set. See
 * [`MutatorStamp`] for how that is told.
 */

import { unitsyncLuaExec } from "@/content/bindings";
import { primeScan } from "@/content/config";
import type { PlayTarget } from "@/play/config";
import { workshopCompile } from "@/workshop/compile";
import type { ModProject } from "@/workshop/project";

import { exportTextureName, unitAtlas } from "./atlas";
import {
  legoExport,
  legoReadTextFile,
  legoScratchGame,
  legoScratchPrune,
  legoWriteTextFile,
  type ScratchSandbox,
} from "./bindings";
import { buildCombinedSheet } from "./combinedSheet";
import { unitScript } from "./luaScript";
import type { ExportedFile, LegoProject } from "./model";
import { type GameMovementData, scratchMovement } from "./movement";
import type { LoadedPack } from "./pack";
import { buildPieceCollisionScript } from "./pieceCollisionScript";
import type { RawGeometry } from "./rawGeometry";
import { importedTextures } from "./rawImport";
import { bakedPieces, buildS3o, unitBounds } from "./s3oBuild";
import {
  buildLuaRulesEntry,
  buildModInfo,
  buildUnitScriptGadget,
  LUARULES_ENTRIES_LUA,
  missingLuaRulesEntries,
} from "./scratchGame";
import { sheetSources } from "./textureSheet";
import { buildUnitDef, footprintSteps, legoUnitDef } from "./unitDef";
import { scratchWeapons } from "./weaponModule";
import { worthTotals } from "./worth";
import { buildWreck } from "./wreck";

/** One built unit to put in a mutator, with what it is built from. */
export interface MutatorUnit {
  project: LegoProject;
  pack: LoadedPack;
  /** The meshes of a unit imported from somebody else's model, if it is one. */
  raw: RawGeometry | null;
}

/** What a mutator is written against, whatever the units in it. */
export interface MutatorContext {
  target: PlayTarget;
  /** The base game's name, as unitsync reports it. */
  baseGame: string;
  /** The base game's archive, which unitsync is asked about its files by. */
  baseArchive: string;
  /** The workshop's projects, where a library weapon is read from. */
  workshopProjects: readonly ModProject[];
  /**
   * The base game's weapon table, null until it is read. A game weapon a unit
   * names that is not in it is left out of the unit.
   */
  gameWeapons: Record<string, Record<string, unknown>> | null;
  /**
   * The base game's units and move definitions, null until they are read. A
   * unit built to move with no movement of its own takes a class from them.
   */
  gameMovement: GameMovementData | null;
}

/** Files a caller adds on top of the units. None of them is needed to write a mutator. */
export interface MutatorExtras {
  /** The side data and the gadget that start a side with one unit. */
  startUnit?: { sidedata: string; gadget: string };
  /** The sandbox mission's files. */
  sandbox?: ScratchSandbox;
}

export interface MutatorArgs extends MutatorContext {
  /** The folder under `games/`, named `coilbox-lego-<consumer>.sdd`. */
  folder: string;
  units: readonly MutatorUnit[];
  extras?: MutatorExtras;
  /** Told the folder as soon as it exists, or is found to be current. */
  onWritten?: (dir: string) => void;
  /** Told when the files are written and the rescan starts. Not told on a skip. */
  onScanning?: () => void;
}

/** What writing one unit into a mutator put on disk. */
export interface WrittenUnit {
  /** The name the unit was exported under, which its files are named after. */
  unitName: string;
  dir: string;
  /** Every file the unit was written as, with the digest of what was written. */
  files: ExportedFile[];
  /**
   * Which textures it was given, as one string. A texture is copied rather
   * than generated, so there is no digest of it, and this is what tells one
   * texture from another.
   */
  textures: string;
  /** The file names the textures were written under, in `unittextures/`. */
  textureFiles: string[];
  /** A line for each weapon the unit names that was left out, and why. */
  weaponsLeftOut: string[];
}

export interface MutatorResult {
  dir: string;
  /** The name unitsync scanned the folder as, which a start script asks for. */
  name: string;
  /** True when the folder already held this set, so nothing was written or scanned. */
  skipped: boolean;
  /** One entry per unit, in the order they were given. */
  units: WrittenUnit[];
}

/** What `legoExport` is given for a unit, less the folder it goes into. */
type ExportPayload = Omit<Parameters<typeof legoExport>[0], "dir">;

/** A unit built into the arguments `legoExport` takes, not yet written. */
interface PreparedUnit {
  payload: ExportPayload;
  textures: string;
  textureFiles: string[];
  weaponsLeftOut: string[];
}

/**
 * The LuaRules entry files the base game lacks, for the mutator to supply, so
 * its gadgets run at all (issue #4475). Throws when unitsync cannot say,
 * because guessing either way breaks a game: a missing file leaves the unit
 * unspawned, and a needless one hides the game's own.
 */
export async function luaRulesEntries(
  target: PlayTarget,
  baseGame: string,
  baseArchive: string,
): Promise<{ luaRulesMain?: string; luaRulesDraw?: string }> {
  const res = await unitsyncLuaExec({
    enginePath: target.enginePath,
    dataDir: target.dataDir,
    archive: baseArchive,
    source: LUARULES_ENTRIES_LUA,
  });
  if (res.error) {
    throw new Error(`Could not read ${baseGame}'s LuaRules: ${res.error}`);
  }
  const missing = missingLuaRulesEntries(res.result);
  const entry = buildLuaRulesEntry();
  return {
    ...(missing.includes("LuaRules/main.lua") ? { luaRulesMain: entry } : {}),
    ...(missing.includes("LuaRules/draw.lua") ? { luaRulesDraw: entry } : {}),
  };
}

/** Build one unit into what a mutator folder holds for it. */
export async function prepareUnit(
  { baseGame, workshopProjects, gameWeapons, gameMovement }: MutatorContext,
  { project: unit, pack, raw }: MutatorUnit,
): Promise<PreparedUnit> {
  // The same slots and files a real export writes, less the game weapons this
  // game lacks. The script reads the unit it is numbered from, so it gets the
  // unit as left out too.
  const weapons = await scratchWeapons(
    unit,
    workshopProjects,
    gameWeapons,
    (made) => workshopCompile({ project: made }),
  );
  // A unit with legs and no game would go in as a building, so it walks on
  // the test game's class instead (issue #4472).
  const bounds = unitBounds(weapons.project, pack, raw);
  const project = {
    ...weapons.project,
    movement: scratchMovement(
      weapons.project,
      gameMovement,
      baseGame,
      Math.max(footprintSteps(bounds.sizeX), footprintSteps(bounds.sizeZ)),
    ),
  };
  // An imported unit draws with its own two textures out of the store. A
  // built one samples one atlas, and only its own: an s3o names one texture.
  // A unit whose atlas is not installed still tests, untextured, rather than
  // failing on a file that cannot be copied. A unit mixing parts with lifted
  // pieces draws from one sheet made of both (#3260).
  const mixed = sheetSources(project, pack, raw);
  if (mixed && "refused" in mixed) throw new Error(mixed.refused);
  const sheet = mixed
    ? await buildCombinedSheet(project, pack, raw, mixed.sources)
    : null;
  const atlas = unitAtlas(project, pack.library.atlases);
  const written = exportTextureName(atlas.texture);
  const imported = project.imported ? importedTextures(project.imported) : null;
  const model = sheet
    ? buildS3o(
        project,
        pack,
        raw,
        { texture1: sheet.texture1, texture2: sheet.texture2 },
        { sheet: sheet.uv },
      )
    : buildS3o(project, pack, raw, {
        texture1: imported ? imported.texture1 : written,
        texture2: imported?.texture2,
      });
  if (!model) throw new Error("This unit has no root piece.");

  const textures = {
    atlas:
      !imported && !sheet && atlas.installed
        ? {
            name: atlas.texture,
            pack: atlas.installed.folder,
            writeAs: written,
          }
        : null,
    stored: sheet ? sheet.place : (imported?.place ?? []),
  };
  const def = legoUnitDef(
    project,
    bounds,
    "def",
    worthTotals(project, pack),
    weapons.slots,
  );
  const wreck = buildWreck(
    project,
    pack,
    raw,
    { texture1: model.texture1, texture2: model.texture2 },
    def,
    sheet?.uv,
  );
  const payload: ExportPayload = {
    unitName: project.unitName,
    textures,
    // A mutator folder always rewrites regardless (see `is_scratch_dir`), so
    // this has no effect here: the drawer's own checkbox is the only thing
    // that reads it for a real export.
    overwriteTexture: false,
    script: unitScript(project),
    // A mutator folder is always rewritten whole, so neither re-export input
    // is read there.
    scriptWritten: null,
    pieceCollision: buildPieceCollisionScript(
      project,
      bakedPieces(project, pack, raw).pieces,
    ),
    // Measured rather than taken off the build: a build's `mid` is the
    // header's, which is the aim point, and the definition is derived from
    // the bounding box.
    // A definition home, always. The mutator is coilbox's own, built fresh
    // here, and it has no localisation file to read a name out of.
    unitDef: buildUnitDef(
      project,
      bounds,
      "def",
      worthTotals(project, pack),
      weapons.slots,
    ),
    unitDefFields: null,
    text: null,
    model,
    weapons: weapons.files,
    // So a test match drops the same wreck a real game will (issue #3310).
    ...(wreck
      ? {
          wreck: {
            model: wreck.model,
            feature: wreck.feature,
            featureWritten: null,
          },
        }
      : {}),
  };
  return {
    payload,
    textures: JSON.stringify(textures),
    textureFiles: [
      ...(textures.atlas ? [textures.atlas.writeAs] : []),
      ...textures.stored.map((stored) => stored.writeAs),
    ],
    weaponsLeftOut: weapons.leftOut,
  };
}

/** The arguments `legoScratchGame` writes a mutator's own files from. */
type FolderFiles = Parameters<typeof legoScratchGame>[0];

/** What the mutator's own files are, before any unit goes in. */
export async function folderFiles({
  folder,
  extras,
  ...context
}: MutatorContext & {
  folder: string;
  extras?: MutatorExtras;
}): Promise<FolderFiles> {
  const { target, baseGame, baseArchive } = context;
  return {
    dataDir: target.dataDir,
    folder,
    modinfo: buildModInfo(baseGame),
    ...(extras?.startUnit
      ? {
          sidedata: extras.startUnit.sidedata,
          gadget: extras.startUnit.gadget,
        }
      : {}),
    unitScriptGadget: buildUnitScriptGadget(),
    ...(await luaRulesEntries(target, baseGame, baseArchive)),
    ...(extras?.sandbox ? { sandbox: extras.sandbox } : {}),
  };
}

/** Write one prepared unit into a mutator folder that exists. */
export async function exportPrepared(
  dir: string,
  prepared: PreparedUnit,
): Promise<WrittenUnit> {
  const { owned } = await legoExport({ dir, ...prepared.payload });
  return {
    unitName: prepared.payload.unitName,
    dir,
    files: owned,
    textures: prepared.textures,
    textureFiles: prepared.textureFiles,
    weaponsLeftOut: prepared.weaponsLeftOut,
  };
}

/**
 * What a mutator folder records beside itself once it is written and scanned,
 * in `games/<folder>.stamp`.
 *
 * `hash` is the SHA-256 of everything this module sends to be written: the
 * folder's own files and every unit's export arguments, with the generated
 * model, script and definition in full. The same hash therefore means the same
 * folder, whether the cause of a change is a unit edit, a different base game
 * or a new coilbox that generates different Lua. The rest is what a skipped
 * launch has to answer without writing: where the folder is, the name unitsync
 * gave it, and what each unit was written as.
 *
 * The stamp sits beside the folder rather than in it, so it does not change the
 * archive the engine reads. It is written last, after the rescan, and cleared
 * before any file changes, so a launch that fails part way leaves no stamp
 * claiming a folder it did not finish.
 *
 * Two things the hash cannot see, and so never skips for: a texture's bytes
 * (a texture is copied from its pack by name, so an atlas edited in place under
 * the same name is not noticed), and the mission runtime a sandbox copies from
 * the app. A sandbox that ships the runtime always rewrites for the second
 * reason. Deleting the folder always rewrites, because the folder's
 * `modinfo.lua` is read back and compared too.
 *
 * Clearing the stamp blanks `hash` and keeps `units`. A blank hash matches
 * nothing, so the folder is rewritten, and the units are what the next write
 * removes if they have left the set (issue #4521).
 */
interface MutatorStamp {
  hash: string;
  dir: string;
  name: string;
  units: WrittenUnit[];
}

function stampPath(dataDir: string, folder: string): string {
  return `${dataDir}/games/${folder}.stamp`;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The units a folder was last written with, as far as its stamp says, whether
 * or not the stamp still matches anything. Empty when there is no readable
 * stamp, and a unit recorded without its name is left out: nothing says which
 * files are its own.
 */
async function recordedUnits(
  dataDir: string,
  folder: string,
): Promise<WrittenUnit[]> {
  try {
    const { text } = await legoReadTextFile({
      path: stampPath(dataDir, folder),
    });
    const stamp = JSON.parse(text) as Partial<MutatorStamp> | null;
    if (!stamp || !Array.isArray(stamp.units)) return [];
    return stamp.units.filter(
      (unit): unit is WrittenUnit =>
        typeof unit?.unitName === "string" &&
        Array.isArray(unit.files) &&
        Array.isArray(unit.textureFiles),
    );
  } catch {
    return [];
  }
}

/**
 * Write a stamp that matches no launch but still names these units, so the next
 * write can remove them if they have left the set.
 */
async function writeUnmatchedStamp(
  dataDir: string,
  folder: string,
  dir: string,
  units: WrittenUnit[],
): Promise<void> {
  const record: MutatorStamp = { hash: "", dir, name: "", units };
  await legoWriteTextFile({
    path: stampPath(dataDir, folder),
    text: JSON.stringify(record),
  });
}

/**
 * Forget what the folder was last written as. Anything that changes the folder
 * without going through `writeMutator` has to call this first, or a later launch
 * could find a stamp that matches and skip a folder that has since changed.
 * The units the stamp named are kept, for the next write to prune.
 */
export async function clearStamp(
  dataDir: string,
  folder: string,
): Promise<void> {
  const units = await recordedUnits(dataDir, folder);
  await writeUnmatchedStamp(dataDir, folder, "", units);
}

/** The stamp, if there is a readable one and the folder is still there. */
async function readStamp(
  dataDir: string,
  folder: string,
  modinfo: string,
): Promise<MutatorStamp | null> {
  try {
    const { text } = await legoReadTextFile({
      path: stampPath(dataDir, folder),
    });
    const stamp = JSON.parse(text) as Partial<MutatorStamp> | null;
    if (
      !stamp ||
      typeof stamp.hash !== "string" ||
      typeof stamp.dir !== "string" ||
      typeof stamp.name !== "string" ||
      !Array.isArray(stamp.units)
    ) {
      return null;
    }
    const onDisk = await legoReadTextFile({
      path: `${dataDir}/games/${folder}/modinfo.lua`,
    });
    return onDisk.text === modinfo ? (stamp as MutatorStamp) : null;
  } catch {
    // No stamp, an unreadable one, or a folder that has gone: write it all.
    return null;
  }
}

/** The scanned name of the game whose archive is this folder, if unitsync has it. */
async function rescannedName(
  target: PlayTarget,
  folder: string,
): Promise<string | null> {
  // The engine takes its game list from the same archive cache unitsync
  // writes, so a forced rescan both registers the folder and tells us the
  // name a start script has to ask for.
  const rescanned = await primeScan(target.enginePath, target.dataDir, true);
  const found = rescanned.games.find(
    (g) => g.primaryArchive.name.toLowerCase() === folder,
  );
  return found?.name ?? null;
}

/**
 * Write the mutator folder with its units and have unitsync find it, unless it
 * already holds exactly this. Answers the name a start script has to ask for.
 * Throws with a reason a person can act on.
 */
export async function writeMutator(args: MutatorArgs): Promise<MutatorResult> {
  const { folder, units, extras, onWritten, onScanning, ...context } = args;
  const { target, baseGame } = context;

  const prepared = [];
  for (const unit of units) prepared.push(await prepareUnit(context, unit));
  const files = await folderFiles({ ...context, folder, extras });

  const hash = await sha256(
    JSON.stringify({ files, units: prepared.map((p) => p.payload) }),
  );
  const rewrites = extras?.sandbox?.shipRuntime === true;
  const stamp = rewrites
    ? null
    : await readStamp(target.dataDir, folder, files.modinfo);
  if (stamp && stamp.hash === hash) {
    onWritten?.(stamp.dir);
    return {
      dir: stamp.dir,
      name: stamp.name,
      skipped: true,
      units: stamp.units,
    };
  }

  const earlier = await recordedUnits(target.dataDir, folder);
  await clearStamp(target.dataDir, folder);
  const { dir } = await legoScratchGame(files);
  onWritten?.(dir);

  // Units the last write made that this one does not, and the textures nothing
  // in this set uses any more. Pruned before anything new goes in, and the
  // stamp keeps naming what is still on disk, so a launch that fails part way
  // is still cleaned up after by the next.
  const names = new Set(prepared.map((p) => p.payload.unitName));
  const leaving = earlier.filter((unit) => !names.has(unit.unitName));
  const usedTextures = new Set(prepared.flatMap((p) => p.textureFiles));
  const textures = [
    ...new Set(earlier.flatMap((unit) => unit.textureFiles)),
  ].filter((texture) => !usedTextures.has(texture));
  if (leaving.length > 0 || textures.length > 0) {
    await legoScratchPrune({
      dataDir: target.dataDir,
      folder,
      units: leaving.map((unit) => ({
        unitName: unit.unitName,
        digests: unit.files.map((file) => file.sha256),
      })),
      textures,
    });
  }
  const written: WrittenUnit[] = [];
  const onDisk = () => {
    const done = new Set(written.map((unit) => unit.unitName));
    return [
      ...earlier.filter(
        (unit) => names.has(unit.unitName) && !done.has(unit.unitName),
      ),
      ...written,
    ];
  };
  await writeUnmatchedStamp(target.dataDir, folder, dir, onDisk());
  for (const one of prepared) {
    written.push(await exportPrepared(dir, one));
    await writeUnmatchedStamp(target.dataDir, folder, dir, onDisk());
  }

  onScanning?.();
  const name = await rescannedName(target, folder);
  if (!name) {
    throw new Error(
      `The engine did not pick up ${folder}. Check that ${baseGame} is still installed.`,
    );
  }
  const record: MutatorStamp = { hash, dir, name, units: written };
  await legoWriteTextFile({
    path: stampPath(target.dataDir, folder),
    text: JSON.stringify(record),
  });
  return { dir, name, skipped: false, units: written };
}
