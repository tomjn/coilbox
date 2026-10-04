import { substitutedMapCount as conquestSubstituted } from "../conquest/challenge";
import type { ConquestState, GalaxyDoc } from "../conquest/model";
import { substitutedMapCount as warpathSubstituted } from "../runlite/challenge";
import type { RogueliteRun } from "../runlite/model";
import { deepestColumn } from "../runlite/progress";
import { galaxyIdentity, runIdentity } from "./identity";

export type ChallengeMode = "conquest" | "warpath";

/**
 * How a finished run did, in the one number each mode's end screen leads with.
 *
 * Conquest: `ConquestState.turn`, the turns taken. Warpath: the deepest column
 * reached (`deepestColumn`), the "Depth reached" line. Warpath's ascension tier
 * is not a second measure, because it is part of the challenge's identity and so
 * cannot differ between two runs of one challenge.
 */
export interface ChallengeScore {
  won: boolean;
  measure: number;
}

/** A finished run that counts, ready to merge into a challenge's record. */
export interface ChallengeRunResult {
  mode: ChallengeMode;
  identity: string;
  /** What stops one finished run being merged twice. */
  runId: string;
  score: ChallengeScore;
}

/**
 * Whether `candidate` beats `best`. A win beats a loss. Two wins compare on the
 * mode's measure, where conquest wants fewer turns and warpath wants more depth.
 * Two losses compare on how far the run got: more turns survived in conquest,
 * more depth in warpath. A tie is not better.
 */
export function betterScore(
  mode: ChallengeMode,
  candidate: ChallengeScore,
  best: ChallengeScore,
): boolean {
  if (candidate.won !== best.won) return candidate.won;
  const fewerIsBetter = mode === "conquest" && candidate.won;
  return fewerIsBetter
    ? candidate.measure < best.measure
    : candidate.measure > best.measure;
}

/**
 * The result of a finished conquest run, or null when it does not count: the run
 * is still going, no code can be made from the galaxy, or a system stands in for
 * a map the code named, which makes it a different fight.
 *
 * A run is one galaxy and one `state.seed`. "Start again" deletes the state and
 * the next run draws a new seed.
 */
export function conquestRunResult(
  galaxy: GalaxyDoc,
  state: ConquestState,
): ChallengeRunResult | null {
  if (state.status === "active") return null;
  const identity = galaxyIdentity(galaxy);
  if (!identity || conquestSubstituted(galaxy) > 0) return null;
  return {
    mode: "conquest",
    identity,
    runId: `${galaxy.id}:${state.seed}`,
    score: { won: state.status === "won", measure: state.turn },
  };
}

/**
 * The result of a finished warpath run, or null when it does not count. `runId`
 * is the key the run is saved under.
 */
export function warpathRunResult(
  runId: string,
  run: RogueliteRun,
): ChallengeRunResult | null {
  if (run.progress.status === "active") return null;
  if (warpathSubstituted(run) > 0) return null;
  return {
    mode: "warpath",
    identity: runIdentity(run),
    runId,
    score: {
      won: run.progress.status === "won",
      measure: deepestColumn(run),
    },
  };
}
