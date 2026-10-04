import { useEffect } from "react";
import type { RogueliteRun } from "./model";
import { observeFinishedRuns, useRunMeta } from "./runs";

/**
 * Count the finished runs among `runs` that no record has counted yet, whenever
 * they are shown. The run page passes its one run and the run list passes all
 * of them, so a run that ended with its page closed is counted the next time
 * either is opened. The rule is `observeFinishedRuns`, shared by both.
 *
 * Nothing is written while the runs or the meta are loading, or when the meta
 * failed to load, so a bad read cannot overwrite the file.
 */
export function useAwardFinishedRuns(
  runs: Readonly<Record<string, RogueliteRun>>,
  runsLoading: boolean,
) {
  const { loading, error } = useRunMeta();
  useEffect(() => {
    if (runsLoading || loading || error) return;
    observeFinishedRuns(runs);
  }, [runs, runsLoading, loading, error]);
}
