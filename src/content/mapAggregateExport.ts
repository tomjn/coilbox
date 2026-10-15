import {
  type AggregateFilters,
  type AggregateMatch,
  FORMAT_LABEL,
  type HeatLayerId,
  LAYER_LABEL,
  type LayerGrid,
  type MatchWindow,
  NORMALISE_LABEL,
  type Normalise,
  windowLabel,
} from "./mapAggregate";
import type { StartRecords } from "./mapRecords";
import { countBy } from "./mapVersions";
import { csvNumber, csvText, EOL, slug } from "./matchStatsCsv";
import type { StartRow } from "./startNames";

/**
 * "How this map is played" as files (#1165): the picture's numbers as CSV, and
 * the provenance the picture and the files both carry.
 *
 * This formats what the section already worked out. It computes no figure of
 * its own, so a file and the screen cannot disagree. The CSV rules are the
 * match chart's: RFC 4180 quoting, a guard on text a spreadsheet would run as a
 * formula, full precision numbers with a dot decimal, CRLF line ends, and the
 * provenance repeated as columns on every row so no tool has a header block to
 * skip.
 *
 * Coordinates. Every x and z is in elmos, the engine's world unit, measured
 * from the map's north west corner. x grows east and z grows south, as a replay
 * records them and as the rest of the app uses them. Column 0 is the west edge
 * of the grid and row 0 its north edge. A cell's x and z are those of its
 * middle.
 */

/** What the files and the image say about where the numbers came from, less
 *  the moment of export, which is stamped when the file is made. */
export interface MapExportBasis {
  mapName: string;
  /** The full map names in the picture, which are the versions it spans. */
  mapVersions: string[];
  /** The games and versions in the picture, as the replays name them. */
  gameVersions: string[];
  /** Matches in the picture, after every filter. */
  matches: number;
  filters: FilterSummary;
  worldWidth: number;
  worldHeight: number;
}

export interface MapExportInfo extends MapExportBasis {
  /** When the export was made, as an ISO 8601 UTC timestamp. */
  exportedUtc: string;
}

export const stampExport = (
  basis: MapExportBasis,
  now: Date,
): MapExportInfo => ({
  ...basis,
  exportedUtc: now.toISOString(),
});

/** The filters in force, each as the words the section uses. */
export interface FilterSummary {
  players: string;
  sides: string;
  analysed: string;
  playedFrom: string;
  playedUntil: string;
  /** The name of the replay set, or "" for every replay. */
  replaySet: string;
  includesShort: boolean;
}

const ANALYSED: Record<AggregateFilters["analysed"], string> = {
  any: "analysed or not",
  yes: "analysed",
  no: "not analysed",
};

export function filterSummary(
  filters: AggregateFilters,
  replaySet: string,
): FilterSummary {
  return {
    players:
      filters.playerCount === null
        ? "any number of players"
        : `${filters.playerCount} players`,
    sides: filters.format === null ? "any sides" : FORMAT_LABEL[filters.format],
    analysed: ANALYSED[filters.analysed],
    playedFrom: filters.from,
    playedUntil: filters.to,
    replaySet,
    includesShort: filters.includeShort,
  };
}

/** The provenance for the matches in the picture, as the section filtered them. */
export function mapExportInfo(input: {
  mapName: string;
  shown: readonly AggregateMatch[];
  filters: AggregateFilters;
  replaySet: string;
  worldWidth: number;
  worldHeight: number;
}): MapExportBasis {
  return {
    mapName: input.mapName,
    mapVersions: countBy(input.shown, (m) => m.record.mapName).map(
      (v) => v.name,
    ),
    gameVersions: countBy(input.shown, (m) => m.record.gameType).map(
      (v) => v.name,
    ),
    matches: input.shown.length,
    filters: filterSummary(input.filters, input.replaySet),
    worldWidth: input.worldWidth,
    worldHeight: input.worldHeight,
  };
}

/** Between two names in a cell that lists several. Names can hold a comma, so
 *  the cell is quoted, and they cannot be told apart by it alone. */
const LIST_SEPARATOR = "; ";

type Column = readonly [name: string, cell: string];

/**
 * The provenance every row carries, text already quoted and guarded. `layer`
 * is what only a layer file says about the matches, and goes beside their count.
 */
function infoColumns(info: MapExportInfo, layer: Column[] = []): Column[] {
  const f = info.filters;
  return [
    ["map", csvText(info.mapName)],
    ["map_versions", csvText(info.mapVersions.join(LIST_SEPARATOR))],
    ["game_versions", csvText(info.gameVersions.join(LIST_SEPARATOR))],
    ["matches_in_picture", csvNumber(info.matches)],
    ...layer,
    ["filter_players", csvText(f.players)],
    ["filter_sides", csvText(f.sides)],
    ["filter_analysed", csvText(f.analysed)],
    ["filter_played_from", csvText(f.playedFrom)],
    ["filter_played_until", csvText(f.playedUntil)],
    ["filter_replay_set", csvText(f.replaySet)],
    ["includes_matches_under_a_minute", f.includesShort ? "true" : "false"],
    ["map_width_elmos", csvNumber(info.worldWidth)],
    ["map_height_elmos", csvNumber(info.worldHeight)],
    ["exported_utc", csvText(info.exportedUtc)],
  ];
}

/**
 * A float32 as the fewest digits that read back as the same float32. A float32
 * shown as a double carries digits the array never held, and nine digits always
 * identify one, so the search stops there.
 */
function float32(value: number): number {
  for (let digits = 1; digits < 9; digits++) {
    const text = Number(value.toPrecision(digits));
    if (Math.fround(text) === value) return text;
  }
  return Number(value.toPrecision(9));
}

export interface LayerCsvInput {
  info: MapExportInfo;
  layer: HeatLayerId;
  normalise: Normalise;
  window: MatchWindow;
  /** Matches with something on this layer in the window. */
  contributing: number;
  grid: LayerGrid;
}

/**
 * The layer on screen as one row per grid cell that has an event in it. A cell
 * with none is absent, and absent means zero.
 *
 * `mean_scaled_per_match` is the grid the picture is smoothed from: each
 * contributing match's events in the cell, scaled by the mode in `scaling`, then
 * the mean over the contributing matches. `events_unscaled` is the plain number
 * of events in the cell over those matches, so another scaling can be made from
 * it. Neither is smoothed.
 */
export function layerCsv(input: LayerCsvInput): string {
  const { grid, info } = input;
  const tail: Column[] = [
    ...infoColumns(info, [
      ["matches_in_layer", csvNumber(input.contributing)],
      ["layer", csvText(LAYER_LABEL[input.layer])],
      ["scaling", csvText(NORMALISE_LABEL[input.normalise])],
      ["window", csvText(windowLabel(input.window))],
    ]),
    ["grid_width_cells", csvNumber(grid.width)],
    ["grid_height_cells", csvNumber(grid.height)],
  ];
  const head = [
    "cell_column",
    "cell_row",
    "x_elmos_from_west",
    "z_elmos_from_north",
    "mean_scaled_per_match",
    "events_unscaled",
    ...tail.map(([name]) => name),
  ];
  const cellW = info.worldWidth / grid.width;
  const cellH = info.worldHeight / grid.height;
  const cells = tail.map(([, cell]) => cell);
  const lines: string[] = [];
  for (let row = 0; row < grid.height; row++)
    for (let col = 0; col < grid.width; col++) {
      const i = row * grid.width + col;
      if (grid.mean[i] === 0 && grid.events[i] === 0) continue;
      lines.push(
        [
          csvNumber(col),
          csvNumber(row),
          csvNumber((col + 0.5) * cellW),
          csvNumber((row + 0.5) * cellH),
          csvNumber(float32(grid.mean[i])),
          csvNumber(grid.events[i]),
          ...cells,
        ].join(","),
      );
    }
  return [head.join(","), ...lines].join(EOL) + EOL;
}

/** The rows of cells a layer file would hold, for the button to say. */
export function layerCellCount(grid: LayerGrid): number {
  let n = 0;
  for (let i = 0; i < grid.mean.length; i++)
    if (grid.mean[i] !== 0 || grid.events[i] !== 0) n++;
  return n;
}

export interface StartsCsvInput {
  info: MapExportInfo;
  records: StartRecords;
  rows: readonly StartRow[];
  /** Whether the section splits positions by side, as it does for matches that
   *  were all two sides. */
  split: boolean;
}

/**
 * The start positions as one row per position.
 *
 * The section's table joins positions the player gave one name into a row. This
 * file lists the positions, so the counts of the positions in one `row_number`
 * add up to that row's. `name` is the player's own text, kept on this computer.
 * `taken` is starts at the position, `with_result` those in a match with a
 * recorded result, and `won` those among them whose side won. The team 1 and
 * team 2 columns are there only when the matches were all two sides.
 */
export function startsCsv(input: StartsCsvInput): string {
  const { info, records, rows, split } = input;
  const tail: Column[] = [
    ...infoColumns(info),
    ["declared_tolerance_elmos", csvNumber(records.tolerance)],
    ["grouping_distance_elmos", csvNumber(records.scale)],
  ];
  const head = [
    "row_number",
    "position_key",
    "position_kind",
    "name",
    "x_elmos_from_west",
    "z_elmos_from_north",
    "radius_elmos",
    "taken",
    "taken_by_ai",
    "with_result",
    "won",
    ...(split
      ? [
          "team_1_taken",
          "team_1_with_result",
          "team_1_won",
          "team_2_taken",
          "team_2_with_result",
          "team_2_won",
        ]
      : []),
    ...tail.map(([name]) => name),
  ];
  const cells = tail.map(([, cell]) => cell);
  const lines = rows.flatMap((row) =>
    row.places.map((place) => {
      const record = records.places.find((r) => r.place.key === place.key);
      if (!record) throw new Error(`no record for position ${place.key}`);
      return [
        csvNumber(row.number),
        csvText(place.key),
        place.kind,
        csvText(row.name ?? ""),
        csvNumber(place.x),
        csvNumber(place.z),
        csvNumber(place.radius),
        csvNumber(record.taken),
        csvNumber(record.byAi),
        csvNumber(record.known),
        csvNumber(record.won),
        ...(split
          ? [
              csvNumber(record.sides[0].taken),
              csvNumber(record.sides[0].known),
              csvNumber(record.sides[0].won),
              csvNumber(record.sides[1].taken),
              csvNumber(record.sides[1].known),
              csvNumber(record.sides[1].won),
            ]
          : []),
        ...cells,
      ].join(",");
    }),
  );
  return [head.join(","), ...lines].join(EOL) + EOL;
}

/** A name from the map and the layer, slugged as the match CSV's is. */
export function layerCsvFileName(
  info: MapExportInfo,
  layer: HeatLayerId,
): string {
  const parts = [slug(info.mapName), slug(LAYER_LABEL[layer])].filter(Boolean);
  return `${parts.length > 0 ? parts.join("-") : "map-density"}.csv`;
}

export function startsCsvFileName(info: MapExportInfo): string {
  const parts = [slug(info.mapName), "start-positions"].filter(Boolean);
  return `${parts.join("-")}.csv`;
}

/** The image's name, from the map and the layer, or just the map when no
 *  layer is drawn. */
export function layerImageFileName(
  info: MapExportInfo,
  layer: HeatLayerId | "",
): string {
  const parts = [
    slug(info.mapName),
    layer ? slug(LAYER_LABEL[layer]) : "",
  ].filter(Boolean);
  return `${parts.length > 0 ? parts.join("-") : "map-density"}.png`;
}
