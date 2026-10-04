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
import type { BattleConfig } from "../play/bindings";
import {
  gameOptionSchema,
  mapOptionSchema,
  type PlayTarget,
} from "../play/config";
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
