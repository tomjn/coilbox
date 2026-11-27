import { Trans, useLingui } from "@lingui/react/macro";
import { ArrowLeft, Code2 } from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import { notify } from "@/notify/notify";
import { useReplayTarget } from "../../play/config";
import { isProfileHidden } from "../../profile/hidden";
import {
  invalidateMapPreview,
  useDemoInfo,
  useReplays,
  useScanTargetSelection,
  useUnitsyncScan,
} from "../config";
import {
  analysisRunHidden,
  goToAnalysisSection,
  openAnalysisRun,
  SHOW_ANALYSIS_EVENT,
  useStoredAnalyses,
} from "../replayAnalysis";
import { otherGameVersion } from "../replayAnalysisOffer";
import { DOCK_MAX_HEIGHT } from "../replayDockRows";
import { replayDependencyBlock } from "../replayEngine";
import { provenanceLink } from "../replayProvenanceLink";
import { teamResultLabel } from "../replaySideLabel";
import { useReplayUserState } from "../replayUserState";
import { gameNamesMatch } from "../resolveContent";
import { MatchClockProvider } from "../useMatchClock";
import { useReplayEngine } from "../useReplayEngine";
import { useReplayFactions } from "../useReplayFactions";
import { useReplaysRoot } from "../useReplaysRoot";
import { SeriesEmphasisProvider } from "../useSeriesEmphasis";
import { unfinishedWarning } from "./components/ClearUnfinishedButton";
import { DeleteReplayButton } from "./components/DeleteReplayButton";
import { MatchStatsSection } from "./components/MatchStatsSection";
import { MissingContentNotice } from "./components/MissingContentNotice";
import { RefightPanel } from "./components/RefightPanel";
import { RemixPanel } from "./components/RemixPanel";
import { ReplayAnalysisSection } from "./components/ReplayAnalysisSection";
import { ReplayAwards } from "./components/ReplayAwards";
import { BasePicturesProvider } from "./components/ReplayBaseCrops";
import { ReplayBuildOrders } from "./components/ReplayBuildOrders";
import { ReplayEventList } from "./components/ReplayEventList";
import { ReplayMapCard } from "./components/ReplayMapCard";
import { ReplayNotes } from "./components/ReplayNotes";
import {
  REPLAY_TABS,
  ReplayPanel,
  type ReplayTab,
  useReplayTab,
} from "./components/ReplayPanel";
import { ReplayRoster } from "./components/ReplayRoster";
import {
  ReplayTimelineDock,
  TimelineKeysProvider,
} from "./components/ReplayTimelineDock";
import { SendReplayExtrasToHub } from "./components/SendReplayExtrasToHub";
import { SendReplayToHub } from "./components/SendReplayToHub";
import { StaleRemixNotice } from "./components/StaleRemixNotice";
import {
  DependencyBlocked,
  DetailLoading,
  ErrorBanner,
  NotFound,
} from "./components/states";
import { UncheckedEngineNotice } from "./components/UncheckedEngineNotice";
import { WatchButton } from "./components/WatchButton";
import { WatchWithRewindButton } from "./components/WatchWithRewindButton";
import { OriginBadge } from "./ReplaysPage";

function playedAt(ms: number, withTime: boolean): string {
  if (!ms) return "";
  return formatDateTime(
    new Date(ms),
    withTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" },
  );
}

/** One replay: decoded metadata, players, and a preview of the map it was on. */
export default function ReplayDetailPage() {
  const { t } = useLingui();
  const { name } = useParams();
  const filename = name ?? "";
  const navigate = useNavigate();
  const { selected } = useScanTargetSelection();
  const replaysRoot = useReplaysRoot(selected?.rootPath);
  const { replays, loading: listLoading, refresh } = useReplays(replaysRoot);
  const replay = replays.find((r) => r.filename === filename);
  // An empty file has no header to read. It is not an error, so it is not
  // decoded (issue #3868).
  const unfinished = replay?.unfinished === true;
  const decoded = useDemoInfo(
    selected?.enginePath,
    unfinished ? undefined : replay?.path,
  );
  const { loading, error } = decoded;
  // Every section reads the faction a player picked in the match, not the
  // start script's.
  const { info, pending: factionsPending } = useReplayFactions(decoded.info);
  // Drives the engine-mismatch "may not sync" hint under the header.
  const { resolved } = useReplayTarget(info?.engineVersion ?? "");
  const engine = useReplayEngine(info?.engineVersion ?? "");
  const userState = useReplayUserState();
  const provenance = userState.get(filename).provenance;
  const origin = provenance?.mode ?? "other";
  const link = provenance ? provenanceLink(provenance) : null;
  const analyses = useStoredAnalyses();

  // The panel's tabs. Economy and Build orders are match statistics in spirit,
  // so a profile that hides those drops both from the list (#1179). The events
  // tab always has the chat.
  const showStats =
    replay !== undefined && !isProfileHidden("analytics.matchStats");
  const listed: ReplayTab[] = REPLAY_TABS.filter((id) =>
    id === "summary"
      ? true
      : id === "events"
        ? replay !== undefined
        : showStats,
  );
  const [tab, setTab] = useReplayTab(listed);
  // The map card's Analyse replay button presses the one in the Summary tab,
  // which is only there to press once the tab is open.
  const analyseWhenSummary = useRef(false);
  const showWhenSummary = useRef(false);
  useEffect(() => {
    if (tab !== "summary") return;
    if (analyseWhenSummary.current) {
      analyseWhenSummary.current = false;
      openAnalysisRun();
    } else if (showWhenSummary.current) {
      showWhenSummary.current = false;
      goToAnalysisSection();
    }
  }, [tab]);
  const onAnalyse = useCallback(() => {
    if (tab === "summary") {
      openAnalysisRun();
      return;
    }
    analyseWhenSummary.current = true;
    setTab("summary");
  }, [tab, setTab]);
  // The links in the map card's rail go to the analysis section, which is in
  // the Summary tab and cannot be scrolled to while another tab is open.
  useEffect(() => {
    const show = () => {
      if (tab === "summary") return;
      showWhenSummary.current = true;
      setTab("summary");
    };
    window.addEventListener(SHOW_ANALYSIS_EVENT, show);
    return () => window.removeEventListener(SHOW_ANALYSIS_EVENT, show);
  }, [tab, setTab]);

  // Remount the preview after a successful map download so it refetches.
  const [previewNonce, setPreviewNonce] = useState(0);
  const onMapDownloaded = () => {
    if (selected && info) {
      invalidateMapPreview(
        selected.enginePath,
        selected.rootPath,
        info.mapName,
      );
    }
    setPreviewNonce((n) => n + 1);
  };

  // Whether the replay's game/map are actually installed, matched against the
  // live unitsync scan the same way the game picker resolves installed games
  // (tolerant of version-string form, see `gameNamesMatch`) rather than a
  // literal string compare (issue #494). Feeds the missing-content notice
  // near the top of the page (#495).
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  const answered = scan.data;
  const missingGame =
    info && answered && !scan.loading
      ? !answered.games.some((g) => gameNamesMatch(g.name, info.gameType))
      : false;
  // A replay of a game that lacks a dependency archive would stop in the
  // engine, so Watch stops first and names the archive (issue #3489).
  const dependencyBlock =
    info && answered && !scan.loading
      ? replayDependencyBlock(info.gameType, answered.games)
      : null;
  // The playback depends on the replay's game, or on another installed version
  // of it when its own is missing, as an analysis does (#3869).
  const playbackGame =
    info && answered && !scan.loading && missingGame
      ? otherGameVersion(info.gameType, answered.games)
      : null;
  const playbackBlock = playbackGame
    ? replayDependencyBlock(playbackGame.name, answered?.games ?? [])
    : dependencyBlock;
  const missingMap =
    info?.mapName && answered && !scan.loading
      ? !answered.maps.some((m) => m.name === info.mapName)
      : false;

  // After a remix, pull the new copy into the list, then open its detail page —
  // so the user lands on the remix (where Watch lives) instead of re-triggering it.
  const onRemixed = async (newPath: string) => {
    await refresh();
    const newName = newPath.split(/[\\/]/).pop();
    if (!newName) return;
    navigate(`/play/replays/${encodeURIComponent(newName)}`);
    // Flag the navigation so the jump to a different file isn't a surprise.
    void notify({
      title: t`Remix created`,
      body: t`Opened the remixed replay — use Watch to run it.`,
      level: "success",
    });
  };

  const onDeleted = () => {
    navigate("/play/replays");
    void notify({ title: t`Replay deleted`, level: "success" });
  };

  if (listLoading && !replay) return <DetailLoading backTo="/play/replays" />;
  if (!listLoading && !replay)
    return <NotFound backTo="/play/replays" label="replay" />;

  const recordedOn = info?.engineVersion || t`an unknown engine`;
  const folderEngineVersion = resolved?.target.engineVersion ?? "";
  const watchingWith =
    resolved?.target.syncVersion ||
    t`the engine in a folder named ${folderEngineVersion}, which has not had its version checked yet`;
  const playedMs = info?.startTimeMs || replay?.modifiedMs || 0;
  const analysed =
    info && !info.remixed && info.gameId
      ? analyses.get(info.gameId)?.state === "current"
      : false;
  // The row under the title. The analysed fact is left out when the profile
  // hides the analysis run, which leaves nothing for it to be compared to.
  const facts: { id: string; text: string }[] = info
    ? [
        { id: "game", text: info.gameType || "—" },
        { id: "engine", text: info.engineVersion || "—" },
        ...(playedMs
          ? [{ id: "played", text: playedAt(playedMs, false) }]
          : []),
        { id: "duration", text: formatDuration(info.durationSec) },
        { id: "result", text: teamResultLabel(info) },
        ...(analysed
          ? [{ id: "analysed", text: t`Analysed` }]
          : analysisRunHidden()
            ? []
            : [{ id: "analysed", text: t`Not analysed` }]),
      ]
    : [];
  // What the row has no room for, which the Summary tab lists.
  const detailRows: [string, string][] = info
    ? [
        [t`File`, filename],
        ...(info.remixed && info.sourceGametype
          ? ([[t`Remixed from`, info.sourceGametype]] as [string, string][])
          : []),
        ...(playedMs
          ? ([[t`Played`, playedAt(playedMs, true)]] as [string, string][])
          : []),
        [t`File size`, replay ? formatBytes(replay.sizeBytes) : "—"],
      ]
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto [container-type:size]">
      {/* The title and the actions share a row until the title has 20rem, and
       * below that the actions drop to their own line rather than taking the
       * last of it (#1215). `min-w-0` truncates a long filename, but on its own
       * it also lets the column shrink to one character wide, because the
       * button row is `shrink-0` and every pixel the window loses comes out of
       * the text. The basis is where that column stops giving. */}
      <header className="flex flex-wrap items-start justify-between gap-4 px-4 pt-4">
        <div className="flex min-w-0 grow basis-80 flex-col gap-1">
          <Link
            to="/play/replays"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="size-3.5" /> {t`Replays`}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-lg font-semibold">
              {info?.mapName || filename}
            </h1>
            {info?.remixed && (
              <Badge
                variant="ghost"
                className="shrink-0 gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary"
              >
                <Code2 className="size-3" /> {t`Remix`}
              </Badge>
            )}
            <OriginBadge origin={origin} />
          </div>
          {facts.length > 0 && (
            <ul
              aria-label={t`Replay facts`}
              className="flex flex-wrap items-center gap-1.5"
            >
              {facts.map((fact) => (
                <li key={fact.id}>
                  <Badge
                    variant="outline"
                    className="rounded-full px-2.5 py-0.5 text-xs font-normal text-muted-foreground"
                  >
                    {fact.text}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {info?.remixed && info.originFilename && (
            <Link
              to={`/play/replays/${encodeURIComponent(info.originFilename)}`}
              className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
            >
              <ArrowLeft className="size-3.5" /> {t`Back to original replay`}
            </Link>
          )}
          {link && (
            <Link
              to={link.to}
              className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
            >
              <ArrowLeft className="size-3.5" /> {link.label}
            </Link>
          )}
          {info &&
            resolved &&
            !resolved.matched &&
            engine.watch.kind === "fallback" && (
              <p className="max-w-md text-xs text-amber-600 dark:text-amber-400">
                <Trans>
                  Recorded on {recordedOn}. Watching with {watchingWith} — may
                  not sync.
                </Trans>
              </p>
            )}
        </div>
        {replay && (info || unfinished) && (
          // Destructive + secondary actions first, and the primary CTA (Watch)
          // last so it lands in the top-right corner. Once the row wraps there
          // is no corner left to sit in, and the block lines up with the title's
          // own left edge instead, which is what reads as the heading's actions
          // rather than a band floating between two sections.
          <div className="flex max-w-full shrink-0 flex-wrap items-start gap-2">
            <DeleteReplayButton
              replayPath={replay.path}
              onDeleted={onDeleted}
              unfinished={unfinished}
            />
            {/* No remixing a remix — its detail links back to the original instead. */}
            {selected && info && !info.remixed && (
              <RemixPanel
                replayPath={replay.path}
                recordedGameType={info.gameType}
                recordedEngineVersion={info.engineVersion}
                enginePath={selected.enginePath}
                dataDir={selected.rootPath}
                onRemixed={onRemixed}
              />
            )}
            {info && (
              <RefightPanel
                info={info}
                filename={filename}
                factionsPending={factionsPending}
              />
            )}
            {/* The raw read, whose sides are the start script's: the hub
             * checks the summary against the file. */}
            {decoded.info && (
              <SendReplayToHub info={decoded.info} replayPath={replay.path} />
            )}
            {decoded.info && <SendReplayExtrasToHub info={decoded.info} />}
            {info && (
              <WatchWithRewindButton
                replayPath={replay.path}
                info={info}
                watch={engine.watch}
                dependencyBlock={dependencyBlock}
                playbackBlock={playbackBlock}
                missingGame={missingGame}
                missingMap={missingMap}
                game={playbackGame?.name}
              />
            )}
            {info && (
              <WatchButton
                replayPath={replay.path}
                engineVersion={info.engineVersion}
                watch={engine.watch}
                dependencyBlock={dependencyBlock}
              />
            )}
          </div>
        )}
      </header>

      {/* The notices stay above everything, at the page's full width (#5304). */}
      <div className="flex shrink-0 flex-col gap-3 px-4 pt-4 empty:hidden">
        {unfinished && (
          <section className="flex max-w-xl flex-col gap-1 rounded-lg border border-border/50 bg-card p-3">
            <h2 className="text-sm font-medium">{t`Recording did not finish`}</h2>
            <p className="text-xs text-muted-foreground">
              <Trans>
                This file is empty and nothing in it can be played. A game that
                was closed, killed or crashed before it ended leaves a file like
                this.
              </Trans>
            </p>
            <p className="text-xs text-muted-foreground">
              {unfinishedWarning()}
            </p>
          </section>
        )}

        {error && <ErrorBanner message={error} />}

        {info && (
          <>
            {engine.notice.kind === "unchecked" && (
              <UncheckedEngineNotice version={engine.notice.version} />
            )}
            {info.staleRemix && (
              <StaleRemixNotice
                gameType={info.gameType}
                sourceGametype={info.sourceGametype}
                originFilename={info.originFilename}
                originInLibrary={replays.some(
                  (r) => r.filename === info.originFilename,
                )}
              />
            )}
            {dependencyBlock && <DependencyBlocked reason={dependencyBlock} />}
            <MissingContentNotice
              gameType={info.gameType}
              mapName={info.mapName}
              missingGame={missingGame}
              missingMap={missingMap}
              engine={engine}
              onMapDownloaded={onMapDownloaded}
            />
          </>
        )}
      </div>

      {loading && !info ? (
        <div className="px-4 pt-4">
          <DetailLoading backTo="/play/replays" />
        </div>
      ) : info ? (
        /* One emphasised series for the roster, the chart and the map's start
         * dots (#1139, #1152). Keyed by replay so a selection can't follow
         * you to the next one. It reaches down to the map, so the sections
         * between are inside it too and read nothing from it. */
        <SeriesEmphasisProvider key={filename}>
          {/* One match time for every section (#5305). Inside the keyed
           * provider, so it starts again for each replay. */}
          <MatchClockProvider durationSec={info.durationSec}>
            <TimelineKeysProvider>
              {/* Two columns from the xl breakpoint, the map card on the left
               * and the panel on the right, each as tall as the row and
               * scrolling inside itself. Below it they stack, and the page
               * scrolls (#5304). */}
              {/* The stacked page keeps the dock's cap free below the map, which
               * the dock would cover. In two columns the dock is not over a
               * column, so nothing is kept (#5356). */}
              <div
                className="flex flex-col gap-4 p-4 [--replay-dock-reserve:var(--replay-dock-max)] xl:grid xl:min-h-64 xl:flex-1 xl:grid-cols-2 xl:grid-rows-[minmax(0,1fr)] xl:[--replay-dock-reserve:0px]"
                style={
                  { "--replay-dock-max": DOCK_MAX_HEIGHT } as CSSProperties
                }
              >
                {/* A size container when the column has a height of its own,
                 * so the map can be sized to it and not to the window. */}
                <div className="min-w-0 xl:min-h-0 xl:overflow-y-auto xl:[container-type:size]">
                  {/* The one map: the recorded match, the flat map with its
                   * layers and the 3D view, one mode at a time (#5310). Keyed
                   * so a map that has just been downloaded is read again. */}
                  <ReplayMapCard
                    key={previewNonce}
                    info={info}
                    replayPath={replay?.path}
                    enginePath={selected?.enginePath}
                    dataDir={selected?.rootPath}
                    onAnalyse={onAnalyse}
                  />
                </div>
                <div className="min-w-0 xl:min-h-0">
                  <ReplayPanel
                    tab={tab}
                    onTab={setTab}
                    content={{
                      summary: (
                        <>
                          {replay && showStats && (
                            <MatchStatsSection
                              part="tiles"
                              info={info}
                              replayPath={replay.path}
                            />
                          )}
                          <ReplayRoster info={info} replayPath={replay?.path} />
                          {showStats && (
                            <ReplayAwards
                              info={info}
                              replayPath={replay?.path}
                            />
                          )}
                          <section className="flex flex-col gap-2">
                            <h2 className="text-sm font-medium">{t`Details`}</h2>
                            <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border border-border/50 bg-card p-3 text-sm">
                              {detailRows.map(([k, v]) => (
                                <div key={k} className="contents">
                                  <dt className="text-xs text-muted-foreground">
                                    {k}
                                  </dt>
                                  <dd className="break-all">{v}</dd>
                                </div>
                              ))}
                            </dl>
                          </section>
                          <ReplayNotes
                            filename={filename}
                            gameId={info.gameId}
                          />
                          {/* Opt in, one replay at a time (#1157). One run makes
                           * the analysis and the track (#3962). The section
                           * gates itself on `analytics.run`, and still shows
                           * what is already stored. */}
                          {replay && (
                            <ReplayAnalysisSection
                              replayPath={replay.path}
                              info={info}
                              target={
                                resolved?.matched ? resolved.target : null
                              }
                              missingGame={missingGame}
                              missingMap={missingMap}
                              dependencyBlock={dependencyBlock}
                              installedGames={answered?.games ?? []}
                              downloads={
                                <MissingContentNotice
                                  gameType={info.gameType}
                                  mapName={info.mapName}
                                  missingGame={missingGame}
                                  missingMap={missingMap}
                                  engine={engine}
                                  onMapDownloaded={onMapDownloaded}
                                />
                              }
                            />
                          )}
                        </>
                      ),
                      economy:
                        replay && showStats ? (
                          <MatchStatsSection
                            part="chart"
                            info={info}
                            replayPath={replay.path}
                          />
                        ) : undefined,
                      builds:
                        replay && showStats ? (
                          <BasePicturesProvider
                            info={info}
                            replayPath={replay.path}
                            enginePath={selected?.enginePath}
                            dataDir={selected?.rootPath}
                          >
                            <ReplayBuildOrders
                              info={info}
                              replayPath={replay.path}
                            />
                          </BasePicturesProvider>
                        ) : undefined,
                      events: replay ? (
                        <ReplayEventList
                          info={info}
                          replayPath={replay.path}
                          showAnalysis={showStats}
                        />
                      ) : undefined,
                    }}
                  />
                </div>
              </div>

              {/* Under both columns, and last so it rests at the bottom of the
               * window when the page has two columns and at the end of the page
               * when it stacks (#5306). */}
              {replay && (
                <ReplayTimelineDock
                  info={info}
                  replayPath={replay.path}
                  showStats={showStats}
                  watch={engine.watch}
                  dependencyBlock={playbackBlock}
                  game={playbackGame?.name}
                />
              )}
            </TimelineKeysProvider>
          </MatchClockProvider>
        </SeriesEmphasisProvider>
      ) : null}
    </div>
  );
}
