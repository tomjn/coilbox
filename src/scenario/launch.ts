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
 * that has not is played through the generated test mutator, which brings
 * coilbox's runtime and depends on the game for everything else. A game that
 * ships the mission in its own archive is launched as itself and normally has
 * nothing written into it, which is the one route a packaged `.sd7`/`.sdz` can
 * take, since it cannot be written into. The exception is a loose game whose
 * shipped mission no longer matches the document beside it, which is recompiled
 * in place before it plays. See {@link scenarioRoute} and `drift.ts`.
 *
 * Either way the mission is compiled, written and read back before the engine is
 * started, and a scenario that does not validate is not launched. The engine's
 * answer to a bad id is silence, so the refusal has to come first.
 */

import type { ConfigOption, GameItem } from "../content/bindings";
import { isSdd } from "../content/format";
import { isMutatorArchive } from "../lib/generatedGames";
import type { BattleConfig } from "../play/bindings";
import { applyRestrictions, toBattleConfig } from "../play/participants";
import {
  scenarioGameMissionFile,
  scenarioGameRuntime,
  scenarioRuntimeStatus,
  scenarioWriteGameMission,
  scenarioWriteMission,
} from "./bindings";
import { compileScenario, missionPath } from "./compile";
import { missionDrifted } from "./drift";
import type { Scenario } from "./model";
import { writeTestMutator } from "./mutator";
import type { GameOrigin } from "./storage";
import {
  describeIssue,
  isBlocking,
  type MapExtent,
  type MissionIssue,
  validateCompiledMission,
  validateCompiledMissionText,
} from "./validate";
import {
  adoptedGameRoute,
  coilboxTooOld,
  gameNotInstalled,
  gameOwnMissionRoute,
  missionDriftedFromDocument,
  missionProblems,
  olderRuntimeRoute,
  packagedGameRoute,
  type ScenarioReader,
  setupNotFound,
  unadoptedGameRoute,
} from "./wording";

/**
 * The modoption that turns a game into a mission. Its value is the folder the
 * runtime includes the compiled mission from: the scenario id for a mission
 * coilbox wrote, and the game's own folder name for one the game ships.
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
 *
 * `missionInGame` is the game already carrying this mission in its own archive,
 * which is the one case a packaged `.sd7`/`.sdz` can be adopted in: there is
 * nothing for coilbox to write, so being unwritable does not matter (issue
 * #2160). It defaults to false, which is a caller saying "coilbox would have to
 * write this one".
 *
 * `reader` decides how much of that a sentence says: see `wording.ts`.
 */
export function scenarioRoute(opts: {
  game: GameItem;
  installed: number | null;
  /** The lowest runtime version that can play the scenario. */
  required: number;
  reader: ScenarioReader;
  /** True when the game already ships this mission. See above. */
  missionInGame?: boolean;
}): RouteChoice {
  const { game, installed, required, reader, missionInGame } = opts;
  const mutator = (reason: string): RouteChoice => ({
    route: "mutator",
    reason,
  });

  // The runtime question comes first. A packaged game with no runtime hears
  // that it has not adopted one rather than that it is packaged: both are true,
  // and adopting the runtime is the one a maintainer can act on.
  if (installed === null) {
    return mutator(unadoptedGameRoute(reader, game.name));
  }
  if (installed < required) {
    return mutator(olderRuntimeRoute(reader, game.name, installed, required));
  }
  // The `.sdd` test is "can coilbox write the mission?", which only comes up
  // when the mission is not in the game already.
  if (
    !missionInGame &&
    (!isSdd(game.primaryArchive) || !game.primaryArchive.path)
  ) {
    return mutator(packagedGameRoute(reader, game.name));
  }
  return {
    route: "adopted",
    reason: missionInGame
      ? gameOwnMissionRoute(reader, game.name)
      : adoptedGameRoute(reader, game.name, installed),
  };
}

/** The lead-in to a refusal: how much is wrong, and that nothing was played. */
export function missionIssueSummary(
  reader: ScenarioReader,
  issues: MissionIssue[],
): string {
  return missionProblems(reader, issues.length);
}

/**
 * What a refusal says when the compiled mission did not validate, in one line.
 * A caller with room for the whole list shows {@link missionIssueSummary} over
 * every issue instead.
 */
export function missionIssueMessage(
  reader: ScenarioReader,
  issues: MissionIssue[],
): string {
  const [first] = issues;
  if (!first) return "";
  const more = issues.length - 1;
  return `${missionIssueSummary(reader, issues)} ${describeIssue(first)}${more > 0 ? ` (and ${more} more)` : ""}`;
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
  reader: ScenarioReader;
}): string | null {
  const { scenario, hasEngine, games, running, reader } = opts;
  const { gameName, mapName } = scenario.setup;
  if (!hasEngine) {
    return reader === "player"
      ? "No engine is installed. Add one from Content before playing a scenario."
      : "No engine is installed. Add one from Content before testing a scenario.";
  }
  if (!gameName || !mapName) {
    return "This scenario has no game and map yet. Set it up from a preset first.";
  }
  if (games && !games.some((g) => g.name === gameName)) {
    return gameNotInstalled(reader, gameName);
  }
  if (running) return "A game is already running.";
  return null;
}

export interface ScenarioLaunchInput {
  scenario: Scenario;
  /** Who is being told when this refuses. See `wording.ts`. */
  reader: ScenarioReader;
  /** The content root the engine is run against. */
  dataDir: string;
  /** The installed games, from the current content scan. */
  games: GameItem[];
  /**
   * The scenario's game's option list, read from unitsync by the caller (see
   * `gameOptionSchema`). Every option it declares that the setup left alone is
   * written into the start script at the game's default, so a scenario plays
   * the game the way the game intends. Empty means the caller could not read
   * them, and the engine falls back to its own built-in values.
   */
  optionSchema: ConfigOption[];
  /**
   * The map's own option list, read from unitsync by the caller (see
   * `mapOptionSchema`). Every option the map declares is written into the start
   * script at its default, because the engine substitutes nothing for an absent
   * map option and the map's Lua reads `nil` instead (#1868). Empty means the
   * caller could not read them, and the scenario runs with no `[mapoptions]`
   * block at all.
   */
  mapOptionSchema: ConfigOption[];
  /**
   * Force a fresh unitsync scan and hand back the games it found. The engine
   * takes its game list from the same archive cache unitsync writes, so a
   * generated mutator is only launchable once one has run.
   */
  rescan: () => Promise<GameItem[]>;
  /** Start the engine. Called only once the mission has validated. */
  launch: (config: BattleConfig) => Promise<{ exitCode: number | null }>;
  /**
   * Extra units to forbid outright, added to the engine `[RESTRICT]` block. A
   * campaign mission's own restriction list, which is authored around the
   * scenario rather than inside it, so it is on top of whatever
   * `scenario.setup.restrictions` already forbids.
   *
   * Neither of those is the scenario's own `restrictions` field, which is what
   * the player may build and do, enforced by the runtime and liftable
   * mid-mission.
   */
  disabledUnits?: string[];
  /**
   * The extent of the map the scenario is set on, when the caller has read it.
   * Only a caller with an engine to ask unitsync with can, so it is optional,
   * and without it a position is checked against the near edge only.
   */
  map?: MapExtent;
  /**
   * The units the scenario's game has, when the caller has read them. Optional
   * for the same reason `map` is, and without it a unit def the game does not
   * have goes unreported. A caller that read the list and got nothing back
   * passes the empty list, which the validator says so about rather than
   * treating as a mission with nothing wrong.
   */
  units?: { name: string }[];
  /**
   * Where the scenario came from, when it is one of a game's own missions. The
   * game already holds the compiled mission, so that one is read out of the
   * archive rather than written into it, and the runtime is armed with the
   * game's own folder name. Absent for a scenario coilbox stored.
   */
  origin?: GameOrigin;
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
      /**
       * What validated as a warning: the mission played, and the player saw
       * something in it that reads as a bug. Shown after the launch rather than
       * instead of it.
       */
      warnings: MissionIssue[];
    }
  | { ok: false; message: string; issues: MissionIssue[] };

const refuse = (
  message: string,
  issues: MissionIssue[] = [],
): ScenarioLaunchResult => ({ ok: false, message, issues });

/**
 * A game's vendored runtime version, or null when it has none to read.
 *
 * A loose game is asked through `scenario_runtime_status`, which also reads the
 * things only a folder has. A packaged `.sd7`/`.sdz` has no folder to root that
 * read at, so its marker comes out of the archive instead.
 */
async function installedRuntime(
  root: string,
  loose: boolean,
): Promise<number | null> {
  try {
    if (!loose) {
      const { installed } = await scenarioGameRuntime({ root });
      return installed.version;
    }
    const { installed } = await scenarioRuntimeStatus({ root });
    return installed ? installed.version : null;
  } catch {
    return null;
  }
}

/** One of a game's own mission files as text. */
async function missionFileText(
  origin: GameOrigin,
  file: string,
): Promise<string> {
  const { base64 } = await scenarioGameMissionFile({
    root: origin.archivePath,
    folder: origin.folder,
    file,
  });
  const binary = atob(base64);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (c) => c.charCodeAt(0)),
  );
}

/**
 * Read a mission the game ships and validate it.
 *
 * The adopted route's other half. A game carrying its own mission is already
 * holding what the engine will load, so the usual thing left to do is the read
 * back every launch does: nothing reaches the engine unvalidated, whoever
 * compiled it.
 *
 * The exception is drift. A game ships the document beside the compiled mission,
 * and the two can fall out of step, so `scenario` here is the document the game
 * carries (`gameScenarios` lists a mission only when it has one). What happens
 * then is decided by whether coilbox can write into the game:
 *
 * - a loose `.sdd` is corrected. The document is the source, so it is recompiled
 *   and written back, and that file is what validates and what plays.
 * - a packaged `.sd7`/`.sdz` cannot be written into, so the mission it ships is
 *   the one that plays, and the mismatch comes back as a warning. An author is
 *   told. A player is not, because they can do nothing about it.
 */
async function readFromGame(
  origin: GameOrigin,
  scenario: Scenario,
  reader: ScenarioReader,
  map?: MapExtent,
  units?: { name: string }[],
): Promise<{ mission: string; issues: MissionIssue[] }> {
  const path = missionPath(origin.folder);
  let source: string;
  try {
    source = await missionFileText(origin, "mission.lua");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { mission: path, issues: [{ path, message }] };
  }

  if (!missionDrifted(scenario, source)) {
    return {
      mission: path,
      issues: await validateCompiledMissionText(source, map, units),
    };
  }

  if (origin.loose) {
    // The document goes back with the mission because the write command takes
    // the pair, which also settles any difference between the bytes on disk and
    // the document as coilbox reads it.
    try {
      await scenarioWriteGameMission({
        root: origin.archivePath,
        folder: origin.folder,
        document: JSON.stringify(scenario),
        mission: compileScenario(scenario),
      });
    } catch (err) {
      // Nothing was corrected, so playing on would play the stale mission the
      // author has already moved past. Refuse and say why.
      const message = err instanceof Error ? err.message : String(err);
      return { mission: path, issues: [{ path, message }] };
    }
    return {
      mission: path,
      issues: await validateCompiledMission(
        origin.archivePath,
        origin.folder,
        map,
        units,
      ),
    };
  }

  const issues = await validateCompiledMissionText(source, map, units);
  const drifted = missionDriftedFromDocument(reader, origin.gameName);
  return {
    mission: path,
    issues: drifted
      ? [...issues, { path, message: drifted, severity: "warning" as const }]
      : issues,
  };
}

/**
 * Compile a scenario into a game that has adopted the runtime, then read it back
 * out. The same three steps the test mutator takes, against the game's own
 * folder: compile, write, validate.
 */
async function writeIntoGame(
  root: string,
  scenario: Scenario,
  map?: MapExtent,
  units?: { name: string }[],
): Promise<{ mission: string; issues: MissionIssue[] }> {
  await scenarioWriteMission({
    root,
    scenarioId: scenario.id,
    mission: compileScenario(scenario),
  });
  return {
    mission: missionPath(scenario.id),
    issues: await validateCompiledMission(root, scenario.id, map, units),
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
  const {
    scenario,
    reader,
    dataDir,
    games,
    optionSchema,
    mapOptionSchema,
    rescan,
    launch,
    disabledUnits,
    map,
    units,
    origin,
  } = input;
  const wanted = scenario.setup.gameName;
  const game = games.find((g) => g.name === wanted);
  if (!game) {
    return refuse(gameNotInstalled(reader, wanted));
  }

  // The mission is in the game only when the document came out of this very
  // game. A scenario merely set in it is still coilbox's to write.
  const inGame = origin?.gameName === game.name ? origin : undefined;
  const root = game.primaryArchive.path;
  const installed = root
    ? await installedRuntime(root, isSdd(game.primaryArchive))
    : null;
  const { route, reason } = scenarioRoute({
    game,
    installed,
    required: scenario.runtimeVersion,
    reader,
    missionInGame: inGame !== undefined,
  });

  // The game already holds this mission, so the adopted route reads it rather
  // than writing it. This is the one adopted case a packaged archive reaches.
  const shipped = route === "adopted" ? inGame : undefined;
  // Everything else on the adopted route is written, and `scenarioRoute` only
  // picks it for a write when the game has a folder to write into.
  const adopted = route === "adopted" && !shipped ? root : undefined;

  let dir: string;
  // The folder the runtime is pointed at, which is the game's own name for the
  // mission when the game brought it, and the document id everywhere else.
  let folder = scenario.id;
  let written: { mission: string; issues: MissionIssue[] };

  if (shipped) {
    dir = shipped.archivePath;
    folder = shipped.folder;
    written = await readFromGame(shipped, scenario, reader, map, units);
  } else if (adopted) {
    dir = adopted;
    written = await writeIntoGame(adopted, scenario, map, units);
  } else {
    // A game's own mission may have no document to compile from, so on this
    // route it travels as the bytes the archive holds. A read that fails is a
    // refusal rather than a quiet fall back to compiling the document, which
    // would play something the game does not ship.
    let source: string | undefined;
    if (inGame) {
      try {
        source = await missionFileText(inGame, "mission.lua");
      } catch (err) {
        const issues = [
          {
            path: missionPath(inGame.folder),
            message: err instanceof Error ? err.message : String(err),
          },
        ];
        return refuse(missionIssueMessage(reader, issues), issues);
      }
    }
    const mutator = await writeTestMutator(
      dataDir,
      scenario,
      map,
      units,
      source,
    );
    dir = mutator.dir;
    written = { mission: missionPath(scenario.id), issues: mutator.issues };
    if (mutator.version < scenario.runtimeVersion) {
      return refuse(
        coilboxTooOld(reader, scenario.runtimeVersion, mutator.version),
      );
    }
  }

  // Only an error stops the launch. A warning is a mission that plays, so it
  // rides along with the result and is shown once the game has closed.
  const blocking = written.issues.filter(isBlocking);
  if (blocking.length > 0) {
    return refuse(missionIssueMessage(reader, blocking), blocking);
  }
  const warnings = written.issues.filter((issue) => !isBlocking(issue));

  // An adopted game plays the scenario as itself. The mutator has to be found
  // first: the engine reads its game list from the archive cache unitsync
  // writes, so a forced rescan both registers the generated game and tells us
  // the name a start script has to ask for.
  let gameType = game.name;
  if (!adopted && !shipped) {
    const found = (await rescan()).find((g) =>
      isMutatorArchive(g.primaryArchive.name),
    );
    if (!found) {
      return refuse(setupNotFound(reader, game.name));
    }
    gameType = found.name;
  }

  // The setup is a skirmish draft, so it can carry the levers a conquest or
  // warpath preset captured: a shared disabled-unit list, an advantage and an
  // income multiplier. Built the same way `SkirmishPage` builds its own config,
  // so a scenario plays the fight its preset described. This is
  // `setup.restrictions`, the engine `[RESTRICT]` block and the team levers. It
  // is not `scenario.restrictions`, which is the runtime's build and command
  // rules.
  const captured = scenario.setup.restrictions;
  const config = applyRestrictions(
    toBattleConfig({
      participants: scenario.setup.participants,
      mapName: scenario.setup.mapName,
      gameType,
      startPosType: scenario.setup.startPosType,
      disabledUnits: [
        ...(captured?.disabledUnits ?? []),
        ...(disabledUnits ?? []),
      ],
      modOptions: {
        ...scenario.setup.modOptionValues,
        [MISSION_MODOPTION]: folder,
      },
      optionSchema,
      mapOptionSchema,
    }),
    captured,
  );
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
    warnings,
  };
}
