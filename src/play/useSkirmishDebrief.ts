import { useCallback, useState } from "react";
import { contentDemoInfo, type DemoInfo } from "../content/bindings";
import type { ReplayProvenance } from "../content/replayUserState";
import type { GameResult, ResultChange } from "../records/bestResult";
import type { PlayTarget } from "./config";
import {
  type DebriefOutcome,
  type DebriefReason,
  describeOutcome,
} from "./debrief";
import { resultFromDemoInfo } from "./detect";
import { ingestFinishedReplay } from "./ingestFinishedReplay";
import { describeChange } from "./presetRecord";
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
  /** What this game did to the record of the preset it was launched from, or
   * null when the game did not count against one (the setup was changed, or
   * the replay was already recorded). */
  presetLine: string | null;
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
    show({
      outcome,
      headline,
      durationSec: null,
      replayFilename: null,
      presetLine: null,
    });
  }, [show]);

  const resolve = useCallback(
    async (opts: {
      target: PlayTarget;
      beforePaths: ReadonlySet<string>;
      playerName: string;
      setProvenance: (filename: string, provenance: ReplayProvenance) => void;
      /** The preset the launched setup counted against, or null when it
       * counted against none. */
      preset: { key: string; name: string } | null;
      /** Merge the game into that preset's record. Called once per replay. */
      recordResult: (key: string, result: GameResult) => ResultChange;
    }) => {
      const {
        target,
        beforePaths,
        playerName,
        setProvenance,
        preset,
        recordResult,
      } = opts;
      // The record is written here, when the replay is first read. The write is
      // keyed on the replay's filename, so reading it again cannot count it twice.
      const countAgainstPreset = (result: GameResult): string | null =>
        preset
          ? describeChange(recordResult(preset.key, result), preset.name)
          : null;
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
          show({
            outcome,
            headline,
            durationSec: null,
            replayFilename: null,
            presetLine: null,
          });
          return;
        }
        let info: DemoInfo | null = null;
        try {
          info = (
            await contentDemoInfo({
              enginePath: target.enginePath,
              replayPath: replay.path,
            })
          ).info;
        } catch {
          info = null;
        }
        const reason: DebriefReason = info
          ? resultFromDemoInfo(info, playerName)
          : "decode-failed";
        const { outcome, headline } = describeOutcome(reason);
        const durationSec = info?.durationSec ?? null;
        show({
          outcome,
          headline,
          durationSec,
          replayFilename: replay.filename,
          presetLine: countAgainstPreset({
            replayFilename: replay.filename,
            outcome,
            durationSec,
          }),
        });
        // After the drawer has its data, and not awaited, so a slow or failed
        // ingest cannot hold the debrief.
        void ingestFinishedReplay(target, replay);
      } finally {
        setChecking(false);
      }
    },
    [show],
  );

  return { debrief, open, checking, setOpen, resolve, markUndetectable, reset };
}
