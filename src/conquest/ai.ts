/**
 * Conquest AI eligibility: which skirmish AIs may fight as opponents.
 *
 * Conquest never fields a "do-nothing" test bot (a game's `LuaAI.lua` often
 * declares one, e.g. `Sandbox`, and it can end up first in the list). These
 * pure helpers filter the AI list for the two places an enemy AI is chosen —
 * galaxy generation (`generate.ts`) and battle synthesis (`synthesize.ts`) —
 * from one tested rule. A game's branding catalog entry can extend the
 * built-in deny-list, restrict the faction pool, or name a neutral-node AI.
 */

/** Per-game conquest AI configuration, carried on a branding catalog entry. */
export interface ConquestAiConfig {
  /** Extra `shortName`s (case-insensitive) treated as non-playing bots. */
  deny?: string[];
  /** Restrict the faction opponent pool to these `shortName`s, in this order. */
  enemyAis?: string[];
  /**
   * AI for neutral garrison nodes (`shortName`). Unset -> auto-pick an available
   * chicken AI, else a normal faction AI.
   */
  neutralAi?: string;
  /** Mod options applied to neutral garrison battles (e.g. chicken difficulty). */
  neutralModOptions?: Record<string, string>;
}

/** Built-in `shortName`s never fielded as conquest opponents (do-nothing bots). */
export const BUILTIN_AI_DENYLIST = ["sandbox", "nullai"];

const norm = (s: string) => s.toLowerCase();

/** A do-nothing/test bot: on the built-in deny-list or the catalog `deny` list. */
export function isDeniedAi(
  ai: { shortName: string },
  config?: ConquestAiConfig,
): boolean {
  const deny = new Set([
    ...BUILTIN_AI_DENYLIST,
    ...(config?.deny ?? []).map(norm),
  ]);
  return deny.has(norm(ai.shortName));
}

/** A chicken-defence / wildlife AI (spawns waves), matched by name. */
export function isChickenAi(ai: { shortName: string }): boolean {
  return /chicken/i.test(ai.shortName);
}

/**
 * AIs usable as a normal faction opponent: neither denied nor a chicken AI.
 * With `enemyAis` set, the result is restricted to and ordered by that list.
 */
export function factionAiPool<T extends { shortName: string }>(
  ais: T[],
  config?: ConquestAiConfig,
): T[] {
  const playable = ais.filter((a) => !isDeniedAi(a, config) && !isChickenAi(a));
  const allow = config?.enemyAis;
  if (allow && allow.length > 0) {
    const byName = new Map(playable.map((a) => [norm(a.shortName), a]));
    return allow
      .map((n) => byName.get(norm(n)))
      .filter((a): a is T => a !== undefined);
  }
  return playable;
}

/**
 * The AI a faction enemy falls back to when nothing is authored: the first of
 * the faction pool, else the first non-denied AI (a chicken AI as a last
 * resort), else undefined when only do-nothing bots are installed.
 */
export function fallbackFactionAi<T extends { shortName: string }>(
  ais: T[],
  config?: ConquestAiConfig,
): T | undefined {
  return (
    factionAiPool(ais, config)[0] ?? ais.find((a) => !isDeniedAi(a, config))
  );
}

/**
 * The AI a neutral garrison uses: an explicit catalog `neutralAi`, else an
 * available chicken AI (the wildlife-hazard default), else a normal faction AI.
 */
export function neutralAi<T extends { shortName: string }>(
  ais: T[],
  config?: ConquestAiConfig,
): T | undefined {
  if (config?.neutralAi) {
    const named = ais.find(
      (a) =>
        norm(a.shortName) === norm(config.neutralAi ?? "") &&
        !isDeniedAi(a, config),
    );
    return named ?? fallbackFactionAi(ais, config);
  }
  const chicken = ais.find((a) => isChickenAi(a) && !isDeniedAi(a, config));
  return chicken ?? fallbackFactionAi(ais, config);
}

/**
 * Resolve a desired AI reference against a game's actual AI list: keep it if
 * still available there, otherwise remap to `fallbackFactionAi` (skipping
 * do-nothing bots like Sandbox/NullAI) so a bot never carries an AI the game
 * doesn't provide. Matched by `shortName` only, case-insensitively, since a
 * shortName is unique regardless of native/Lua kind on the wire. Returns
 * undefined only when the game has no usable AI at all.
 *
 * Shared so every "pick an AI for this game" surface agrees: the multiplayer
 * preset-to-battle bridge (`draftToHostSeed`), and, in time, the
 * singleplayer opponent picker's own game-switch fallback.
 */
export function resolveGameAi<T extends { shortName: string }>(
  desired: { shortName: string } | undefined,
  ais: T[],
  config?: ConquestAiConfig,
): T | undefined {
  if (desired) {
    const found = ais.find(
      (a) => norm(a.shortName) === norm(desired.shortName),
    );
    if (found) return found;
  }
  return fallbackFactionAi(ais, config);
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
  config?: ConquestAiConfig,
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
