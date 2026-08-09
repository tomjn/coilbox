/**
 * What the room does with a Tachyon server's "the match is here" signal.
 *
 * A Tachyon lobby has no host to go in-game, which is what the room launches off
 * on the line protocol. The server picks an autohost and sends every player its
 * address instead, and the connection reports each one by advancing a counter.
 * This turns the counter into the room's next move.
 */
export interface MatchStartState {
  /** The connection's count of matches the server has told us about. */
  seq: number;
  /** The count the room has already acted on. */
  actedOn: number;
  /** The map and game are installed and an engine is selected. */
  canRun: boolean;
}

export type MatchStartAction =
  /** Nothing new, or the counter went backwards. */
  | "ignore"
  /** Start the engine now. */
  | "launch"
  /** A match we cannot play yet. Start it when the content lands. */
  | "wait";

export function matchStartAction(s: MatchStartState): MatchStartAction {
  // Only a rise is a match starting. A reconnect puts the counter back to zero,
  // and launching off that would point the engine at a match that finished
  // hours ago.
  if (s.seq <= s.actedOn) return "ignore";
  return s.canRun ? "launch" : "wait";
}
