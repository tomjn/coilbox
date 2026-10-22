import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
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
  User,
  X,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { ContinueBadge } from "@/components/ContinueBadge";
import { OptionSelect } from "@/components/OptionSelect";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatBytes,
  formatDateTime,
  formatDuration,
  formatFixed,
} from "@/lib/format";
import { mostRecentOpen } from "@/lib/recency";
import { isProfileHidden } from "../../profile/hidden";
import type { StatRecord } from "../bindings";
import {
  useContentState,
  useReplayStats,
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
import {
  columnMetrics,
  compareFigures,
  figureBasis,
  formatFigure,
  isOverMinimum,
  libraryMetrics,
  MIN_LENGTH_OPTIONS,
  matchFigure,
  metricSortValue,
  parseMetricSort,
} from "../replayMatchFigures";
import { findSet, resolveSet, useReplaySets } from "../replaySets";
import { refightFilenames, useReplayUserState } from "../replayUserState";
import { useMetricRegistry } from "../useMetricRegistry";
import { pickPrimaryPlayer } from "../usePrimaryPlayer";
import { useReplaysRoot } from "../useReplaysRoot";
import { BrowserToolbar } from "./components/BrowserToolbar";
import { ClearUnfinishedButton } from "./components/ClearUnfinishedButton";
import { FilterBar } from "./components/FilterBar";
import { GatherReplaysButton } from "./components/GatherReplaysButton";
import { MapThumb } from "./components/MapThumb";
import { ReplaySetPicker } from "./components/ReplaySetPicker";
import { ReplaySetsManager } from "./components/ReplaySetsManager";
import { ReplayTrackBadge } from "./components/ReplayTrackBadge";
import { EmptyState, ErrorBanner, SkeletonList } from "./components/states";

/** A fixed sort from the list below, or a `metric:<key>:<direction>` value. */
type SortKey = string;

const SORT_OPTIONS: { value: string; label: MessageDescriptor }[] = [
  { value: "date-desc", label: msg`Newest` },
  { value: "date-asc", label: msg`Oldest` },
  { value: "name-asc", label: msg`Name A–Z` },
  { value: "name-desc", label: msg`Name Z–A` },
  { value: "size-desc", label: msg`Largest` },
  { value: "size-asc", label: msg`Smallest` },
  { value: "duration-desc", label: msg`Longest` },
  { value: "duration-asc", label: msg`Shortest` },
];

/** `Damage dealt` becomes `damage dealt`, to follow "Most" or "Least". */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

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
const ORIGIN_OPTIONS: { value: OriginFilterValue; label: MessageDescriptor }[] =
  [
    { value: "all", label: msg`All origins` },
    { value: "conquest", label: msg`Conquest` },
    { value: "warpath", label: msg`Warpath` },
    { value: "campaign", label: msg`Campaign` },
    { value: "skirmish", label: msg`Skirmish` },
    { value: "multiplayer", label: msg`Multiplayer` },
    { value: "refight", label: msg`Refight` },
    { value: "other", label: msg`Unknown origin` },
  ];

const ORIGIN_BADGE: Record<
  ReplayOrigin,
  { label: MessageDescriptor; icon: typeof Orbit } | null
> = {
  conquest: { label: msg`Conquest`, icon: Orbit },
  warpath: { label: msg`Warpath`, icon: Rocket },
  campaign: { label: msg`Campaign`, icon: Milestone },
  skirmish: { label: msg`Skirmish`, icon: Swords },
  multiplayer: { label: msg`Multiplayer`, icon: Gamepad2 },
  refight: { label: msg`Refight`, icon: Repeat },
  // No badge for "other" — there's nothing known to show, and a badge on
  // every row would just be noise.
  other: null,
};

/** Played date, e.g. `27 Apr 2026, 20:14`. */
function playedAt(ms: number): string {
  if (!ms) return "";
  return formatDateTime(new Date(ms), {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** The battle date: the demo header's start time, falling back to the mtime. */
const dateOf = (r: { startTimeMs?: number; modifiedMs: number }) =>
  r.startTimeMs || r.modifiedMs;

/** A skill value for a column, rounded to one decimal (or `—`). */
const fmtSkill = (v?: number) => (v == null ? "—" : formatFixed(v, 1));

/** The mode badge for a replay's row/detail header, when its origin is known. */
export function OriginBadge({ origin }: { origin: ReplayOrigin }) {
  const { i18n } = useLingui();
  const badge = ORIGIN_BADGE[origin];
  if (!badge) return null;
  const Icon = badge.icon;
  return (
    <Badge
      variant="ghost"
      className="shrink-0 gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
    >
      <Icon className="size-2.5" /> {i18n._(badge.label)}
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
  const { t, i18n } = useLingui();
  const { targets, selected, selectedKey } = useScanTargetSelection();
  const replaysRoot = useReplaysRoot(selected?.rootPath);
  const { replays, loading, error, refresh, ready } = useReplays(replaysRoot);
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
  const [minLength, setMinLength] = useSetting(
    "content.replayFilters.minLength",
    "0",
  );
  // The id of the set the list is narrowed to, "" for none.
  const [setFilterId, setSetFilterId] = useSetting(
    "content.replayFilters.set",
    "",
  );
  // Whether the figures and metric sorts are for the primary player's own army
  // rather than the whole match.
  const [mineOnly, setMineOnly] = useSetting(
    "content.replayFilters.mine",
    false,
  );
  const [statsPlayer] = useSetting("content.statsPlayer", "");

  // What happened in the match comes from the stats store, joined to a row by
  // file. A distribution that hides match statistics gets none of it, and the
  // empty root list stops the ingest pass and watcher as well.
  const statsHidden = isProfileHidden("analytics.matchStats");
  const { state: contentState } = useContentState();
  const statRoots = useMemo(
    () => (statsHidden ? [] : (contentState?.roots ?? []).map((r) => r.path)),
    [statsHidden, contentState],
  );
  const { records: statRecords } = useReplayStats(
    statRoots,
    selected?.enginePath,
  );
  const registry = useMetricRegistry(!statsHidden);
  const metrics = useMemo(() => libraryMetrics(registry), [registry]);
  const userState = useReplayUserState();
  // Who "mine" means, decided as the dossier decides it. The list ingests, so
  // it reads the records it already holds. Empty until they arrive.
  const primary = useMemo(
    () =>
      pickPrimaryPlayer(
        statRecords,
        refightFilenames(userState.state),
        statsPlayer,
      ),
    [statRecords, userState.state, statsPlayer],
  );
  const mineBasis = metrics.length > 0 && primary !== "";
  // The player the figures are for, or undefined for the whole match. A saved
  // "mine" with nobody to be mine for shows the whole match.
  const basisPlayer = mineOnly && mineBasis ? primary : undefined;
  const statsByPath = useMemo(() => {
    const byPath = new Map<string, StatRecord>();
    const byName = new Map<string, StatRecord>();
    for (const rec of statRecords) {
      byPath.set(rec.path, rec);
      byName.set(rec.filename, rec);
    }
    return (r: { path: string; filename: string }) =>
      byPath.get(r.path) ?? byName.get(r.filename);
  }, [statRecords]);

  const sortOptions = useMemo(
    () => [
      ...SORT_OPTIONS.map((o) => ({ value: o.value, label: i18n._(o.label) })),
      ...metrics.flatMap((m) => {
        const metricName = lowerFirst(m.label);
        return [
          {
            value: metricSortValue(m.key, "desc"),
            label: t`Most ${metricName}`,
          },
          {
            value: metricSortValue(m.key, "asc"),
            label: t`Least ${metricName}`,
          },
        ];
      }),
    ],
    [metrics, i18n, t],
  );
  // A saved sort the page cannot offer now (statistics hidden, or the registry
  // has not arrived) falls back to newest rather than showing a blank select.
  const effectiveSort = sortOptions.some((o) => o.value === sort)
    ? sort
    : "date-desc";
  const metricSort = parseMetricSort(effectiveSort);
  const sortMetric = metricSort
    ? metrics.find((m) => m.key === metricSort.key)
    : undefined;
  const shownMetrics = useMemo(
    () => columnMetrics(registry, sortMetric?.key),
    [registry, sortMetric],
  );

  const replaySets = useReplaySets();
  // A saved pick whose set was since deleted shows everything.
  const activeSet = findSet(replaySets.sets, setFilterId);
  // The game id comes from the stat record, so it is absent while statistics
  // are hidden or the replay is not ingested yet. The filename still matches.
  const gameIdOf = useCallback(
    (r: { path: string; filename: string }) => statsByPath(r)?.gameId,
    [statsByPath],
  );
  const resolveForList = (set: Parameters<typeof resolveSet>[0]) =>
    resolveSet(set, replays, gameIdOf);
  const activeSetName = activeSet?.name ?? "";
  const activeResolved = useMemo(
    () => (activeSet ? resolveSet(activeSet, replays, gameIdOf) : null),
    [activeSet, replays, gameIdOf],
  );
  const inActiveSet = useMemo(
    () => new Set(activeResolved?.present.map((r) => r.path)),
    [activeResolved],
  );
  const tagOptions = useMemo(
    () => [
      { value: "", label: t`All tags` },
      ...userState.allTags().map((tag) => ({ value: tag, label: tag })),
    ],
    [userState, t],
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
      if (!isOverMinimum(r.durationSec, Number(minLength))) return false;
      if (tagFilter && !(us.tags ?? []).includes(tagFilter)) return false;
      if (activeSet && !inActiveSet.has(r.path)) return false;
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
    minLength,
    tagFilter,
    originFilter,
    userState,
    activeSet,
    inActiveSet,
  ]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      if (sortMetric && metricSort) {
        return compareFigures(
          matchFigure(statsByPath(a), sortMetric, basisPlayer),
          matchFigure(statsByPath(b), sortMetric, basisPlayer),
          metricSort.dir,
        );
      }
      switch (effectiveSort) {
        case "duration-desc":
        case "duration-asc":
          return compareFigures(
            a.durationSec,
            b.durationSec,
            effectiveSort === "duration-asc" ? "asc" : "desc",
          );
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
  }, [
    filtered,
    effectiveSort,
    sortMetric,
    metricSort,
    statsByPath,
    basisPlayer,
  ]);

  // Busy only while actually loading or before the first load completes for the
  // selected target — NOT when a load finished and simply found no replays (that
  // must fall through to the empty state, not spin a skeleton forever).
  const filterText = filter.trim();
  const missingCount = activeResolved?.missing.length ?? 0;
  const originOptions = ORIGIN_OPTIONS.map((o) => ({
    value: o.value,
    label: i18n._(o.label),
  }));
  const busy = loading || (!!replaysRoot && !ready);

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4 p-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">{t`Replays`}</h1>
          <p className="text-sm text-muted-foreground">
            <Trans>Demo files in your content folder.</Trans>
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-auto">
            <BrowserToolbar
              targets={targets}
              selectedKey={selectedKey}
              onRescan={refresh}
              scanning={loading}
            />
          </div>
          {/* Some engines record into their own folder, so a player clearing an
              old engine in Finder loses those games. This puts them all in one
              place first (issue #971). */}
          <GatherReplaysButton rootPath={replaysRoot} onGathered={refresh} />
          <ClearUnfinishedButton replays={replays} onCleared={refresh} />
          <ReplaySetsManager
            api={replaySets}
            resolve={resolveForList}
            shown={sorted.map((r) => ({
              filename: r.filename,
              gameId: gameIdOf(r),
            }))}
            activeId={activeSet?.id ?? ""}
            onFilter={setSetFilterId}
          />
        </div>

        {!busy && replays.length > 0 && (
          <FilterBar
            search={filter}
            onSearch={setFilter}
            searchPlaceholder={t`Filter replays…`}
            searchLabel={t`Filter replays`}
            sort={effectiveSort}
            onSort={setSort}
            sortOptions={sortOptions}
            sortClassName="w-52"
            total={replays.length}
            shown={sorted.length}
            noun={t`replays`}
            trailing={
              <>
                {mapFilter && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={clearMapFilter}
                    className="gap-1.5"
                    title={t`Clear the map filter`}
                  >
                    <Trans>Map: {mapFilter}</Trans> <X className="size-3.5" />
                  </Button>
                )}
                {mineBasis && (
                  <Button
                    variant={mineOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => setMineOnly(!mineOnly)}
                    aria-pressed={mineOnly}
                    className="gap-1.5"
                    title={t`Show and sort the figures for ${primary} alone instead of the whole match`}
                  >
                    <User className="size-4" /> {t`My figures`}
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
                    <Eye className="size-4" /> {t`Watched`}
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
                    <Code2 className="size-4" /> {t`Remixed`}
                  </Button>
                )}
                {filterVisibility.short && (
                  <Button
                    variant={showShort ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowShort(!showShort)}
                    aria-pressed={showShort}
                    className="gap-1.5"
                    title={t`Show replays under a minute long`}
                  >
                    <Clock className="size-4" /> {t`Short replays`}
                  </Button>
                )}
                {activeSet && activeResolved && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSetFilterId("")}
                    className="gap-1.5"
                    title={t`Show every replay again`}
                  >
                    {activeResolved.missing.length > 0
                      ? t`Set: ${activeSetName} (${missingCount} not in library)`
                      : t`Set: ${activeSetName}`}
                    <X className="size-3.5" />
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
                  value={minLength}
                  onValueChange={setMinLength}
                  options={MIN_LENGTH_OPTIONS}
                  size="sm"
                  className="w-44"
                />
                <OptionSelect
                  value={originFilter}
                  onValueChange={(v) => setOriginFilter(v as OriginFilterValue)}
                  options={originOptions}
                  size="sm"
                  className="w-44"
                />
              </>
            }
          />
        )}

        {error && <ErrorBanner message={error} />}

        {busy ? (
          <SkeletonList />
        ) : replays.length === 0 ? (
          <EmptyState
            label={t`No replays found. Watch a game, or place .sdfz files in your demos folder.`}
          />
        ) : sorted.length === 0 ? (
          <EmptyState
            label={
              mapFilter
                ? t`No replays on “${mapFilter}”.`
                : activeSet && !filter.trim()
                  ? t`No replays in “${activeSetName}” match the filters.`
                  : t`No replays match “${filterText}”.`
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
                  ? plural(r.playerCount, {
                      one: "# player",
                      other: "# players",
                    })
                  : null,
                formatBytes(r.sizeBytes),
              ].filter(Boolean);
              const us = userState.get(r.filename);
              const hasSkill = r.skillAvg != null;
              const stat = statsByPath(r);
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
                          r.mapName ? t`Minimap of ${r.mapName}` : t`Replay map`
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
                            title={t`A coilbox remix — rewritten to run on a local build`}
                          >
                            <Code2 className="size-2.5" /> {t`Remix`}
                          </Badge>
                        )}
                        {r.unfinished && (
                          <Badge
                            variant="ghost"
                            className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                            title={t`The file is empty. The game that was recording it did not finish, or is still running.`}
                          >
                            {t`Recording did not finish`}
                          </Badge>
                        )}
                        {r.staleRemix && (
                          <Badge
                            variant="ghost"
                            className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                            title={t`An older coilbox made this remix. It plays on the game it was recorded with. Open it to remake it from the original.`}
                          >
                            {t`Plays original game`}
                          </Badge>
                        )}
                        <OriginBadge origin={replayOrigin(us)} />
                        <ReplayTrackBadge
                          gameId={r.gameId}
                          remixed={r.remixed}
                        />
                        {r.filename === resumeFilename && (
                          <ContinueBadge label={t`Unwatched`} />
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
                          {us.tags?.map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </Link>
                  {/* Skill columns + watched toggle live outside the Link so they
                    stay their own controls. */}
                  <div className="flex shrink-0 items-center gap-3 border-l border-border/40 px-3">
                    {shownMetrics.map((m) => {
                      const sorted = m.key === sortMetric?.key;
                      return (
                        <Tooltip key={m.key}>
                          <TooltipTrigger asChild>
                            {/* Below the large breakpoint only the sorted figure
                              stays, so a narrow window keeps the one it sorts by. */}
                            <div
                              className={`${sorted ? "" : "hidden lg:block"} text-right text-xs text-muted-foreground`}
                            >
                              <div className="text-[10px] uppercase tracking-wide">
                                {m.label}
                              </div>
                              <div className="font-mono text-sm text-foreground">
                                {formatFigure(
                                  matchFigure(stat, m, basisPlayer),
                                )}
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            {m.label}, {figureBasis(m, basisPlayer)}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                    {hasSkill && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="text-right text-xs text-muted-foreground">
                            <div className="text-[10px] uppercase tracking-wide">
                              {t`Skill`}
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
                          <Trans>
                            Average non-spectator player skill, with the min-max
                            range below
                          </Trans>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <ReplaySetPicker
                      api={replaySets}
                      label=""
                      member={{ filename: r.filename, gameId: gameIdOf(r) }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        userState.setWatched(r.filename, !us.watched)
                      }
                      aria-pressed={!!us.watched}
                      aria-label={
                        us.watched ? t`Mark unwatched` : t`Mark watched`
                      }
                      title={us.watched ? t`Watched` : t`Mark watched`}
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
