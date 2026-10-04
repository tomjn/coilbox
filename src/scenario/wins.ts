import { useSetting } from "@picoframe/frame";
import { useCallback } from "react";
import { updateStoredSetting } from "../lib/storedSetting";

/**
 * Which standalone scenarios the player has won (issue #3549).
 *
 * A campaign mission's win goes in the campaign progress file. A scenario played
 * on its own, from the Scenarios page, had no record at all until a
 * distribution's start card needed one to know when to go away. This is that
 * record and nothing more: the scenario's `id` against when it was first won.
 *
 * A setting rather than a file of its own, because settings are read before the
 * first frame and written from TypeScript, so the home page has the answer with
 * nothing to wait for and the record needs no plugin command.
 */
export type ScenarioWins = Record<string, string>;

export const SCENARIO_WINS_KEY = "scenario.wins";

const NO_WINS: ScenarioWins = {};

/**
 * Record a win, keeping the date of the first one. Hands back the same object
 * when the scenario was already won, which `updateStoredSetting` reads as
 * nothing to write.
 */
export function withWin(
  wins: ScenarioWins,
  scenarioId: string,
  now: string = new Date().toISOString(),
): ScenarioWins {
  if (wins[scenarioId]) return wins;
  return { ...wins, [scenarioId]: now };
}

/** The scenarios won so far, and a way to record another. */
export function useScenarioWins(): {
  wins: ScenarioWins;
  recordWin: (scenarioId: string) => void;
} {
  const [wins, setWins] = useSetting<ScenarioWins>(SCENARIO_WINS_KEY, NO_WINS);
  const recordWin = useCallback(
    (scenarioId: string) =>
      updateStoredSetting(SCENARIO_WINS_KEY, NO_WINS, setWins, (prev) =>
        withWin(prev, scenarioId),
      ),
    [setWins],
  );
  return { wins, recordWin };
}
