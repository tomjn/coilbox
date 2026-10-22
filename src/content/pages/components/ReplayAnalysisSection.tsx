import { plural as icuPlural, t } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { ChevronRight, Loader2, ScanSearch, Trash2, X } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ConfirmPopover } from "@/components/ConfirmPopover";
import { OptionSelect } from "@/components/OptionSelect";
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
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatNumber,
} from "@/lib/format";
import {
  contentAnalysisCheck,
  type DemoInfo,
  type GameItem,
  type ReplayAnalysisFailure,
  type ReplayAnalysisRunningJob,
  type StoredReplayAnalysis,
  type StoredReplayTrack,
} from "../../bindings";
import { FRAMES_PER_SECOND } from "../../chatClock";
import {
  ANALYSIS_ACTION_ATTRIBUTE,
  ANALYSIS_SECTION_ID,
  analysisBlockers,
  analysisEngineOutput,
  analysisPercent,
  analysisProgressLabel,
  analysisRunHidden,
  cancelAnalysis,
  deleteStoredAnalysis,
  differenceNote,
  disagreementInWords,
  dismissAnalysisFailure,
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
import { budgetEffect, estimateRecording } from "../../replayRecordingEstimate";
import {
  useRecordingCosts,
  useStoredTracks,
  useTrackBudget,
  useTrackUsage,
} from "../../replayTracks";
import { useMetricRegistry } from "../../useMetricRegistry";
import { SectionHelp } from "./SectionHelp";

type Check = Awaited<ReturnType<typeof contentAnalysisCheck>>;
type Estimate = ReturnType<typeof estimateRecording>;

/** How many disagreeing figures are listed before the rest go behind a disclosure. */
const FIGURES_SHOWN = 4;

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function when(ms: number): string {
  return formatDateTime(new Date(ms), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** A length of time in words, to the nearest sensible unit. */
export function roughly(seconds: number): string {
  if (seconds < 90) {
    const count = Math.max(1, Math.round(seconds));
    return icuPlural(count, { one: "# second", other: "# seconds" });
  }
  const count = Math.round(seconds / 60);
  return icuPlural(count, { one: "# minute", other: "# minutes" });
}

/**
 * The replay page's analysis and recording section (#1157, #1158, #3788,
 * #3962).
 *
 * One playback of the match in the engine, on this computer, makes the
 * analysis and the track that rewind plays, so there is one section, one
 * button and one job for both. It never starts by itself: the button here is
 * the only thing in the app that asks for a run, and it says what the run will
 * cost before it starts. Once a run is asked for it belongs to the app's
 * queue, not to this page, so leaving the page changes nothing and coming back
 * shows where it has got to.
 *
 * A replay can have one of the two and not the other: tracks go when the disk
 * limit is reached and an analysis can be deleted by itself. The section says
 * which it has, and the button makes both again.
 *
 * `analytics.run` hides the button and everything that steers a run. An
 * analysis or a track that is already stored is still shown, with no way to
 * make another.
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
  const { t } = useLingui();
  const hidden = analysisRunHidden();
  const queue = useAnalysisQueue();
  const analyses = useStoredAnalyses();
  const tracks = useStoredTracks();
  const costs = useRecordingCosts();
  const [check, setCheck] = useState<Check | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
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

  // A remix carries its original's game id and has no analysis or track of
  // its own.
  const gameId = info.remixed ? undefined : info.gameId;
  const stored = gameId ? analyses.get(gameId) : undefined;
  const track = gameId ? tracks.get(gameId) : undefined;
  if (hidden && !stored && !track) return null;

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
    engineHeadless:
      target === null || check === undefined
        ? undefined
        : check.headless.includes(target.enginePath),
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

  async function analyse() {
    if (!run) return;
    setConfirming(false);
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const outcome = await requestAnalysis({
        replayPath,
        enginePath: run.enginePath,
        dataDir: run.dataDir,
        game: otherGame?.name,
        // Whatever is stored, stale or current, is replaced on purpose.
        force: stored !== undefined || track !== undefined,
      });
      if (outcome === "alreadyQueued") {
        setNote(t`This replay is already in the queue.`);
      } else if (outcome === "alreadyDone") {
        setNote(t`This replay is already analysed and recorded.`);
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

  const estimate = estimateRecording(
    costs,
    info.gameType,
    info.durationSec * FRAMES_PER_SECOND,
  );
  const analysed = stored?.state === "current";
  const recorded = track?.state === "current";
  // What the button is for. A run always makes both, so the words say what is
  // missing and the confirmation says what the run costs.
  const tryAgain = !!failure || stored?.state === "diverged";
  const label = tryAgain
    ? t`Try again`
    : analysed && !track
      ? t`Record this replay`
      : recorded && !stored
        ? t`Analyse this replay`
        : stored || track
          ? t`Analyse and record again`
          : t`Analyse and record this replay`;
  const chosenLabel = chosen?.label;
  const withChosen = tryAgain
    ? t`Try with ${chosenLabel}`
    : t`Analyse and record with ${chosenLabel}`;

  const offer = (
    <>
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
      <Popover open={confirming} onOpenChange={setConfirming}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-fit gap-1.5"
            disabled={!ready || pending}
            {...{ [ANALYSIS_ACTION_ATTRIBUTE]: "" }}
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <ScanSearch className="size-4" />
            )}
            {chosen ? withChosen : label}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="flex w-80 flex-col gap-3">
          <Confirmation
            estimate={estimate}
            ownBytes={track?.sizeBytes ?? 0}
            onCancel={() => setConfirming(false)}
            onStart={() => void analyse()}
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
      {check !== undefined && blockers.length > 0 && downloads}
    </>
  );

  return (
    <section
      id={ANALYSIS_SECTION_ID}
      className="flex flex-col gap-2"
      aria-label={t`Analysis and recording`}
    >
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-medium">
          <Trans>Analysis and recording</Trans>
        </h2>
        <SectionHelp section={t`the analysis and recording`}>
          <AnalysisHelp
            canRun={!hidden}
            matchSeconds={info.durationSec}
            estimate={estimate}
            hasEngineOptions={options.length > 0}
            gameUsed={otherGame ? gameUsed : null}
            running={!!running}
            diverged={stored?.state === "diverged"}
          />
        </SectionHelp>
      </div>
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
                ? t`Queued. It starts when the game you are playing ends.`
                : queuedAt === 0
                  ? t`Queued. It is next.`
                  : icuPlural(queuedAt, {
                      one: "Queued, with # replay ahead of it.",
                      other: "Queued, with # replays ahead of it.",
                    })}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => act(() => cancelAnalysis(queued.id))}
            >
              <X className="size-4" /> <Trans>Cancel</Trans>
            </Button>
          </div>
        ) : (
          <>
            {failure && !hidden && (
              <Failed
                failure={failure}
                earlierTrack={track !== undefined}
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
            {(track || (stored && stored.state !== "diverged")) && (
              <TrackLine track={track} />
            )}
            {!hidden && !(analysed && recorded) && offer}
          </>
        )}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </section>
  );
}

/**
 * Why the run behaves as it does, for the section's help entry: what it makes,
 * how long it takes, why a different engine often will not match, and what a
 * run and a failed match leave behind.
 */
function AnalysisHelp({
  canRun,
  matchSeconds,
  estimate,
  hasEngineOptions,
  gameUsed,
  running,
  diverged,
}: {
  canRun: boolean;
  matchSeconds: number;
  estimate: Estimate;
  hasEngineOptions: boolean;
  gameUsed: string | null;
  running: boolean;
  diverged: boolean;
}) {
  const duration = formatDuration(matchSeconds);
  const expected = estimate ? roughly(estimate.seconds) : "";
  const recordings = estimate ? estimate.runs : 0;
  return (
    <>
      <p>
        <Trans>
          Analysing plays the match back in the game's engine on this computer,
          to record where units were made and lost. The same playback records
          the whole match as a track, which is what the page shows and rewinds.
        </Trans>
      </p>
      {canRun && (
        <>
          <p>
            <Trans>
              The match is {duration} long, and playback runs faster than the
              match did.
            </Trans>
            {estimate && (
              <>
                {" "}
                <Trans>Expect about {expected}.</Trans>
              </>
            )}
            {estimate && (
              <>
                {" "}
                <Plural
                  value={recordings}
                  one="The estimate goes by the # recording of this game this computer has finished."
                  other="The estimate goes by the # recordings of this game this computer has finished."
                />
              </>
            )}{" "}
            <Trans>
              The engine and the game the replay used must be installed. The
              result is kept, so this happens once.
            </Trans>
          </p>
          <p>
            {hasEngineOptions && gameUsed ? (
              <Trans>
                A different engine or game version often computes a different
                match, because the engine only keeps its playback in step within
                one version. The result is kept only if the playback matches the
                recorded match exactly: who won, how long it lasted and every
                team's final totals. If it does not, no events and no track are
                kept and the page says so.
              </Trans>
            ) : hasEngineOptions ? (
              <Trans>
                A different engine often computes a different match, because the
                engine only keeps its playback in step within one version. The
                result is kept only if the playback matches the recorded match
                exactly: who won, how long it lasted and every team's final
                totals. If it does not, no events and no track are kept and the
                page says so.
              </Trans>
            ) : (
              <Trans>
                A different game version often computes a different match,
                because the engine only keeps its playback in step within one
                version. The result is kept only if the playback matches the
                recorded match exactly: who won, how long it lasted and every
                team's final totals. If it does not, no events and no track are
                kept and the page says so.
              </Trans>
            )}
          </p>
          <p>
            <Trans>
              Tracks share a limit on disk space. When a new track takes them
              past it, tracks that are out of date are removed first and then
              the ones watched longest ago. Their analyses stay.
            </Trans>
          </p>
          {hasEngineOptions && (
            <p>
              <Trans>
                Engines are listed newest first. Coilbox has no measure of which
                version is nearest to the one the replay was recorded on, so it
                has not picked one for that.
              </Trans>
            </p>
          )}
          {gameUsed && (
            <p>
              <Trans>
                The game version used is the highest numbered one installed, and
                coilbox cannot tell whether it is the nearest.
              </Trans>
            </p>
          )}
        </>
      )}
      {running && (
        <p>
          <Trans>
            The frame shown is where the playback had got to when a unit was
            last made or lost, so it can stand still for a while.
          </Trans>
        </p>
      )}
      {diverged && (
        <p>
          <Trans>
            The usual reason a playback does not match is that the installed
            game or engine is not exactly the one the match was played on.
          </Trans>
        </p>
      )}
    </>
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
  const { t } = useLingui();
  const tried = options.filter((o) => o.tried);
  const chosenLabel = chosen?.label;
  const triedLabels = tried.map((o) => o.label).join(", ");
  return (
    <div className="flex max-w-prose flex-col gap-2">
      {options.length > 0 && (
        <>
          <p>
            {recordedEngine
              ? t`This replay was recorded on engine ${recordedEngine}, which is not installed.`
              : t`This replay does not say which engine recorded it.`}{" "}
            {chosen
              ? t`The analysis will use engine ${chosenLabel} instead.`
              : t`Every installed engine has been tried and did not reproduce the match. Pick one to try it again.`}
          </p>
          {options.length > 1 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">
                <Trans>Engine to use</Trans>
              </span>
              <OptionSelect
                value={chosen?.path ?? ""}
                onValueChange={onPick}
                placeholder={t`Pick an engine`}
                size="sm"
                className="max-w-sm"
                ariaLabel={t`Engine to use`}
                options={options.map((o) => ({
                  value: o.path,
                  label: o.tried
                    ? t`${o.label} (did not reproduce this match)`
                    : o.label,
                }))}
              />
            </div>
          )}
          {tried.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <Trans>
                Already tried, and did not reproduce the match: {triedLabels}.
              </Trans>
            </p>
          )}
        </>
      )}
      {recordedGame && gameUsed && (
        <p>
          <Trans>
            The game this replay was recorded on, {recordedGame}, is not
            installed. The analysis will use {gameUsed}, another version of it.
          </Trans>
        </p>
      )}
    </div>
  );
}

/**
 * What pressing the button will do and cost, said before the run starts. Read
 * only while the popover is open, so the limit on disk space is not followed
 * while it is shut.
 */
export function Confirmation({
  estimate,
  ownBytes,
  onCancel,
  onStart,
  heading,
  startLabel,
}: {
  estimate: Estimate;
  /** What the replay's own track takes now, which a new one replaces. */
  ownBytes: number;
  onCancel: () => void;
  onStart: () => void;
  /** Left out, it asks about the section's own run. */
  heading?: string;
  startLabel?: string;
}) {
  const { t } = useLingui();
  const usage = useTrackUsage();
  const { budgetBytes } = useTrackBudget();
  const effect = budgetEffect({
    budgetBytes,
    totalBytes: usage.totalBytes,
    ownBytes,
    estimateBytes: estimate?.bytes ?? null,
  });
  const timeNeeded = estimate ? roughly(estimate.seconds) : null;
  const sizeNeeded = estimate ? formatBytes(estimate.bytes) : null;
  const limit = formatBytes(budgetBytes);
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-medium">
          {heading ?? t`Analyse and record this replay?`}
        </h3>
        <p className="text-xs text-muted-foreground">
          <Trans>This runs the game once, without a window.</Trans>
        </p>
        <p className="text-xs">
          {timeNeeded ? t`Time: about ${timeNeeded}` : t`Time: unknown`}
        </p>
        <p className="text-xs">
          {sizeNeeded
            ? t`Track size: about ${sizeNeeded}`
            : t`Track size: unknown`}
        </p>
        <p className="text-xs text-muted-foreground">
          {estimate
            ? icuPlural(estimate.runs, {
                one: "Estimated from # earlier recording of this game on this computer.",
                other:
                  "Estimated from # earlier recordings of this game on this computer.",
              })
            : t`Nothing of this game has been recorded on this computer yet.`}
        </p>
        {effect === "removesOlder" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t`Older tracks will be removed to stay within the ${limit} limit.`}
          </p>
        )}
        {effect === "largerThanBudget" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t`The track would be larger than the whole ${limit} limit. It is kept and every other track is removed.`}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button type="button" size="sm" onClick={onStart}>
          {startLabel ?? t`Start`}
        </Button>
      </div>
    </>
  );
}

/** Whether the replay has a track for rewind, beside what its analysis says. */
function TrackLine({ track }: { track: StoredReplayTrack | undefined }) {
  if (!track)
    return (
      <p>
        <Trans>Not recorded for rewind.</Trans>
      </p>
    );
  if (track.state === "stale") {
    return (
      <p className="text-xs text-amber-700 dark:text-amber-400">
        <Trans>
          The recorded track is out of date and is not played. A new run
          replaces it.
        </Trans>
      </p>
    );
  }
  const size = formatBytes(track.sizeBytes);
  return (
    <p>
      <Trans>Recorded for rewind. The track takes {size}.</Trans>
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
  const { t } = useLingui();
  const label = analysisProgressLabel(job);
  const [now, setNow] = useState(() => Date.now());
  const [outputOpen, setOutputOpen] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // Read only while it is open, and again each second: the engine goes on
  // writing for as long as it runs.
  useEffect(() => {
    if (!outputOpen) return;
    let stale = false;
    const read = () =>
      analysisEngineOutput(job.id).then(
        (lines) => {
          if (!stale) setOutput(lines);
        },
        () => {},
      );
    void read();
    const timer = setInterval(read, 1000);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [outputOpen, job.id]);
  // The newest line is the one worth reading, so the box stays at its end
  // until it is scrolled away from there.
  const outputBox = useRef<HTMLPreElement>(null);
  const atEnd = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the lines change, which is when the box grows.
  useLayoutEffect(() => {
    const box = outputBox.current;
    if (box && atEnd.current) box.scrollTop = box.scrollHeight;
  }, [output]);
  const elapsed = formatDuration(Math.max(0, (now - job.startedAtMs) / 1000));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
          {job.phase === "thinning"
            ? t`Making the track from the recording.`
            : t`Playing the match back. ${label}.`}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={job.cancelling}
          onClick={onCancel}
        >
          <X className="size-4" /> <Trans>Cancel</Trans>
        </Button>
      </div>
      {/* A bar only once there is a frame to draw it from. */}
      {job.phase === "playing" && (
        <Progress
          value={analysisPercent(job)}
          className="h-1.5 bg-muted"
          aria-label={t`Playback progress`}
        />
      )}
      <p className="text-xs text-muted-foreground">
        <Trans>Running for {elapsed}. You can leave this page.</Trans>
      </p>
      <Collapsible open={outputOpen} onOpenChange={setOutputOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="group w-fit gap-1.5">
            <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
            <Trans>What the engine is saying</Trans>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre
            ref={outputBox}
            onScroll={(e) => {
              const box = e.currentTarget;
              // Within a pixel, because scroll positions are fractional.
              atEnd.current =
                box.scrollHeight - box.scrollTop - box.clientHeight <= 1;
            }}
            className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs"
          >
            {output.length > 0
              ? output.join("\n")
              : t`The engine has written nothing yet.`}
          </pre>
        </CollapsibleContent>
      </Collapsible>
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
  const { t } = useLingui();
  const diverged = stored.state === "diverged";
  const { counts } = stored;
  const difference = differenceNote(stored);
  const attempts = divergedAttempts(stored);
  const unitsMade = icuPlural(counts.unitCreated, {
    one: "# unit made",
    other: "# units made",
  });
  const finished = formatNumber(counts.unitFinished);
  const lost = formatNumber(counts.unitDestroyed);
  const at = when(stored.analysedAtMs);
  const game = stored.game || t`an unnamed game`;
  const engine = stored.engine || t`unknown`;
  const took = roughly(stored.wallSeconds);
  const onDisk = formatBytes(stored.sizeBytes) ?? "0 B";
  const triedList = attempts
    .map((a) => {
      const attemptEngine = a.engine || t`unknown`;
      const attemptGame = a.game;
      return t`engine ${attemptEngine} with ${attemptGame}`;
    })
    .join(", ");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          {diverged ? (
            <p>
              <Trans>
                The playback did not reproduce the recorded match, so what it
                recorded was thrown away.
              </Trans>
            </p>
          ) : (
            <p>
              <Trans>
                Analysed. {unitsMade}, {finished} finished and {lost} lost.
              </Trans>
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {diverged
              ? t`Tried ${at} with ${game} on engine ${engine}, in ${took}.`
              : t`Run ${at} with ${game} on engine ${engine}, in ${took}.`}
            {!diverged && ` ${t`Takes ${onDisk} on disk.`}`}
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
          heading={
            diverged ? t`Forget this attempt?` : t`Delete this analysis?`
          }
          description={
            diverged
              ? t`Coilbox forgets that the playback did not match. The replay is not touched.`
              : t`The recorded events are deleted. The replay is not touched, and it can be analysed again.`
          }
          confirmLabel={diverged ? t`Forget it` : t`Delete analysis`}
          busyLabel={t`Deleting`}
          onConfirm={onDelete}
        >
          <Trash2 className="size-4" />{" "}
          {diverged ? t`Forget` : t`Delete analysis`}
        </ConfirmPopover>
      </div>
      {diverged && <Disagreements stored={stored} />}
      {diverged && attempts.length > 1 && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Tried so far, and none reproduced the match: {triedList}.
          </Trans>
        </p>
      )}
      {stored.state === "outdated" && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          <Trans>
            This analysis was made by an earlier version of coilbox, which
            recorded less than this one does. Analyse it again to bring it up to
            date.
          </Trans>
        </p>
      )}
    </div>
  );
}

function Disagreements({ stored }: { stored: StoredReplayAnalysis }) {
  // A team statistic is named the way the rest of the page names it.
  const { t } = useLingui();
  const registry = useMetricRegistry();
  const labels = new Map(registry.map((m) => [m.key as string, m.label]));
  const figures = stored.disagreements.map((d) =>
    disagreementInWords(d, labels),
  );
  const first = figures.slice(0, FIGURES_SHOWN);
  const rest = figures.slice(FIGURES_SHOWN);
  return (
    <div className="flex flex-col gap-1 text-xs">
      <p className="text-muted-foreground">{t`What disagreed:`}</p>
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
              {icuPlural(rest.length, {
                one: "# more figure",
                other: "# more figures",
              })}
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

/**
 * Getters, so a caller that indexes this at render reads the active language
 * (`WatchWithRewindButton` does).
 */
export const FAILURE_WORDS: Record<ReplayAnalysisFailure["reason"], string> = {
  get tookTooLong() {
    return t`The playback took too long and was stopped.`;
  },
  get engineFailed() {
    return t`The engine stopped before the match ended.`;
  },
  get couldNotRun() {
    return t`The analysis and recording could not be run.`;
  },
  get thinFailed() {
    return t`The recording could not be made into a track.`;
  },
};

function Failed({
  failure,
  earlierTrack,
  onDismiss,
}: {
  failure: ReplayAnalysisFailure;
  /** The replay has a track from an earlier run, which a failed run leaves. */
  earlierTrack: boolean;
  onDismiss: () => void;
}) {
  const { t } = useLingui();
  const allowed = failure.limitSeconds ? roughly(failure.limitSeconds) : "";
  const reasonText = `${failure.message.charAt(0).toUpperCase()}${failure.message.slice(1)}`;
  return (
    <div className="flex flex-col gap-1.5" role="alert">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-destructive">{FAILURE_WORDS[failure.reason]}</p>
          <p className="text-xs text-muted-foreground">
            {failure.reason === "tookTooLong" && failure.limitSeconds
              ? t`It was allowed ${allowed}, which is the length of the match plus time for the engine to start. Nothing was stored.`
              : `${reasonText}. ${earlierTrack ? t`The earlier track was kept.` : t`No track was made.`}`}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          <Trans>Dismiss</Trans>
        </Button>
      </div>
      {failure.logExcerpt.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group w-fit gap-1.5">
              <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
              <Trans>What the engine said</Trans>
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
