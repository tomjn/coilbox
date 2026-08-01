/**
 * The test mutator: the game a scenario is tested in when the real one cannot
 * play it.
 *
 * Playing a scenario means the game vendors coilbox's mission runtime, and most
 * do not. A packaged `.sd7`/`.sdz` cannot even be written into. So coilbox
 * writes a game of its own, `coilbox-mission-test.sdd`, which depends on the
 * game being tested against and carries the runtime plus the one compiled
 * scenario. The base game supplies the units, the sides and everything else.
 *
 * It is a test route and never a distribution one. Nothing outside that one
 * folder is written, so deleting it undoes everything this flow ever did, which
 * is lego's scratch game arrangement (`src/lego/scratchGame.ts`) applied to
 * missions rather than units.
 */

import { scenarioTestMutator } from "./bindings";
import { compileScenario, luaString } from "./compile";
import type { Scenario } from "./model";
import {
  type MapExtent,
  type MissionIssue,
  validateCompiledMission,
} from "./validate";

/**
 * The mutator's folder name, matching the constant the plugin writes to. Held
 * here as well because the frontend has to recognise the generated game in a
 * content scan: as a game it comes back in every scan, and offering it as a
 * base to test against would nest it inside itself.
 */
export const MUTATOR_FOLDER = "coilbox-mission-test.sdd";

/** What the archive calls itself. The engine appends the version to this. */
const MUTATOR_NAME = "Coilbox mission test";

/** Rewritten on every test launch, so it carries no state worth versioning. */
const MUTATOR_VERSION = "test";

/**
 * The mutator's `modinfo.lua`.
 *
 * `modtype = 1` is what makes it a game the engine can be launched with.
 * Anything lower and it would never be offered as a start-script `GameType`.
 * The single `depend` entry is the name unitsync reports for the base game,
 * which is the same string a start script names, so the two cannot drift apart.
 */
export function buildMutatorModInfo(
  baseGame: string,
  scenarioName: string,
): string {
  const lines = [
    "-- The game coilbox tests a scenario in.",
    "-- Rewritten on every test launch. Delete this folder to undo it.",
    "",
    "return {",
    `  name = ${luaString(MUTATOR_NAME)},`,
    '  shortname = "coilbox_mission_test",',
    `  game = ${luaString(MUTATOR_NAME)},`,
    `  version = ${luaString(MUTATOR_VERSION)},`,
    `  description = ${luaString(`Testing ${scenarioName} on top of ${baseGame}.`)},`,
    "  modtype = 1,",
    "  depend = {",
    `    ${luaString(baseGame)},`,
    "  },",
    "}",
  ];
  return `${lines.join("\n")}\n`;
}

/** Whether a scanned archive is the test mutator, by its archive file name. */
export function isMutatorArchive(archiveName: string): boolean {
  return archiveName.toLowerCase() === MUTATOR_FOLDER;
}

/** What was written, and whether the engine may be shown it. */
export interface TestMutator {
  /** The generated game's folder, for revealing it or reading it back. */
  dir: string;
  /** The runtime version the generated game reports, read back out of it. */
  version: number;
  /** The compiled mission's path inside the archive. */
  mission: string;
  /**
   * What is wrong with the compiled mission, read back through the same
   * `VFS.Include` the runtime's gadget uses. Empty means it can be launched.
   */
  issues: MissionIssue[];
}

/**
 * Compile a scenario into a freshly generated test mutator, then read the
 * mission back out of it.
 *
 * Compile, write, validate, in that order and always all three. The validator
 * runs against the file on disk rather than against the document, so what it
 * reports is the engine's own view of what was written. A caller launches only
 * when `issues` is empty.
 *
 * `dataDir` is the content root the engine will be run against, because the
 * mutator has to land in the `games/` folder that engine scans.
 */
export async function writeTestMutator(
  dataDir: string,
  scenario: Scenario,
  map?: MapExtent,
): Promise<TestMutator> {
  const result = await scenarioTestMutator({
    dataDir,
    scenarioId: scenario.id,
    modinfo: buildMutatorModInfo(scenario.setup.gameName, scenario.name),
    mission: compileScenario(scenario),
  });
  return {
    dir: result.dir,
    version: result.installed.version,
    mission: `${MUTATOR_FOLDER}/missions/${scenario.id}/mission.lua`,
    issues: await validateCompiledMission(result.dir, scenario.id, map),
  };
}
