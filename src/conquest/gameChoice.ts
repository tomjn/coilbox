import type { GameChoice } from "../play/installedGames";
import type { ConquestState, GalaxyDoc, GameRef } from "./model";

/**
 * The game a conquest run launches: the galaxy's game, with the full name the
 * player answered with taking precedence over the galaxy's own pin (issue
 * #3465). The answer lives on the run state, never the galaxy document.
 */
export function conquestGameRef(
  galaxy: GalaxyDoc,
  state: ConquestState | undefined,
): GameRef {
  const pinnedName = state?.pinnedGame ?? galaxy.game.pinnedName;
  return pinnedName
    ? { shortname: galaxy.game.shortname, pinnedName }
    : { shortname: galaxy.game.shortname };
}

/** A run state with the player's answer about its game applied. */
export function withGameChoice(
  state: ConquestState,
  choice: GameChoice,
): ConquestState {
  return {
    ...state,
    pinnedGame: choice.pinnedName ?? state.pinnedGame,
    declinedGameUpdate: choice.declinedUpdate ?? state.declinedGameUpdate,
  };
}
