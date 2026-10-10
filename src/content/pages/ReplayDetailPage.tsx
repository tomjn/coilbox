import { Button, Input } from "@picoframe/frame";
import {
  ArrowLeft,
  Code2,
  Download,
  Eye,
  ImageOff,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatBytes, formatDuration } from "@/lib/format";
import { notify } from "@/notify/notify";
import { useWriteRoot, useWriteRootPath } from "../../downloads/config";
import { QueueProgress } from "../../downloads/pages/components/ProgressBar";
import { useQueuedDownload } from "../../downloads/useQueuedDownload";
import { useReplayTarget } from "../../play/config";
import { isProfileHidden } from "../../profile/hidden";
import type { DemoInfo } from "../bindings";
import { contentDeleteReplay } from "../bindings";
import {
  invalidateMapPreview,
  useDemoInfo,
  useReplays,
  useScanTargetSelection,
  useUnitsyncHeightmap,
  useUnitsyncMapSkybox,
  useUnitsyncMinimap,
  useUnitsyncScan,
} from "../config";
import { refreshStoredAnalyses } from "../replayAnalysis";
import {
  type ReplayEngineNotice,
  replayDependencyBlock,
} from "../replayEngine";
import { forgetReplay } from "../replayList";
import { provenanceLink } from "../replayProvenanceLink";
import { useReplaySets } from "../replaySets";
import { teamResultLabel } from "../replaySideLabel";
import { useReplayUserState } from "../replayUserState";
import { gameNamesMatch } from "../resolveContent";
import { type ReplayEngine, useReplayEngine } from "../useReplayEngine";
import { useReplaysRoot } from "../useReplaysRoot";
import { SeriesEmphasisProvider } from "../useSeriesEmphasis";
import { UNFINISHED_WARNING } from "./components/ClearUnfinishedButton";
import { MatchStatsSection } from "./components/MatchStatsSection";
import { RefightPanel } from "./components/RefightPanel";
import { RemixPanel } from "./components/RemixPanel";
import { ReplayAnalysisEvents } from "./components/ReplayAnalysisEvents";
import { ReplayAnalysisSection } from "./components/ReplayAnalysisSection";
import { ReplayBuildOrders } from "./components/ReplayBuildOrders";
import { ReplayChat } from "./components/ReplayChat";
import { ReplayMap } from "./components/ReplayMap";
import { ReplayRoster } from "./components/ReplayRoster";
import { ReplaySetPicker } from "./components/ReplaySetPicker";
import { StaleRemixNotice } from "./components/StaleRemixNotice";
import {
  DependencyBlocked,
  DetailLoading,
  ErrorBanner,
  NotFound,
} from "./components/states";
import { UncheckedEngineNotice } from "./components/UncheckedEngineNotice";
import { WatchButton } from "./components/WatchButton";
import { OriginBadge } from "./ReplaysPage";

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

function playedAt(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The map preview for the replay's map. When the map isn't installed,
 * unitsync can't render it. The download control for that now lives in
 * {@link MissingContentNotice} near the top of the page (#495), so this just
 * explains why the preview is blank.
 */
function ReplayMapPreview({
  enginePath,
  dataDir,
  mapName,
  info,
  replayPath,
}: {
  enginePath: string;
  dataDir: string;
  mapName: string;
  info: DemoInfo;
  replayPath: string | undefined;
}) {
  const minimap = useUnitsyncMinimap(enginePath, dataDir, mapName);
  const heightmap = useUnitsyncHeightmap(enginePath, dataDir, mapName);
  const skybox = useUnitsyncMapSkybox(enginePath, dataDir, mapName);

  const busy = minimap.loading || heightmap.loading;

  if (busy) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-border/50 bg-card">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (minimap.url) {
    return (
      <ReplayMap
        info={info}
        replayPath={replayPath}
        mapName={mapName}
        minimapUrl={minimap.url}
        heightmap={heightmap.data}
        preview={
          heightmap.data && heightmap.url
            ? {
                heightSrc: heightmap.url,
                heightRange: heightmap.range,
                textureSrc: minimap.url,
                appearance: minimap.appearance,
                skyboxSrc: skybox.dataUrl,
                minHeight: heightmap.data.minHeight ?? 0,
                maxHeight: heightmap.data.maxHeight ?? 0,
              }
            : null
        }
      />
    );
  }

  // Map not installed / not renderable: the download control for this sits
  // in the missing-content notice near the top of the page.
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <ImageOff className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{mapName}</span> isn't
        installed, so its preview can't be rendered.
      </p>
    </div>
  );
}

/** Best-effort game download (rapid). The demo's `gameType` is a display string,
 * not a rapid tag, so an exact-version match isn't guaranteed — surfaced honestly. */
function GameDownload({ gameType }: { gameType: string }) {
  const writePath = useWriteRootPath();
  const gameDl = useQueuedDownload({
    kind: "rapid",
    label: `Game: ${gameType}`,
    args: { tag: gameType, writePath },
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          onClick={() => gameDl.start()}
          disabled={gameDl.busy || !writePath}
          className="gap-1.5"
        >
          {gameDl.busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Download game
        </Button>
        <span className="text-xs text-muted-foreground">
          Best effort — an exact version match isn't guaranteed.
        </span>
      </div>
      <QueueProgress item={gameDl} className="max-w-xs" />
      {gameDl.status === "done" && (
        <p className="text-xs text-muted-foreground">Downloaded {gameType}.</p>
      )}
      {gameDl.error && (
        <p className="text-xs text-destructive">{gameDl.error}</p>
      )}
    </div>
  );
}

/**
 * Map download for the missing-content notice. `onDownloaded` invalidates the
 * cached preview and bumps the parent's remount key so the map preview
 * further down the page picks up the newly installed map.
 */
function MapDownload({
  mapName,
  onDownloaded,
}: {
  mapName: string;
  onDownloaded: () => void;
}) {
  const { path: writePath, loading: writeRootLoading } = useWriteRoot();
  // Only once the read has landed and said there is none. Before that `writePath`
  // is undefined whatever the user has configured (issue #1104).
  const noWriteRoot = !writeRootLoading && !writePath;
  // Replays here are BAR-dominant, and this used to fetch the map straight from
  // BAR's search endpoint for that reason. It resolves a name by fetching and
  // storing the archive at BAR's cost, so a replay of any other game's map made
  // BAR pay to host it. The source order does not.
  const mapDl = useQueuedDownload({
    kind: "mapAnySource",
    label: `Map: ${mapName}`,
    args: { mapName, writePath },
  });
  const downloading = mapDl.busy;

  async function download() {
    const settled = await mapDl.start();
    if (settled?.status === "done") onDownloaded();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          onClick={download}
          disabled={downloading || !writePath}
          className="gap-1.5"
        >
          {downloading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Download map
        </Button>
      </div>
      <QueueProgress item={mapDl} className="max-w-xs" />
      {noWriteRoot && !downloading && (
        <p className="text-xs text-muted-foreground">
          Set a download folder in{" "}
          <Link
            className="underline underline-offset-4"
            to="/settings/downloads"
          >
            Downloads settings
          </Link>{" "}
          first.
        </p>
      )}
      {mapDl.error && <p className="text-xs text-destructive">{mapDl.error}</p>}
    </div>
  );
}

/**
 * The engine the replay was recorded on, for the missing-content notice (issue
 * #3370). A replay only plays back on that version. When no build of it can be
 * downloaded the version is named, so the player knows which engine to find.
 */
function EngineDownload({
  notice,
  engine,
}: {
  notice: Extract<ReplayEngineNotice, { kind: "download" | "unavailable" }>;
  engine: ReplayEngine;
}) {
  const { requirement, resolve } = engine;
  const status = resolve.statusFor(requirement);
  const item = resolve.itemFor(requirement);
  const error = resolve.errorFor(requirement);
  const busy = status === "active" || status === "queued";

  if (notice.kind === "unavailable") {
    return (
      <p className="text-xs text-muted-foreground">
        {notice.reason === "no-write-root" ? (
          <>
            Engine {notice.version} is not installed. Set a download folder in{" "}
            <Link
              className="underline underline-offset-4"
              to="/settings/downloads"
            >
              Downloads settings
            </Link>{" "}
            to download it.
          </>
        ) : (
          <>
            Engine {notice.version} is not installed, and no download was found
            for it on this platform. Install it yourself in Settings, Engines.
          </>
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button
          onClick={() => resolve.download(requirement)}
          disabled={busy}
          className="gap-1.5"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {status === "queued" ? "Queued…" : "Download engine"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Recorded on {notice.version}. A replay only plays on that version.
        </span>
      </div>
      <QueueProgress item={item} className="max-w-xs" />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Missing-content affordance for the replay's game, map and engine, surfaced near
 * the top of the page next to the game/map identity (#495) instead of at the
 * bottom, so it's the first thing a user sees when something needs
 * downloading. Renders nothing once all are installed, the common case,
 * especially after the #494 version-tolerant match fix.
 */
function MissingContentNotice({
  gameType,
  mapName,
  missingGame,
  missingMap,
  engine,
  onMapDownloaded,
}: {
  gameType: string;
  mapName: string;
  missingGame: boolean;
  missingMap: boolean;
  engine: ReplayEngine;
  onMapDownloaded: () => void;
}) {
  const engineNotice =
    engine.notice.kind === "download" || engine.notice.kind === "unavailable"
      ? engine.notice
      : null;
  if (!missingGame && !missingMap && !engineNotice) return null;
  const missing = [
    missingGame && "Game",
    missingMap && "Map",
    engineNotice && "Engine",
  ].filter((m): m is string => !!m);
  const label = `${missing
    .map((m, i) => (i === 0 ? m : m.toLowerCase()))
    .join(", ")
    .replace(/, ([^,]*)$/, " and $1")} not installed`;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
        <Download className="size-4" /> {label}
      </div>
      {missingGame && <GameDownload gameType={gameType} />}
      {missingMap && mapName && (
        <MapDownload mapName={mapName} onDownloaded={onMapDownloaded} />
      )}
      {engineNotice && <EngineDownload notice={engineNotice} engine={engine} />}
    </section>
  );
}

/** Watched flag + free-form tags for this replay (persisted locally by filename). */
function ReplayNotes({
  filename,
  gameId,
}: {
  filename: string;
  gameId?: string;
}) {
  const userState = useReplayUserState();
  const replaySets = useReplaySets();
  const us = userState.get(filename);
  const tags = us.tags ?? [];
  const [draft, setDraft] = useState("");

  const addTag = () => {
    const t = draft.trim();
    if (!t || tags.includes(t)) {
      setDraft("");
      return;
    }
    userState.setTags(filename, [...tags, t]);
    setDraft("");
  };
  const removeTag = (t: string) =>
    userState.setTags(
      filename,
      tags.filter((x) => x !== t),
    );

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Your notes</h2>
      <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-3">
        <Button
          variant={us.watched ? "default" : "outline"}
          size="sm"
          onClick={() => userState.setWatched(filename, !us.watched)}
          aria-pressed={!!us.watched}
          className="w-fit gap-1.5"
        >
          <Eye className="size-4" /> {us.watched ? "Watched" : "Mark watched"}
        </Button>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              {t}
              <button
                type="button"
                onClick={() => removeTag(t)}
                aria-label={`Remove tag ${t}`}
                className="hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addTag();
            }}
            onBlur={addTag}
            placeholder="Add tag…"
            className="h-7 w-28"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {replaySets.sets
            .filter((s) => s.members.some((m) => m.filename === filename))
            .map((s) => (
              <span
                key={s.id}
                className="rounded bg-primary/15 px-1.5 py-0.5 text-xs text-primary"
              >
                {s.name}
              </span>
            ))}
          <ReplaySetPicker
            api={replaySets}
            member={{ filename, gameId }}
            label="Sets"
          />
        </div>
      </div>
    </section>
  );
}

/** Delete a replay after a confirm (irreversible), then hand back to `onDeleted`. */
function DeleteReplayButton({
  replayPath,
  onDeleted,
  unfinished = false,
}: {
  replayPath: string;
  onDeleted: () => void;
  /** An empty file: the warning says what a running game would lose, and the
   * backend leaves the file alone if it has filled in since the page opened. */
  unfinished?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del() {
    setPending(true);
    setError(null);
    try {
      const { analysisDeleted } = await contentDeleteReplay({
        path: replayPath,
        ...(unfinished ? { onlyUnfinished: true } : {}),
      });
      if (analysisDeleted) void refreshStoredAnalyses();
      forgetReplay(replayPath);
      setOpen(false);
      onDeleted();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-1.5">
          <Trash2 className="size-4" /> Delete
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Delete this replay?</h3>
          <p className="text-xs text-muted-foreground">
            The file is permanently removed from your demos folder — this can't
            be undone. If this replay has been analysed, its stored analysis is
            deleted with it.
          </p>
          {unfinished && (
            <p className="text-xs text-muted-foreground">
              {UNFINISHED_WARNING}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={del}
            disabled={pending}
            className="gap-1.5"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Delete
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  );
}

/** One replay: decoded metadata, players, and a preview of the map it was on. */
export default function ReplayDetailPage() {
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
  const { info, loading, error } = useDemoInfo(
    selected?.enginePath,
    unfinished ? undefined : replay?.path,
  );
  // Drives the engine-mismatch "may not sync" hint under the header.
  const { resolved } = useReplayTarget(info?.engineVersion ?? "");
  const engine = useReplayEngine(info?.engineVersion ?? "");
  const userState = useReplayUserState();
  const provenance = userState.get(filename).provenance;
  const origin = provenance?.mode ?? "other";
  const link = provenance ? provenanceLink(provenance) : null;

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
      title: "Remix created",
      body: "Opened the remixed replay — use Watch to run it.",
      level: "success",
    });
  };

  const onDeleted = () => {
    navigate("/play/replays");
    void notify({ title: "Replay deleted", level: "success" });
  };

  if (listLoading && !replay) return <DetailLoading backTo="/play/replays" />;
  if (!listLoading && !replay)
    return <NotFound backTo="/play/replays" label="replay" />;

  const metaRows: [string, string][] = info
    ? [
        ["Game", info.gameType || "—"],
        ...(info.remixed && info.sourceGametype
          ? ([["Remixed from", info.sourceGametype]] as [string, string][])
          : []),
        ["Engine", info.engineVersion || "—"],
        [
          "Played",
          playedAt(info.startTimeMs) || playedAt(replay?.modifiedMs ?? 0),
        ],
        ["Duration", formatDuration(info.durationSec)],
        ["Result", teamResultLabel(info)],
        ["File size", replay ? formatBytes(replay.sizeBytes) : "—"],
      ]
    : [];

  return (
    <div className="flex flex-col gap-5 p-4">
      {/* The title and the actions share a row until the title has 20rem, and
       * below that the actions drop to their own line rather than taking the
       * last of it (#1215). `min-w-0` truncates a long filename, but on its own
       * it also lets the column shrink to one character wide, because the
       * button row is `shrink-0` and every pixel the window loses comes out of
       * the text. The basis is where that column stops giving. */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 grow basis-80 flex-col gap-1">
          <Link
            to="/play/replays"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
          >
            <ArrowLeft className="size-3.5" /> Replays
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
                <Code2 className="size-3" /> Remix
              </Badge>
            )}
            <OriginBadge origin={origin} />
          </div>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {filename}
          </p>
          {info?.remixed && info.originFilename && (
            <Link
              to={`/play/replays/${encodeURIComponent(info.originFilename)}`}
              className="inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
            >
              <ArrowLeft className="size-3.5" /> Back to original replay
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
                Recorded on {info.engineVersion || "an unknown engine"}.
                Watching with{" "}
                {resolved.target.syncVersion ||
                  `the engine in a folder named ${resolved.target.engineVersion}, which has not had its version checked yet`}{" "}
                — may not sync.
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
            {info && <RefightPanel info={info} filename={filename} />}
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

      {unfinished && (
        <section className="flex max-w-xl flex-col gap-1 rounded-lg border border-border/50 bg-card p-3">
          <h2 className="text-sm font-medium">Recording did not finish</h2>
          <p className="text-xs text-muted-foreground">
            This file is empty and nothing in it can be played. A game that was
            closed, killed or crashed before it ended leaves a file like this.
          </p>
          <p className="text-xs text-muted-foreground">{UNFINISHED_WARNING}</p>
        </section>
      )}

      {error && <ErrorBanner message={error} />}

      {loading && !info ? (
        <DetailLoading backTo="/play/replays" />
      ) : info ? (
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

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Details</h2>
            <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border border-border/50 bg-card p-3 text-sm">
              {metaRows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* One emphasised series for the roster, the chart and the map's start
           * dots (#1139, #1152). Keyed by replay so a selection can't follow
           * you to the next one. It reaches down to the map, so the sections
           * between are inside it too and read nothing from it. */}
          <SeriesEmphasisProvider key={filename}>
            <ReplayRoster info={info} replayPath={replay?.path} />

            {/* Directly under the roster (#1200). The roster is where a player
             * is already reading per-seat numbers, and the chart answers the
             * question the roster raises. */}
            {replay && !isProfileHidden("analytics.matchStats") && (
              <MatchStatsSection info={info} replayPath={replay.path} />
            )}
            {replay && !isProfileHidden("analytics.matchStats") && (
              <ReplayBuildOrders info={info} replayPath={replay.path} />
            )}

            {/* Opt in, one replay at a time (#1157). The section gates itself on
             * `analytics.run`, and still shows an analysis that is already stored. */}
            {replay && (
              <ReplayAnalysisSection
                replayPath={replay.path}
                info={info}
                target={resolved?.matched ? resolved.target : null}
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

            {/* Match statistics in spirit, so it takes the build orders' gate (#1179). */}
            {replay && !isProfileHidden("analytics.matchStats") && (
              <ReplayAnalysisEvents info={info} replayPath={replay.path} />
            )}

            {/* Read from the replay file, so it needs no engine. */}
            {replay && (
              <ReplayChat
                replayPath={replay.path}
                durationSec={info.durationSec}
              />
            )}

            <ReplayNotes filename={filename} gameId={info.gameId} />

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Map · {info.mapName}</h2>
              {selected && info.mapName ? (
                <ReplayMapPreview
                  key={previewNonce}
                  enginePath={selected.enginePath}
                  dataDir={selected.rootPath}
                  mapName={info.mapName}
                  info={info}
                  replayPath={replay?.path}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {info.mapName
                    ? "Install an engine to preview this map."
                    : "No map recorded for this replay."}
                </p>
              )}
            </section>
          </SeriesEmphasisProvider>
        </>
      ) : null}
    </div>
  );
}
