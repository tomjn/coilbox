import { Button } from "@picoframe/frame";
import { Code2, Eye, Tag } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { formatBytes } from "../../downloads/pages/components/ProgressBar";
import { OptionSelect } from "../../uberstress/pages/components/OptionSelect";
import {
  useReplays,
  useScanTargetSelection,
  useUnitsyncThumbnails,
} from "../config";
import { useReplayUserState } from "../replayUserState";
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

/** A skill value for a column, rounded to one decimal (or `—`). */
const fmtSkill = (v?: number) => (v == null ? "—" : v.toFixed(1));

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
  const { replays, loading, error, refresh, ready } = useReplays(
    selected?.rootPath,
  );
  const { thumbs, loading: thumbsLoading } = useUnitsyncThumbnails(
    selected?.enginePath,
    selected?.rootPath,
  );

  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortKey>("date-desc");
  const [watchedOnly, setWatchedOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const userState = useReplayUserState();
  const tagOptions = useMemo(
    () => [
      { value: "", label: "All tags" },
      ...userState.allTags().map((t) => ({ value: t, label: t })),
    ],
    [userState],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return replays.filter((r) => {
      if (q && !r.filename.toLowerCase().includes(q)) return false;
      const us = userState.get(r.filename);
      if (watchedOnly && !us.watched) return false;
      if (tagFilter && !(us.tags ?? []).includes(tagFilter)) return false;
      return true;
    });
  }, [replays, filter, watchedOnly, tagFilter, userState]);

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

  // Busy only while actually loading or before the first load completes for the
  // selected target — NOT when a load finished and simply found no replays (that
  // must fall through to the empty state, not spin a skeleton forever).
  const busy = loading || (!!selected && !ready);

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
        <>
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={watchedOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setWatchedOnly((v) => !v)}
              aria-pressed={watchedOnly}
              className="gap-1.5"
            >
              <Eye className="size-4" /> Watched
            </Button>
            {tagOptions.length > 1 && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Tag className="size-4" />
                <OptionSelect
                  value={tagFilter}
                  onValueChange={setTagFilter}
                  options={tagOptions}
                  size="sm"
                  className="w-40"
                />
              </div>
            )}
          </div>
        </>
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
            const us = userState.get(r.filename);
            const hasSkill = r.skillAvg != null;
            return (
              <li
                key={r.path}
                className="flex items-stretch overflow-hidden rounded-lg border border-border/50 bg-card transition-colors hover:border-border hover:bg-accent/40"
              >
                <Link
                  to={`/content/replays/${encodeURIComponent(r.filename)}`}
                  className="flex min-w-0 flex-1 items-stretch gap-3 p-2"
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
                    <div className="flex items-center gap-1.5">
                      <span
                        className="truncate text-sm font-medium"
                        title={r.mapName ?? r.filename}
                      >
                        {r.mapName ?? r.filename}
                      </span>
                      {r.remixed && (
                        <Badge
                          variant="ghost"
                          className="shrink-0 gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                          title="A coilbox remix — rewritten to run on a local build"
                        >
                          <Code2 className="size-2.5" /> Remix
                        </Badge>
                      )}
                    </div>
                    <span className="truncate text-xs text-muted-foreground">
                      {meta.join(" · ")}
                    </span>
                    {r.gameType && (
                      <span className="truncate text-xs text-muted-foreground/80">
                        {r.gameType}
                      </span>
                    )}
                    {(us.tags?.length ?? 0) > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {us.tags?.map((t) => (
                          <span
                            key={t}
                            className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
                {/* Skill columns + watched toggle live outside the Link so they
                    stay their own controls. */}
                <div className="flex shrink-0 items-center gap-3 border-l border-border/40 px-3">
                  {hasSkill && (
                    <div
                      className="text-right text-xs text-muted-foreground"
                      title="Skill min / avg / max"
                    >
                      <div className="font-mono text-sm text-foreground">
                        {fmtSkill(r.skillAvg)}
                      </div>
                      <div className="font-mono">
                        {fmtSkill(r.skillMin)}–{fmtSkill(r.skillMax)}
                      </div>
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      userState.setWatched(r.filename, !us.watched)
                    }
                    aria-pressed={!!us.watched}
                    aria-label={us.watched ? "Mark unwatched" : "Mark watched"}
                    title={us.watched ? "Watched" : "Mark watched"}
                  >
                    <Eye
                      className={`size-4 ${us.watched ? "text-primary" : "text-muted-foreground/50"}`}
                    />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
