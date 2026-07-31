/**
 * Reconciling a wanted AI with what a game actually offers.
 *
 * A preset, draft or authored battle names the AI it was written against, but
 * that AI may not exist in the game it is later applied to. These pure helpers
 * decide what to use instead and report the swap, over the per-game rules in
 * `play/gameAi.ts` (which ranks AIs and says which must never play).
 */

import {
  aiForDifficulty,
  type GameAiConfig,
  referencePips,
  standardAi,
} from "@/play/gameAi";

const norm = (s: string) => s.toLowerCase();

/**
 * Resolve a desired AI reference against a game's actual AI list: keep it if
 * still available there, otherwise pick this game's nearest equivalent so a bot
 * never carries an AI the game doesn't provide. Matched by `shortName` only,
 * case-insensitively, since a shortName is unique regardless of native/Lua kind
 * on the wire. Returns undefined only when the game has no usable AI at all.
 *
 * The replacement keeps difficulty where it can: an AI the built-in ranking
 * knows is swapped for the target game's AI at the same level, so leaving a
 * brutal opponent behind doesn't quietly hand the player a walkover. Anything
 * else falls back to the game's standard AI.
 *
 * Shared so every "pick an AI for this game" surface agrees: the multiplayer
 * preset-to-battle bridge (`draftToHostSeed`), and, in time, the
 * singleplayer opponent picker's own game-switch fallback.
 */
export function resolveGameAi<T extends { shortName: string }>(
  desired: { shortName: string } | undefined,
  ais: T[],
  config?: GameAiConfig,
): T | undefined {
  if (desired) {
    const found = ais.find(
      (a) => norm(a.shortName) === norm(desired.shortName),
    );
    if (found) return found;
    const level = referencePips(desired.shortName);
    if (level !== undefined) return aiForDifficulty(level, ais, config);
  }
  return standardAi(ais, config);
}

/** One desired AI the target game didn't offer, and what it became instead. */
export interface AiSubstitution {
  /** The `shortName` the preset/draft asked for. */
  from: string;
  /** The `shortName` it was remapped to (a valid AI in the target game). */
  to: string;
}

/** What `reconcileAi` did with a desired AI against a target game's AI list. */
export type AiReconcileStatus =
  /** The desired AI is available in this game, kept as-is. */
  | "kept"
  /** No AI was desired (blank slot), filled with the fallback default. */
  | "filled"
  /** The desired AI is not offered here, remapped to a valid default. */
  | "substituted"
  /** The game has no usable AI at all, nothing to assign. */
  | "unresolved";

export interface AiReconcileOutcome<T> {
  ai: T | undefined;
  status: AiReconcileStatus;
}

/**
 * Reconcile one desired AI against a target game version's actual AI list,
 * reporting what happened as well as the resulting AI. This is the reporting
 * wrapper over `resolveGameAi` (the keep-or-remap decision) that every "a
 * preset/draft meets a game" surface shares, so an unavailable AI is both
 * substituted for a valid default AND surfaced rather than silently swapped.
 * Matching is by `shortName`, the same case-insensitive rule `resolveGameAi`
 * uses, so it works across game versions (match against the installed version's
 * own list, not the game name).
 */
export function reconcileAi<T extends { shortName: string }>(
  desired: { shortName: string } | undefined,
  ais: T[],
  config?: GameAiConfig,
): AiReconcileOutcome<T> {
  const resolved = resolveGameAi(desired, ais, config);
  if (!resolved) return { ai: undefined, status: "unresolved" };
  if (!desired) return { ai: resolved, status: "filled" };
  const kept = norm(resolved.shortName) === norm(desired.shortName);
  return { ai: resolved, status: kept ? "kept" : "substituted" };
}

/**
 * A single human notice for a set of AI substitutions, deduped by from/to so
 * six bots all remapped the same way read as one line, not six. Returns
 * undefined for an empty list so callers can skip the notice entirely.
 */
export function summarizeSubstitutions(
  subs: AiSubstitution[],
): string | undefined {
  const seen = new Map<string, AiSubstitution>();
  for (const s of subs) seen.set(`${s.from}=>${s.to}`, s);
  const list = [...seen.values()];
  if (list.length === 0) return undefined;
  if (list.length === 1) {
    const s = list[0];
    return `This game doesn't offer ${s.from}. Using ${s.to} instead.`;
  }
  const parts = list.map((s) => `${s.from} to ${s.to}`);
  return `This game doesn't offer some of the chosen AIs. Substituted ${parts.join(", ")}.`;
}
