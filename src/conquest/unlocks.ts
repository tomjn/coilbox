import type { ConquestState, GalaxyDoc } from "./model";
import { BASE_SIZES, LARGE_SIZES } from "./size";
import { MAX_THREAT_LEVEL, readThreatLevel } from "./threat";

/**
 * What finishing conquests unlocks, kept between conquests. The rule is
 * Warpath's (`awardMeta` in `../runlite/meta.ts`): options, not raw power. An
 * unlock only adds a choice at setup, and nothing the setup offers today is ever
 * locked.
 *
 * The threat level (`./threat`) goes up one level at a time, and only by
 * winning a conquest played at the current highest level. A loss unlocks
 * nothing. The centre start (`./startPosition`) opens with the first of those
 * wins.
 *
 * Warpath's document is not reused. It holds loadouts, event pools and an
 * ascension tier that mean nothing here, and its page owns the only code that
 * reads it. Conquest keeps its own, one record per game.
 */

/** One game's record. */
export interface GameUnlocks {
  /** The highest threat level the player may choose. */
  threatLevel: number;
  /** Conquests finished, won or lost. */
  finished: number;
  /** Conquests won. */
  won: number;
  /** The conquests already counted, which is what stops one counting twice. */
  seen: string[];
}

/** The whole document: one record per game, keyed by lower case shortname. */
export type ConquestUnlocks = Record<string, GameUnlocks>;

/** Where the document is stored, in the frame's settings. */
export const CONQUEST_UNLOCKS_KEY = "conquest.unlocks";

/** A game's key. Lower case, as the setup page matches shortnames. */
const gameKey = (game: string) => game.trim().toLowerCase();

/** The highest threat level a game has unlocked, 0 for a game with no record. */
export function unlockedLevel(unlocks: ConquestUnlocks, game: string): number {
  return readThreatLevel(unlocks[gameKey(game)]?.threatLevel);
}

/** A finished conquest, ready to count. */
export interface FinishedConquest {
  /** `galaxy.id` and the run's state seed. A restart draws a new seed. */
  runId: string;
  game: string;
  won: boolean;
  /** The threat level it was played at, or null when the galaxy has no level
   * to play at (an authored one). Such a conquest counts but never unlocks. */
  level: number | null;
}

/**
 * The conquest a finished run is, or null while it is still going.
 *
 * A galaxy saved before threat levels existed reads as level 0, and a conquest
 * that ended before this change counts when its page is first opened after it,
 * the way a result does for a challenge record.
 */
export function finishedConquest(
  galaxy: GalaxyDoc,
  state: ConquestState,
): FinishedConquest | null {
  if (state.status === "active") return null;
  return {
    runId: `${galaxy.id}:${state.seed}`,
    game: gameKey(galaxy.game.shortname),
    won: state.status === "won",
    level: galaxy.generated
      ? readThreatLevel(galaxy.generated.threatLevel)
      : null,
  };
}

/**
 * Fold a finished conquest into the document. Returns the same object when the
 * conquest was counted before, so a caller can tell nothing changed.
 *
 * A win unlocks the next level only when it was played at exactly the highest
 * level unlocked. A win above it, which a challenge code at a locked level
 * allows, unlocks nothing, so a code cannot be used to skip ahead.
 */
export function foldFinishedConquest(
  unlocks: ConquestUnlocks,
  finished: FinishedConquest,
): ConquestUnlocks {
  const key = gameKey(finished.game);
  const prev = unlocks[key] ?? {
    threatLevel: 0,
    finished: 0,
    won: 0,
    seen: [],
  };
  if (prev.seen.includes(finished.runId)) return unlocks;

  const unlocksNext =
    finished.won &&
    finished.level === prev.threatLevel &&
    prev.threatLevel < MAX_THREAT_LEVEL;
  return {
    ...unlocks,
    [key]: {
      threatLevel: prev.threatLevel + (unlocksNext ? 1 : 0),
      finished: prev.finished + 1,
      won: prev.won + (finished.won ? 1 : 0),
      seen: [...prev.seen, finished.runId],
    },
  };
}

/**
 * Whether a game's player may start at the centre of the galaxy (issue #3432).
 * It opens with the first win, which is the threshold threat level 1 already
 * uses, so it reads the same record and stores nothing of its own.
 */
export function startPositionUnlocked(
  unlocks: ConquestUnlocks,
  game: string,
): boolean {
  return unlockedLevel(unlocks, game) >= 1;
}

/** What the setup says unlocks the centre start. The words threat level 1 uses. */
export function startPositionRequirement(): string {
  return levelChoices(0).locked?.requirement ?? "";
}

/** What the setup offers at a given unlocked level. */
export interface LevelChoices {
  /** Every level that can be chosen, 0 first. */
  unlocked: number[];
  /** The next level and how to get it, or null at the top. */
  locked: { level: number; requirement: string } | null;
}

/** The choices the setup shows for a game whose highest unlocked level is `ceiling`. */
export function levelChoices(ceiling: number): LevelChoices {
  const top = readThreatLevel(ceiling);
  const unlocked = Array.from({ length: top + 1 }, (_, i) => i);
  if (top >= MAX_THREAT_LEVEL) return { unlocked, locked: null };
  return {
    unlocked,
    locked: {
      level: top + 1,
      requirement:
        top === 0 ? "Win a conquest" : `Win a conquest at level ${top}`,
    },
  };
}

/** One entry in the setup's size list. */
export interface SizeOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

/**
 * The size options the setup shows for a game whose highest unlocked threat
 * level is `ceiling` (issue #3433). Every size that was always on offer, every
 * unlocked larger size, and the next larger one greyed out with what unlocks it.
 * Sizes beyond that are not shown, the way the threat level control shows one
 * locked level.
 *
 * A larger size opens with the threat level it is tied to, so what unlocks it is
 * what unlocks that level: a win at the level before.
 */
export function sizeOptions(ceiling: number): SizeOption[] {
  const options: SizeOption[] = [...BASE_SIZES];
  const next = LARGE_SIZES.find((s) => ceiling < s.level);
  for (const size of LARGE_SIZES) {
    const label = `${size.label} (${size.count} systems)`;
    if (ceiling >= size.level) {
      options.push({ value: String(size.count), label });
    } else if (size === next) {
      const requirement = levelChoices(size.level - 1).locked?.requirement;
      options.push({
        value: String(size.count),
        label,
        description: `Locked. ${requirement}.`,
        disabled: true,
      });
    }
  }
  return options;
}
