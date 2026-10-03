/**
 * What the battle room's main button does, given the state of the match.
 *
 * Before a match the button starts one. Once the host is in game it is the way
 * into the running match instead, and who you are decides which way in:
 *
 * - Somebody who was in the room when the match started is a participant. Their
 *   engine was launched for them, and if it exits the button brings them back
 *   (issue #453). The launch carries our own script password, so the host puts
 *   us back in the slot we left.
 * - Somebody who walked into a room that was already running was never in the
 *   match. Nothing launches for them, and the button offers to watch.
 */
export type MatchAction = "start" | "rejoin" | "watch" | "ingame";

export interface MatchState {
  /** We founded this battle, so we launch from the Start button. */
  selfHost: boolean;
  /** The host is in game, meaning a match is running. */
  hostIngame: boolean;
  /** We were in the room when the running match started. */
  presentAtStart: boolean;
  /** A launch of ours for this match is on its way or has an engine up. */
  launching: boolean;
  /** A game is running app-wide. Only one runs at a time. */
  running: boolean;
}

export function matchAction(s: MatchState): MatchAction {
  if (!s.hostIngame) return "start";
  if (s.selfHost || s.running || s.launching) return "ingame";
  return s.presentAtStart ? "rejoin" : "watch";
}

export interface AutoLaunchState {
  /** We founded this battle, so we launch from the Start button. */
  selfHost: boolean;
  /** The host is in game, meaning a match is running. */
  hostIngame: boolean;
  /** We were in the room when the running match started. */
  presentAtStart: boolean;
  /** The room has already launched the engine for this match. */
  launched: boolean;
  /** The map and game are installed and an engine is selected. */
  canRun: boolean;
}

/**
 * Whether the room starts the engine without being asked.
 *
 * It does once for each match, for somebody who was there when it started. An
 * engine that then exits may have exited on purpose, so getting back in is a
 * click. Somebody who walked into a running room came to a room, not to a
 * match, so nothing starts for them either.
 */
export function launchesOnItsOwn(s: AutoLaunchState): boolean {
  if (s.selfHost || !s.hostIngame) return false;
  return s.presentAtStart && !s.launched && s.canRun;
}
