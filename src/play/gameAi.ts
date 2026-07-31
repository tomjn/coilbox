/**
 * Per-game AI catalogue: how a game's skirmish AIs rank against each other and
 * what each one is for (issue #695).
 *
 * Coilbox used to pick AIs by list position, so "the default opponent" was
 * whatever unitsync happened to return first and a difficulty setting only ever
 * changed enemy count and handicap. A game can now declare its AIs hardest to
 * easiest, name the standard one, and bucket the rest: bots that must never
 * play, mini-game AIs (chickens, scavengers) that are a game mode rather than an
 * opponent, and the AI a neutral conquest world garrisons itself with.
 *
 * The config ships per game in the branding catalog and a distribution profile
 * can override it ({@link mergeGameAi}). Games that declare nothing fall back to
 * {@link DEFAULT_AI_RANKING}, so the common Spring/Recoil AIs still order
 * sensibly out of the box.
 *
 * Everything here is pure and matched on `shortName` (case-insensitively), which
 * is unique regardless of whether an AI is native or Lua, so one config works
 * across game versions.
 */

/** Per-game AI catalogue, carried on a branding catalog entry or a profile. */
export interface GameAiConfig {
  /** Playing AIs by `shortName`, hardest first. Unlisted AIs rank after these. */
  ranking?: string[];
  /** The standard/normal AI (`shortName`): the default pick everywhere. */
  standard?: string;
  /** Never offered or auto-picked (`shortName`s), e.g. a do-nothing test bot. */
  never?: string[];
  /** Mini-game AIs (`shortName`s) like chickens or scavengers: a game mode, not
   * an opponent. Never fielded as a normal enemy, still pickable by hand. */
  minigame?: string[];
  /** AIs for neutral unclaimed conquest worlds (`shortName`s), best first. */
  neutral?: string[];
  /** Mod options applied to neutral-world battles (e.g. chicken difficulty). */
  neutralModOptions?: Record<string, string>;
}

/** `shortName`s never fielded by any game: the engine's do-nothing test bots. */
export const BUILTIN_NEVER = ["sandbox", "nullai"];

/** Mini-game AIs recognised without configuration: chicken and scavenger waves. */
const MINIGAME_PATTERN = /chicken|scav/i;

/**
 * The ranking used by a game that declares none: the common Spring/Recoil AIs,
 * hardest first. Rough by nature, so a game that cares about the order should
 * ship its own `ranking`. Unlisted AIs are left unranked rather than guessed at.
 */
export const DEFAULT_AI_RANKING = [
  "BARb",
  "CircuitAI",
  "AAI",
  "E323AI",
  "KAIK",
  "Shard",
  "RAI",
  "SimpleAI",
];

/** How many pips a difficulty reading is drawn out of. */
export const PIP_SCALE = 5;

const norm = (s: string) => s.toLowerCase();

const listed = (names: string[] | undefined, shortName: string): boolean =>
  !!names?.some((n) => norm(n) === norm(shortName));

/** A bot that must never play: on the built-in list or the config's `never`. */
export function isNeverAi(
  ai: { shortName: string },
  config?: GameAiConfig,
): boolean {
  return (
    listed(BUILTIN_NEVER, ai.shortName) || listed(config?.never, ai.shortName)
  );
}

/** A mini-game AI (chickens, scavengers): a game mode, not a normal opponent. */
export function isMinigameAi(
  ai: { shortName: string },
  config?: GameAiConfig,
): boolean {
  return (
    listed(config?.minigame, ai.shortName) ||
    MINIGAME_PATTERN.test(ai.shortName)
  );
}

/** AIs that may fight as a normal opponent: neither banned nor a mini-game. */
function playable<T extends { shortName: string }>(
  ais: T[],
  config?: GameAiConfig,
): T[] {
  return ais.filter((a) => !isNeverAi(a, config) && !isMinigameAi(a, config));
}

/**
 * The game's playable AIs that the ranking actually names, hardest first.
 * Empty when the game ships only AIs nobody has ranked, which is the signal
 * callers use to fall back to {@link battlePool}'s unranked remainder.
 */
export function rankedAis<T extends { shortName: string }>(
  ais: T[],
  config?: GameAiConfig,
): T[] {
  const order = config?.ranking?.length ? config.ranking : DEFAULT_AI_RANKING;
  const pool = playable(ais, config);
  return order
    .map((n) => pool.find((a) => norm(a.shortName) === norm(n)))
    .filter((a): a is T => a !== undefined);
}

/**
 * Every playable AI in display order: ranked ones hardest first, then the ones
 * no ranking mentions in their original order. Used where a list must stay
 * complete (the skirmish AI dropdown) rather than curated.
 */
export function orderedAis<T extends { shortName: string }>(
  ais: T[],
  config?: GameAiConfig,
): T[] {
  const ranked = rankedAis(ais, config);
  const rest = ais.filter((a) => !ranked.includes(a));
  return [...ranked, ...rest];
}

/**
 * The difficulty reading for one AI, 1..{@link PIP_SCALE} with the scale's top
 * being hardest, or undefined when no ranking places it. Fixed-width so two
 * games with different numbers of AIs still read against the same scale. A game
 * with one ranked AI reads mid-scale: it is the standard by default.
 */
export function aiPips(
  ai: { shortName: string },
  ais: { shortName: string }[],
  config?: GameAiConfig,
): number | undefined {
  const ranked = rankedAis(ais, config);
  const rank = ranked.findIndex(
    (a) => norm(a.shortName) === norm(ai.shortName),
  );
  if (rank < 0) return undefined;
  if (ranked.length === 1) return Math.ceil(PIP_SCALE / 2);
  const span = (rank / (ranked.length - 1)) * (PIP_SCALE - 1);
  return Math.round(PIP_SCALE - span);
}

/**
 * The difficulty reading for a `shortName` against the built-in ranking alone,
 * ignoring what is installed. The one way to carry a difficulty across a game
 * switch: the game a preset was authored in is gone by the time its AI has to be
 * replaced, so a well-known AI is placed on the shared scale and the target
 * game's AI at that level takes over. Undefined for an AI the built-in ranking
 * does not name.
 */
export function referencePips(shortName: string): number | undefined {
  return aiPips(
    { shortName },
    DEFAULT_AI_RANKING.map((n) => ({ shortName: n })),
  );
}

/**
 * The AI to use when nothing more specific is asked for: the configured
 * `standard`, else the middle of the ranking, else any playable AI, else a
 * mini-game AI as a last resort. Undefined only when every installed AI is
 * banned outright.
 */
export function standardAi<T extends { shortName: string }>(
  ais: T[],
  config?: GameAiConfig,
): T | undefined {
  const pool = playable(ais, config);
  const named = config?.standard
    ? pool.find((a) => norm(a.shortName) === norm(config.standard ?? ""))
    : undefined;
  if (named) return named;
  // Middle of the ranking, rounded towards the gentler half: an unconfigured
  // game should default to a fair fight, not the hardest bot it ships.
  const ranked = rankedAis(ais, config);
  if (ranked.length > 0) return ranked[Math.ceil((ranked.length - 1) / 2)];
  return pool[0] ?? ais.find((a) => !isNeverAi(a, config));
}

/**
 * The AIs a generated battle may field, hardest first. Ranked AIs only, so a
 * game's curation holds, except when the ranking matches nothing installed, in
 * which case the unranked playable AIs are all there is to fight.
 */
export function battlePool<T extends { shortName: string }>(
  ais: T[],
  config?: GameAiConfig,
): T[] {
  const ranked = rankedAis(ais, config);
  return ranked.length > 0 ? ranked : playable(ais, config);
}

/**
 * The AI for a 1..{@link PIP_SCALE} difficulty level, the inverse of
 * {@link aiPips}: level 5 fields the hardest AI in the pool, level 1 the
 * easiest. Levels outside the scale clamp to its ends. Falls back to
 * {@link standardAi} when there is no pool to pick from.
 */
export function aiForDifficulty<T extends { shortName: string }>(
  level: number,
  ais: T[],
  config?: GameAiConfig,
): T | undefined {
  const pool = battlePool(ais, config);
  if (pool.length === 0) return standardAi(ais, config);
  const clamped = Math.min(PIP_SCALE, Math.max(1, Math.round(level)));
  const span = ((PIP_SCALE - clamped) / (PIP_SCALE - 1)) * (pool.length - 1);
  return pool[Math.round(span)];
}

/**
 * The AI a neutral, unclaimed world garrisons itself with: the configured
 * `neutral` list first, else a mini-game AI (the wildlife-hazard default), else
 * the standard opponent.
 */
export function neutralPick<T extends { shortName: string }>(
  ais: T[],
  config?: GameAiConfig,
): T | undefined {
  const allowed = ais.filter((a) => !isNeverAi(a, config));
  for (const name of config?.neutral ?? []) {
    const found = allowed.find((a) => norm(a.shortName) === norm(name));
    if (found) return found;
  }
  return (
    allowed.find((a) => isMinigameAi(a, config)) ?? standardAi(ais, config)
  );
}

/** First non-empty array among the candidates, else `undefined`. */
function firstNonEmpty<T>(...candidates: (T[] | undefined)[]): T[] | undefined {
  for (const c of candidates) if (c && c.length > 0) return c;
  return undefined;
}

/**
 * Merge the two override sources per field: a `profile.json` value wins over the
 * branding catalog's, which wins over the built-in defaults. Empty arrays count
 * as absent so an override never blanks a field. Returns undefined when neither
 * source sets anything, mirroring `mergeConquestNames`.
 */
export function mergeGameAi(
  profile?: GameAiConfig,
  branding?: GameAiConfig,
): GameAiConfig | undefined {
  if (!profile && !branding) return undefined;
  const merged: GameAiConfig = {
    ranking: firstNonEmpty(profile?.ranking, branding?.ranking),
    standard: profile?.standard ?? branding?.standard,
    never: firstNonEmpty(profile?.never, branding?.never),
    minigame: firstNonEmpty(profile?.minigame, branding?.minigame),
    neutral: firstNonEmpty(profile?.neutral, branding?.neutral),
    neutralModOptions:
      profile?.neutralModOptions ?? branding?.neutralModOptions,
  };
  return Object.values(merged).some((v) => v !== undefined)
    ? merged
    : undefined;
}
