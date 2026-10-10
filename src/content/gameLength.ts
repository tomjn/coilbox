/**
 * Where game length is cut into bands, in seconds. A game is "over" a boundary
 * only when it is strictly longer, so a game of exactly 30 minutes is not over
 * 30 minutes. Every surface that groups or filters by length reads this list so
 * the replay library's minimum length filter and the matchup view agree.
 */
export const GAME_LENGTH_BOUNDARIES_SEC = [1800, 3600, 7200] as const;
