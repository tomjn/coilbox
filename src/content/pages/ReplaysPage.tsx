import { useMemo, useState } from "react";
import { Link } from "react-router";
import { formatBytes } from "../../downloads/pages/components/ProgressBar";
import {
  useReplays,
  useScanTargetSelection,
  useUnitsyncThumbnails,
} from "../config";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { FilterBar } from "./components/FilterBar";
import { MapThumb } from "./components/MapThumb";
import { EmptyState, ErrorBanner, SkeletonList } from "./components/states";

type SortKey =
  | "date-desc"
  | "date-asc"
  | "name-asc"
  | "name-desc"
  | "size-desc"
  | "size-asc";

const SORT_OPTIONS = [
  { value: "date-desc", label: "Newest" },
  { value: "date-asc", label: "Oldest" },
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "size-desc", label: "Largest" },
  { value: "size-asc", label: "Smallest" },
];

/** Played date, e.g. `27 Apr 2026, 20:14`. */
function playedAt(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** The battle date: the demo header's start time, falling back to the mtime. */
const dateOf = (r: { startTimeMs?: number; modifiedMs: number }) =>
  r.startTimeMs || r.modifiedMs;

/** Seconds → `mm:ss` (or `h:mm:ss`). */
function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return h > 0
    ? `${h}:${mm}:${String(s).padStart(2, "0")}`
    : `${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * Replays found in the selected content root's `demos/`/`replays/` folder. The
 * list is cheap fs metadata (filename, played date, size); each row opens a
 * detail view that decodes the demo (map preview, players, winner).
 */
export default function ReplaysPage() {
  const { targets, selected, selectedKey, setSelectedKey } =
    useScanTargetSelection();
  const { replays, loading, error, refresh } = useReplays(selected?.rootPath);
  const { thumbs, loading: thumbsLoading } = useUnitsyncThumbnails(
    selected?.enginePath,
    selected?.rootPath,
  );

  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("date-desc");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return replays;
    return replays.filter((r) => r.filename.toLowerCase().includes(q));
  }, [replays, filter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      switch (sort) {
        case "date-asc":
          return dateOf(a) - dateOf(b);
        case "name-asc":
          return a.filename.localeCompare(b.filename);
        case "name-desc":
          return b.filename.localeCompare(a.filename);
        case "size-desc":
          return b.sizeBytes - a.sizeBytes;
        case "size-asc":
          return a.sizeBytes - b.sizeBytes;
        default:
          return dateOf(b) - dateOf(a);
      }
    });
    return arr;
  }, [filtered, sort]);

  const busy = loading || (!!selected && replays.length === 0 && !error);

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Replays</h1>
        <p className="text-sm text-muted-foreground">
          Demo files in your content folder, decoded with the engine's demotool.
        </p>
      </header>

      <BrowserToolbar
        targets={targets}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onRescan={refresh}
        scanning={loading}
      />

      {!busy && replays.length > 0 && (
        <FilterBar
          search={filter}
          onSearch={setFilter}
          searchPlaceholder="Filter replays…"
          searchLabel="Filter replays"
          sort={sort}
          onSort={(v) => setSort(v as SortKey)}
          sortOptions={SORT_OPTIONS}
          total={replays.length}
          shown={sorted.length}
          noun="replays"
        />
      )}

      {error && <ErrorBanner message={error} />}

      {targets.length === 0 ? null : busy ? (
        <SkeletonList />
      ) : replays.length === 0 ? (
        <EmptyState label="No replays found. Watch a game, or place .sdfz files in your demos folder." />
      ) : sorted.length === 0 ? (
        <EmptyState label={`No replays match “${filter.trim()}”.`} />
      ) : (
        <ul className="flex flex-col gap-2">
          {sorted.map((r) => {
            const thumb = r.mapName ? thumbs.get(r.mapName) : undefined;
            const meta = [
              playedAt(dateOf(r)),
              r.durationSec != null ? formatDuration(r.durationSec) : null,
              r.playerCount != null
                ? `${r.playerCount} player${r.playerCount === 1 ? "" : "s"}`
                : null,
              formatBytes(r.sizeBytes),
            ].filter(Boolean);
            return (
              <li
                key={r.path}
                className="overflow-hidden rounded-lg border border-border/50 bg-card transition-colors hover:border-border hover:bg-accent/40"
              >
                <Link
                  to={`/content/replays/${encodeURIComponent(r.filename)}`}
                  className="flex items-stretch gap-3 p-2"
                >
                  <div className="size-16 shrink-0 overflow-hidden rounded-md">
                    <MapThumb
                      dataUrl={thumb?.dataUrl}
                      width={thumb?.width}
                      height={thumb?.height}
                      alt={r.mapName ? `Minimap of ${r.mapName}` : "Replay map"}
                      loading={!!r.mapName && thumbsLoading && !thumb}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                    <span
                      className="truncate text-sm font-medium"
                      title={r.mapName ?? r.filename}
                    >
                      {r.mapName ?? r.filename}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {meta.join(" · ")}
                    </span>
                    {r.gameType && (
                      <span className="truncate text-xs text-muted-foreground/80">
                        {r.gameType}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
