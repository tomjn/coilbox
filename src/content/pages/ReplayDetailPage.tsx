import { Button } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { ArrowLeft, Download, ImageOff, Loader2, Trophy } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  type DownloadProgress,
  dlDownload,
  dlDownloadMap,
} from "../../downloads/bindings";
import { useWriteRootPath } from "../../downloads/config";
import {
  formatBytes,
  ProgressBar,
} from "../../downloads/pages/components/ProgressBar";
import { MapPreview3D } from "../../mapconv/pages/components/MapPreview3D";
import type {
  AllyTeamInfo,
  DemoInfo,
  ReplayPlayer,
  StartBox,
} from "../bindings";
import {
  invalidateMapPreview,
  useDemoInfo,
  useReplays,
  useScanTargetSelection,
  useUnitsyncHeightmap,
  useUnitsyncMinimap,
} from "../config";
import { DetailLoading, ErrorBanner, NotFound } from "./components/states";

/** BAR maps live on the files-cdn search endpoint (replays here are BAR-dominant). */
const BAR_SEARCH_URL = "https://files-cdn.beyondallreason.dev/find";

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Seconds → `mm:ss` (or `h:mm:ss`). */
function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function playedAt(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Human-readable result line from the winning ally-teams. */
function resultLabel(info: DemoInfo): string {
  if (!info.winnersKnown) return "Unknown (winner not recorded by demotool)";
  if (info.winningAllyTeams.length === 0) return "No result recorded";
  const ids = info.winningAllyTeams.map((a) => `Ally ${a}`).join(", ");
  return `${ids} won`;
}

/** `rgbColor` (0..1) → a CSS colour for the team swatch. */
function swatch(rgb?: [number, number, number]): string | undefined {
  if (!rgb) return undefined;
  const [r, g, b] = rgb.map((v) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255),
  );
  return `rgb(${r}, ${g}, ${b})`;
}

function PlayerRow({ p, won }: { p: ReplayPlayer; won: boolean }) {
  return (
    <li className="flex items-center gap-2 py-1">
      <span
        className="inline-block size-3 shrink-0 rounded-sm border border-border/60"
        style={{ backgroundColor: swatch(p.rgbColor) ?? "transparent" }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-sm" title={p.name}>
        {p.name}
        {p.countryCode ? (
          <span className="ml-1 text-xs text-muted-foreground">
            {p.countryCode}
          </span>
        ) : null}
      </span>
      {p.side && (
        <span className="shrink-0 text-xs text-muted-foreground">{p.side}</span>
      )}
      {won && (
        <Trophy
          className="size-3.5 shrink-0 text-amber-500"
          aria-label="On the winning team"
        />
      )}
    </li>
  );
}

/** Players grouped by ally-team, with the winning team highlighted; spectators last. */
function Players({ info }: { info: DemoInfo }) {
  const teams = new Map<number, ReplayPlayer[]>();
  const spectators: ReplayPlayer[] = [];
  const push = (key: number, p: ReplayPlayer) => {
    const arr = teams.get(key);
    if (arr) arr.push(p);
    else teams.set(key, [p]);
  };
  for (const p of info.players) {
    if (p.spectator) spectators.push(p);
    else push(p.allyTeam ?? -1, p);
  }
  const allyTeamIds = [...teams.keys()].sort((a, b) => a - b);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Players</h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-3">
        {allyTeamIds.map((id) => {
          const won = info.winnersKnown && info.winningAllyTeams.includes(id);
          return (
            <div
              key={id}
              className={`rounded-lg border p-3 ${
                won
                  ? "border-amber-500/50 bg-amber-500/5"
                  : "border-border/50 bg-card"
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <h3 className="text-xs font-semibold text-muted-foreground">
                  {id === -1 ? "Unassigned" : `Ally team ${id}`}
                </h3>
                {won && (
                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    <Trophy className="size-3" /> Winner
                  </span>
                )}
              </div>
              <ul className="flex flex-col divide-y divide-border/40">
                {teams.get(id)?.map((p) => (
                  <PlayerRow key={`${id}-${p.name}`} p={p} won={won} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {spectators.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Spectators: {spectators.map((s) => s.name).join(", ")}
        </p>
      )}
    </section>
  );
}

/**
 * The map preview for the replay's map. When the map isn't installed, unitsync
 * can't render it, so we offer a download; on success the parent remounts this
 * (via `onDownloaded` bumping a key) so the now-installed map renders.
 */
function ReplayMapPreview({
  enginePath,
  dataDir,
  mapName,
  allyTeams,
  onDownloaded,
}: {
  enginePath: string;
  dataDir: string;
  mapName: string;
  allyTeams: AllyTeamInfo[];
  onDownloaded: () => void;
}) {
  const writePath = useWriteRootPath();
  const minimap = useUnitsyncMinimap(enginePath, dataDir, mapName);
  const heightmap = useUnitsyncHeightmap(enginePath, dataDir, mapName);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);

  const busy = minimap.loading || heightmap.loading;

  async function download() {
    setDownloading(true);
    setDlError(null);
    setProgress(null);
    const onProgress = new Channel<DownloadProgress>();
    onProgress.onmessage = setProgress;
    try {
      await dlDownloadMap({
        springName: mapName,
        searchUrl: BAR_SEARCH_URL,
        writePath,
        onProgress,
      });
      invalidateMapPreview(enginePath, dataDir, mapName);
      onDownloaded();
    } catch (e) {
      setDlError(errMessage(e));
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  }

  if (busy) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-border/50 bg-card">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (minimap.dataUrl) {
    const aspect =
      heightmap.data?.width && heightmap.data?.height
        ? `${heightmap.data.width} / ${heightmap.data.height}`
        : "1 / 1";
    const boxes = (allyTeams ?? []).filter((a) => a.startBox);
    return (
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <div className="flex w-full max-w-sm shrink-0 flex-col gap-1.5">
          <div className="relative flex items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-card">
            <div className="relative inline-flex max-h-full max-w-full">
              <img
                src={minimap.dataUrl}
                alt={`Minimap of ${mapName}`}
                style={{ aspectRatio: aspect }}
                className="block max-h-full max-w-full object-fill"
              />
              {boxes.map((a) => {
                const b = a.startBox as StartBox;
                const c = swatch(a.color) ?? "rgb(148, 163, 184)";
                return (
                  <span
                    key={a.id}
                    className="absolute flex items-start justify-start"
                    style={{
                      left: `${b.left * 100}%`,
                      top: `${b.top * 100}%`,
                      width: `${(b.right - b.left) * 100}%`,
                      height: `${(b.bottom - b.top) * 100}%`,
                      border: `1.5px solid ${c}`,
                      backgroundColor: c
                        .replace("rgb", "rgba")
                        .replace(")", ", 0.22)"),
                    }}
                    title={`Ally team ${a.id} start box`}
                  >
                    <span
                      className="m-0.5 rounded px-1 text-[10px] font-medium leading-tight text-white"
                      style={{
                        backgroundColor: c
                          .replace("rgb", "rgba")
                          .replace(")", ", 0.85)"),
                      }}
                    >
                      {a.id}
                    </span>
                  </span>
                );
              })}
            </div>
          </div>
          {boxes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Start boxes per ally team.
            </p>
          )}
        </div>
        {heightmap.data?.dataUrl && (
          <MapPreview3D
            className="w-full min-w-0 lg:flex-1"
            heightSrc={heightmap.data.dataUrl}
            textureSrc={minimap.dataUrl}
            minHeight={heightmap.data.minHeight ?? 0}
            maxHeight={heightmap.data.maxHeight ?? 0}
            worldWidth={
              heightmap.data.width ? (heightmap.data.width - 1) * 8 : 1
            }
            worldHeight={
              heightmap.data.height ? (heightmap.data.height - 1) * 8 : 1
            }
          />
        )}
      </div>
    );
  }

  // Map not installed / not renderable: offer a download.
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <ImageOff className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{mapName}</span> isn't
        installed, so its preview can't be rendered.
      </p>
      {downloading ? (
        <ProgressBar
          progress={
            progress ?? {
              phase: "downloading",
              downloadedBytes: 0,
              totalBytes: null,
              percent: null,
              bytesPerSec: null,
            }
          }
          className="w-full max-w-xs"
        />
      ) : (
        <Button onClick={download} className="gap-1.5" disabled={!writePath}>
          <Download className="size-4" /> Download map
        </Button>
      )}
      {!writePath && !downloading && (
        <p className="text-xs text-muted-foreground">
          Set a download folder in Downloads settings first.
        </p>
      )}
      {dlError && <ErrorBanner message={dlError} />}
    </div>
  );
}

/** Best-effort game download (rapid). The demo's `gameType` is a display string,
 * not a rapid tag, so an exact-version match isn't guaranteed — surfaced honestly. */
function GameDownload({ gameType }: { gameType: string }) {
  const writePath = useWriteRootPath();
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  async function download() {
    setDownloading(true);
    setResult(null);
    setProgress(null);
    const onProgress = new Channel<DownloadProgress>();
    onProgress.onmessage = setProgress;
    try {
      const { message } = await dlDownload({
        tag: gameType,
        writePath,
        onProgress,
      });
      setResult({ ok: true, message });
    } catch (e) {
      setResult({ ok: false, message: errMessage(e) });
    } finally {
      setDownloading(false);
      setProgress(null);
    }
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
          Download game
        </Button>
        <span className="text-xs text-muted-foreground">
          Best effort — an exact version match isn't guaranteed.
        </span>
      </div>
      {downloading && progress && (
        <ProgressBar progress={progress} className="max-w-xs" />
      )}
      {result && (
        <p
          className={`text-xs ${result.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}

/** One replay: decoded metadata, players, and a preview of the map it was on. */
export default function ReplayDetailPage() {
  const { name } = useParams();
  const filename = name ? decodeURIComponent(name) : "";
  const { selected } = useScanTargetSelection();
  const { replays, loading: listLoading } = useReplays(selected?.rootPath);
  const replay = replays.find((r) => r.filename === filename);
  const { info, loading, error } = useDemoInfo(
    selected?.enginePath,
    replay?.path,
  );

  // Remount the preview after a successful map download so it refetches.
  const [previewNonce, setPreviewNonce] = useState(0);

  if (listLoading && !replay)
    return <DetailLoading backTo="/content/replays" />;
  if (!listLoading && !replay)
    return <NotFound backTo="/content/replays" label="replay" />;

  const metaRows: [string, string][] = info
    ? [
        ["Game", info.gameType || "—"],
        ["Engine", info.engineVersion || "—"],
        [
          "Played",
          playedAt(info.startTimeMs) || playedAt(replay?.modifiedMs ?? 0),
        ],
        ["Duration", formatDuration(info.durationSec)],
        ["Result", resultLabel(info)],
        ["File size", replay ? formatBytes(replay.sizeBytes) : "—"],
      ]
    : [];

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex flex-col gap-1">
        <Link
          to="/content/replays"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Replays
        </Link>
        <h1 className="break-words text-lg font-semibold">
          {info?.mapName || filename}
        </h1>
        <p className="break-all font-mono text-xs text-muted-foreground">
          {filename}
        </p>
        {/* Action seams: Delete + Launch land in a later iteration. */}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button disabled title="Coming soon">
            Launch
          </Button>
          <Button disabled title="Coming soon">
            Delete
          </Button>
        </div>
      </header>

      {error && <ErrorBanner message={error} />}

      {loading && !info ? (
        <DetailLoading backTo="/content/replays" />
      ) : info ? (
        <>
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

          <Players info={info} />

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Map · {info.mapName}</h2>
            {selected && info.mapName ? (
              <ReplayMapPreview
                key={previewNonce}
                enginePath={selected.enginePath}
                dataDir={selected.rootPath}
                mapName={info.mapName}
                allyTeams={info.allyTeams}
                onDownloaded={() => setPreviewNonce((n) => n + 1)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No map recorded for this replay.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Game</h2>
            <GameDownload gameType={info.gameType} />
          </section>
        </>
      ) : null}
    </div>
  );
}
