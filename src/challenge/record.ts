import { COMPRESSED_CODE_PREFIX } from "../container/container";
import type { Ranking, ResultRecord } from "../records/bestResult";
import {
  betterScore,
  type ChallengeMode,
  type ChallengeRunResult,
} from "./result";

/**
 * Best results for challenge codes, kept apart from the codes, the galaxies and
 * the runs. A code is shared as it stands, so a record stored in it would travel
 * with it. Keyed by challenge identity (see `./identity.ts`).
 */
export const CHALLENGE_RECORDS_KEY = "challenge.records";

/** What a record keeps as its best. `measure` is turns for conquest and the
 * deepest column for warpath. */
export interface ChallengeBest {
  mode: ChallengeMode;
  won: boolean;
  measure: number;
  /** The run it came from. */
  runId: string;
}

export type ChallengeChange =
  | { kind: "first" }
  | { kind: "better" }
  | { kind: "kept" };

/** Best is the better score under that mode's measure. A loss can be best, until
 * a win replaces it. */
export const challengeRanking: Ranking<
  ChallengeRunResult,
  ChallengeBest,
  ChallengeChange
> = {
  id: (result) => result.runId,
  isWin: (result) => result.score.won,
  judge(result, best) {
    const entry: ChallengeBest = {
      mode: result.mode,
      ...result.score,
      runId: result.runId,
    };
    if (!best) return { best: entry, change: { kind: "first" } };
    return betterScore(result.mode, result.score, best)
      ? { best: entry, change: { kind: "better" } }
      : { best, change: { kind: "kept" } };
  },
};

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** A best result as a phrase, such as "won in 14 turns". */
export function describeBest(best: ChallengeBest): string {
  if (best.mode === "conquest") {
    return best.won
      ? `won in ${plural(best.measure, "turn")}`
      : `lost after ${plural(best.measure, "turn")}`;
  }
  return best.won
    ? `won, reaching depth ${best.measure}`
    : `lost at depth ${best.measure}`;
}

/** The line a run's page and the import page show. */
export function recordSummary(record: ResultRecord<ChallengeBest>): string {
  const attempts = plural(record.attempts, "attempt");
  return record.best
    ? `Your best: ${describeBest(record.best)}. ${attempts}.`
    : `${attempts}.`;
}

/**
 * The text copied to share a challenge. With a result it adds a line under the
 * code, worded as a claim because coilbox cannot check it. The container holds
 * none of it.
 */
export function shareText(
  code: string,
  best: ChallengeBest | undefined,
): string {
  if (!best) return code;
  return `${code}\n\nMy best result so far (my claim, not checked by coilbox): ${describeBest(best)}`;
}

/**
 * The code in pasted text. A shared code may arrive with a line of text under
 * it, which would otherwise make it fail to decode. Only a compressed code is
 * cut at the first whitespace. A file's JSON and an older plain code are left
 * as they are. The text itself is never read.
 */
export function codeFromPaste(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith(COMPRESSED_CODE_PREFIX)
    ? (trimmed.split(/\s/, 1)[0] ?? trimmed)
    : text;
}
