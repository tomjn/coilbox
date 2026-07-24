import { Button, Input } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Code2,
  Download,
  Eye,
  ImageOff,
  Loader2,
  MessageSquare,
  Trash2,
  Trophy,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { useReplayTarget } from "../../play/config";
import type {
  AllyTeamInfo,
  DemoInfo,
  ReplayPlayer,
  StartBox,
} from "../bindings";
import {
  type ChatLine,
  contentDeleteReplay,
  contentDemoChat,
} from "../bindings";
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
import type { ReplayProvenance } from "../replayUserState";
import { useReplayUserState } from "../replayUserState";
import { gameNamesMatch } from "../resolveContent";
import { RefightPanel } from "./components/RefightPanel";
import { RemixPanel } from "./components/RemixPanel";
import { DetailLoading, ErrorBanner, NotFound } from "./components/states";
import { WatchButton } from "./components/WatchButton";
import { OriginBadge } from "./ReplaysPage";

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

/**
 * Where a tagged replay's provenance links back to. Warpath links to the run
 * (no per-node route exists there yet — see #369 follow-up); conquest links
 * to the galaxy with the node preselected via `?node=`; campaign links
 * straight to the mission briefing. A stale/deleted target (galaxy, run or
 * mission no longer exists) still resolves to a route — each destination page
 * already renders its own "not found" state rather than crashing.
 */
function provenanceLink(
  p: ReplayProvenance,
): { to: string; label: string } | null {
  switch (p.mode) {
    case "conquest":
      if (!p.galaxyId) return null;
      return {
        to: p.nodeId
          ? `/conquest/${encodeURIComponent(p.galaxyId)}?node=${encodeURIComponent(p.nodeId)}`
          : `/conquest/${encodeURIComponent(p.galaxyId)}`,
        label: "Back to conquest galaxy",
      };
    case "warpath":
      if (!p.runId) return null;
      return {
        to: `/warpath/${encodeURIComponent(p.runId)}`,
        label: "Back to warpath run",
      };
    case "campaign":
      if (!p.campaignId || !p.missionId) return null;
      return {
        to: `/campaign/${encodeURIComponent(p.campaignId)}/${encodeURIComponent(p.missionId)}`,
        label: "Back to mission",
      };
    case "refight":
      if (!p.sourceReplayFilename) return null;
      return {
        to: `/play/replays/${encodeURIComponent(p.sourceReplayFilename)}`,
        label: "Back to original replay",
      };
    default:
      return null;
  }
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
      <span className="min-w-0 flex-1 truncate text-sm">
        {/* Spectators aren't in the stats database (see stats.rs), so only
         * seated players link through to the dossier (#375). */}
        {p.spectator ? (
          p.name
        ) : (
          <Link
            to={`/stats/${encodeURIComponent(p.name)}`}
            className="hover:underline"
            title={p.name}
          >
            {p.name}
          </Link>
        )}
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
                  <Badge
                    variant="ghost"
                    className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                  >
                    <Trophy className="size-3" /> Winner
                  </Badge>
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
 * The map preview for the replay's map. When the map isn't installed,
 * unitsync can't render it. The download control for that now lives in
 * {@link MissingContentNotice} near the top of the page (#495), so this just
 * explains why the preview is blank.
 */
function ReplayMapPreview({
  enginePath,
  dataDir,
  mapName,
  allyTeams,
}: {
  enginePath: string;
  dataDir: string;
  mapName: string;
  allyTeams: AllyTeamInfo[];
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
            appearance={minimap.appearance}
            skyboxSrc={skybox.dataUrl}
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
  const writePath = useWriteRootPath();
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);

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
      onDownloaded();
    } catch (e) {
      setDlError(errMessage(e));
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
          Download map
        </Button>
      </div>
      {downloading && progress && (
        <ProgressBar progress={progress} className="max-w-xs" />
      )}
      {!writePath && !downloading && (
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
      {dlError && <p className="text-xs text-destructive">{dlError}</p>}
    </div>
  );
}

/**
 * Missing-content affordance for the replay's game and/or map, surfaced near
 * the top of the page next to the game/map identity (#495) instead of at the
 * bottom, so it's the first thing a user sees when something needs
 * downloading. Renders nothing once both are installed, the common case,
 * especially after the #494 version-tolerant match fix.
 */
function MissingContentNotice({
  gameType,
  mapName,
  missingGame,
  missingMap,
  onMapDownloaded,
}: {
  gameType: string;
  mapName: string;
  missingGame: boolean;
  missingMap: boolean;
  onMapDownloaded: () => void;
}) {
  if (!missingGame && !missingMap) return null;
  const label =
    missingGame && missingMap
      ? "Game and map not installed"
      : missingGame
        ? "Game not installed"
        : "Map not installed";
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 p-3">
      <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
        <Download className="size-4" /> {label}
      </div>
      {missingGame && <GameDownload gameType={gameType} />}
      {missingMap && mapName && (
        <MapDownload mapName={mapName} onDownloaded={onMapDownloaded} />
      )}
    </section>
  );
}

/** Watched flag + free-form tags for this replay (persisted locally by filename). */
function ReplayNotes({ filename }: { filename: string }) {
  const userState = useReplayUserState();
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
      </div>
    </section>
  );
}

/** The replay's in-demo chat log, loaded on demand (runs `demotool --dump`). */
function ReplayChat({
  enginePath,
  replayPath,
}: {
  enginePath: string;
  replayPath: string;
}) {
  const [messages, setMessages] = useState<ChatLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await contentDemoChat({ enginePath, replayPath });
      setMessages(res.messages);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Chat log</h2>
      {messages === null ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="gap-1.5"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MessageSquare className="size-4" />
            )}
            {loading ? "Reading chat…" : "Show chat log"}
          </Button>
          {error && <ErrorBanner message={error} />}
        </div>
      ) : messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No chat was recorded in this replay.
        </p>
      ) : (
        <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto rounded-lg border border-border/50 bg-card p-3 text-sm">
          {messages.map((m, i) => {
            const key = `${i}-${m.text}`;
            return (
              <li key={key} className="break-words">
                <span
                  className={`mr-1.5 font-semibold ${m.system ? "text-muted-foreground" : ""}`}
                >
                  {m.system
                    ? "*"
                    : (m.playerName ??
                      (m.player != null ? `Player ${m.player}` : "?"))}
                </span>
                <span className={m.system ? "text-muted-foreground" : ""}>
                  {m.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Delete a replay after a confirm (irreversible), then hand back to `onDeleted`. */
function DeleteReplayButton({
  replayPath,
  onDeleted,
}: {
  replayPath: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del() {
    setPending(true);
    setError(null);
    try {
      await contentDeleteReplay({ path: replayPath });
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
            be undone.
          </p>
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
  const filename = name ? decodeURIComponent(name) : "";
  const navigate = useNavigate();
  const { selected } = useScanTargetSelection();
  const {
    replays,
    loading: listLoading,
    refresh,
  } = useReplays(selected?.rootPath);
  const replay = replays.find((r) => r.filename === filename);
  const { info, loading, error } = useDemoInfo(
    selected?.enginePath,
    replay?.path,
  );
  // Drives the engine-mismatch "may not sync" hint under the header.
  const { resolved } = useReplayTarget(info?.engineVersion ?? "");
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
  const missingGame =
    info && scan.data && !scan.loading
      ? !scan.data.games.some((g) => gameNamesMatch(g.name, info.gameType))
      : false;
  const missingMap =
    info?.mapName && scan.data && !scan.loading
      ? !scan.data.maps.some((m) => m.name === info.mapName)
      : false;

  // After a remix, pull the new copy into the list, then open its detail page —
  // so the user lands on the remix (where Watch lives) instead of re-triggering it.
  const onRemixed = async (newPath: string) => {
    await refresh();
    const newName = newPath.split(/[\\/]/).pop();
    if (!newName) return;
    navigate(`/play/replays/${encodeURIComponent(newName)}`);
    // Flag the navigation so the jump to a different file isn't a surprise.
    toast.success("Remix created", {
      description: "Opened the remixed replay — use Watch to run it.",
    });
  };

  const onDeleted = () => {
    navigate("/play/replays");
    toast.success("Replay deleted");
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
        ["Result", resultLabel(info)],
        ["File size", replay ? formatBytes(replay.sizeBytes) : "—"],
      ]
    : [];

  return (
    <div className="flex flex-col gap-5 p-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
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
          {info && resolved && !resolved.matched && (
            <p className="max-w-md text-xs text-amber-600 dark:text-amber-400">
              Recorded on {info.engineVersion || "an unknown engine"}; watching
              with {resolved.target.engineVersion} — may not sync.
            </p>
          )}
        </div>
        {replay && info && (
          // Destructive + secondary actions first; the primary CTA (Watch) sits
          // last so it lands in the top-right corner.
          <div className="flex shrink-0 items-start gap-2">
            <DeleteReplayButton
              replayPath={replay.path}
              onDeleted={onDeleted}
            />
            {/* No remixing a remix — its detail links back to the original instead. */}
            {selected && !info.remixed && (
              <RemixPanel
                replayPath={replay.path}
                recordedGameType={info.gameType}
                recordedEngineVersion={info.engineVersion}
                enginePath={selected.enginePath}
                dataDir={selected.rootPath}
                onRemixed={onRemixed}
              />
            )}
            <RefightPanel info={info} filename={filename} />
            <WatchButton
              replayPath={replay.path}
              engineVersion={info.engineVersion}
            />
          </div>
        )}
      </header>

      {error && <ErrorBanner message={error} />}

      {loading && !info ? (
        <DetailLoading backTo="/play/replays" />
      ) : info ? (
        <>
          <MissingContentNotice
            gameType={info.gameType}
            mapName={info.mapName}
            missingGame={missingGame}
            missingMap={missingMap}
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

          <Players info={info} />

          <ReplayNotes filename={filename} />

          {selected && replay && (
            <ReplayChat
              enginePath={selected.enginePath}
              replayPath={replay.path}
            />
          )}

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Map · {info.mapName}</h2>
            {selected && info.mapName ? (
              <ReplayMapPreview
                key={previewNonce}
                enginePath={selected.enginePath}
                dataDir={selected.rootPath}
                mapName={info.mapName}
                allyTeams={info.allyTeams}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                No map recorded for this replay.
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
