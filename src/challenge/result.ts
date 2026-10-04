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
 *
 * A warpath win tells two wins apart by `hull` remaining and then `salvage`
 * banked, because every win reaches the same depth. The hull is an absolute
 * number: `maxHull` follows from difficulty and ascension, which are both part of
 * the identity, so it is the same for every run of one challenge. Both are absent
 * on a loss, on conquest, and on a win stored before they were kept.
 */
export interface ChallengeScore {
  won: boolean;
  measure: number;
  hull?: number;
  salvage?: number;
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
 *
 * Two warpath wins compare on hull remaining, then salvage banked. A win with no
 * hull or salvage, stored before they were kept, ranks below any win that has them.
 */
export function betterScore(
  mode: ChallengeMode,
  candidate: ChallengeScore,
  best: ChallengeScore,
): boolean {
  if (candidate.won !== best.won) return candidate.won;
  if (mode === "warpath" && candidate.won) {
    const hull = (candidate.hull ?? -1) - (best.hull ?? -1);
    if (hull !== 0) return hull > 0;
    return (candidate.salvage ?? -1) > (best.salvage ?? -1);
  }
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
  const won = run.progress.status === "won";
  const measure = deepestColumn(run);
  return {
    mode: "warpath",
    identity: runIdentity(run),
    runId,
    score: won
      ? {
          won,
          measure,
          hull: run.progress.hull,
          salvage: run.progress.salvage,
        }
      : { won, measure },
  };
}
