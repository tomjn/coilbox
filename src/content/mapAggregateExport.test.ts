import { describe, expect, it } from "vitest";
import { type LayerGrid, NO_FILTERS, WHOLE } from "./mapAggregate";
import {
  layerCellCount,
  layerCsv,
  layerCsvFileName,
  layerImageFileName,
  type MapExportInfo,
  mapExportInfo,
  startsCsv,
  startsCsvFileName,
} from "./mapAggregateExport";
import type { PlaceRecord, StartRecords } from "./mapRecords";
import type { StartRow } from "./startNames";

const info: MapExportInfo = {
  mapName: "Tabula 2.1",
  mapVersions: ["Tabula 2.1", "Tabula v2.0"],
  gameVersions: ["Game A 1.0"],
  matches: 5,
  filters: {
    players: "any number of players",
    sides: "any sides",
    analysed: "analysed or not",
    playedFrom: "",
    playedUntil: "",
    replaySet: "",
    includesShort: false,
  },
  worldWidth: 800,
  worldHeight: 400,
  exportedUtc: "2026-10-10T12:34:56.000Z",
};

/** 4 columns by 2 rows over an 800 by 400 map: a cell is 200 elmos each way. */
function grid(): LayerGrid {
  const mean = new Float32Array(8);
  const events = new Float32Array(8);
  mean[1] = 0.1;
  events[1] = 3;
  mean[6] = 0.25;
  events[6] = 12;
  return { width: 4, height: 2, mean, events };
}

const lines = (text: string) => text.split("\r\n");

describe("layerCsv", () => {
  const text = layerCsv({
    info,
    layer: "buildings",
    normalise: "share",
    window: WHOLE,
    contributing: 4,
    grid: grid(),
  });

  it("names every column, with the numbers first and the provenance after", () => {
    expect(lines(text)[0]).toBe(
      [
        "cell_column",
        "cell_row",
        "x_elmos_from_west",
        "z_elmos_from_north",
        "mean_scaled_per_match",
        "events_unscaled",
        "map",
        "map_versions",
        "game_versions",
        "matches_in_picture",
        "matches_in_layer",
        "layer",
        "scaling",
        "window",
        "filter_players",
        "filter_sides",
        "filter_analysed",
        "filter_played_from",
        "filter_played_until",
        "filter_replay_set",
        "includes_matches_under_a_minute",
        "map_width_elmos",
        "map_height_elmos",
        "exported_utc",
        "grid_width_cells",
        "grid_height_cells",
      ].join(","),
    );
  });

  it("writes one row for each cell with something in it and none for the rest", () => {
    const rows = lines(text);
    // Header, two cells, and the empty string after the last line ending.
    expect(rows).toHaveLength(4);
    expect(rows[3]).toBe("");
    expect(layerCellCount(grid())).toBe(2);
  });

  it("puts a cell's middle in elmos from the north west corner", () => {
    const [, first, second] = lines(text);
    // Cell 1 is column 1, row 0: x 200 to 400, z 0 to 200.
    expect(first.startsWith("1,0,300,100,0.1,3,")).toBe(true);
    // Cell 6 is column 2, row 1: x 400 to 600, z 200 to 400.
    expect(second.startsWith("2,1,500,300,0.25,12,")).toBe(true);
  });

  it("repeats the provenance on every row", () => {
    const [, first, second] = lines(text);
    const tail =
      "Tabula 2.1,Tabula 2.1; Tabula v2.0,Game A 1.0,5,4,Building density,Share of each match,the whole match,any number of players,any sides,analysed or not,,,,false,800,400,2026-10-10T12:34:56.000Z,4,2";
    expect(first.endsWith(tail)).toBe(true);
    expect(second.endsWith(tail)).toBe(true);
  });

  it("ends every line with CRLF and writes no bare line feed", () => {
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("writes a float32 as the digits it holds and not the double's", () => {
    const g = grid();
    g.mean[1] = Math.fround(1 / 3);
    const row = lines(
      layerCsv({
        info,
        layer: "orders",
        normalise: "peak",
        window: { kind: "range", from: 5, to: 10 },
        contributing: 1,
        grid: g,
      }),
    )[1];
    expect(row.split(",")[4]).toBe("0.33333334");
    expect(row).toContain("minutes 5 to 10");
    expect(row).toContain("Order density");
  });

  it("quotes and guards the text a player or a map author wrote", () => {
    const row = lines(
      layerCsv({
        info: {
          ...info,
          mapName: "=cmd|' /C calc'!A0",
          mapVersions: ['Map, the "best"'],
          filters: { ...info.filters, replaySet: "+Set" },
        },
        layer: "buildings",
        normalise: "share",
        window: WHOLE,
        contributing: 4,
        grid: grid(),
      }),
    )[1];
    expect(row).toContain(",'=cmd|' /C calc'!A0,");
    expect(row).toContain('"Map, the ""best"""');
    expect(row).toContain(",'+Set,");
  });
});

const place = (
  key: string,
  taken: number,
  known: number,
  won: number,
): PlaceRecord => ({
  place: {
    key,
    kind: key.startsWith("d") ? "declared" : "cluster",
    number: 1,
    x: 100.5,
    z: 200,
    radius: 0,
  },
  taken,
  known,
  won,
  sides: [
    { taken: 2, known: 1, won: 1 },
    { taken: taken - 2, known: known - 1, won: won - 1 },
  ],
  byAi: 1,
});

describe("startsCsv", () => {
  const records: StartRecords = {
    places: [place("d1", 4, 3, 2), place("c3:7", 2, 2, 1)],
    tolerance: 512,
    scale: null,
    atDeclared: 4,
    grouped: 2,
    ungrouped: 0,
  };
  const rows: StartRow[] = [
    {
      key: "d1",
      number: 1,
      name: "=Front",
      places: [records.places[0].place],
      taken: 4,
      known: 3,
      won: 2,
      sides: [
        { taken: 0, known: 0, won: 0 },
        { taken: 0, known: 0, won: 0 },
      ],
      byAi: 1,
    },
    {
      key: "c3:7",
      number: 2,
      name: null,
      places: [records.places[1].place],
      taken: 2,
      known: 2,
      won: 1,
      sides: [
        { taken: 0, known: 0, won: 0 },
        { taken: 0, known: 0, won: 0 },
      ],
      byAi: 1,
    },
  ];

  it("writes one row for each position, with the player's name guarded", () => {
    const out = lines(startsCsv({ info, records, rows, split: false }));
    expect(out[0].split(",").slice(0, 11)).toEqual([
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
    ]);
    expect(
      out[1].startsWith("1,d1,declared,'=Front,100.5,200,0,4,1,3,2,"),
    ).toBe(true);
    expect(out[2].startsWith("2,c3:7,cluster,,100.5,200,0,2,1,2,1,")).toBe(
      true,
    );
    expect(out).toHaveLength(4);
  });

  it("adds the team columns only when the section splits by team", () => {
    const plain = lines(startsCsv({ info, records, rows, split: false }))[0];
    const split = lines(startsCsv({ info, records, rows, split: true }))[0];
    expect(plain).not.toContain("team_1_taken");
    expect(split).toContain(
      "team_1_taken,team_1_with_result,team_1_won,team_2_taken",
    );
    const row = lines(startsCsv({ info, records, rows, split: true }))[1];
    expect(
      row.startsWith("1,d1,declared,'=Front,100.5,200,0,4,1,3,2,2,1,1,2,2,1,"),
    ).toBe(true);
  });

  it("says how the positions were found, and leaves a missing figure empty", () => {
    const out = lines(startsCsv({ info, records, rows, split: false }));
    expect(out[0]).toContain(
      "declared_tolerance_elmos,grouping_distance_elmos",
    );
    expect(out[1].endsWith(",512,")).toBe(true);
  });
});

describe("mapExportInfo", () => {
  it("lists the map and game versions of the matches in the picture", () => {
    const match = (mapName: string, gameType: string) =>
      ({ record: { mapName, gameType } }) as never;
    const got = mapExportInfo({
      mapName: "Tabula 2.1",
      shown: [
        match("Tabula v2.0", "G 2"),
        match("Tabula 2.1", "G 10"),
        match("Tabula 2.1", "G 2"),
      ],
      filters: {
        ...NO_FILTERS,
        playerCount: 4,
        format: "ffa",
        from: "2026-01-01",
      },
      replaySet: "Cup",
      worldWidth: 8192,
      worldHeight: 4096,
    });
    expect(got.matches).toBe(3);
    expect(got.mapVersions).toEqual(["Tabula 2.1", "Tabula v2.0"]);
    expect(got.gameVersions).toEqual(["G 2", "G 10"]);
    expect(got.filters).toEqual({
      players: "4 players",
      sides: "Free for all",
      analysed: "analysed or not",
      playedFrom: "2026-01-01",
      playedUntil: "",
      replaySet: "Cup",
      includesShort: false,
    });
  });
});

describe("file names", () => {
  it("are slugs of the map and what is in the file", () => {
    expect(layerCsvFileName(info, "buildings")).toBe(
      "tabula-2-1-building-density.csv",
    );
    expect(startsCsvFileName(info)).toBe("tabula-2-1-start-positions.csv");
    expect(layerImageFileName(info, "deaths")).toBe("tabula-2-1-deaths.png");
    expect(layerImageFileName({ ...info, mapName: "地图" }, "")).toBe(
      "map-density.png",
    );
  });
});
