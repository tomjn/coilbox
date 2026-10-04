import { useEffect, useRef } from "react";
import { awardMeta, justFinished } from "./meta";
import type { RogueliteMeta, RogueliteRun, RunStatus } from "./model";

/** What the hook needs of `useRunMeta`. */
export interface AwardMetaState {
  meta: RogueliteMeta;
  loading: boolean;
  error: string | null;
  save: (next: RogueliteMeta) => void | Promise<void>;
}

/**
 * When the page sees a run reach won/lost, fold it into its game's
 * meta-progression once. A run that is already over when the page opens is
 * never awarded here: it was counted when it ended, by this version or by
 * the totals from before records were kept per game, and nothing records
 * which. The meta is only written when the award changed it, and never when
 * it failed to load, so a bad read cannot overwrite the file.
 */
export function useAwardFinishedRun(
  run: RogueliteRun | null | undefined,
  runId: string | undefined,
  { meta, loading, error, save }: AwardMetaState,
) {
  // The status last seen, and the finish waiting for the meta to load.
  const lastStatusRef = useRef<{ id: string; status: RunStatus } | null>(null);
  const pendingAwardRef = useRef<{ run: RogueliteRun; id: string } | null>(
    null,
  );

  useEffect(() => {
    if (run && runId) {
      const last = lastStatusRef.current;
      const before = last?.id === runId ? last.status : undefined;
      lastStatusRef.current = { id: runId, status: run.progress.status };
      if (justFinished(before, run.progress.status)) {
        pendingAwardRef.current = { run, id: runId };
      }
    }
    const pending = pendingAwardRef.current;
    if (!pending || loading || error) return;
    pendingAwardRef.current = null;
    const next = awardMeta(meta, pending.run, pending.id);
    if (next !== meta) save(next);
  }, [run, runId, meta, loading, error, save]);
}
