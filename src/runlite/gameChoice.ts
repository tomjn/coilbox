import type { GameChoice } from "../play/installedGames";
import type { RogueliteRun } from "./model";

/**
 * A run with the player's answer about its game applied (issue #3465). Writes
 * only the field the answer names, so the rest of the saved run is untouched.
 */
export function withGameChoice(
  run: RogueliteRun,
  choice: GameChoice,
): RogueliteRun {
  return {
    ...run,
    settings: choice.pinnedName
      ? {
          ...run.settings,
          game: { ...run.settings.game, pinnedName: choice.pinnedName },
        }
      : run.settings,
    declinedGameUpdate: choice.declinedUpdate ?? run.declinedGameUpdate,
  };
}

/**
 * The run's start unit and unlocked units that a game does not have, given the
 * names of that game's units. Empty when the run moves over cleanly.
 */
export function unitsMissingFrom(
  run: RogueliteRun,
  unitNames: Iterable<string>,
): string[] {
  const have = new Set([...unitNames].map((n) => n.toLowerCase()));
  const wanted = new Set(
    [run.startUnit, ...run.progress.unlockedUnits].filter(
      (u): u is string => !!u,
    ),
  );
  return [...wanted].filter((u) => !have.has(u.toLowerCase()));
}
