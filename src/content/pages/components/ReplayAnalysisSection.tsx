import { Button } from "@picoframe/frame";
import { ChevronRight, Loader2, ScanSearch, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmPopover } from "@/components/ConfirmPopover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { formatBytes, formatDuration } from "@/lib/format";
import {
  contentAnalysisCheck,
  type DemoInfo,
  type ReplayAnalysisFailure,
  type ReplayAnalysisRunningJob,
  type StoredReplayAnalysis,
} from "../../bindings";
import {
  analysisBlockers,
  analysisPercent,
  analysisProgressLabel,
  analysisRunHidden,
  cancelAnalysis,
  deleteStoredAnalysis,
  disagreementInWords,
  dismissAnalysisFailure,
  estimateAnalysisSeconds,
  requestAnalysis,
  useAnalysisQueue,
  useStoredAnalyses,
} from "../../replayAnalysis";
import { useMetricRegistry } from "../../useMetricRegistry";

type Check = Awaited<ReturnType<typeof contentAnalysisCheck>>;

/** How many disagreeing figures are listed before the rest go behind a disclosure. */
const FIGURES_SHOWN = 4;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** A length of time in words, to the nearest sensible unit. */
function roughly(seconds: number): string {
  if (seconds < 90)
    return plural(Math.max(1, Math.round(seconds)), "second", "seconds");
  return plural(Math.round(seconds / 60), "minute", "minutes");
}

/**
 * The replay page's analysis section (#1157, #1158).
 *
 * Analysing a replay plays the match back in the engine, on this computer, so
 * it never starts by itself: the button here is the only thing in the app that
 * asks for a run, and it says what it will do before it is pressed. Once a run
 * is asked for it belongs to the app's queue, not to this page, so leaving the
 * page changes nothing and coming back shows where it has got to.
 *
 * `analytics.run` hides the button and everything that steers a run. An
 * analysis that is already stored is still shown, with no way to make another.
 *
 * The page works out what is installed and hands it in, so this asks nothing
 * of the content scan itself.
 */
export function ReplayAnalysisSection({
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
   * plays from, as a replay launch resolves them. Null when that exact engine
   * is not installed.
   */
  target: { enginePath: string; dataDir: string } | null;
  missingGame: boolean;
  missingMap: boolean;
  dependencyBlock: string | null;
}) {
  const hidden = analysisRunHidden();
  const queue = useAnalysisQueue();
  const analyses = useStoredAnalyses();
  const [check, setCheck] = useState<Check | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hidden) return;
    let stale = false;
    setCheck(undefined);
    contentAnalysisCheck({ replayPath }).then(
      (r) => {
        if (!stale) setCheck(r);
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [replayPath, hidden]);

  // A remix carries its original's game id and has no analysis of its own.
  const gameId = info.remixed ? undefined : info.gameId;
  const stored = gameId ? analyses.get(gameId) : undefined;
  if (hidden && !stored) return null;

  // With the run hidden there is nothing here to follow or to steer.
  const jobId = hidden ? undefined : gameId;
  const running =
    jobId && queue.running?.gameId === jobId ? queue.running : null;
  const queuedAt = jobId
    ? queue.queued.findIndex((job) => job.gameId === jobId)
    : -1;
  const queued = queuedAt >= 0 ? queue.queued[queuedAt] : null;
  const failure = jobId
    ? queue.failures.find((f) => f.gameId === jobId)
    : undefined;

  const blockers = analysisBlockers({
    cannot: check?.cannot,
    engineVersion: info.engineVersion,
    engineInstalled: target !== null,
    missingGame,
    missingMap,
    dependencyBlock,
  });
  const ready = check !== undefined && blockers.length === 0 && target !== null;

  async function analyse(force: boolean) {
    if (!target) return;
    setPending(true);
    setError(null);
    try {
      await requestAnalysis({
        replayPath,
        enginePath: target.enginePath,
        dataDir: target.dataDir,
        force,
      });
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

  const button = (label: string, force: boolean) => (
    <Button
      type="button"
      variant="outline"
      className="w-fit gap-1.5"
      disabled={!ready || pending}
      onClick={() => analyse(force)}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
      ) : (
        <ScanSearch className="size-4" />
      )}
      {label}
    </Button>
  );

  const offer = (label: string, force: boolean) => (
    <>
      <BeforeRunning
        matchSeconds={info.durationSec}
        estimate={estimateAnalysisSeconds(analyses.values(), info.durationSec)}
      />
      {button(label, force)}
      {check !== undefined && blockers.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </>
  );

  return (
    <section className="flex flex-col gap-2" aria-label="Analysis">
      <h2 className="text-sm font-medium">Analysis</h2>
      <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-3 text-sm">
        {running ? (
          <Running
            job={running}
            onCancel={() => act(() => cancelAnalysis(running.id))}
          />
        ) : queued ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              {queue.waitingForGame
                ? "Queued. It starts when the game you are playing ends."
                : queuedAt === 0
                  ? "Queued. It is next."
                  : `Queued, with ${plural(queuedAt, "analysis", "analyses")} ahead of it.`}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => act(() => cancelAnalysis(queued.id))}
            >
              <X className="size-4" /> Cancel
            </Button>
          </div>
        ) : (
          <>
            {failure && !hidden && (
              <Failed
                failure={failure}
                onDismiss={() =>
                  act(() => dismissAnalysisFailure(failure.gameId))
                }
              />
            )}
            {stored ? (
              <Stored
                stored={stored}
                onDelete={() => act(() => deleteStoredAnalysis(stored.gameId))}
              />
            ) : null}
            {hidden
              ? null
              : stored?.state === "current"
                ? null
                : stored?.state === "outdated"
                  ? offer("Analyse again", true)
                  : stored?.state === "diverged" || failure
                    ? offer("Try again", false)
                    : offer("Analyse this replay", false)}
          </>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </section>
  );
}

/** What pressing the button will do, said before it is pressed. */
function BeforeRunning({
  matchSeconds,
  estimate,
}: {
  matchSeconds: number;
  estimate: { seconds: number; runs: number } | null;
}) {
  return (
    <p className="max-w-prose text-muted-foreground">
      Analysing plays this match back in the game's engine on this computer, to
      record where units were made and lost. The match is{" "}
      {formatDuration(matchSeconds)} long, and playback runs faster than the
      match did.{" "}
      {estimate &&
        `Going by the ${plural(estimate.runs, "analysis", "analyses")} this computer has finished, expect about ${roughly(estimate.seconds)}. `}
      The engine and the game the replay used must be installed. The result is
      kept, so this happens once.
    </p>
  );
}

function Running({
  job,
  onCancel,
}: {
  job: ReplayAnalysisRunningJob;
  onCancel: () => void;
}) {
  const label = analysisProgressLabel(job);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          Playing the match back. {label}.
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
      {job.phase === "playing" && (
        <Progress
          value={analysisPercent(job)}
          className="h-1.5 bg-muted"
          aria-label="Playback progress"
        />
      )}
      <p className="text-xs text-muted-foreground">
        The frame is where the playback had got to when a unit was last made or
        lost, so it can stand still for a while. You can leave this page.
      </p>
    </div>
  );
}

function Stored({
  stored,
  onDelete,
}: {
  stored: StoredReplayAnalysis;
  onDelete: () => void | Promise<void>;
}) {
  const diverged = stored.state === "diverged";
  const { counts } = stored;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          {diverged ? (
            <p>
              The playback did not reproduce the recorded match, so what it
              recorded was thrown away.
            </p>
          ) : (
            <p>
              Analysed. {plural(counts.unitCreated, "unit made", "units made")},{" "}
              {counts.unitFinished.toLocaleString()} finished and{" "}
              {counts.unitDestroyed.toLocaleString()} lost.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {diverged ? "Tried" : "Run"} {when(stored.analysedAtMs)} with{" "}
            {stored.game || "an unnamed game"} on engine{" "}
            {stored.engine || "unknown"}, in {roughly(stored.wallSeconds)}.
            {!diverged &&
              ` Takes ${formatBytes(stored.sizeBytes) ?? "0 B"} on disk.`}
          </p>
        </div>
        <ConfirmPopover
          triggerProps={{
            variant: "outline",
            size: "sm",
            className: "gap-1.5",
          }}
          heading={diverged ? "Forget this attempt?" : "Delete this analysis?"}
          description={
            diverged
              ? "Coilbox forgets that the playback did not match. The replay is not touched."
              : "The recorded events are deleted. The replay is not touched, and it can be analysed again."
          }
          confirmLabel={diverged ? "Forget it" : "Delete analysis"}
          busyLabel="Deleting"
          onConfirm={onDelete}
        >
          <Trash2 className="size-4" />{" "}
          {diverged ? "Forget" : "Delete analysis"}
        </ConfirmPopover>
      </div>
      {diverged && <Disagreements stored={stored} />}
      {stored.state === "outdated" && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          This analysis was made by an earlier version of coilbox, which
          recorded less than this one does. Analyse it again to bring it up to
          date.
        </p>
      )}
    </div>
  );
}

function Disagreements({ stored }: { stored: StoredReplayAnalysis }) {
  // A team statistic is named the way the rest of the page names it.
  const registry = useMetricRegistry();
  const labels = new Map(registry.map((m) => [m.key as string, m.label]));
  const figures = stored.disagreements.map((d) =>
    disagreementInWords(d, labels),
  );
  const first = figures.slice(0, FIGURES_SHOWN);
  const rest = figures.slice(FIGURES_SHOWN);
  return (
    <div className="flex flex-col gap-1 text-xs">
      <p className="text-muted-foreground">
        The usual reason is that the installed game or engine is not exactly the
        one the match was played on. What disagreed:
      </p>
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

const FAILURE_WORDS: Record<ReplayAnalysisFailure["reason"], string> = {
  tookTooLong: "The playback took too long and was stopped.",
  engineFailed: "The engine stopped before the match ended.",
  couldNotRun: "The analysis could not be run.",
};

function Failed({
  failure,
  onDismiss,
}: {
  failure: ReplayAnalysisFailure;
  onDismiss: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5" role="alert">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-destructive">{FAILURE_WORDS[failure.reason]}</p>
          <p className="text-xs text-muted-foreground">
            {failure.reason === "tookTooLong" && failure.limitSeconds
              ? `It was allowed ${roughly(failure.limitSeconds)}, which is the length of the match plus time for the engine to start. Nothing was stored.`
              : `${failure.message.charAt(0).toUpperCase()}${failure.message.slice(1)}. Nothing was stored.`}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {failure.logExcerpt.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group w-fit gap-1.5">
              <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
              What the engine said
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">
              {failure.logExcerpt.join("\n")}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
