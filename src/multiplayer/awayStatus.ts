/**
 * Auto-away (issue #333). The lobby's `MYSTATUS` carries a single pair of
 * client-set bits, `ingame` and `away`, so both are resolved here from the three
 * inputs that can move them: the running game, the user's manual choice, and the
 * idle timer. The provider owns the resulting pair and is the only sender.
 */

/** Setting key: whether idling flips us to away at all. */
export const AUTO_AWAY_ENABLED_KEY = "multiplayer.autoAway";
/** Setting key: minutes of no input before we go away. */
export const AUTO_AWAY_MINUTES_KEY = "multiplayer.autoAwayMinutes";

export const DEFAULT_AUTO_AWAY_MINUTES = 10;
export const MIN_AUTO_AWAY_MINUTES = 1;
export const MAX_AUTO_AWAY_MINUTES = 120;

/** How often the idle watcher re-checks the last-activity stamp. Activity clears
 *  away immediately, so this only bounds how late the away flip can be. */
export const IDLE_POLL_MS = 15_000;

/** The two client-set bits of `ClientStatus`. */
export interface ClientFlags {
  ingame: boolean;
  away: boolean;
}

/** Coerce a stored threshold into a usable number of minutes. */
export function clampAwayMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AUTO_AWAY_MINUTES;
  }
  const rounded = Math.round(value);
  if (rounded < MIN_AUTO_AWAY_MINUTES) return MIN_AUTO_AWAY_MINUTES;
  if (rounded > MAX_AUTO_AWAY_MINUTES) return MAX_AUTO_AWAY_MINUTES;
  return rounded;
}

/** Has `minutes` passed since the last activity? A negative gap (the wall clock
 *  moved back, e.g. waking from sleep) counts as recent activity, not idle. */
export function isIdle(
  lastActivity: number,
  now: number,
  minutes: number,
): boolean {
  const elapsed = now - lastActivity;
  return elapsed >= minutes * 60_000;
}

/**
 * The status pair to report. A manual away always wins. The idle timer is
 * ignored while a game is running, because the engine takes the input the
 * watcher would otherwise be waiting for.
 */
export function resolveStatus(input: {
  ingame: boolean;
  manualAway: boolean;
  idle: boolean;
}): ClientFlags {
  return {
    ingame: input.ingame,
    away: input.manualAway || (input.idle && !input.ingame),
  };
}

/** Do two status pairs carry the same bits? Gates the wire send. */
export function sameStatus(a: ClientFlags, b: ClientFlags): boolean {
  return a.ingame === b.ingame && a.away === b.away;
}
