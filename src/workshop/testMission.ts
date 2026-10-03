/**
 * "Start with this unit on the map" on the Test drawer (issue #3178).
 *
 * A test of an edited unit used to start a skirmish with the project loaded and
 * leave the player to build the unit before they could see it. This generates a
 * throwaway scenario in memory that places the edited unit, and the game's own
 * version of it beside it (`baseCopyName`, issue #3177), for the player's side.
 * The mission runtime places them in the game's first frame and the scenario is
 * never saved, so nothing appears in the scenario editor or its list.
 *
 * The game needs the runtime and the mission in its archive. Most games bundle
 * neither, so both go into the test game the workshop already writes
 * (`WORKSHOP_MUTATOR_FOLDER`), which is rewritten on every test and never
 * packaged. `workshopTestMission` does the writing.
 */
import type { GameItem } from "../content/bindings";
import { isSdd } from "../content/format";
import { WORKSHOP_MUTATOR_FOLDER } from "../lib/generatedGames";
import type { Participant } from "../play/participants";
import { compileScenario, luaString } from "../scenario/compile";
import { newScenario } from "../scenario/create";
import {
  installedRuntime,
  MISSION_MODOPTION,
  missionIssueMessage,
} from "../scenario/launch";
import type { Scenario } from "../scenario/model";
import { isBlocking, validateCompiledMissionText } from "../scenario/validate";
import { baseCopyName } from "./compile";
import { workshopTestMission } from "./mutator";

/**
 * The generated mission's folder in the test game. Fixed, so a test rewrites the
 * one mission and leaves no trail, and `[A-Za-z0-9-]+` as the writer requires.
 */
export const TEST_MISSION_ID = "coilbox-workshop-test";

/**
 * What each side of the bank starts with, in the player's bank. The runtime
 * empties every mission team's bank at game frame 1 unless the scenario sets
 * one, and an energy weapon cannot fire from an empty bank. A chosen value, not
 * a measured one: the engine clamps a bank to the team's storage, so a larger
 * number only means "full".
 */
const TEST_BANK = 10000;

/** Random start position, as the Test drawer already launches with. */
const START_POS_RANDOM = 1;

/** The unit a test is about. */
export interface TestUnit {
  /** The unit's internal name, as the game and the project spell it. */
  key: string;
  /** What to call it in the drawer. */
  label: string;
  /**
   * Whether the game has its own version of this unit. A copy of a unit the
   * project added has nothing to copy, so only the unit itself is placed.
   */
  inGame: boolean;
}

/**
 * The scenario that places `unit` for the player's side.
 *
 * Only the player's side is given a team entry. The AI's is left out so it
 * keeps its commander: Beyond All Reason ends a team that has no units at game
 * start, and the engine then refuses every unit placed for it.
 */
export function buildTestScenario(opts: {
  unit: TestUnit;
  gameName: string;
  mapName: string;
  participants: Participant[];
}): Scenario {
  const { unit, gameName, mapName, participants } = opts;
  const player = participants.find((p) => p.kind === "you" && !p.spectator);
  const scenario = newScenario(`Test ${unit.label}`);
  return {
    ...scenario,
    id: TEST_MISSION_ID,
    setup: {
      participants,
      gameName,
      mapName,
      startPosType: START_POS_RANDOM,
      modOptionValues: {},
    },
    teams: player
      ? {
          [player.id]: {
            startUnits: unit.inGame
              ? [unit.key, baseCopyName(unit.key)]
              : [unit.key],
            resources: { metal: TEST_BANK, energy: TEST_BANK },
          },
        }
      : {},
  };
}

/** The mod option that turns the game into the mission, for the start script. */
export function testMissionModOptions(): Record<string, string> {
  return { [MISSION_MODOPTION]: TEST_MISSION_ID };
}

/**
 * The test game's `modinfo.lua` for the tweak slot route, which has no compiled
 * project to take one from. `modtype = 1` is what makes it a game a start script
 * can name, and the one `depend` entry is the name unitsync reports for the base
 * game.
 */
export function buildTestGameModInfo(
  baseGame: string,
  unitLabel: string,
): string {
  const name = "Coilbox workshop test";
  const lines = [
    "-- The game coilbox tests a workshop project in.",
    `-- Rewritten on every test launch. Delete ${WORKSHOP_MUTATOR_FOLDER} to undo it.`,
    "",
    "return {",
    `  name = ${luaString(name)},`,
    '  shortname = "coilbox_workshop_test",',
    `  game = ${luaString(name)},`,
    '  version = "test",',
    `  description = ${luaString(`Testing ${unitLabel} on top of ${baseGame}.`)},`,
    "  modtype = 1,",
    "  depend = {",
    `    ${luaString(baseGame)},`,
    "  },",
    "}",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Compile the scenario, check it, and write it into the test game.
 *
 * A mission that does not validate is refused before anything is written, since
 * the engine's answer to a bad mission is silence. The runtime is shipped unless
 * the base game already bundles one at least as new as the mission needs, and
 * then only the mission goes in, so the generated game does not shadow the
 * game's own runtime with a second.
 *
 * `modinfo` is the tweak slot route's: with it the test game is started afresh,
 * without it the mutator route's compiled files are added to.
 *
 * Every failure is thrown for the drawer to show.
 */
export async function writeStartWithUnit(opts: {
  dataDir: string;
  game: GameItem;
  scenario: Scenario;
  modinfo?: string;
}): Promise<{ dir: string }> {
  const { dataDir, game, scenario, modinfo } = opts;
  const mission = compileScenario(scenario);
  // The unit list is left out on purpose: the copy is not in the game's own list.
  const blocking = (await validateCompiledMissionText(mission)).filter(
    isBlocking,
  );
  if (blocking.length > 0) {
    throw new Error(missionIssueMessage("author", blocking));
  }
  const root = game.primaryArchive.path;
  const installed = root
    ? await installedRuntime(root, isSdd(game.primaryArchive))
    : null;
  const written = await workshopTestMission({
    dataDir,
    missionId: scenario.id,
    mission,
    ...(modinfo === undefined ? {} : { modinfo }),
    shipRuntime: installed === null || installed < scenario.runtimeVersion,
  });
  return { dir: written.dir };
}
