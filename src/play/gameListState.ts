/**
 * What an empty game list means, as one rule both warpath and conquest read.
 *
 * The distinction that matters is `empty` against `unreadable`. The unitsync
 * worker prints a valid result document even when its `Init` failed, and
 * `ScanResult` carries the reason in `errors`, so an engine that could not
 * mount the content root answers with an empty list and a note. That is
 * indistinguishable from a player who owns nothing unless somebody reads the
 * note. Both screens used to send that player to the download page for games
 * already sitting on their disk.
 *
 * Pure, and free of hooks, so the rule can be tested without a scan. The hook
 * that gathers the inputs is `usePlayReadiness` in `./config`.
 */
export type GameListState =
  /** A scan found games to play. */
  | "ready"
  /** No engine is installed, so there is nothing to scan with. */
  | "no-engine"
  /** A scan is running and has not answered yet. */
  | "scanning"
  /** A scan ran cleanly and found no games. */
  | "empty"
  /** A scan found no games and said why it could not read them. */
  | "unreadable";

export function gameListState({
  hasTarget,
  scanned,
  hasGames,
  scanErrors,
  initFailure,
}: {
  /** Whether an engine was resolved to scan with. */
  hasTarget: boolean;
  /** Whether a scan result has landed for that engine. */
  scanned: boolean;
  /** Whether the result held any game a player could pick. */
  hasGames: boolean;
  /** Diagnostics unitsync drained during the scan. */
  scanErrors: readonly string[];
  /** The reason the scan could not read the install, when it could not. Comes
   *  from the scan hook's `error`, which holds unitsync's `Init` failure with
   *  `data` null (issue #3423). A scan that errored counts as `scanned`. */
  initFailure?: string | null;
}): GameListState {
  if (!hasTarget) return "no-engine";
  if (!scanned) return "scanning";
  if (hasGames) return "ready";
  return scanErrors.length > 0 || initFailure ? "unreadable" : "empty";
}

/**
 * Whether the player is being told to go and get a game, which only a state
 * with nothing wrong with the reading can say. A scan that could not read the
 * games has not shown there are none to get.
 */
export function needsGame(state: GameListState): boolean {
  return state === "no-engine" || state === "empty";
}
