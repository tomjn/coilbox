import { useCallback, useState } from "react";
import { contentDemoInfo } from "../content/bindings";
import type { ReplayProvenance } from "../content/replayUserState";
import type { PlayTarget } from "./config";
import {
  type DebriefOutcome,
  type DebriefReason,
  describeOutcome,
} from "./debrief";
import { resultFromDemoInfo } from "./detect";
import { tagFreshReplay } from "./tagReplayProvenance";

export interface SkirmishDebrief {
  outcome: DebriefOutcome;
  headline: string;
  /** In-game duration, seconds; null when it couldn't be read (no replay, or
   * the replay failed to decode). */
  durationSec: number | null;
  /** The fresh replay's filename, for the "view replay" link; null when none
   * was found. */
  replayFilename: string | null;
}

/**
 * Post-skirmish debrief for the plain Skirmish page (#370) — mirrors
 * `conquest/run.ts`/`campaign/run.ts`'s replay-based result detection, minus
 * the strategic layer they advance: this just surfaces the winner and
 * duration for a summary panel. Reuses `tagFreshReplay` (already called to
 * tag the replay's provenance) so the fresh replay is only located once.
 */
export function useSkirmishDebrief() {
  const [debrief, setDebrief] = useState<SkirmishDebrief | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const show = useCallback((d: SkirmishDebrief) => {
    setDebrief(d);
    setOpen(true);
  }, []);

  /** Hide the drawer without discarding the last debrief's data, so a rematch
   * (which reopens it once resolved) doesn't flash empty content mid-close
   * animation. Call before a new launch starts. */
  const reset = useCallback(() => setOpen(false), []);

  /** No detection was possible at all (the pre-launch replay snapshot itself
   * failed) — still show a debrief, honestly reporting the outcome as unknown
   * rather than skipping the panel. */
  const markUndetectable = useCallback(() => {
    const { outcome, headline } = describeOutcome("no-replay");
    show({ outcome, headline, durationSec: null, replayFilename: null });
  }, [show]);

  const resolve = useCallback(
    async (opts: {
      target: PlayTarget;
      beforePaths: ReadonlySet<string>;
      playerName: string;
      setProvenance: (filename: string, provenance: ReplayProvenance) => void;
    }) => {
      const { target, beforePaths, playerName, setProvenance } = opts;
      setChecking(true);
      try {
        const replay = await tagFreshReplay(
          target.dataDir,
          beforePaths,
          { mode: "skirmish" },
          setProvenance,
        );
        if (!replay) {
          const { outcome, headline } = describeOutcome("no-replay");
          show({ outcome, headline, durationSec: null, replayFilename: null });
          return;
        }
        try {
          const { info } = await contentDemoInfo({
            enginePath: target.enginePath,
            replayPath: replay.path,
          });
          const reason: DebriefReason = resultFromDemoInfo(info, playerName);
          const { outcome, headline } = describeOutcome(reason);
          show({
            outcome,
            headline,
            durationSec: info.durationSec,
            replayFilename: replay.filename,
          });
        } catch {
          const { outcome, headline } = describeOutcome("decode-failed");
          show({
            outcome,
            headline,
            durationSec: null,
            replayFilename: replay.filename,
          });
        }
      } finally {
        setChecking(false);
      }
    },
    [show],
  );

  return { debrief, open, checking, setOpen, resolve, markUndetectable, reset };
}
