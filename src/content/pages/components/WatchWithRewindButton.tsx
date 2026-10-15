import { Button } from "@picoframe/frame";
import { Loader2, Rewind } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useReplayTarget } from "../../../play/config";
import { usePlay } from "../../../play/PlayProvider";
import { contentAnalysisCheck, type DemoInfo } from "../../bindings";
import { FRAMES_PER_SECOND } from "../../chatClock";
import {
  analysisBlockers,
  analysisRunHidden,
  refreshStoredAnalyses,
  requestAnalysis,
  useAnalysisQueue,
  useStoredAnalyses,
} from "../../replayAnalysis";
import type { ReplayWatch } from "../../replayEngine";
import { estimateRecording } from "../../replayRecordingEstimate";
import { rewindOffer } from "../../replayRewindOffer";
import {
  refreshStoredTracks,
  storedTracksNow,
  useRecordingCosts,
  useStoredTracks,
} from "../../replayTracks";
import { Confirmation, FAILURE_WORDS } from "./ReplayAnalysisSection";
import { useWatchReplay } from "./useWatchReplay";
import {
  isBlocked,
  launchBlockedReason,
  useWatchTarget,
} from "./useWatchTarget";

type Check = Awaited<ReturnType<typeof contentAnalysisCheck>>;

const HEADINGS = {
  none: "Record this replay, then watch it with rewind?",
  stale:
    "The recorded track is out of date. Record it again, then watch it with rewind?",
  failed: "The last recording failed. Try again, then watch it with rewind?",
} as const;

/**
 * Watch a replay in the engine on the playback game, with its recorded track
 * to rewind (#3803). It sits beside Watch and leaves Watch alone.
 *
 * With a current track it opens the playback game. Without one, or with an
 * out of date one, it asks once, with the cost the analysis section states,
 * records through the same queue, and opens the playback game when that
 * recording is done. A replay whose playback did not reproduce the match has no
 * track and will not get one, so the button says so and offers plain Watch.
 *
 * What happens after the person confirms belongs to this page: if they leave
 * it, the recording carries on in the queue and nothing opens. It does not open
 * over a game that is running, and it does not open after a cancelled, failed
 * or diverged recording.
 *
 * Everything about the replay's track is read from the stores the analysis
 * section reads, so the two cannot disagree.
 */
export function WatchWithRewindButton({
  replayPath,
  info,
  watch,
  dependencyBlock,
  playbackBlock,
  missingGame,
  missingMap,
  game,
}: {
  replayPath: string;
  info: DemoInfo;
  watch: ReplayWatch;
  /** `replayDependencyBlock` for the replay's own game, for plain Watch. */
  dependencyBlock: string | null;
  /** The same for the game the playback uses, which may be another version. */
  playbackBlock: string | null;
  missingGame: boolean;
  missingMap: boolean;
  /** Another installed version of the replay's game, when its own is missing. */
  game?: string;
}) {
  const hidden = analysisRunHidden();
  const resolveTarget = useWatchTarget(info.engineVersion, watch);
  const { resolved } = useReplayTarget(info.engineVersion);
  const { running, launchReplayPlayback } = usePlay();
  const plain = useWatchReplay(
    replayPath,
    info.engineVersion,
    watch,
    dependencyBlock,
  );
  const queue = useAnalysisQueue();
  const analyses = useStoredAnalyses();
  const tracks = useStoredTracks();
  const costs = useRecordingCosts();
  const [check, setCheck] = useState<Check | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** The person confirmed a recording from this page and it has not ended. */
  const [awaiting, setAwaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const runningNow = useRef(running);
  runningNow.current = running;

  // The recording engine is the one the analysis section records on. Another
  // engine is chosen in that section.
  const target = resolved?.matched ? resolved.target : null;
  const enginePath = target?.enginePath;

  useEffect(() => {
    if (hidden) return;
    let stale = false;
    setCheck(undefined);
    contentAnalysisCheck({
      replayPath,
      enginePaths: enginePath ? [enginePath] : [],
    }).then(
      (r) => {
        if (!stale) setCheck(r);
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [replayPath, hidden, enginePath]);

  const gameId = info.remixed ? undefined : info.gameId;
  const stored = gameId ? analyses.get(gameId) : undefined;
  const track = gameId ? tracks.get(gameId) : undefined;
  const busy =
    !!gameId &&
    !hidden &&
    (queue.running?.gameId === gameId ||
      queue.queued.some((job) => job.gameId === gameId));
  const failure =
    gameId && !hidden
      ? queue.failures.find((f) => f.gameId === gameId)
      : undefined;

  let recordBlocker: string | null = null;
  if (hidden) {
    recordBlocker = "Recording is turned off in this distribution.";
  } else if (check === undefined) {
    recordBlocker = "Checking this replay.";
  } else {
    const blockers = analysisBlockers({
      cannot: check.cannot,
      engineVersion: info.engineVersion,
      engineInstalled: target !== null,
      engineHeadless: target
        ? check.headless.includes(target.enginePath)
        : undefined,
      otherEngines: 0,
      missingGame,
      otherGame: !!game,
      missingMap,
      dependencyBlock: playbackBlock,
    });
    recordBlocker = check.cannot
      ? blockers[0]
      : target === null
        ? "Record this replay in the analysis and recording section, which can use another engine."
        : (blockers[0] ?? null);
  }

  const offer = rewindOffer({
    track,
    stored,
    busy,
    failed: failure !== undefined,
    recordBlocker,
  });

  async function launch() {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const t = await resolveTarget();
      if (!t) return;
      const res = await launchReplayPlayback({
        replayPath,
        executable: t.executable,
        dataDir: t.dataDir,
        game,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  async function record() {
    if (!target || !gameId) return;
    setConfirming(false);
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const outcome = await requestAnalysis({
        replayPath,
        enginePath: target.enginePath,
        dataDir: target.dataDir,
        game,
        // Whatever is stored, stale or current, is replaced on purpose.
        force: stored !== undefined || track !== undefined,
      });
      if (!mounted.current) return;
      if (outcome === "alreadyDone") {
        await openAfterRecording(true);
      } else {
        setAwaiting(true);
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  /**
   * The recording is over, however it ended. The stores learn of a finished job
   * and of its track in separate reads, so a missing track is read again before
   * it is taken to mean a cancelled or diverged run.
   */
  async function openAfterRecording(trackKnown: boolean) {
    if (!trackKnown) {
      await Promise.all([refreshStoredTracks(), refreshStoredAnalyses()]);
      if (!mounted.current) return;
      if (!gameId || storedTracksNow().get(gameId)?.state !== "current") return;
    }
    if (runningNow.current) {
      setNotice(
        "Recording finished. A game is running, so the engine did not open.",
      );
      return;
    }
    await launch();
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the job leaves the queue or fails, which is what ends a recording.
  useEffect(() => {
    if (!awaiting || busy) return;
    setAwaiting(false);
    if (failure) return;
    void openAfterRecording(false);
  }, [awaiting, busy, failure]);

  const launchBlock = launchBlockedReason(watch, playbackBlock);
  const unavailable = isBlocked(watch) || !!playbackBlock || running;
  const title =
    launchBlock ??
    (running && !pending ? "A game is already running." : undefined) ??
    (offer.kind === "recording"
      ? awaiting
        ? "Recording this replay. The engine opens when it finishes."
        : "This replay is being recorded."
      : offer.kind === "unavailable"
        ? offer.reason
        : undefined);
  const disabled =
    unavailable ||
    pending ||
    offer.kind === "recording" ||
    offer.kind === "unavailable";

  const estimate = estimateRecording(
    costs,
    info.gameType,
    info.durationSec * FRAMES_PER_SECOND,
  );

  const button = (
    <Button
      type="button"
      onClick={offer.kind === "ready" ? () => void launch() : undefined}
      disabled={disabled}
      title={title}
      className="gap-1.5"
    >
      {pending || offer.kind === "recording" ? (
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
      ) : (
        <Rewind className="size-4 fill-current" />
      )}
      Watch with rewind
    </Button>
  );

  const message =
    error ??
    plain.error ??
    (offer.kind === "record" && offer.why === "failed" && failure
      ? FAILURE_WORDS[failure.reason]
      : null);

  return (
    <div className="flex flex-col items-end gap-1">
      {offer.kind === "record" || offer.kind === "diverged" ? (
        <Popover open={confirming} onOpenChange={setConfirming}>
          <PopoverTrigger asChild>{button}</PopoverTrigger>
          <PopoverContent align="end" className="flex w-80 flex-col gap-3">
            {offer.kind === "record" ? (
              <Confirmation
                heading={HEADINGS[offer.why]}
                estimate={estimate}
                ownBytes={track?.sizeBytes ?? 0}
                onCancel={() => setConfirming(false)}
                onStart={() => void record()}
              />
            ) : (
              <>
                <p className="text-sm">
                  The playback did not reproduce this match when it was
                  recorded, so there is no track to rewind.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setConfirming(false);
                      void plain.watchReplay();
                    }}
                  >
                    Watch
                  </Button>
                </div>
              </>
            )}
          </PopoverContent>
        </Popover>
      ) : (
        button
      )}
      {message && (
        <p className="max-w-xs text-right text-xs text-destructive">
          {message}
        </p>
      )}
      {notice && (
        <p className="max-w-xs text-right text-xs text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}
