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
