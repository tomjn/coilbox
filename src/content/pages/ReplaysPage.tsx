import { Button, useSetting } from "@picoframe/frame";
import {
  Clock,
  Code2,
  Eye,
  Gamepad2,
  Milestone,
  Orbit,
  Repeat,
  Rocket,
  Swords,
  Tag,
  X,
} from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { ContinueBadge } from "@/components/ContinueBadge";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { mostRecentOpen } from "@/lib/recency";
import { formatBytes } from "../../downloads/pages/components/ProgressBar";
import { OptionSelect } from "../../uberstress/pages/components/OptionSelect";
import {
  useReplays,
  useScanTargetSelection,
  useUnitsyncThumbnails,
} from "../config";
import {
  computeReplayFilterVisibility,
  isShortReplay,
  type ReplayOrigin,
  replayOrigin,
} from "../replayFilterVisibility";
import { useReplayUserState } from "../replayUserState";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { FilterBar } from "./components/FilterBar";
import { GatherReplaysButton } from "./components/GatherReplaysButton";
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

/** The origin filter's value, including the "no filter" choice. Radix's
 * `Select.Item` rejects an empty-string value, so "no filter" needs its own
 * sentinel rather than reusing `""` (as the tag filter does — that one never
 * renders its `""` item live, since it's hidden until a tag exists). */
type OriginFilterValue = ReplayOrigin | "all";

/**
 * Origin filter options. `other` is legacy/untagged replays — anything from
 * before this feature, or a best-effort tag that didn't land — not a mode of
 * its own.
 */
const ORIGIN_OPTIONS: { value: OriginFilterValue; label: string }[] = [
  { value: "all", label: "All origins" },
  { value: "conquest", label: "Conquest" },
  { value: "warpath", label: "Warpath" },
  { value: "campaign", label: "Campaign" },
  { value: "skirmish", label: "Skirmish" },
  { value: "multiplayer", label: "Multiplayer" },
  { value: "refight", label: "Refight" },
  { value: "other", label: "Unknown origin" },
];

const ORIGIN_BADGE: Record<
  ReplayOrigin,
  { label: string; icon: typeof Orbit } | null
> = {
  conquest: { label: "Conquest", icon: Orbit },
  warpath: { label: "Warpath", icon: Rocket },
  campaign: { label: "Campaign", icon: Milestone },
  skirmish: { label: "Skirmish", icon: Swords },
  multiplayer: { label: "Multiplayer", icon: Gamepad2 },
  refight: { label: "Refight", icon: Repeat },
  // No badge for "other" — there's nothing known to show, and a badge on
  // every row would just be noise.
  other: null,
};

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

/** The mode badge for a replay's row/detail header, when its origin is known. */
export function OriginBadge({ origin }: { origin: ReplayOrigin }) {
  const badge = ORIGIN_BADGE[origin];
  if (!badge) return null;
  const Icon = badge.icon;
  return (
    <Badge
      variant="ghost"
      className="shrink-0 gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
    >
      <Icon className="size-2.5" /> {badge.label}
    </Badge>
  );
}

/**
 * Replays found in the selected content root's `demos/`/`replays/` folder and in
 * those of every engine installed under it (an engine in Portable Mode writes
 * its replays into its own folder). The list is cheap fs metadata (filename,
 * played date, size), and each row opens a detail view that decodes the demo
 * (map preview, players, winner).
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

  // A content map detail's "Replays on this map" links here with `?map=<name>`,
  // scoping the list to that map. Clearable via the chip below (drops the param).
  const [searchParams, setSearchParams] = useSearchParams();
  const mapFilter = searchParams.get("map") ?? "";
  const clearMapFilter = () => {
    setSearchParams(
      (prev) => {
        prev.delete("map");
        return prev;
      },
      { replace: true },
    );
  };

  // Search/sort/watched/tag persist through the frame settings store (like the
  // skirmish draft) so a regular's usual view survives a restart. The `map`
  // query param above is a separate, unpersisted mechanism (a content map
  // detail link scoping the list) and is untouched by this.
  const [filter, setFilter] = useSetting("content.replayFilters.search", "");
  const [sort, setSort] = useSetting<SortKey>(
    "content.replayFilters.sort",
    "date-desc",
  );
  const [watchedOnly, setWatchedOnly] = useSetting(
    "content.replayFilters.watchedOnly",
    false,
  );
  const [remixedOnly, setRemixedOnly] = useSetting(
    "content.replayFilters.remixedOnly",
    false,
  );
  // Sub-1-minute replays are noise (aborts, crashes), so they're hidden by
  // default; this reveals them rather than narrowing the list further.
  const [showShort, setShowShort] = useSetting(
    "content.replayFilters.showShort",
    false,
  );
  const [tagFilter, setTagFilter] = useSetting("content.replayFilters.tag", "");
  const [originFilter, setOriginFilter] = useSetting<OriginFilterValue>(
    "content.replayFilters.origin",
    "all",
  );
  const userState = useReplayUserState();
  const tagOptions = useMemo(
    () => [
      { value: "", label: "All tags" },
      ...userState.allTags().map((t) => ({ value: t, label: t })),
    ],
    [userState],
  );

  // Which toggle filters could match anything, so a filter that can only ever
  // return an empty list (e.g. watched-only before the user has watched
  // anything) doesn't show at all. Computed from `replays` — the unfiltered
  // library — so toggling one filter never hides another filter's control.
  const filterVisibility = useMemo(
    () => computeReplayFilterVisibility(replays, userState.get),
    [replays, userState],
  );

  // The single most recent unwatched replay (issue #374's "continue playing"
  // affordance): badged wherever it lands in the current sort/filter, since
  // its row already links straight to the replay.
  const resumeFilename = useMemo(
    () =>
      mostRecentOpen(
        replays,
        (r) => !userState.get(r.filename).watched,
        (r) => dateOf(r),
      )?.filename,
    [replays, userState],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return replays.filter((r) => {
      if (q && !r.filename.toLowerCase().includes(q)) return false;
      if (mapFilter && r.mapName !== mapFilter) return false;
      const us = userState.get(r.filename);
      if (watchedOnly && !us.watched) return false;
      if (remixedOnly && !r.remixed) return false;
      if (!showShort && isShortReplay(r.durationSec)) return false;
      if (tagFilter && !(us.tags ?? []).includes(tagFilter)) return false;
      if (originFilter !== "all" && replayOrigin(us) !== originFilter)
        return false;
      return true;
    });
  }, [
    replays,
    filter,
    mapFilter,
    watchedOnly,
    remixedOnly,
    showShort,
    tagFilter,
    originFilter,
    userState,
  ]);

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
    <TooltipProvider>
      <div className="flex flex-col gap-4 p-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Replays</h1>
          <p className="text-sm text-muted-foreground">
            Demo files in your content folder.
          </p>
        </header>

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <BrowserToolbar
              targets={targets}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              onRescan={refresh}
              scanning={loading}
            />
          </div>
          {/* Some engines record into their own folder, so a player clearing an
              old engine in Finder loses those games. This puts them all in one
              place first (issue #971). */}
          <GatherReplaysButton
            rootPath={selected?.rootPath}
            onGathered={refresh}
          />
        </div>

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
            trailing={
              <>
                {mapFilter && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={clearMapFilter}
                    className="gap-1.5"
                    title="Clear the map filter"
                  >
                    Map: {mapFilter} <X className="size-3.5" />
                  </Button>
                )}
                {filterVisibility.watched && (
                  <Button
                    variant={watchedOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => setWatchedOnly(!watchedOnly)}
                    aria-pressed={watchedOnly}
                    className="gap-1.5"
                  >
                    <Eye className="size-4" /> Watched
                  </Button>
                )}
                {filterVisibility.remixed && (
                  <Button
                    variant={remixedOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => setRemixedOnly(!remixedOnly)}
                    aria-pressed={remixedOnly}
                    className="gap-1.5"
                  >
                    <Code2 className="size-4" /> Remixed
                  </Button>
                )}
                {filterVisibility.short && (
                  <Button
                    variant={showShort ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowShort(!showShort)}
                    aria-pressed={showShort}
                    className="gap-1.5"
                    title="Show replays under a minute long"
                  >
                    <Clock className="size-4" /> Short replays
                  </Button>
                )}
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
                <OptionSelect
                  value={originFilter}
                  onValueChange={(v) => setOriginFilter(v as OriginFilterValue)}
                  options={ORIGIN_OPTIONS}
                  size="sm"
                  className="w-44"
                />
              </>
            }
          />
        )}

        {error && <ErrorBanner message={error} />}

        {targets.length === 0 ? null : busy ? (
          <SkeletonList />
        ) : replays.length === 0 ? (
          <EmptyState label="No replays found. Watch a game, or place .sdfz files in your demos folder." />
        ) : sorted.length === 0 ? (
          <EmptyState
            label={
              mapFilter
                ? `No replays on “${mapFilter}”.`
                : `No replays match “${filter.trim()}”.`
            }
          />
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
                    to={`/play/replays/${encodeURIComponent(r.filename)}`}
                    className="flex min-w-0 flex-1 items-stretch gap-3 p-2"
                  >
                    <div className="size-16 shrink-0 overflow-hidden rounded-md">
                      <MapThumb
                        url={thumb?.url}
                        width={thumb?.width}
                        height={thumb?.height}
                        alt={
                          r.mapName ? `Minimap of ${r.mapName}` : "Replay map"
                        }
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
                        <OriginBadge origin={replayOrigin(us)} />
                        {r.filename === resumeFilename && (
                          <ContinueBadge label="Unwatched" />
                        )}
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        {meta.join(" · ")}
                      </span>
                      {r.gameType && (
                        <span className="truncate text-xs text-muted-foreground">
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
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="text-right text-xs text-muted-foreground">
                            <div className="text-[10px] uppercase tracking-wide">
                              Skill
                            </div>
                            <div className="font-mono text-sm text-foreground">
                              {fmtSkill(r.skillAvg)}
                            </div>
                            <div className="font-mono">
                              {fmtSkill(r.skillMin)}–{fmtSkill(r.skillMax)}
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          Average non-spectator player skill, with the min-max
                          range below
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        userState.setWatched(r.filename, !us.watched)
                      }
                      aria-pressed={!!us.watched}
                      aria-label={
                        us.watched ? "Mark unwatched" : "Mark watched"
                      }
                      title={us.watched ? "Watched" : "Mark watched"}
                    >
                      <Eye
                        className={`size-4 ${us.watched ? "text-primary" : "text-muted-foreground"}`}
                      />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </TooltipProvider>
  );
}
