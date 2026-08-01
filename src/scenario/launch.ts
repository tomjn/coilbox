/**
 * Putting a scenario in front of the engine.
 *
 * A scenario is a skirmish the mission runtime takes over, so launching one is
 * the ordinary skirmish launch plus two things:
 *
 * - the compiled mission written where the game will look for it, and
 * - `coilbox_mission = <scenario id>` in the start script's modoptions, which is
 *   the only signal the runtime's gadget has. Without it the gadget returns
 *   false and the game plays normally.
 *
 * Where the mission is written depends on the game. One that has vendored the
 * runtime gets it in its own `missions/` folder and is launched as itself. One
 * that has not, including any packaged `.sd7`/`.sdz`, which cannot be written
 * into at all, is played through the generated test mutator. That brings
 * coilbox's runtime and depends on the game for everything else. See
 * {@link scenarioRoute}.
 *
 * Either way the mission is compiled, written and read back before the engine is
 * started, and a scenario that does not validate is not launched. The engine's
 * answer to a bad id is silence, so the refusal has to come first.
 */

import type { GameItem } from "../content/bindings";
import { isSdd } from "../content/format";
import type { BattleConfig } from "../play/bindings";
import { toBattleConfig } from "../play/participants";
import { scenarioRuntimeStatus, scenarioWriteMission } from "./bindings";
import { compileScenario, missionPath } from "./compile";
import type { Scenario } from "./model";
import { isMutatorArchive, writeTestMutator } from "./mutator";
import { packagedArchiveReason } from "./offer";
import {
  describeIssue,
  type MissionIssue,
  validateCompiledMission,
} from "./validate";

/**
 * The modoption that turns a game into a mission. Its value is the scenario id,
 * which is the folder the runtime includes the compiled mission from.
 */
export const MISSION_MODOPTION = "coilbox_mission";

/** How a scenario reaches the engine. */
export type ScenarioRoute = "adopted" | "mutator";

/** The route a game gives a scenario, and why. */
export interface RouteChoice {
  route: ScenarioRoute;
  /** Why this route, in a sentence a player can act on. */
  reason: string;
}

/**
 * Which route a game gives a scenario.
 *
 * The adopted route is the real one. The game vendors the runtime, the mission
 * goes in its own `missions/` folder, and the start script names the game
 * itself. Everything else falls back to the test mutator, which is a test route
 * and never a distribution one.
 *
 * `installed` is the runtime version the game vendors, or null when it has none.
 * A game whose runtime is older than the scenario needs would ignore the
 * triggers it does not know and play a quietly broken mission, so it is treated
 * the same as a game with no runtime at all.
 */
export function scenarioRoute(opts: {
  game: GameItem;
  installed: number | null;
  /** The lowest runtime version that can play the scenario. */
  required: number;
}): RouteChoice {
  const { game, installed, required } = opts;
  const mutator = (reason: string): RouteChoice => ({
    route: "mutator",
    reason,
  });

  if (!isSdd(game.primaryArchive) || !game.primaryArchive.path) {
    return mutator(packagedArchiveReason(game.name));
  }
  if (installed === null) {
    return mutator(
      `${game.name} has not adopted coilbox's mission runtime, so it cannot play a scenario itself. The scenario is played through the test mutator instead.`,
    );
  }
  if (installed < required) {
    return mutator(
      `${game.name} vendors mission runtime version ${installed}, and this scenario needs version ${required}. The scenario is played through the test mutator instead.`,
    );
  }
  return {
    route: "adopted",
    reason: `${game.name} vendors mission runtime version ${installed}, so it plays the scenario itself.`,
  };
}

/** The lead-in to a refusal: how much is wrong, and that nothing was played. */
export function missionIssueSummary(issues: MissionIssue[]): string {
  return `The compiled mission has ${issues.length} problem${issues.length === 1 ? "" : "s"}, so it was not launched.`;
}

/**
 * What a refusal says when the compiled mission did not validate, in one line.
 * A caller with room for the whole list shows {@link missionIssueSummary} over
 * every issue instead.
 */
export function missionIssueMessage(issues: MissionIssue[]): string {
  const [first] = issues;
  if (!first) return "";
  const more = issues.length - 1;
  return `${missionIssueSummary(issues)} ${describeIssue(first)}${more > 0 ? ` (and ${more} more)` : ""}`;
}

/**
 * Why a scenario cannot be put in front of the engine at all, before any of it
 * is compiled. Null when it can be tried.
 *
 * This is the button's own reason for being disabled, so it is the things the
 * author has to go and fix elsewhere: no engine, no setup, a game they have not
 * installed, a game already running. Everything wrong *inside* the scenario is
 * {@link launchScenario}'s answer, because it takes compiling to find out.
 *
 * `games` is null until the content scan has answered, which is not a blocker:
 * a scenario is not stopped from being tested because a read is in flight.
 */
export function scenarioLaunchBlocker(opts: {
  scenario: Scenario;
  hasEngine: boolean;
  games: GameItem[] | null;
  running: boolean;
}): string | null {
  const { scenario, hasEngine, games, running } = opts;
  const { gameName, mapName } = scenario.setup;
  if (!hasEngine) {
    return "No engine is installed. Add one from Content before testing a scenario.";
  }
  if (!gameName || !mapName) {
    return "This scenario has no game and map yet. Set it up from a preset first.";
  }
  if (games && !games.some((g) => g.name === gameName)) {
    return `${gameName} is not installed. Install it from Content, or set the scenario up on a game you have.`;
  }
  if (running) return "A game is already running.";
  return null;
}

export interface ScenarioLaunchInput {
  scenario: Scenario;
  /** The content root the engine is run against. */
  dataDir: string;
  /** The installed games, from the current content scan. */
  games: GameItem[];
  /**
   * Force a fresh unitsync scan and hand back the games it found. The engine
   * takes its game list from the same archive cache unitsync writes, so a
   * generated mutator is only launchable once one has run.
   */
  rescan: () => Promise<GameItem[]>;
  /** Start the engine. Called only once the mission has validated. */
  launch: (config: BattleConfig) => Promise<{ exitCode: number | null }>;
  /**
   * Units to forbid outright, as the engine `[RESTRICT]` block. A campaign
   * mission's own restriction list, which is authored around the scenario
   * rather than inside it. Distinct from the scenario's `restrictions`, which
   * the runtime enforces and can lift mid-mission.
   */
  disabledUnits?: string[];
}

export type ScenarioLaunchResult =
  | {
      ok: true;
      route: ScenarioRoute;
      /** Why that route, worth showing beside the launch. */
      reason: string;
      /** The game folder the engine loads the mission out of. */
      dir: string;
      /** The compiled mission's path inside that folder. */
      mission: string;
      /** The game name the start script asks for. */
      gameType: string;
      config: BattleConfig;
      exitCode: number | null;
    }
  | { ok: false; message: string; issues: MissionIssue[] };

const refuse = (
  message: string,
  issues: MissionIssue[] = [],
): ScenarioLaunchResult => ({ ok: false, message, issues });

/** A game's vendored runtime version, or null when it has none to read. */
async function installedRuntime(root: string): Promise<number | null> {
  try {
    const { installed } = await scenarioRuntimeStatus({ root });
    return installed ? installed.version : null;
  } catch {
    return null;
  }
}

/**
 * Compile a scenario into a game that has adopted the runtime, then read it back
 * out. The same three steps the test mutator takes, against the game's own
 * folder: compile, write, validate.
 */
async function writeIntoGame(
  root: string,
  scenario: Scenario,
): Promise<{ mission: string; issues: MissionIssue[] }> {
  await scenarioWriteMission({
    root,
    scenarioId: scenario.id,
    mission: compileScenario(scenario),
  });
  return {
    mission: missionPath(scenario.id),
    issues: await validateCompiledMission(root, scenario.id),
  };
}

/**
 * Compile, write, validate, then launch. The engine is started only on a clean
 * validation. Everything else comes back as a refusal with a message rather than
 * a thrown error, because every one of them is something the author has to be
 * told about.
 */
export async function launchScenario(
  input: ScenarioLaunchInput,
): Promise<ScenarioLaunchResult> {
  const { scenario, dataDir, games, rescan, launch, disabledUnits } = input;
  const wanted = scenario.setup.gameName;
  const game = games.find((g) => g.name === wanted);
  if (!game) {
    return refuse(
      `This scenario is set in ${wanted || "no game"}, which is not installed. Install it from Content, or point the scenario at a game you have.`,
    );
  }

  const root = game.primaryArchive.path;
  const installed =
    isSdd(game.primaryArchive) && root ? await installedRuntime(root) : null;
  const { route, reason } = scenarioRoute({
    game,
    installed,
    required: scenario.runtimeVersion,
  });

  // Only the adopted route has a folder to write into, and `scenarioRoute` only
  // picks it when the game has one.
  const adopted = route === "adopted" ? root : undefined;

  let dir: string;
  let written: { mission: string; issues: MissionIssue[] };

  if (adopted) {
    dir = adopted;
    written = await writeIntoGame(adopted, scenario);
  } else {
    const mutator = await writeTestMutator(dataDir, scenario);
    dir = mutator.dir;
    written = { mission: missionPath(scenario.id), issues: mutator.issues };
    if (mutator.version < scenario.runtimeVersion) {
      return refuse(
        `This scenario needs mission runtime version ${scenario.runtimeVersion}, and this build of coilbox ships version ${mutator.version}. Update coilbox to play it.`,
      );
    }
  }

  if (written.issues.length > 0) {
    return refuse(missionIssueMessage(written.issues), written.issues);
  }

  // An adopted game plays the scenario as itself. The mutator has to be found
  // first: the engine reads its game list from the archive cache unitsync
  // writes, so a forced rescan both registers the generated game and tells us
  // the name a start script has to ask for.
  let gameType = game.name;
  if (!adopted) {
    const found = (await rescan()).find((g) =>
      isMutatorArchive(g.primaryArchive.name),
    );
    if (!found) {
      return refuse(
        `The engine did not pick up coilbox's test mutator. Check that ${game.name} is still installed.`,
      );
    }
    gameType = found.name;
  }

  const config = toBattleConfig({
    participants: scenario.setup.participants,
    mapName: scenario.setup.mapName,
    gameType,
    startPosType: scenario.setup.startPosType,
    disabledUnits,
    modOptions: {
      ...scenario.setup.modOptionValues,
      [MISSION_MODOPTION]: scenario.id,
    },
  });
  const { exitCode } = await launch(config);
  return {
    ok: true,
    route,
    reason,
    dir,
    mission: written.mission,
    gameType,
    config,
    exitCode,
  };
}
