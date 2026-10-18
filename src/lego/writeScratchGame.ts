/**
 * Put the unit into coilbox's scratch game and have unitsync find it, which is
 * the first half of both Test in game and the load check.
 *
 * The writing itself is `./mutator`, which any other mode that launches built
 * units shares. This is the Test drawer's side of it: one unit, the fixed
 * `coilbox-lego-test.sdd`, and the start unit and sandbox it adds.
 */

import { SCRATCH_FOLDER } from "@/lib/generatedGames";
import type { PlayTarget } from "@/play/config";
import type { ModProject } from "@/workshop/project";

import { legoScratchGame, type ScratchSandbox } from "./bindings";
import type { LegoProject } from "./model";
import type { GameMovementData } from "./movement";
import {
  buildListFor,
  builtByOf,
  clearStamp,
  exportPrepared,
  folderFiles,
  type MutatorExtras,
  prepareUnit,
  type WrittenUnit,
  writeMutator,
} from "./mutator";
import type { LoadedPack } from "./pack";
import type { RawGeometry } from "./rawGeometry";
import { buildSideData, buildStartUnitGadget } from "./scratchGame";

export interface ScratchGameArgs {
  target: PlayTarget;
  /** The base game's name, as unitsync reports it. */
  baseGame: string;
  /** The base game's archive, which unitsync is asked about its files by. */
  baseArchive: string;
  project: LegoProject;
  pack: LoadedPack;
  raw: RawGeometry | null;
  /** The workshop's projects, where a library weapon is read from. */
  workshopProjects: readonly ModProject[];
  /**
   * The test game's weapon table, null until it is read. A game weapon the
   * unit names that is not in it is left out of the scratch unit.
   */
  gameWeapons: Record<string, Record<string, unknown>> | null;
  /**
   * The test game's units and move definitions, null until they are read. A
   * unit built to move with no movement of its own takes a class from them.
   */
  gameMovement: GameMovementData | null;
  /** The sandbox's files, for "Play with this unit". Absent for a plain test. */
  sandbox?: ScratchSandbox;
  /** Told when the write is done and the rescan starts. */
  onScanning?: () => void;
  /** Told the scratch game's folder as soon as it exists. */
  onWritten?: (dir: string) => void;
}

/**
 * What writing the unit into the scratch game put on disk, and the builders
 * left off its build list.
 */
export type WrittenScratchUnit = WrittenUnit & { buildListLeftOut: string[] };

/** The start unit and sandbox the Test drawer adds to its scratch game. */
function testExtras(unitName: string, sandbox?: ScratchSandbox): MutatorExtras {
  return {
    startUnit: {
      sidedata: buildSideData(unitName),
      gadget: buildStartUnitGadget(unitName),
    },
    ...(sandbox ? { sandbox } : {}),
  };
}

/**
 * Write the scratch game and the unit into it, then rescan. Answers the name a
 * start script has to ask for the scratch game by. Throws with a reason a
 * person can act on.
 */
export async function writeScratchGame({
  project,
  pack,
  raw,
  sandbox,
  onScanning,
  onWritten,
  ...context
}: ScratchGameArgs): Promise<WrittenScratchUnit & { name: string }> {
  const result = await writeMutator({
    ...context,
    folder: SCRATCH_FOLDER,
    units: [{ project, pack, raw }],
    extras: testExtras(project.unitName, sandbox),
    onScanning,
    onWritten,
  });
  return {
    ...result.units[0],
    name: result.name,
    buildListLeftOut: result.buildListLeftOut,
  };
}

/**
 * Write the scratch game and the unit into it, with no rescan. A game already
 * running from the scratch game reads the files again from here, which is what
 * the sandbox's reload needs (issue #3346).
 */
export async function writeScratchUnit({
  project,
  pack,
  raw,
  sandbox,
  onWritten,
  onScanning: _onScanning,
  ...context
}: ScratchGameArgs): Promise<WrittenScratchUnit> {
  const prepared = await prepareUnit(context, { project, pack, raw });
  const { buildList, leftOut } = await buildListFor(
    context,
    builtByOf([{ project, pack, raw }]),
  );
  await clearStamp(context.target.dataDir, SCRATCH_FOLDER);
  const { dir } = await legoScratchGame(
    await folderFiles({
      ...context,
      folder: SCRATCH_FOLDER,
      extras: testExtras(project.unitName, sandbox),
      buildList,
    }),
  );
  onWritten?.(dir);
  return {
    ...(await exportPrepared(dir, prepared)),
    buildListLeftOut: leftOut,
  };
}
