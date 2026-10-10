import { Button, Input, useSetting } from "@picoframe/frame";
import { useEffect, useMemo, useRef, useState } from "react";
import { Field } from "@/components/Field";
import { HeatLegend } from "@/components/HeatLegend";
import { OptionSelect } from "@/components/OptionSelect";
import { Skeleton } from "@/components/ui/skeleton";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { drawHeatField } from "@/lib/heatCanvas";
import { HEAT_KIND_OF_LAYER } from "@/lib/heatRamp";
import type { MapScene3D } from "@/lib/mapScene";
import { useHeatmapLayer } from "@/lib/useHeatmapLayer";
import type { StatRecord } from "../../bindings";
import {
  type AggregateFilters,
  aggregateLayer,
  aggregateStarts,
  FORMAT_LABEL,
  filterChoices,
  filterMatches,
  HEAT_LAYERS,
  type HeatLayerId,
  LAYER_LABEL,
  type LayerAggregate,
  layerEvents,
  layerLegend,
  type MatchFormat,
  type MatchWindow,
  mapMatches,
  matchCount,
  matchesElsewhere,
  matchesWithStarts,
  NO_FILTERS,
  NORMALISE_LABEL,
  type Normalise,
  WHOLE,
  windowLabel,
} from "../../mapAggregate";
import { mapExportInfo } from "../../mapAggregateExport";
import {
  joinStarts,
  type Point,
  placeRecords,
  sharedFormat,
} from "../../mapRecords";
import {
  countBy,
  includedVersions,
  type MapSize,
  mapVersions,
  versionsSpanned,
} from "../../mapVersions";
import { useStoredAnalyses } from "../../replayAnalysis";
import { type MapWorld, mapFraction } from "../../replayMapLayers";
import { findSet, resolveSet, useReplaySets } from "../../replaySets";
import {
  resolveNames,
  type StartRow,
  type StoredName,
  startRows,
  withNames,
  withoutName,
} from "../../startNames";
import { useGameCategories, useMapReplayCounts } from "../../useMapAggregate";
import { useStartNames } from "../../useStartNames";
import { DateFilter } from "./DateFilter";
import { MapExportButtons } from "./MapExportButtons";
import { MapRecords, MapRecordsHelp, PlaceNumber } from "./MapRecords";
import { SectionHelp } from "./SectionHelp";
import { VersionList, VersionSpan } from "./VersionList";

const ANY = "any";
const NO_POSITIONS: readonly Point[] = [];
const NO_REFIGHTS: ReadonlySet<string> = new Set();
const NO_SIZES: Readonly<Record<string, MapSize>> = {};

/** The windows offered by name. Each is a stretch of every match's own clock. */
const WINDOWS: { value: string; label: string; window: MatchWindow | null }[] =
  [
    { value: "whole", label: "Whole match", window: WHOLE },
    {
      value: "first5",
      label: "First 5 minutes",
      window: { kind: "first", minutes: 5 },
    },
    {
      value: "first10",
      label: "First 10 minutes",
      window: { kind: "first", minutes: 10 },
    },
    {
      value: "5to10",
      label: "Minutes 5 to 10",
      window: { kind: "range", from: 5, to: 10 },
    },
    {
      value: "10to20",
      label: "Minutes 10 to 20",
      window: { kind: "range", from: 10, to: 20 },
    },
    {
      value: "last5",
      label: "Last 5 minutes",
      window: { kind: "last", minutes: 5 },
    },
    { value: "custom", label: "Between two minutes", window: null },
  ];

const LEGEND_LABEL: Record<HeatLayerId, string> = {
  buildings: "Where buildings were ordered",
  defence: "Where defences were ordered",
  economy: "Where economy buildings were ordered",
  orders: "Where orders were aimed",
  deaths: "Where units died",
};

/** What a scaling does, for the help. */
const NORMALISE_NOTE: Record<Normalise, string> = {
  share:
    "Each match counts the same: its events are scaled to add up to one before the matches are averaged. A long busy match weighs no more than a short quiet one.",
  peak: "Each match is scaled so its own busiest spot is one, then the matches are averaged. A spot is bright when it was the busiest place in many matches.",
  rate: "Each match is divided by its length in the window, then the matches are averaged. A busy match weighs more than a quiet one, and a long one no more than a short one.",
};

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * Every match of one map in the library, drawn as one picture (#1161).
 *
 * The section a map's page shows under its preview. The picture is drawn on
 * its own copy of the minimap, and draped over the page's 3D preview through
 * `scene`. Each layer says how many matches are behind it, because they
 * differ: every match with a stream has orders, and only an analysed one has
 * deaths.
 *
 * `records` is the library's stat records, which the page already holds.
 */
export function MapAggregate({
  mapName,
  world,
  minimapUrl,
  records,
  ingesting,
  scene,
  declared = NO_POSITIONS,
  refights = NO_REFIGHTS,
  mapSizes = NO_SIZES,
}: {
  mapName: string;
  world: MapWorld;
  minimapUrl: string | undefined;
  records: StatRecord[];
  /** True while the library's records are still being read for the first time. */
  ingesting: boolean;
  /** The page's 3D preview, or null when it has none. */
  scene: MapScene3D | null;
  /** The positions the map itself declares, in elmos. */
  declared?: readonly Point[];
  /** File names marked as refights, which the library does not count. */
  refights?: ReadonlySet<string>;
  /** The size of every installed map named like this one, by name, in the
   *  units the map list reports. A version that is not installed has none,
   *  because a replay does not record the size of the map it was played on. */
  mapSizes?: Readonly<Record<string, MapSize>>;
}) {
  const analyses = useStoredAnalyses();
  const { sets } = useReplaySets();
  // Every version of the map. Which of them are in is chosen below.
  const family = useMemo(
    () => mapMatches(records, mapName, analyses, refights),
    [records, mapName, analyses, refights],
  );
  const sizesKey = JSON.stringify(mapSizes);
  // biome-ignore lint/correctness/useExhaustiveDependencies: sizesKey stands for mapSizes, whose identity changes every render
  const versions = useMemo(
    () => mapVersions(family.matches, mapName, mapSizes),
    [family, mapName, sizesKey],
  );
  // A choice is the player's own and lasts until the page is left, as the
  // filters do. Without one a version is in unless it is another size.
  const [versionChoice, setVersionChoice] = useState<
    ReadonlyMap<string, boolean>
  >(() => new Map());
  const included = useMemo(
    () => includedVersions(versions, versionChoice),
    [versions, versionChoice],
  );
  const all = useMemo(
    () => ({
      ...family,
      matches: family.matches.filter((m) => included.has(m.record.mapName)),
    }),
    [family, included],
  );
  const rest = useMemo(
    () => matchesElsewhere(records, mapName, analyses, refights),
    [records, mapName, analyses, refights],
  );
  const choices = useMemo(() => filterChoices(all.matches), [all]);
  const games = useMemo(
    () => countBy(all.matches, (m) => m.record.gameType),
    [all],
  );

  const [filters, setFilters] = useState<AggregateFilters>(NO_FILTERS);
  // The set the picture is scoped to, kept as the stats page keeps its own.
  // A saved pick whose set was deleted means every replay again.
  const [setId, setSetId] = useSetting("content.mapInsightSet", "");
  const activeSet = findSet(sets, setId);
  const scope = useMemo(
    () =>
      activeSet
        ? new Set(
            resolveSet(
              activeSet,
              all.matches.map((m) => m.record),
            ).present.map((r) => r.filename),
          )
        : null,
    [activeSet, all],
  );
  const shown = useMemo(
    () => filterMatches(all.matches, filters, scope),
    [all, filters, scope],
  );
  const filtered = shown.length !== family.matches.length;
  // The rest of the library under the same filters, for the length to be set
  // beside. A set's members are looked up among those matches too.
  const elsewhere = useMemo(
    () =>
      filterMatches(
        rest.matches,
        filters,
        activeSet
          ? new Set(
              resolveSet(
                activeSet,
                rest.matches.map((m) => m.record),
              ).present.map((r) => r.filename),
            )
          : null,
      ),
    [rest, filters, activeSet],
  );

  const asks = useMemo(
    () =>
      shown.map((m) => ({
        path: m.record.path,
        analysedAtMs:
          (m.analysis === "events" && m.record.gameId
            ? analyses.get(m.record.gameId)?.analysedAtMs
            : 0) ?? 0,
      })),
    [shown, analyses],
  );
  const read = useMapReplayCounts(asks, world);
  const replays = useMemo(
    () => shown.flatMap((m) => read.counts.get(m.record.path) ?? []),
    [shown, read.counts],
  );

  const [layer, setLayer] = useState<HeatLayerId | "">("buildings");
  const [showStarts, setShowStarts] = useState(true);
  const [normalise, setNormalise] = useState<Normalise>("share");
  const [windowChoice, setWindowChoice] = useState("whole");
  const [customFrom, setCustomFrom] = useState("0");
  const [customTo, setCustomTo] = useState("5");
  const timeWindow = useMemo<MatchWindow>(() => {
    const preset = WINDOWS.find((w) => w.value === windowChoice)?.window;
    if (preset) return preset;
    const from = Math.floor(Number(customFrom));
    const to = Math.floor(Number(customTo));
    return from >= 0 && to > from ? { kind: "range", from, to } : WHOLE;
  }, [windowChoice, customFrom, customTo]);
  const customInvalid =
    windowChoice === "custom" && timeWindow.kind !== "range";

  const gameTypes = useMemo(() => replays.map((r) => r.gameType), [replays]);
  const { categories, loading: categoriesLoading } = useGameCategories(
    gameTypes,
    replays.length > 0,
  );

  // Every layer is counted, so each toggle can say how many matches are behind
  // it. Only the one being drawn is smoothed into a field.
  const perLayer = useMemo(() => {
    const out = {} as Record<HeatLayerId, LayerAggregate>;
    for (const id of HEAT_LAYERS)
      out[id] = aggregateLayer(replays, id, world, {
        normalise,
        window: timeWindow,
        categories,
        countsOnly: id !== layer,
      });
    return out;
  }, [replays, world, normalise, timeWindow, categories, layer]);
  const drawn = layer ? perLayer[layer] : null;
  const field = drawn?.field ?? null;

  const starts = useMemo(
    () => aggregateStarts(shown, read.counts),
    [shown, read.counts],
  );
  const dots = useMemo(
    () =>
      starts.flatMap((s) => {
        const at = mapFraction(s, world);
        return at ? [{ ...at, key: `${s.filename}:${s.team}` }] : [];
      }),
    [starts, world],
  );
  const startMatches = matchesWithStarts(starts);
  const joined = useMemo(
    () => joinStarts(shown, read.counts),
    [shown, read.counts],
  );
  const startRecords = useMemo(
    () => placeRecords(joined.starts, declared, world),
    [joined, declared, world],
  );
  // The player's names for the positions above, and the rows they join.
  const { stored, save } = useStartNames(mapName);
  const resolved = useMemo(
    () =>
      resolveNames(
        stored,
        startRecords.places.map((p) => p.place),
        startRecords.scale,
      ),
    [stored, startRecords],
  );
  const rows = useMemo(
    () =>
      startRows(
        startRecords.places,
        new Map([...resolved.byPlace].map(([key, e]) => [key, e.name])),
      ),
    [startRecords, resolved],
  );
  const rename = (row: StartRow, name: string) =>
    save(withNames(stored, resolved, row.places, name));
  const forget = (entry: StoredName) => save(withoutName(stored, entry));
  // A mark takes the number and name of the row its position is in.
  const marks = useMemo(
    () =>
      rows.flatMap((row) =>
        row.places.flatMap((place) => {
          const at = mapFraction(place, world);
          return at
            ? [{ ...at, n: row.number, name: row.name, key: place.key }]
            : [];
        }),
      ),
    [rows, world],
  );

  // What the exports say about where their numbers came from.
  const exportBasis = useMemo(
    () =>
      mapExportInfo({
        mapName,
        shown,
        filters,
        replaySet: activeSet?.name ?? "",
        worldWidth: world.worldWidth,
        worldHeight: world.worldHeight,
      }),
    [mapName, shown, filters, activeSet, world],
  );

  const heatRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = heatRef.current;
    if (canvas && field)
      drawHeatField(canvas, field, HEAT_KIND_OF_LAYER[layer || "buildings"]);
  }, [field, layer]);
  useHeatmapLayer(scene, field, HEAT_KIND_OF_LAYER[layer || "buildings"]);

  const sized = world.worldWidth > 0 && world.worldHeight > 0;
  const withOrders = replays.filter((r) => r.orders.total > 0).length;
  const withEvents = shown.filter((m) => m.analysis === "events").length;
  const diverged = shown.filter((m) => m.analysis === "diverged").length;
  const set = (patch: Partial<AggregateFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));
  const anyFilter =
    JSON.stringify(filters) !== JSON.stringify(NO_FILTERS) ||
    !!activeSet ||
    versionChoice.size > 0;
  const toggleVersion = (name: string, on: boolean) =>
    setVersionChoice((before) => new Map(before).set(name, on));
  const toggleGame = (name: string, on: boolean) =>
    set({
      excludedGames: on
        ? filters.excludedGames.filter((g) => g !== name)
        : [...filters.excludedGames, name],
    });

  if (ingesting && records.length === 0)
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">How this map is played</h2>
        <Skeleton className="h-24 rounded bg-muted" />
      </section>
    );

  if (family.matches.length === 0)
    return (
      <section className="flex flex-col gap-2" data-testid="map-aggregate">
        <h2 className="text-sm font-medium">How this map is played</h2>
        <p className="text-sm text-muted-foreground">
          No match on this map is in your library yet.
          {family.remixes > 0 &&
            ` ${plural(family.remixes, "remix is", "remixes are")} here, and a remix is a copy of another match and not a match of its own.`}
        </p>
      </section>
    );

  const leftOut = [
    family.remixes > 0 ? plural(family.remixes, "remix", "remixes") : null,
    family.refights > 0 ? plural(family.refights, "refight", "refights") : null,
    family.duplicates > 0
      ? plural(
          family.duplicates,
          "second file of a match already counted",
          "second files of matches already counted",
        )
      : null,
  ].filter(Boolean);
  const mentioned = family.remixes + family.duplicates + family.refights;
  const spanned = versionsSpanned(shown);

  return (
    <section className="flex flex-col gap-3" data-testid="map-aggregate">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-medium">How this map is played</h2>
          <SectionHelp
            section="how this map is played"
            source={
              layer === "deaths" ? "log" : layer === "" ? undefined : "stream"
            }
            detail={
              layer === "deaths" || layer === ""
                ? undefined
                : "These are orders given, which is what players meant to do and not what happened. An order that was cancelled or never carried out counts like any other."
            }
          >
            <AggregateHelp
              layer={layer}
              drawn={drawn}
              normalise={normalise}
              timeWindow={timeWindow}
              picture={shown.length > 0}
              versions={versions.length}
              leftOut={leftOut.join(" and ")}
              leftOutCount={mentioned}
              short={!filters.includeShort ? choices.short : 0}
              showStarts={showStarts}
              hasDots={dots.length > 0}
              analysedShown={withEvents}
              unattacked={replays.reduce((n, r) => n + r.deathsUnattacked, 0)}
              noPosition={replays.reduce((n, r) => n + r.deathsNoPosition, 0)}
              windowCount={drawn !== null && drawn.contributing > 0}
            />
            {shown.length > 0 && (
              <MapRecordsHelp
                shown={shown}
                elsewhere={elsewhere}
                joined={joined}
                records={startRecords}
                rows={rows}
                reading={read.reading}
                versions={spanned}
                mapName={mapName}
              />
            )}
          </SectionHelp>
        </div>
        <p
          className="text-sm text-muted-foreground"
          data-testid="aggregate-summary"
        >
          {filtered
            ? `${matchCount(shown.length)} of the ${family.matches.length.toLocaleString()} on this map in your library ${shown.length === 1 ? "is" : "are"} in this picture.`
            : `${shown.length === 1 ? "The 1 match" : `All ${shown.length.toLocaleString()} matches`} on this map in your library ${shown.length === 1 ? "is" : "are"} in this picture.`}{" "}
          {read.reading
            ? `Reading replays: ${read.done.toLocaleString()} of ${read.total.toLocaleString()}.`
            : `${withOrders.toLocaleString()} ${withOrders === 1 ? "has" : "have"} orders recorded, and ${withEvents.toLocaleString()} ${withEvents === 1 ? "has" : "have"} been analysed and ${withEvents === 1 ? "has" : "have"} event data.`}
          {diverged > 0 &&
            ` ${plural(diverged, "was", "were")} analysed and the playback did not reproduce the match, so ${diverged === 1 ? "it has" : "they have"} no events.`}
        </p>
        {read.failed.length > 0 && (
          <p className="text-xs text-destructive">
            {plural(read.failed.length, "replay", "replays")} could not be read
            and {read.failed.length === 1 ? "is" : "are"} not in the picture.
          </p>
        )}
      </div>

      {versions.length > 1 && (
        <>
          <VersionList
            label="Versions of this map"
            testId="map-versions"
            onToggle={toggleVersion}
            items={versions.map((v) => ({
              name: v.name,
              matches: v.matches,
              included: included.has(v.name),
              note:
                v.name === mapName
                  ? "this page's map"
                  : v.verdict === "different"
                    ? included.has(v.name)
                      ? "a different size from this page's map"
                      : "a different size from this page's map, so it is left out"
                    : undefined,
            }))}
          />
          <p
            className="text-xs text-muted-foreground"
            data-testid="version-layout-warning"
          >
            A version can differ in layout, so its starts and counts may be in
            the wrong place on this page's map.
          </p>
        </>
      )}
      {games.length > 1 && (
        <VersionList
          label="Games and versions"
          testId="game-versions"
          onToggle={toggleGame}
          items={games.map((g) => ({
            name: g.name,
            matches: g.matches,
            included: !filters.excludedGames.includes(g.name),
          }))}
        />
      )}

      <div
        className="flex flex-wrap items-end gap-2"
        data-testid="aggregate-filters"
      >
        {choices.playerCounts.length > 1 && (
          <OptionSelect
            size="sm"
            className="w-44"
            ariaLabel="Players in the match"
            value={
              filters.playerCount === null ? ANY : String(filters.playerCount)
            }
            onValueChange={(v) =>
              set({ playerCount: v === ANY ? null : Number(v) })
            }
            options={[
              { value: ANY, label: "Any number of players" },
              ...choices.playerCounts.map((n) => ({
                value: String(n),
                label: `${n} players`,
              })),
            ]}
          />
        )}
        {choices.formats.length > 1 && (
          <OptionSelect
            size="sm"
            className="w-40"
            ariaLabel="How the sides were arranged"
            value={filters.format ?? ANY}
            onValueChange={(v) =>
              set({ format: v === ANY ? null : (v as MatchFormat) })
            }
            options={[
              { value: ANY, label: "Any sides" },
              ...choices.formats.map((f) => ({
                value: f,
                label: FORMAT_LABEL[f],
              })),
            ]}
          />
        )}
        <OptionSelect
          size="sm"
          className="w-44"
          ariaLabel="Analysed or not"
          value={filters.analysed}
          onValueChange={(v) =>
            set({ analysed: v as AggregateFilters["analysed"] })
          }
          options={[
            { value: "any", label: "Analysed or not" },
            { value: "yes", label: "Analysed" },
            { value: "no", label: "Not analysed" },
          ]}
        />
        {sets.length > 0 && (
          <OptionSelect
            size="sm"
            className="w-48"
            ariaLabel="Scope to a set"
            value={activeSet?.id ?? "all"}
            onValueChange={(v) => setSetId(v === "all" ? "" : v)}
            options={[
              { value: "all", label: "All replays" },
              ...sets.map((s) => ({ value: s.id, label: `Set: ${s.name}` })),
            ]}
          />
        )}
        <DateFilter
          label="Played from"
          value={filters.from}
          onChange={(from) => set({ from })}
        />
        <DateFilter
          label="Played until"
          value={filters.to}
          onChange={(to) => set({ to })}
        />
        {choices.short > 0 && (
          <Toggle
            size="sm"
            variant="outline"
            pressed={filters.includeShort}
            onPressedChange={(on) => set({ includeShort: on })}
          >
            Matches under a minute
          </Toggle>
        )}
        {anyFilter && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFilters(NO_FILTERS);
              setSetId("");
              setVersionChoice(new Map());
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No match on this map passes these filters.
        </p>
      ) : (
        <>
          <VersionSpan versions={spanned} testId="versions-picture" />
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <div className="relative flex w-full max-w-sm shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-card">
              <div
                className="relative w-full"
                style={{
                  aspectRatio: sized
                    ? `${world.worldWidth} / ${world.worldHeight}`
                    : "1 / 1",
                }}
              >
                {minimapUrl && (
                  <img
                    src={minimapUrl}
                    alt={`Minimap of ${mapName}`}
                    className="absolute inset-0 size-full object-fill brightness-[0.7]"
                  />
                )}
                {field && field.peak > 0 && (
                  <canvas
                    ref={heatRef}
                    data-layer={layer}
                    className="pointer-events-none absolute inset-0 size-full"
                  />
                )}
                {showStarts &&
                  dots.map((dot) => (
                    <span
                      key={dot.key}
                      data-layer="starts"
                      aria-hidden
                      className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/80 bg-white/80"
                      style={{
                        left: `${dot.left * 100}%`,
                        top: `${dot.top * 100}%`,
                      }}
                    />
                  ))}
                {showStarts &&
                  marks.map((m) => (
                    <span
                      key={m.key}
                      data-layer="start-places"
                      data-testid={`start-mark-${m.n}`}
                      title={m.name ?? undefined}
                      className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center${m.name ? "" : " pointer-events-none"}`}
                      style={{
                        left: `${m.left * 100}%`,
                        top: `${m.top * 100}%`,
                      }}
                    >
                      <PlaceNumber n={m.n} />
                      {m.name && (
                        <span className="absolute left-full ml-1 max-w-24 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-black/70 px-1 text-[10px] text-white">
                          {m.name}
                        </span>
                      )}
                    </span>
                  ))}
              </div>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap gap-1">
                <Toggle
                  size="sm"
                  variant="outline"
                  pressed={showStarts}
                  onPressedChange={setShowStarts}
                  data-testid="layer-starts"
                >
                  Start positions · {startMatches.toLocaleString()}
                </Toggle>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  spacing={1}
                  aria-label="Density layer"
                  className="flex-wrap"
                  value={layer}
                  onValueChange={(v) => setLayer(v as HeatLayerId | "")}
                >
                  {HEAT_LAYERS.map((id) => (
                    <ToggleGroupItem
                      key={id}
                      value={id}
                      data-testid={`layer-${id}`}
                    >
                      {LAYER_LABEL[id]} ·{" "}
                      {perLayer[id].contributing.toLocaleString()}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <OptionSelect
                  size="sm"
                  className="w-56"
                  ariaLabel="How each match is scaled"
                  value={normalise}
                  onValueChange={(v) => setNormalise(v as Normalise)}
                  options={(Object.keys(NORMALISE_LABEL) as Normalise[]).map(
                    (mode) => ({ value: mode, label: NORMALISE_LABEL[mode] }),
                  )}
                />
                <OptionSelect
                  size="sm"
                  className="w-52"
                  ariaLabel="Window of match time"
                  value={windowChoice}
                  onValueChange={setWindowChoice}
                  options={WINDOWS.map(({ value, label }) => ({
                    value,
                    label,
                  }))}
                />
                {windowChoice === "custom" && (
                  <>
                    <Field label="From minute" className="w-24 text-xs">
                      <Input
                        type="number"
                        min={0}
                        value={customFrom}
                        onChange={(e) => setCustomFrom(e.target.value)}
                      />
                    </Field>
                    <Field label="To minute" className="w-24 text-xs">
                      <Input
                        type="number"
                        min={1}
                        value={customTo}
                        onChange={(e) => setCustomTo(e.target.value)}
                      />
                    </Field>
                  </>
                )}
              </div>
              {customInvalid && (
                <p className="text-xs text-destructive">
                  The second minute must be after the first. The whole match is
                  shown until it is.
                </p>
              )}
              {showStarts && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="starts-note"
                >
                  {dots.length === 0
                    ? read.reading
                      ? "Reading start positions…"
                      : "None of these replays recorded a start position."
                    : `${plural(dots.length, "start", "starts")} from ${matchCount(startMatches)}.`}
                </p>
              )}

              {layer && drawn && (
                <LayerNotes
                  layer={layer}
                  drawn={drawn}
                  normalise={normalise}
                  timeWindow={timeWindow}
                  analysedShown={withEvents}
                  reading={read.reading}
                  categoriesLoading={categoriesLoading}
                  incomplete={replays.filter((r) => r.incomplete).length}
                />
              )}

              <MapExportButtons
                info={exportBasis}
                layer={layer}
                layerSentence={layer ? LEGEND_LABEL[layer] : ""}
                drawn={drawn}
                normalise={normalise}
                window={timeWindow}
                records={startRecords}
                rows={rows}
                split={
                  sharedFormat(shown) === "duel" ||
                  sharedFormat(shown) === "teams"
                }
                minimapUrl={minimapUrl}
                world={world}
                dots={dots}
                places={marks}
                showStarts={showStarts}
              />
            </div>
          </div>
          <MapRecords
            versions={spanned}
            shown={shown}
            elsewhere={elsewhere}
            records={startRecords}
            rows={rows}
            orphans={resolved.orphans}
            onRename={rename}
            onDeleteName={forget}
            reading={read.reading}
          />
        </>
      )}
    </section>
  );
}

/** What is said under the controls about the layer being drawn: its counts and
 *  the warnings that the picture may be incomplete. The rest is in the help. */
function LayerNotes({
  layer,
  drawn,
  normalise,
  timeWindow,
  analysedShown,
  reading,
  categoriesLoading,
  incomplete,
}: {
  layer: HeatLayerId;
  drawn: LayerAggregate;
  normalise: Normalise;
  timeWindow: MatchWindow;
  /** Matches in the picture that have event data. */
  analysedShown: number;
  reading: boolean;
  categoriesLoading: boolean;
  /** Replays whose stream could not be read to the end. */
  incomplete: number;
}) {
  const category = layer === "defence" || layer === "economy";
  const windowed = timeWindow.kind !== "whole";
  return (
    <div className="flex flex-col gap-2" data-testid="layer-notes">
      {layer === "deaths" && analysedShown === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="no-analysis">
          No match on this map in the picture has been analysed, so there are no
          deaths to draw.
        </p>
      )}

      {category && (categoriesLoading || drawn.unclassified > 0) && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="category-note"
        >
          {categoriesLoading
            ? "Reading unit definitions…"
            : `${plural(drawn.unclassified, "match was", "matches were")} played on a game or version that is not installed, so nothing says what ${drawn.unclassified === 1 ? "its" : "their"} buildings are for and ${drawn.unclassified === 1 ? "it is" : "they are"} left out of this layer.`}
        </p>
      )}

      {!reading &&
        drawn.contributing === 0 &&
        !(layer === "deaths" && analysedShown === 0) && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="layer-empty"
          >
            {windowed
              ? `None of these matches has anything on this layer in ${windowLabel(timeWindow)}.`
              : "None of these matches has anything on this layer."}
          </p>
        )}
      {drawn.contributing > 0 && windowed && (
        <p className="text-xs text-muted-foreground" data-testid="window-count">
          {drawn.contributing.toLocaleString()} of {matchCount(drawn.available)}{" "}
          {drawn.contributing === 1 ? "has" : "have"} anything on this layer in{" "}
          {windowLabel(timeWindow)}.
        </p>
      )}
      {drawn.contributing > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="layer-events">
          {layerEvents(layer, drawn.events)}
          {windowed ? ` in ${windowLabel(timeWindow)}` : ""}, from{" "}
          {matchCount(drawn.contributing)}.
        </p>
      )}
      {incomplete > 0 && layer !== "deaths" && (
        <p className="text-xs text-muted-foreground">
          {plural(incomplete, "replay", "replays")} could not be read to the end
          and may be missing later orders.
        </p>
      )}

      {drawn.field && drawn.field.peak > 0 && (
        <HeatLegend
          label={LEGEND_LABEL[layer]}
          peak={layerLegend(layer, drawn, normalise, timeWindow)}
          kind={HEAT_KIND_OF_LAYER[layer]}
        />
      )}
    </div>
  );
}

/**
 * What the picture is made of and what it leaves out, for the section's help
 * popover (#3889). The records' own explanation follows it in the popover.
 */
function AggregateHelp({
  layer,
  drawn,
  normalise,
  timeWindow,
  picture,
  versions,
  leftOut,
  leftOutCount,
  short,
  showStarts,
  hasDots,
  analysedShown,
  unattacked,
  noPosition,
  windowCount,
}: {
  layer: HeatLayerId | "";
  drawn: LayerAggregate | null;
  normalise: Normalise;
  timeWindow: MatchWindow;
  /** Whether any match is in the picture. */
  picture: boolean;
  versions: number;
  /** The matches left out, as a sentence part such as "2 remixes". */
  leftOut: string;
  leftOutCount: number;
  /** Matches under a minute that are left out, or 0. */
  short: number;
  showStarts: boolean;
  hasDots: boolean;
  analysedShown: number;
  unattacked: number;
  noPosition: number;
  /** Whether the layer has anything in the picture. */
  windowCount: boolean;
}) {
  const windowed = timeWindow.kind !== "whole";
  const category = layer === "defence" || layer === "economy";
  return (
    <>
      <p data-testid="grouping-note">
        Matches are grouped by the map's name with a trailing version taken off,
        and not by the map's archive. A replay records the map's name and
        nothing that says which archive it was played on, so two archives with
        one name cannot be told apart.
      </p>
      {(leftOut || short > 0) && (
        <p data-testid="left-out-note">
          {leftOut &&
            `${leftOut} ${leftOutCount === 1 ? "is" : "are"} left out, so each match counts once.`}
          {short > 0 &&
            `${leftOut ? " " : ""}${plural(short, "match", "matches")} under a minute ${short === 1 ? "is" : "are"} left out${leftOut ? " too" : ""}.`}
        </p>
      )}
      {versions > 1 && (
        <>
          <p>
            A version can differ in layout. Its starts and counts are drawn on
            this page's map as the replay recorded them, so a version that moved
            things puts them in the wrong place.
          </p>
          <p data-testid="version-sizes-note">
            A version is left out only when it is installed and its size differs
            from this page's map. A version that is not installed has no size to
            compare, because a replay does not record the size of the map it was
            played on.
          </p>
        </>
      )}
      {picture && (
        <p>
          The number beside a layer is how many matches it is drawn from. One
          density layer shows at a time.
        </p>
      )}
      {picture && showStarts && hasDots && (
        <p>
          A dot is where one team's start was set before one match. The engine
          can move a start into its start box, so a commander may have appeared
          a short way off.
        </p>
      )}
      {picture && layer && (
        <p data-testid="scaling-note">
          {NORMALISE_NOTE[normalise]}
          {windowed &&
            ` The window is ${windowLabel(timeWindow)} of each match by its own clock, in whole minutes.`}
          {windowed &&
            windowCount &&
            " Matches with nothing on this layer in the window are not in the average."}
        </p>
      )}
      {picture && layer === "deaths" && (
        <p>
          Deaths come from playing a match back, which is run from a replay's
          own page.
          {analysedShown > 0 &&
            " Every unit that was destroyed counts, whatever destroyed it."}
          {analysedShown > 0 &&
            unattacked > 0 &&
            ` ${plural(unattacked, "death names", "deaths name")} no attacker, which is how a cancelled build and a self destruct are recorded.`}
          {analysedShown > 0 &&
            noPosition > 0 &&
            ` ${plural(noPosition, "death was", "deaths were")} recorded at exactly the map's corner, which is what the recorder writes when it has no position, and ${noPosition === 1 ? "is" : "are"} left out.`}
        </p>
      )}
      {picture && category && (
        <p>
          What a building is for is read from the installed game with exactly
          the name and version the replay records, matched by name.
        </p>
      )}
      {picture && drawn?.field && drawn.field.peak > 0 && (
        <p>
          Colours compare places on this map with each other, not with another
          picture.
        </p>
      )}
    </>
  );
}
