/**
 * Launching a scenario for somebody who is playing it, not writing it.
 *
 * A campaign mission and a scenario location on a Conquest or Warpath map both
 * hand a scenario to the engine the same way: `launchScenario`, with the game's
 * and the map's option lists read from unitsync, and a rescan that words its
 * failure for a player. This is that one call, so the two cannot drift apart.
 * The route (a game that bundles the mission runtime, or the test game) and the
 * `runtimeVersion` check are `launchScenario`'s own.
 */

import type { GameItem } from "../content/bindings";
import { primeScan } from "../content/config";
import { sameGameFamily } from "../content/resolveContent";
import type { BattleConfig } from "../play/bindings";
import {
  gameOptionSchema,
  mapOptionSchema,
  type PlayTarget,
} from "../play/config";
import { scenarioMediaWrite } from "./bindings";
import { launchScenario, type ScenarioLaunchResult } from "./launch";
import type { Difficulty, Scenario } from "./model";

export interface PlayerScenarioLaunch {
  scenario: Scenario;
  target: PlayTarget;
  /** The installed games, from the current content scan. */
  games: GameItem[];
  /** Start the engine. Called only once the mission has validated. */
  launch: (config: BattleConfig) => Promise<{ exitCode: number | null }>;
  /** Units to forbid on top of the scenario's own. See `launchScenario`. */
  disabledUnits?: string[];
  /** How hard to play it, for a scenario that varies by difficulty. */
  difficulty?: Difficulty;
}

export async function launchScenarioForPlayer(
  opts: PlayerScenarioLaunch,
): Promise<ScenarioLaunchResult> {
  const { scenario, target, games, launch, disabledUnits, difficulty } = opts;
  // A scenario runs as itself or as a mutator over its game, so the options
  // are that game's either way. A game that is not installed has none to read,
  // and `launchScenario` refuses before they would be used.
  const game = games.find((g) => g.name === scenario.setup.gameName);
  return launchScenario({
    scenario,
    // A refusal here is read on a briefing screen, by whoever is playing.
    reader: "player",
    dataDir: target.dataDir,
    games,
    optionSchema: await gameOptionSchema(target, game?.primaryArchive.name),
    mapOptionSchema: await mapOptionSchema(target, scenario.setup.mapName),
    disabledUnits,
    difficulty,
    // A rescan whose unitsync `Init` failed throws the engine's reason. It is
    // worded as a scan failure here so the briefing's error does not read as a
    // bare engine message.
    rescan: async () => {
      try {
        return (await primeScan(target.enginePath, target.dataDir, true)).games;
      } catch (e) {
        throw new Error(
          `The content scan failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    launch,
  });
}

/**
 * A scenario set on the installed game a Conquest or Warpath run uses, or null
 * when it was made for a different game.
 *
 * A scenario names one build of its game, and a run plays whichever build it
 * settled on, which need not be that one. Any build of the same game plays the
 * scenario, so the run's build takes the place of the name in the setup. A
 * different game is never substituted: its units are not the scenario's.
 */
export function scenarioOnGame(
  scenario: Scenario,
  gameName: string,
): Scenario | null {
  if (!sameGameFamily(scenario.setup.gameName, gameName)) return null;
  if (scenario.setup.gameName === gameName) return scenario;
  return { ...scenario, setup: { ...scenario.setup, gameName } };
}

/**
 * Put the dialogue clips a scenario file carried into the media store, which
 * is the one place the compile step copies them from. A clip that will not
 * write is skipped: it costs a line its picture or its voice, which is never a
 * reason to refuse the launch.
 */
export async function storeScenarioMedia(
  scenarioId: string,
  media: Record<string, string>,
): Promise<void> {
  for (const [file, dataUri] of Object.entries(media)) {
    try {
      await scenarioMediaWrite({ scenarioId, file, dataUri });
    } catch {
      console.warn("skipping unwritable dialogue clip", file);
    }
  }
}
