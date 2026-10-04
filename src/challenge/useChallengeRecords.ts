import { useEffect } from "react";
import { useResultRecords } from "../records/useResultRecords";
import {
  CHALLENGE_RECORDS_KEY,
  type ChallengeBest,
  type ChallengeChange,
  challengeRanking,
} from "./record";
import type { ChallengeRunResult } from "./result";

/** The records of best results for challenge codes, under their own settings key. */
export function useChallengeRecords() {
  return useResultRecords<ChallengeRunResult, ChallengeBest, ChallengeChange>(
    CHALLENGE_RECORDS_KEY,
    challengeRanking,
  );
}

/**
 * Record a finished run against its challenge, once. Pass null while the run
 * does not count (still going, or no code to match). The run's id stops a second
 * visit to the same finished run counting again.
 */
export function useRecordChallengeRun(result: ChallengeRunResult | null) {
  const { record } = useChallengeRecords();
  const identity = result?.identity;
  const runId = result?.runId;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on which run finished, not on the result object or `record`, which change every render
  useEffect(() => {
    if (result) record(result.identity, result);
  }, [identity, runId]);
}
