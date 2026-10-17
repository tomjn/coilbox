/**
 * Put the unit into coilbox's scratch game and have unitsync find it, which is
 * the first half of both Test in game and the load check.
 */

import { primeScan } from "@/content/config";
import { isScratchArchive, SCRATCH_FOLDER } from "@/lib/generatedGames";
import type { PlayTarget } from "@/play/config";

import { exportTextureName, unitAtlas } from "./atlas";
import { legoExport, legoScratchGame, type ScratchSandbox } from "./bindings";
import { unitScript } from "./luaScript";
import type { ExportedFile, LegoProject } from "./model";
import type { LoadedPack } from "./pack";
import { buildPieceCollisionScript } from "./pieceCollisionScript";
import type { RawGeometry } from "./rawGeometry";
import { importedTextures } from "./rawImport";
import { bakedPieces, buildS3o, unitBounds } from "./s3oBuild";
import {
  buildModInfo,
  buildSideData,
  buildStartUnitGadget,
  buildUnitScriptGadget,
} from "./scratchGame";
import { buildUnitDef } from "./unitDef";
import { worthTotals } from "./worth";

export interface ScratchGameArgs {
  target: PlayTarget;
  /** The base game's name, as unitsync reports it. */
  baseGame: string;
  project: LegoProject;
  pack: LoadedPack;
  raw: RawGeometry | null;
  /** The sandbox's files, for "Play with this unit". Absent for a plain test. */
  sandbox?: ScratchSandbox;
  /** Told when the write is done and the rescan starts. */
  onScanning?: () => void;
  /** Told the scratch game's folder as soon as it exists. */
  onWritten?: (dir: string) => void;
}

/** What writing the unit into the scratch game put on disk. */
export interface WrittenScratchUnit {
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
}

/**
 * Write the scratch game and the unit into it, then rescan. Answers the name a
 * start script has to ask for the scratch game by. Throws with a reason a
 * person can act on.
 */
export async function writeScratchGame(
  args: ScratchGameArgs,
): Promise<WrittenScratchUnit & { name: string }> {
  const written = await writeScratchUnit(args);

  // The engine takes its game list from the same archive cache unitsync
  // writes, so a forced rescan both registers the scratch game and tells us
  // the name a start script has to ask for.
  args.onScanning?.();
  const { target, baseGame } = args;
  const rescanned = await primeScan(target.enginePath, target.dataDir, true);
  const scratch = rescanned.games.find((g) =>
    isScratchArchive(g.primaryArchive.name),
  );
  if (!scratch) {
    throw new Error(
      `The engine did not pick up ${SCRATCH_FOLDER}. Check that ${baseGame} is still installed.`,
    );
  }
  return { ...written, name: scratch.name };
}

/**
 * Write the scratch game and the unit into it, with no rescan. A game already
 * running from the scratch game reads the files again from here, which is what
 * the sandbox's reload needs (issue #3346).
 */
export async function writeScratchUnit({
  target,
  baseGame,
  project,
  pack,
  raw,
  sandbox,
  onWritten,
}: ScratchGameArgs): Promise<WrittenScratchUnit> {
  // An imported unit draws with its own two textures out of the store. A
  // built one samples one atlas, and only its own: an s3o names one texture.
  // A unit whose atlas is not installed still tests, untextured, rather than
  // failing on a file that cannot be copied.
  const atlas = unitAtlas(project, pack.library.atlases);
  const written = exportTextureName(atlas.texture);
  const imported = project.imported ? importedTextures(project.imported) : null;
  const model = buildS3o(project, pack, raw, {
    texture1: imported ? imported.texture1 : written,
    texture2: imported?.texture2,
  });
  if (!model) throw new Error("This unit has no root piece.");

  const { dir } = await legoScratchGame({
    dataDir: target.dataDir,
    folder: SCRATCH_FOLDER,
    modinfo: buildModInfo(baseGame),
    sidedata: buildSideData(project.unitName),
    gadget: buildStartUnitGadget(project.unitName),
    unitScriptGadget: buildUnitScriptGadget(),
    ...(sandbox ? { sandbox } : {}),
  });
  onWritten?.(dir);
  const textures = {
    atlas:
      !imported && atlas.installed
        ? {
            name: atlas.texture,
            pack: atlas.installed.folder,
            writeAs: written,
          }
        : null,
    stored: imported?.place ?? [],
  };
  const { owned } = await legoExport({
    dir,
    unitName: project.unitName,
    textures,
    // The scratch game always rewrites regardless (see `is_scratch_dir`),
    // so this has no effect here: the drawer's own checkbox is the only
    // thing that reads it for a real export.
    overwriteTexture: false,
    script: unitScript(project),
    pieceCollision: buildPieceCollisionScript(
      project,
      bakedPieces(project, pack, raw).pieces,
    ),
    // Measured rather than taken off the build: a build's `mid` is the
    // header's, which is the aim point, and the definition is derived from
    // the bounding box.
    // A definition home, always. The scratch game is coilbox's own, built
    // fresh here, and it has no localisation file to read a name out of.
    unitDef: buildUnitDef(
      project,
      unitBounds(project, pack, raw),
      "def",
      worthTotals(project, pack),
    ),
    text: null,
    model,
  });

  const textureFiles = [
    ...(textures.atlas ? [textures.atlas.writeAs] : []),
    ...textures.stored.map((stored) => stored.writeAs),
  ];
  return {
    dir,
    files: owned,
    textures: JSON.stringify(textures),
    textureFiles,
  };
}
