/**
 * When to offer a manual way back into a running match (issue #453).
 *
 * The room auto-launches the engine once for each match the host starts. If that
 * engine then exits, from a crash or a deliberate quit, nothing brings you back,
 * because the auto-launch guard has already fired for this match. This predicate
 * spots that state so the room can offer a Rejoin button.
 *
 * Rejoining reuses the ordinary client launch, which carries our own script
 * password, so the host puts us back in the slot we left rather than making us a
 * spectator.
 */
export interface RejoinState {
  /** We founded this battle, so we launch from the Start button instead. */
  selfHost: boolean;
  /** The host is still in-game, meaning the match has not finished. */
  hostIngame: boolean;
  /** Our launch for this match has settled: the engine exited, or never ran. */
  launchSettled: boolean;
  /** A game is running app-wide. Only one runs at a time. */
  running: boolean;
  /** The map and game are installed and an engine is selected. */
  canRun: boolean;
}

export function canRejoinMatch(s: RejoinState): boolean {
  if (s.selfHost) return false;
  return s.hostIngame && s.launchSettled && !s.running && s.canRun;
}
