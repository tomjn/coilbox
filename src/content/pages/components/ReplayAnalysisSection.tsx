import { Button } from "@picoframe/frame";
import { ChevronRight, Loader2, ScanSearch, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ConfirmPopover } from "@/components/ConfirmPopover";
import { OptionSelect } from "@/components/OptionSelect";
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
  type GameItem,
  type ReplayAnalysisFailure,
  type ReplayAnalysisRunningJob,
  type StoredReplayAnalysis,
} from "../../bindings";
import {
  ANALYSIS_SECTION_ID,
  analysisBlockers,
  analysisPercent,
  analysisProgressLabel,
  analysisRunHidden,
  cancelAnalysis,
  deleteStoredAnalysis,
  differenceNote,
  disagreementInWords,
  dismissAnalysisFailure,
  estimateAnalysisSeconds,
  requestAnalysis,
  useAnalysisQueue,
  useStoredAnalyses,
} from "../../replayAnalysis";
import {
  divergedAttempts,
  type EngineOption,
  type InstalledEngine,
  otherEngineOptions,
  otherGameVersion,
  useInstalledEngines,
} from "../../replayAnalysisOffer";
import { replayDependencyBlock } from "../../replayEngine";
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
export function ReplayAnalysisSection(props: SectionProps) {
  // With the run hidden nothing is run, so the engines are not asked for.
  return analysisRunHidden() ? (
    <AnalysisBody {...props} engines={[]} />
  ) : (
    <WithEngines {...props} />
  );
}

function WithEngines(props: SectionProps) {
  return <AnalysisBody {...props} engines={useInstalledEngines()} />;
}

interface SectionProps {
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
  /** The installed games, to find another version of a missing one. */
  installedGames?: GameItem[];
  /**
   * The page's offer to download whatever the replay is missing, shown beside
   * the reasons an analysis cannot run. It renders nothing when nothing is
   * missing, and it is the page's own, so a download here is the same download.
   */
  downloads?: ReactNode;
}

function AnalysisBody({
  replayPath,
  info,
  target,
  missingGame,
  missingMap,
  dependencyBlock,
  installedGames = [],
  downloads = null,
  engines,
}: SectionProps & { engines: InstalledEngine[] }) {
  const hidden = analysisRunHidden();
  const queue = useAnalysisQueue();
  const analyses = useStoredAnalyses();
  const [check, setCheck] = useState<Check | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The engine the person picked, by path. Unset until they pick one. */
  const [picked, setPicked] = useState<string | null>(null);
  const enginePaths = engines.map((e) => e.path).join("\n");

  useEffect(() => {
    if (hidden) return;
    let stale = false;
    setCheck(undefined);
    contentAnalysisCheck({
      replayPath,
      enginePaths: enginePaths ? enginePaths.split("\n") : [],
    }).then(
      (r) => {
        if (!stale) setCheck(r);
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [replayPath, hidden, enginePaths]);

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

  // The recorded game, or another installed version of it (#3869).
  const otherGame = missingGame
    ? otherGameVersion(info.gameType, installedGames)
    : null;
  const gameUsed = otherGame?.name ?? info.gameType;
  // What earlier runs on other engines found. Only a diverged file has any.
  const attempts = divergedAttempts(stored);
  const options: EngineOption[] =
    target === null
      ? otherEngineOptions({
          recorded: info.engineVersion,
          engines,
          headless: check?.headless ?? [],
          attempts,
          game: gameUsed,
        })
      : [];
  // The newest engine not yet tried. When every one has been tried there is
  // no default, and a person has to ask for one to run it again.
  const chosen =
    options.find((o) => o.path === picked) ??
    options.find((o) => !o.tried) ??
    null;
  const run =
    target ?? (chosen && { enginePath: chosen.path, dataDir: chosen.dataDir });

  const blockers = analysisBlockers({
    cannot: check?.cannot,
    engineVersion: info.engineVersion,
    engineInstalled: target !== null,
    otherEngines: options.length,
    installedEngines: engines.length,
    missingGame,
    otherGame: otherGame !== null,
    missingMap,
    dependencyBlock: otherGame
      ? replayDependencyBlock(otherGame.name, installedGames)
      : dependencyBlock,
  });
  const ready = check !== undefined && blockers.length === 0 && run !== null;
  const substitution = check !== undefined && (options.length > 0 || otherGame);

  async function analyse(force: boolean) {
    if (!run) return;
    setPending(true);
    setError(null);
    try {
      await requestAnalysis({
        replayPath,
        enginePath: run.enginePath,
        dataDir: run.dataDir,
        game: otherGame?.name,
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
      {substitution && (
        <Substitution
          recordedEngine={info.engineVersion}
          options={options}
          chosen={chosen}
          onPick={setPicked}
          recordedGame={otherGame ? info.gameType : null}
          gameUsed={otherGame ? gameUsed : null}
        />
      )}
      {button(
        chosen
          ? `${label.startsWith("Try") ? "Try" : "Analyse"} with ${chosen.label}`
          : label,
        force,
      )}
      {check !== undefined && blockers.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-amber-700 dark:text-amber-400">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {check !== undefined && blockers.length > 0 && downloads}
    </>
  );

  return (
    <section
      id={ANALYSIS_SECTION_ID}
      className="flex flex-col gap-2"
      aria-label="Analysis"
    >
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

/**
 * What will be used in place of what the replay was recorded with, said before
 * the button is pressed (#3869).
 *
 * The app has an order for engine versions and no measure of how near one is
 * to another, so the engines are listed newest first and the newest not yet
 * tried is the one picked. The odds are not guessed at: all this says is what
 * the engine's design supports, that its simulation is only kept in step
 * within one version, and that the result is kept only when the playback
 * matches the recorded match exactly.
 */
function Substitution({
  recordedEngine,
  options,
  chosen,
  onPick,
  recordedGame,
  gameUsed,
}: {
  recordedEngine: string;
  options: EngineOption[];
  chosen: EngineOption | null;
  onPick: (path: string) => void;
  recordedGame: string | null;
  gameUsed: string | null;
}) {
  const tried = options.filter((o) => o.tried);
  return (
    <div className="flex max-w-prose flex-col gap-2">
      {options.length > 0 && (
        <>
          <p>
            {recordedEngine
              ? `This replay was recorded on engine ${recordedEngine}, which is not installed.`
              : "This replay does not say which engine recorded it."}{" "}
            {chosen
              ? `The analysis will use engine ${chosen.label} instead.`
              : "Every installed engine has been tried and did not reproduce the match. Pick one to try it again."}
          </p>
          {options.length > 1 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">Engine to use</span>
              <OptionSelect
                value={chosen?.path ?? ""}
                onValueChange={onPick}
                placeholder="Pick an engine"
                size="sm"
                className="max-w-sm"
                ariaLabel="Engine to use"
                options={options.map((o) => ({
                  value: o.path,
                  label: o.tried
                    ? `${o.label} (did not reproduce this match)`
                    : o.label,
                }))}
              />
              <span className="text-xs text-muted-foreground">
                Newest first. Coilbox has no measure of which version is nearest
                to the one the replay was recorded on, so it has not picked one
                for that.
              </span>
            </div>
          )}
          {tried.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Already tried, and did not reproduce the match:{" "}
              {tried.map((o) => o.label).join(", ")}.
            </p>
          )}
        </>
      )}
      {recordedGame && gameUsed && (
        <p>
          The game this replay was recorded on, {recordedGame}, is not
          installed. The analysis will use {gameUsed}, another version of it.
          That is the highest numbered version installed, and coilbox cannot
          tell whether it is the nearest.
        </p>
      )}
      <p className="text-muted-foreground">
        A different{" "}
        {options.length > 0 && gameUsed
          ? "engine or game version"
          : options.length > 0
            ? "engine"
            : "game version"}{" "}
        often computes a different match, because the engine only keeps its
        playback in step within one version. The result is kept only if the
        playback matches the recorded match exactly: who won, how long it lasted
        and every team's final totals. If it does not, no events are kept and
        the page says so.
      </p>
    </div>
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
  const difference = differenceNote(stored);
  const attempts = divergedAttempts(stored);
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
          {difference && (
            <p className="max-w-prose text-xs text-amber-700 dark:text-amber-400">
              {difference}
            </p>
          )}
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
      {diverged && attempts.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Tried so far, and none reproduced the match:{" "}
          {attempts
            .map((a) => `engine ${a.engine || "unknown"} with ${a.game}`)
            .join(", ")}
          .
        </p>
      )}
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
