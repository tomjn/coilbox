import { Button } from "@picoframe/frame";
import { ChevronRight, Loader2, Video, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/format";
import {
  contentAnalysisCheck,
  type DemoInfo,
  type ReplayAnalysisFailure,
} from "../../bindings";
import { FRAMES_PER_SECOND } from "../../chatClock";
import {
  analysisRunHidden,
  cancelAnalysis,
  disagreementInWords,
  dismissAnalysisFailure,
} from "../../replayAnalysis";
import {
  type RecordingJobState,
  requestRecording,
  useRecordingJob,
} from "../../replayRecording";
import { budgetEffect, estimateRecording } from "../../replayRecordingEstimate";
import {
  refreshStoredTracks,
  useRecordingCosts,
  useStoredTracks,
  useTrackBudget,
  useTrackUsage,
} from "../../replayTracks";
import { useMetricRegistry } from "../../useMetricRegistry";
import { plural, roughly } from "./ReplayAnalysisSection";

type Check = Awaited<ReturnType<typeof contentAnalysisCheck>>;

/** How many disagreeing figures are listed before the rest go behind a disclosure. */
const FIGURES_SHOWN = 4;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const capital = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/**
 * The replay page's control for recording a replay as a track for rewind
 * (#3788).
 *
 * A recording plays the match back in the engine without a window, so it never
 * starts by itself: the button here is the only thing on the page that asks for
 * one, and it says what it will cost before it does. Once asked for, the job
 * belongs to the app's queue, the same one an analysis runs in, so leaving the
 * page changes nothing and coming back shows where it has got to.
 *
 * `analytics.run` hides the button and everything that steers a job. A track
 * that is already stored is still shown.
 */
export function ReplayRecordingSection({
  replayPath,
  info,
  target,
  missingGame,
  missingMap,
  dependencyBlock,
}: {
  replayPath: string;
  info: DemoInfo;
  /**
   * The installed engine the replay was recorded on and the content folder it
   * plays from. Null when that exact engine is not installed.
   */
  target: { enginePath: string; dataDir: string } | null;
  missingGame: boolean;
  missingMap: boolean;
  dependencyBlock: string | null;
}) {
  const hidden = analysisRunHidden();
  const tracks = useStoredTracks();
  const costs = useRecordingCosts();
  // A remix carries its original's game id and has no track of its own.
  const gameId = info.remixed ? undefined : info.gameId;
  const job = useRecordingJob(hidden ? undefined : gameId);
  const [check, setCheck] = useState<Check | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  const track = gameId ? tracks.get(gameId) : undefined;
  if (hidden && !track) return null;

  const blockers = recordingBlockers({
    check,
    remixed: !!info.remixed,
    engineVersion: info.engineVersion,
    target,
    missingGame,
    missingMap,
    dependencyBlock,
  });
  const ready = check !== undefined && blockers.length === 0 && target !== null;

  const estimate = estimateRecording(
    costs,
    info.gameType,
    info.durationSec * FRAMES_PER_SECOND,
  );
  async function record() {
    if (!target) return;
    setOpen(false);
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const outcome = await requestRecording({
        replayPath,
        enginePath: target.enginePath,
        dataDir: target.dataDir,
        // A track that is there, stale or current, is replaced on purpose.
        force: track !== undefined,
      });
      if (outcome === "joined") {
        setNote(
          "This replay was waiting to be analysed. It will be recorded as well.",
        );
      } else if (outcome === "alreadyQueued") {
        setNote("This replay is already in the queue.");
      } else if (outcome === "alreadyRecorded") {
        setNote("This replay is already recorded.");
        void refreshStoredTracks();
      }
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setPending(false);
    }
  }

  async function act(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errMessage(e));
    }
  }

  const failed =
    job.state === "diverged" || job.state === "failed" ? job : null;
  const label = failed
    ? "Try again"
    : track?.state === "stale"
      ? "Record again"
      : "Record this replay";
  const offered = !hidden && (failed || track?.state !== "current");

  return (
    <section className="flex flex-col gap-2" aria-label="Recording">
      <h2 className="text-sm font-medium">Rewind recording</h2>
      <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-3 text-sm">
        {job.state === "queued" ? (
          <Queued
            job={job}
            onCancel={() => act(() => cancelAnalysis(job.id))}
          />
        ) : job.state === "recording" || job.state === "thinning" ? (
          <Active
            job={job}
            onCancel={() => act(() => cancelAnalysis(job.id))}
          />
        ) : (
          <>
            {failed && (
              <Failed
                job={failed}
                earlierTrack={track !== undefined}
                onDismiss={() =>
                  act(() => dismissAnalysisFailure(gameId ?? ""))
                }
              />
            )}
            {track?.state === "current" && (
              <p>Recorded. The track takes {formatBytes(track.sizeBytes)}.</p>
            )}
            {track?.state === "stale" && (
              <p>
                The recorded track is out of date and is not played. Recording
                the replay again replaces it.
              </p>
            )}
            {!track && !failed && <p>Not recorded.</p>}
            {offered && (
              <div className="flex flex-col gap-2">
                <Popover open={open} onOpenChange={setOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-fit gap-1.5"
                      disabled={!ready || pending}
                    >
                      {pending ? (
                        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                      ) : (
                        <Video className="size-4" />
                      )}
                      {label}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="flex w-80 flex-col gap-3"
                  >
                    <Confirmation
                      estimate={estimate}
                      ownBytes={track?.sizeBytes ?? 0}
                      onCancel={() => setOpen(false)}
                      onRecord={() => void record()}
                    />
                  </PopoverContent>
                </Popover>
                {check !== undefined && blockers.length > 0 && (
                  <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
                    {blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </section>
  );
}

/**
 * What pressing the button will do and cost, said before it is pressed. Read
 * only while the popover is open, so the budget is not followed while it is
 * shut.
 */
function Confirmation({
  estimate,
  ownBytes,
  onCancel,
  onRecord,
}: {
  estimate: ReturnType<typeof estimateRecording>;
  /** What the replay's own track takes now, which recording it replaces. */
  ownBytes: number;
  onCancel: () => void;
  onRecord: () => void;
}) {
  const usage = useTrackUsage();
  const { budgetBytes } = useTrackBudget();
  const effect = budgetEffect({
    budgetBytes,
    totalBytes: usage.totalBytes,
    ownBytes,
    estimateBytes: estimate?.bytes ?? null,
  });
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-medium">Record this replay?</h3>
        <p className="text-xs text-muted-foreground">
          This runs the game without a window.
        </p>
        <p className="text-xs">
          {`Time: ${estimate ? `about ${roughly(estimate.seconds)}` : "unknown"}`}
        </p>
        <p className="text-xs">
          {`Size: ${estimate ? `about ${formatBytes(estimate.bytes)}` : "unknown"}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {estimate
            ? `Estimated from ${plural(estimate.runs, "earlier recording", "earlier recordings")} of this game on this computer.`
            : "Nothing of this game has been recorded on this computer yet."}
        </p>
        {effect === "removesOlder" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {`Older tracks will be removed to stay within the ${formatBytes(budgetBytes)} limit.`}
          </p>
        )}
        {effect === "largerThanBudget" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {`The track would be larger than the whole ${formatBytes(budgetBytes)} limit. It is kept and every other track is removed.`}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onRecord}>
          Record
        </Button>
      </div>
    </>
  );
}

/**
 * What stops a replay being recorded, each as a sentence to show. Empty while
 * the replay is still being checked, and when nothing does.
 */
function recordingBlockers(facts: {
  check: Check | undefined;
  remixed: boolean;
  engineVersion: string;
  target: { enginePath: string } | null;
  missingGame: boolean;
  missingMap: boolean;
  dependencyBlock: string | null;
}): string[] {
  const { check } = facts;
  if (check === undefined) return [];
  if (facts.remixed || check.cannot === "remix") {
    return [
      "This is a remix. It has no track of its own, so record the original.",
    ];
  }
  switch (check.cannot) {
    case "noGameOver":
      return [
        "This match never recorded a game over, usually because it was quit before it ended, so there is nothing to check a recording against.",
      ];
    case "noGameId":
      return [
        "This replay has no game id, so there is nothing to file a track under.",
      ];
    case "unreadable":
      return ["This file does not read as a replay."];
  }
  const blockers: string[] = [];
  if (!facts.target) {
    blockers.push(
      facts.engineVersion
        ? `Engine ${facts.engineVersion} is not installed.`
        : "This replay does not say which engine recorded it.",
    );
  } else if (!check.headless.includes(facts.target.enginePath)) {
    blockers.push(
      `Engine ${facts.engineVersion} has no headless build, which a recording needs.`,
    );
  }
  if (facts.missingGame) blockers.push("The game is not installed.");
  if (facts.missingMap) blockers.push("The map is not installed.");
  if (facts.dependencyBlock) blockers.push(facts.dependencyBlock);
  return blockers;
}

function Queued({
  job,
  onCancel,
}: {
  job: Extract<RecordingJobState, { state: "queued" }>;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p>
        {job.waitingForGame
          ? "Queued. It starts when the game you are playing ends."
          : job.ahead === 0
            ? "Queued. It is next."
            : `Queued, with ${plural(job.ahead, "job", "jobs")} ahead of it.`}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={onCancel}
      >
        <X className="size-4" /> Cancel
      </Button>
    </div>
  );
}

function Active({
  job,
  onCancel,
}: {
  job: Extract<RecordingJobState, { state: "recording" | "thinning" }>;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          {activeWords(job)}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={job.cancelling}
          onClick={onCancel}
        >
          <X className="size-4" /> Cancel
        </Button>
      </div>
      {/* A bar only once there is a frame to draw it from. */}
      {job.state === "recording" && job.phase === "playing" && (
        <Progress
          value={job.percent}
          className="h-1.5 bg-muted"
          aria-label="Recording progress"
        />
      )}
    </div>
  );
}

function activeWords(
  job: Extract<RecordingJobState, { state: "recording" | "thinning" }>,
): string {
  if (job.cancelling) return "Stopping the recording.";
  if (job.state === "thinning") return "Making the track from the recording.";
  if (job.phase === "starting")
    return "Recording the match. Starting the engine.";
  if (job.phase === "loading") return "Recording the match. Loading the match.";
  // The header holds whole seconds, so the last event can land past it.
  const frame = Math.min(job.frame, job.lastFrame);
  return `Recording the match. Frame ${frame.toLocaleString()} of ${job.lastFrame.toLocaleString()}.`;
}

const FAILURE_WORDS: Record<ReplayAnalysisFailure["reason"], string> = {
  tookTooLong: "The playback took too long and was stopped.",
  engineFailed: "The engine stopped before the match ended.",
  couldNotRun: "The recording could not be run.",
  diverged: "The playback did not reproduce the match, so no track was made.",
  thinFailed: "The recording could not be made into a track.",
};

function Failed({
  job,
  earlierTrack,
  onDismiss,
}: {
  job: Extract<RecordingJobState, { state: "diverged" | "failed" }>;
  earlierTrack: boolean;
  onDismiss: () => void;
}) {
  const reason = job.state === "diverged" ? "diverged" : job.reason;
  return (
    <div className="flex flex-col gap-1.5" role="alert">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-destructive">{FAILURE_WORDS[reason]}</p>
          {job.state === "failed" && (
            <p className="text-xs text-muted-foreground">
              {`${capital(job.message)}. ${earlierTrack ? "The earlier track was kept." : "No track was made."}`}
            </p>
          )}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {job.state === "diverged" && job.disagreements.length > 0 && (
        <Disagreements disagreements={job.disagreements} />
      )}
      {job.logExcerpt.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group w-fit gap-1.5">
              <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
              What the engine said
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">
              {job.logExcerpt.join("\n")}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function Disagreements({
  disagreements,
}: {
  disagreements: Extract<
    RecordingJobState,
    { state: "diverged" }
  >["disagreements"];
}) {
  // A team statistic is named the way the rest of the page names it.
  const registry = useMetricRegistry();
  const labels = new Map(registry.map((m) => [m.key as string, m.label]));
  const figures = disagreements.map((d) => disagreementInWords(d, labels));
  const first = figures.slice(0, FIGURES_SHOWN);
  const rest = figures.slice(FIGURES_SHOWN);
  return (
    <div className="flex flex-col gap-1 text-xs">
      <p className="text-muted-foreground">What disagreed:</p>
      <ul className="flex list-disc flex-col gap-0.5 pl-4">
        {first.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      {rest.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group w-fit gap-1.5">
              <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
              {plural(rest.length, "more figure", "more figures")}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="flex list-disc flex-col gap-0.5 pl-4">
              {rest.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
