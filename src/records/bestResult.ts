export type GameOutcome = "victory" | "defeat" | "unknown";

export interface GameResult {
  /** The replay the result was read from. Also what stops one game counting twice. */
  replayFilename: string;
  outcome: GameOutcome;
  /** In-game seconds, or null when the replay could not be decoded. */
  durationSec: number | null;
}

export interface BestResult {
  durationSec: number;
  replayFilename: string;
}

export interface ResultRecord<B = BestResult> {
  attempts: number;
  wins: number;
  best: B | null;
  /** Ids already merged in: replay filenames for a preset. */
  seen: string[];
}

/** What merging one game did to a record. */
export type ResultChange =
  /** The replay was merged before, so nothing changed. */
  | { kind: "duplicate" }
  | { kind: "first-win"; durationSec: number }
  | { kind: "faster"; durationSec: number; bySec: number }
  | { kind: "slower"; bestSec: number; bySec: number }
  | { kind: "equal"; bestSec: number }
  | { kind: "loss" }
  | { kind: "no-winner" }
  /** A win whose replay gave no time, so it cannot be compared. */
  | { kind: "win-no-time" };

/**
 * How one kind of result is ranked into a record. `mergeResult` does the
 * counting and the duplicate check, and asks the ranking the rest.
 *
 * `R` is the result, `B` what the record keeps as its best and `C` what a
 * merge reports back.
 */
export interface Ranking<R, B, C> {
  /** What stops one game counting twice. */
  id(result: R): string;
  /** Whether the result adds to the record's wins. */
  isWin(result: R): boolean;
  /**
   * Compare the result with the record's best. Return the best to keep, which is
   * `best` itself when the result does not beat it, and what to report.
   */
  judge(result: R, best: B | null): { best: B | null; change: C };
}

/** The ranking presets use: the fastest win is best, and a loss never is. */
export const presetRanking: Ranking<GameResult, BestResult, ResultChange> = {
  id: (result) => result.replayFilename,
  isWin: (result) => result.outcome === "victory",
  judge(result, best) {
    if (result.outcome === "unknown") {
      return { best, change: { kind: "no-winner" } };
    }
    if (result.outcome === "defeat") return { best, change: { kind: "loss" } };

    const time = result.durationSec;
    if (time === null) return { best, change: { kind: "win-no-time" } };
    const thisGame = {
      durationSec: time,
      replayFilename: result.replayFilename,
    };
    if (!best) {
      return {
        best: thisGame,
        change: { kind: "first-win", durationSec: time },
      };
    }
    if (time < best.durationSec) {
      return {
        best: thisGame,
        change: {
          kind: "faster",
          durationSec: time,
          bySec: best.durationSec - time,
        },
      };
    }
    if (time === best.durationSec) {
      return { best, change: { kind: "equal", bestSec: best.durationSec } };
    }
    return {
      best,
      change: {
        kind: "slower",
        bestSec: best.durationSec,
        bySec: time - best.durationSec,
      },
    };
  },
};

/**
 * Merge one finished game into the record for the thing it was played against.
 *
 * With no ranking, best means the fastest win. A loss is never best, so a record
 * with only losses has attempts and no best. A game whose id was merged before
 * returns the record untouched. A fresh record starts from `undefined`.
 *
 * Pass a ranking to decide best another way, as a challenge does.
 */
export function mergeResult(
  record: ResultRecord | undefined,
  result: GameResult,
): { record: ResultRecord; change: ResultChange };
export function mergeResult<R, B, C>(
  record: ResultRecord<B> | undefined,
  result: R,
  ranking: Ranking<R, B, C>,
): { record: ResultRecord<B>; change: C | { kind: "duplicate" } };
export function mergeResult<R, B, C>(
  record: ResultRecord<B> | undefined,
  result: R,
  ranking: Ranking<R, B, C> = presetRanking as unknown as Ranking<R, B, C>,
): { record: ResultRecord<B>; change: C | { kind: "duplicate" } } {
  const prev: ResultRecord<B> = record ?? {
    attempts: 0,
    wins: 0,
    best: null,
    seen: [],
  };
  const id = ranking.id(result);
  if (prev.seen.includes(id)) {
    return { record: prev, change: { kind: "duplicate" } };
  }
  const judged = ranking.judge(result, prev.best);
  return {
    record: {
      attempts: prev.attempts + 1,
      wins: prev.wins + (ranking.isWin(result) ? 1 : 0),
      best: judged.best,
      seen: [...prev.seen, id],
    },
    change: judged.change,
  };
}
