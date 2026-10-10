/**
 * One picture of a map from every replay of it in the library (#1161).
 *
 * A replay is counted in Rust (`map_grids.rs`) onto the grid `heatField.ts`
 * gives the map, by minute of match time. What arrives here is those counts.
 * This file decides which replays are in the picture, cuts each to a window of
 * match time, scales each so no one match is the whole picture, adds them, and
 * says in numbers what the result is. Nothing here touches React or the DOM.
 *
 * Two words are kept apart throughout. A replay is a file. A match is a game
 * that was played, and it can have more than one file. The picture is of
 * matches.
 */

import {
  buildHeatFieldFromCounts,
  DEFAULT_RESOLUTION,
  type HeatField,
  heatGridSize,
} from "@/lib/heatField";
import type {
  MapCountLayer,
  ReplayMapGrids,
  StatRecord,
  StoredReplayAnalysis,
  UnitDatasetEntry,
} from "./bindings";
import { isShortReplay } from "./replayFilterVisibility";
import type { MapWorld } from "./replayMapLayers";
import { column } from "./replayOrderPoints";
import { classifyUnit, type UnitCategory } from "./unitCategory";

/** Cells along the longer side. `GRID_RESOLUTION` in `map_grids.rs` is the
 *  same number, and `mapAggregate.test.ts` reads that file to hold them
 *  together. */
export const MAP_GRID_RESOLUTION = DEFAULT_RESOLUTION;

/** Frames in one slice of match time: a minute. `FRAMES_PER_SLICE` in Rust. */
export const FRAMES_PER_SLICE = 30 * 60;

// ---- one replay's counts ----------------------------------------------------

/** A count layer, unpacked. The columns are parallel. */
export interface CountColumns {
  entries: number;
  cell: Uint32Array;
  slice: Uint16Array;
  count: Uint16Array;
  /** The unit definition id of each entry, on the buildings layer only. */
  def: Uint32Array | null;
  total: number;
  offMap: number;
}

/** One replay's counts, unpacked. Hold it in a ref, a memo or a module, and
 *  never spread its columns into React props. */
export interface ReplayCounts {
  path: string;
  gameId?: string;
  gameType: string;
  lastFrame: number;
  incomplete: boolean;
  starts: { team: number; x: number; z: number }[];
  buildings: CountColumns;
  orders: CountColumns;
  unitAimed: number;
  custom: number;
  /** Null when the match has no analysis with events. */
  deaths: CountColumns | null;
  /** Deaths with no attacker named, which are in `deaths` all the same. */
  deathsUnattacked: number;
  /** Deaths the log put at exactly 0,0, which were left out. */
  deathsNoPosition: number;
}

function unpack(layer: MapCountLayer, name: string): CountColumns {
  const n = layer.entries;
  const out = {
    entries: n,
    total: layer.total,
    offMap: layer.offMap,
  } as CountColumns;
  const columns: [keyof CountColumns, object | null][] = [
    ["cell", column(layer.cell, Uint32Array, 4, n, `${name} cell`)],
    ["slice", column(layer.slice, Uint16Array, 2, n, `${name} slice`)],
    ["count", column(layer.count, Uint16Array, 2, n, `${name} count`)],
    [
      "def",
      layer.def ? column(layer.def, Uint32Array, 4, n, `${name} def`) : null,
    ],
  ];
  // Not enumerable, so a development build of React never walks a column.
  for (const [key, value] of columns)
    Object.defineProperty(out, key, { value, enumerable: false });
  return out;
}

export function decodeReplayGrids(raw: ReplayMapGrids): ReplayCounts {
  return {
    path: raw.path,
    gameId: raw.gameId,
    gameType: raw.gameType,
    lastFrame: raw.lastFrame,
    incomplete: raw.incomplete,
    starts: raw.starts,
    buildings: unpack(raw.buildings, "buildings"),
    orders: unpack(raw.orders, "orders"),
    unitAimed: raw.unitAimed,
    custom: raw.custom,
    deaths: raw.deaths ? unpack(raw.deaths.layer, "deaths") : null,
    deathsUnattacked: raw.deaths?.unattacked ?? 0,
    deathsNoPosition: raw.deaths?.noPosition ?? 0,
  };
}

// ---- which matches ----------------------------------------------------------

/** How the sides of a match were arranged. */
export type MatchFormat = "duel" | "teams" | "ffa" | "other";

export const FORMAT_LABEL: Record<MatchFormat, string> = {
  duel: "1v1",
  teams: "Two sides",
  ffa: "Free for all",
  other: "Other",
};

/** Whether a match has events from an analysis. */
export type MatchAnalysis = "events" | "diverged" | "none";

/** One match on the map, with what the filters ask about it. */
export interface AggregateMatch {
  record: StatRecord;
  /** People and AIs who played. Spectators are not counted. */
  playerCount: number;
  format: MatchFormat;
  analysis: MatchAnalysis;
}

/**
 * How a match's sides were arranged, from the ally team of every seat that
 * played. Two sides of one each is a duel. Two sides of any other size is two
 * sides. Three or more is a free for all, whether or not its sides are teams.
 */
export function matchFormat(record: StatRecord): MatchFormat {
  const sides = new Map<number, number>();
  const seat = (ally: number | undefined) => {
    if (ally !== undefined) sides.set(ally, (sides.get(ally) ?? 0) + 1);
  };
  for (const p of record.players) if (!p.spectator) seat(p.allyTeam);
  for (const a of record.ais) seat(a.allyTeam);
  if (sides.size === 2)
    return [...sides.values()].every((n) => n === 1) ? "duel" : "teams";
  return sides.size > 2 ? "ffa" : "other";
}

export interface MapMatches {
  matches: AggregateMatch[];
  /** Files left out because they are remixes: copies of a match pointed at
   *  another game, which are not a match of their own. */
  remixes: number;
  /** Files left out because another file of the same match is already in. */
  duplicates: number;
}

/**
 * The matches on one map, from the library's records.
 *
 * The map is matched by its exact name, which carries its version, so two
 * versions of a map are two maps here (#1164 is where that is revisited).
 *
 * One match is counted once however many files hold it. A remix carries its
 * original's game id and is left out by its own mark. Two plain files with one
 * game id are one match, and the first by file name stands for it. A record
 * with no game id cannot be compared and is kept.
 */
export function mapMatches(
  records: readonly StatRecord[],
  mapName: string,
  analyses: ReadonlyMap<string, Pick<StoredReplayAnalysis, "state">>,
): MapMatches {
  const out: MapMatches = { matches: [], remixes: 0, duplicates: 0 };
  const seen = new Set<string>();
  const onMap = records
    .filter((r) => r.mapName === mapName)
    .sort((a, b) => a.filename.localeCompare(b.filename));
  for (const record of onMap) {
    if (record.remixed) {
      out.remixes++;
      continue;
    }
    if (record.gameId) {
      if (seen.has(record.gameId)) {
        out.duplicates++;
        continue;
      }
      seen.add(record.gameId);
    }
    const stored = record.gameId ? analyses.get(record.gameId) : undefined;
    out.matches.push({
      record,
      playerCount:
        record.players.filter((p) => !p.spectator).length + record.ais.length,
      format: matchFormat(record),
      analysis: !stored
        ? "none"
        : stored.state === "diverged"
          ? "diverged"
          : "events",
    });
  }
  out.matches.sort((a, b) => a.record.startTimeMs - b.record.startTimeMs);
  return out;
}

export interface AggregateFilters {
  /** Exactly this many players, or null for any. */
  playerCount: number | null;
  /** The game and version as the replay names it, or null for any. */
  game: string | null;
  format: MatchFormat | null;
  /** `yes` keeps matches with event data, `no` keeps the ones without. */
  analysed: "any" | "yes" | "no";
  /** Local dates as `YYYY-MM-DD`, both inclusive. Empty for no bound. */
  from: string;
  to: string;
  /** Matches under a minute are left out unless this is set, as the replay
   *  list leaves them out. */
  includeShort: boolean;
}

export const NO_FILTERS: AggregateFilters = {
  playerCount: null,
  game: null,
  format: null,
  analysed: "any",
  from: "",
  to: "",
  includeShort: false,
};

/** The start of a local day, or NaN for text that is not a date. */
function dayStart(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d).getTime() : Number.NaN;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The matches that pass the filters. `scope` is the file names of a replay
 * set's members, or null for no set.
 */
export function filterMatches(
  matches: readonly AggregateMatch[],
  filters: AggregateFilters,
  scope: ReadonlySet<string> | null = null,
): AggregateMatch[] {
  const from = filters.from ? dayStart(filters.from) : Number.NaN;
  const to = filters.to ? dayStart(filters.to) + DAY_MS : Number.NaN;
  return matches.filter((m) => {
    const r = m.record;
    if (scope && !scope.has(r.filename)) return false;
    if (!filters.includeShort && isShortReplay(r.durationSec)) return false;
    if (filters.playerCount !== null && m.playerCount !== filters.playerCount)
      return false;
    if (filters.game !== null && r.gameType !== filters.game) return false;
    if (filters.format !== null && m.format !== filters.format) return false;
    if (filters.analysed === "yes" && m.analysis !== "events") return false;
    if (filters.analysed === "no" && m.analysis === "events") return false;
    if (!Number.isNaN(from) && r.startTimeMs < from) return false;
    if (!Number.isNaN(to) && r.startTimeMs >= to) return false;
    return true;
  });
}

/** What each filter can be set to, from the matches there are. */
export function filterChoices(matches: readonly AggregateMatch[]) {
  const sorted = <T>(values: Iterable<T>, by: (a: T, b: T) => number) =>
    [...new Set(values)].sort(by);
  return {
    playerCounts: sorted(
      matches.map((m) => m.playerCount),
      (a, b) => a - b,
    ),
    games: sorted(
      matches.map((m) => m.record.gameType),
      (a, b) => a.localeCompare(b, undefined, { numeric: true }),
    ),
    formats: sorted(
      matches.map((m) => m.format),
      (a, b) => a.localeCompare(b),
    ),
    short: matches.filter((m) => isShortReplay(m.record.durationSec)).length,
  };
}

// ---- the window -------------------------------------------------------------

/**
 * A window of match time, applied to each match on its own clock.
 *
 * "The first five minutes" means the same thing in every match. "The last
 * five" is each match's own last five. A stretch between two minutes is the
 * same stretch of every match, and a match that ended before it has nothing in
 * it, which the layer's count of matches shows.
 */
export type MatchWindow =
  | { kind: "whole" }
  | { kind: "first"; minutes: number }
  | { kind: "last"; minutes: number }
  | { kind: "range"; from: number; to: number };

export const WHOLE: MatchWindow = { kind: "whole" };

/** The slices of one match a window covers, both inclusive, and how many
 *  minutes of the match that is. Null when the window misses the match. */
export function windowSlices(
  window: MatchWindow,
  lastFrame: number,
): { lo: number; hi: number; minutes: number } | null {
  const frames = Math.max(0, lastFrame);
  const lastSlice = Math.floor(frames / FRAMES_PER_SLICE);
  let lo = 0;
  let hi = lastSlice;
  if (window.kind === "first") hi = Math.min(hi, window.minutes - 1);
  else if (window.kind === "last")
    lo = Math.max(0, lastSlice - window.minutes + 1);
  else if (window.kind === "range") {
    lo = window.from;
    hi = Math.min(hi, window.to - 1);
  }
  if (hi < lo) return null;
  const end = Math.min((hi + 1) * FRAMES_PER_SLICE, frames);
  const minutes = (end - lo * FRAMES_PER_SLICE) / FRAMES_PER_SLICE;
  return { lo, hi, minutes: Math.max(minutes, 0) };
}

/** A window in words, for a legend and for a picture's caption. */
export function windowLabel(window: MatchWindow): string {
  switch (window.kind) {
    case "whole":
      return "the whole match";
    case "first":
      return `the first ${window.minutes} minutes`;
    case "last":
      return `the last ${window.minutes} minutes`;
    case "range":
      return `minutes ${window.from} to ${window.to}`;
  }
}

// ---- what a building is for -------------------------------------------------

/** Each unit definition id's category in one build of one game. Index `id`. */
export type DefCategories = readonly (UnitCategory | undefined)[];

/**
 * The category of every unit definition id of one game build. The engine
 * numbers definitions from 1 in the dataset's order (see
 * `replayBuildOrders.ts`), and that numbering holds for this build alone.
 */
export function defCategories(
  units: readonly UnitDatasetEntry[],
): DefCategories {
  const out: (UnitCategory | undefined)[] = [undefined];
  for (const unit of units) out.push(classifyUnit(unit));
  return out;
}

// ---- adding matches up ------------------------------------------------------

/** The layers that are a density. Start positions are dots and not one. */
export const HEAT_LAYERS = [
  "buildings",
  "defence",
  "economy",
  "orders",
  "deaths",
] as const;
export type HeatLayerId = (typeof HEAT_LAYERS)[number];

/** The categories a layer keeps, for the layers that are one kind of building. */
const LAYER_CATEGORY: Partial<Record<HeatLayerId, UnitCategory>> = {
  defence: "defence",
  economy: "economy",
};

/**
 * How each match is scaled before the matches are added.
 *
 * - `share`: so its events add to 1. Every match gives the picture the same
 *   amount, spread the way that match spread it. The sum answers "of the
 *   building in a typical match, how much went where", and a long busy match
 *   weighs no more than a short quiet one.
 * - `peak`: so its own busiest spot is 1. Every match's hottest place counts
 *   the same, however much of the match happened there.
 * - `rate`: by its minutes in the window. The sum is events a minute, and a
 *   busy match weighs more than a quiet one, though a long one no more than a
 *   short one.
 */
export type Normalise = "share" | "peak" | "rate";

export const NORMALISE_LABEL: Record<Normalise, string> = {
  share: "Share of each match",
  peak: "Each match's busiest spot",
  rate: "Per minute of match",
};

export interface LayerAggregate {
  /** The mean of the scaled matches, smoothed. Null when no match has
   *  anything in the window. */
  field: HeatField | null;
  /** Matches that could have been in this layer: all that were read for a
   *  stream layer, the analysed ones for deaths, the ones whose game build is
   *  installed for a category layer. */
  available: number;
  /** Matches with at least one event in the window. The mean is over these. */
  contributing: number;
  /** Matches left out because their game build is not installed, so nothing
   *  says what their buildings are for. Category layers only. */
  unclassified: number;
  /** Events in the window, over the contributing matches, unscaled. */
  events: number;
  /**
   * The mean field's amount within the field's radius of its brightest spot,
   * in the unit of the mode: a fraction of a match's events for `share`,
   * events a minute for `rate`. Null for `peak`, which has no such unit, and
   * for an empty layer.
   */
  atPeak: number | null;
}

/** One match's counts for a layer, cut to the window: the cells and amounts,
 *  and their total. */
function matchCells(
  columns: CountColumns,
  lo: number,
  hi: number,
  keep: ((def: number) => boolean) | null,
  into: Float32Array,
  scale: number,
): number {
  let total = 0;
  for (let i = 0; i < columns.entries; i++) {
    const slice = columns.slice[i];
    if (slice < lo || slice > hi) continue;
    if (keep && !(columns.def && keep(columns.def[i]))) continue;
    total += columns.count[i];
    if (scale !== 0) into[columns.cell[i]] += columns.count[i] * scale;
  }
  return total;
}

/** A match's own smoothed peak for a layer and window, kept so a filter
 *  change in `peak` mode does not smooth every match again. */
const ownPeaks = new WeakMap<CountColumns, Map<string, number>>();

/**
 * Add the matches up for one layer.
 *
 * `categories` gives the category table for a game build by the name the
 * replay records, or undefined when that build is not installed. It is only
 * asked for a category layer.
 */
export function aggregateLayer(
  replays: readonly ReplayCounts[],
  layer: HeatLayerId,
  world: MapWorld,
  options: {
    normalise: Normalise;
    window: MatchWindow;
    categories?: (gameType: string) => DefCategories | undefined;
  },
): LayerAggregate {
  const { width, height } = heatGridSize(
    world.worldWidth,
    world.worldHeight,
    MAP_GRID_RESOLUTION,
  );
  const sum = new Float32Array(width * height);
  const scratch = new Float32Array(width * height);
  const category = LAYER_CATEGORY[layer];
  let available = 0;
  let contributing = 0;
  let unclassified = 0;
  let events = 0;

  for (const replay of replays) {
    const columns =
      layer === "orders"
        ? replay.orders
        : layer === "deaths"
          ? replay.deaths
          : replay.buildings;
    if (!columns) continue;
    let keep: ((def: number) => boolean) | null = null;
    if (category) {
      const table = options.categories?.(replay.gameType);
      if (!table) {
        unclassified++;
        continue;
      }
      keep = (def) => table[def] === category;
    }
    available++;
    const range = windowSlices(options.window, replay.lastFrame);
    if (!range) continue;
    const total = matchCells(columns, range.lo, range.hi, keep, scratch, 0);
    if (total === 0) continue;

    let scale: number;
    if (options.normalise === "share") scale = 1 / total;
    else if (options.normalise === "rate") {
      if (!(range.minutes > 0)) continue;
      scale = 1 / range.minutes;
    } else {
      const key = `${layer}:${range.lo}:${range.hi}:${width}x${height}`;
      let peaks = ownPeaks.get(columns);
      if (!peaks) {
        peaks = new Map();
        ownPeaks.set(columns, peaks);
      }
      let peak = category ? undefined : peaks.get(key);
      if (peak === undefined) {
        scratch.fill(0);
        matchCells(columns, range.lo, range.hi, keep, scratch, 1);
        peak = buildHeatFieldFromCounts(scratch, world, {
          resolution: MAP_GRID_RESOLUTION,
        }).peak;
        // A category's table can change under one set of columns when a game
        // is installed, so only the layers with no table are kept.
        if (!category) peaks.set(key, peak);
      }
      if (!(peak > 0)) continue;
      scale = 1 / peak;
    }
    matchCells(columns, range.lo, range.hi, keep, sum, scale);
    contributing++;
    events += total;
  }

  if (contributing === 0)
    return {
      field: null,
      available,
      contributing,
      unclassified,
      events,
      atPeak: null,
    };
  for (let i = 0; i < sum.length; i++) sum[i] /= contributing;
  const field = buildHeatFieldFromCounts(sum, world, {
    resolution: MAP_GRID_RESOLUTION,
    counted: events,
  });
  return {
    field,
    available,
    contributing,
    unclassified,
    events,
    atPeak:
      options.normalise === "peak" ? null : (field.peakWithinRadius ?? null),
  };
}

const NOUN: Record<HeatLayerId, [one: string, many: string]> = {
  buildings: ["order to place a building", "orders to place a building"],
  defence: ["order to place a defence", "orders to place a defence"],
  economy: [
    "order to place an economy building",
    "orders to place an economy building",
  ],
  orders: ["order", "orders"],
  deaths: ["death", "deaths"],
};

export const LAYER_LABEL: Record<HeatLayerId, string> = {
  buildings: "Building density",
  defence: "Defences",
  economy: "Economy",
  orders: "Order density",
  deaths: "Deaths",
};

/** A count of matches in words. */
export const matchCount = (n: number) =>
  `${n.toLocaleString()} ${n === 1 ? "match" : "matches"}`;

/** A fraction as a percentage a person can read: one decimal under ten. */
function percent(fraction: number): string {
  const p = fraction * 100;
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

/**
 * What the legend says about a layer's brightest spot. A sum of scaled matches
 * has no count of orders to state, so it states what the scale leaves true.
 */
export function layerLegend(
  layer: HeatLayerId,
  aggregate: LayerAggregate,
  normalise: Normalise,
  window: MatchWindow,
): string {
  const { field, contributing } = aggregate;
  if (!field) return "";
  const [one, many] = NOUN[layer];
  const reach = `${Math.round(field.radius).toLocaleString()} elmos`;
  const during = window.kind === "whole" ? "" : ` in ${windowLabel(window)}`;
  const over = `across ${matchCount(contributing)}`;
  if (normalise === "share")
    return `on average ${percent(aggregate.atPeak ?? 0)} of a match's ${many}${during} within ${reach} of one spot, ${over}`;
  if (normalise === "rate") {
    const rate = aggregate.atPeak ?? 0;
    const shown =
      rate < 10 ? rate.toFixed(1) : Math.round(rate).toLocaleString();
    return `on average ${shown} ${rate === 1 ? one : many} a minute${during} within ${reach} of one spot, ${over}`;
  }
  return `where the most matches were at their own busiest${during}, ${over}. Each match is scaled to its busiest spot, so this is not a count`;
}

// ---- start positions --------------------------------------------------------

/** One team's start in one match, with how that match went for it. */
export interface AggregateStart {
  /** The replay file, which with `team` names this start. */
  filename: string;
  gameId?: string;
  /** The engine team. */
  team: number;
  /** The side the team was on, when the record says. */
  allyTeam?: number;
  /** In elmos from the map's north west corner. */
  x: number;
  z: number;
  /** Whether its side won. Null when the match's result is not known, or the
   *  team's side is not. */
  won: boolean | null;
  /** How many players the match had, for a caller that splits by it. */
  playerCount: number;
}

/**
 * Every start position of every match, with its result (#1163 reads this).
 *
 * A dot a match, so the same place used in ten matches is ten entries. Nothing
 * here groups places or counts wins: on a map with start boxes a position is
 * anywhere in a box, and which places are "the same" is a decision this does
 * not make.
 */
export function aggregateStarts(
  matches: readonly AggregateMatch[],
  counts: ReadonlyMap<string, ReplayCounts>,
): AggregateStart[] {
  const out: AggregateStart[] = [];
  for (const m of matches) {
    const r = m.record;
    const replay = counts.get(r.path);
    if (!replay) continue;
    const allyOf = new Map<number, number>();
    for (const seat of [...r.players.filter((p) => !p.spectator), ...r.ais])
      if (seat.team !== undefined && seat.allyTeam !== undefined)
        allyOf.set(seat.team, seat.allyTeam);
    for (const start of replay.starts) {
      const allyTeam = allyOf.get(start.team);
      out.push({
        filename: r.filename,
        gameId: r.gameId,
        team: start.team,
        allyTeam,
        x: start.x,
        z: start.z,
        won:
          r.winnersKnown && allyTeam !== undefined
            ? r.winningAllyTeams.includes(allyTeam)
            : null,
        playerCount: m.playerCount,
      });
    }
  }
  return out;
}

/** How many matches have at least one start position recorded. */
export function matchesWithStarts(starts: readonly AggregateStart[]): number {
  return new Set(starts.map((s) => s.filename)).size;
}
