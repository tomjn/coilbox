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

export interface ResultRecord {
  attempts: number;
  wins: number;
  best: BestResult | null;
  /** Replay filenames already merged in. */
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
 * Merge one finished game into the record for the thing it was played against.
 *
 * Best means the fastest win. A loss is never best, so a record with only losses
 * has attempts and no best. A game whose replay was merged before returns the
 * record untouched. A fresh record starts from `undefined`.
 */
export function mergeResult(
  record: ResultRecord | undefined,
  result: GameResult,
): { record: ResultRecord; change: ResultChange } {
  const prev = record ?? { attempts: 0, wins: 0, best: null, seen: [] };
  if (prev.seen.includes(result.replayFilename)) {
    return { record: prev, change: { kind: "duplicate" } };
  }
  const next: ResultRecord = {
    ...prev,
    attempts: prev.attempts + 1,
    seen: [...prev.seen, result.replayFilename],
  };
  if (result.outcome === "unknown") {
    return { record: next, change: { kind: "no-winner" } };
  }
  if (result.outcome === "defeat") {
    return { record: next, change: { kind: "loss" } };
  }

  next.wins = prev.wins + 1;
  const time = result.durationSec;
  if (time === null) {
    return { record: next, change: { kind: "win-no-time" } };
  }
  const best = prev.best;
  const thisGame = { durationSec: time, replayFilename: result.replayFilename };
  if (!best) {
    next.best = thisGame;
    return { record: next, change: { kind: "first-win", durationSec: time } };
  }
  if (time < best.durationSec) {
    next.best = thisGame;
    return {
      record: next,
      change: {
        kind: "faster",
        durationSec: time,
        bySec: best.durationSec - time,
      },
    };
  }
  if (time === best.durationSec) {
    return {
      record: next,
      change: { kind: "equal", bestSec: best.durationSec },
    };
  }
  return {
    record: next,
    change: {
      kind: "slower",
      bestSec: best.durationSec,
      bySec: time - best.durationSec,
    },
  };
}
