// @vitest-environment happy-dom
/**
 * The picture of every match on a map (#1161), as the page shows it. The sums
 * are `mapAggregate.test.ts`. This file reads what reaches the DOM: which
 * replays are asked for, the count beside each layer, the sentences that say
 * what the picture is made of, and the states with nothing to draw. Nothing is
 * painted here, so no pixel is asserted.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MapCountLayer,
  ReplayMapGrids,
  StatRecord,
  StoredReplayAnalysis,
} from "../../bindings";
import type { ReplaySet } from "../../replaySets";

let GRIDS: Record<string, Partial<ReplayMapGrids> | Error> = {};
let SETS: ReplaySet[] = [];
let UNITS: Record<string, unknown[]> = {};
let SETTINGS: Record<string, unknown> = {};
const asked = vi.fn();

vi.mock("../../bindings", async (original) => ({
  ...(await original<typeof import("../../bindings")>()),
  contentReplayMapGrids: async (args: {
    paths: string[];
    worldWidth: number;
    worldHeight: number;
  }) => {
    asked(args);
    const [path] = args.paths;
    const found = GRIDS[path];
    const grid = {
      width: 256,
      height: 256,
      worldWidth: 8192,
      worldHeight: 8192,
    };
    if (!found || found instanceof Error)
      return {
        grid,
        replays: [],
        failed: [{ path, error: found?.message ?? "read demo: gone" }],
      };
    return { grid, replays: [{ ...EMPTY, path, ...found }], failed: [] };
  },
}));
vi.mock("../../config", () => ({
  useScanTargetSelection: () => ({
    selected: { enginePath: "/engine", rootPath: "/data" },
  }),
  useUnitsyncScan: () => ({
    data: {
      games: Object.keys(UNITS).map((name) => ({
        name,
        primaryArchive: { name: `${name}.sdz` },
      })),
    },
    loading: false,
  }),
  loadUnitsyncUnitDataset: async (_e: string, _d: string, archive: string) => ({
    units: UNITS[archive.replace(/\.sdz$/, "")] ?? [],
    errors: [],
  }),
}));
vi.mock("../../replaySets", async (original) => ({
  ...(await original<typeof import("../../replaySets")>()),
  useReplaySets: () => ({ sets: SETS }),
}));
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (key: string, fallback: unknown) => [
    SETTINGS[key] ?? fallback,
    (value: unknown) => {
      SETTINGS[key] = value;
    },
  ],
}));
vi.mock("@/lib/useHeatmapLayer", () => ({ useHeatmapLayer: () => {} }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: async () => {} }));

const { MapAggregate } = await import("./MapAggregate");
const { resetMapReplayCounts } = await import("../../useMapAggregate");
const { seedReplayAnalysisForTests, resetReplayAnalysisForTests } =
  await import("../../replayAnalysis");

const MAP = "Some Map 1.0";
const WORLD = { worldWidth: 8192, worldHeight: 8192 };

function base64(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

/** `[cell, minute, count, def?]`, packed as Rust packs them. */
function layer(entries: [number, number, number, number?][]): MapCountLayer {
  const n = entries.length;
  const cell = new Uint32Array(n);
  const slice = new Uint16Array(n);
  const count = new Uint16Array(n);
  const def = new Uint32Array(n);
  entries.forEach(([c, s, k, d], i) => {
    cell[i] = c;
    slice[i] = s;
    count[i] = k;
    def[i] = d ?? 0;
  });
  const packed = (a: ArrayBufferView) => base64(new Uint8Array(a.buffer));
  return {
    entries: n,
    cell: packed(cell),
    slice: packed(slice),
    count: packed(count),
    def: entries.some((e) => e[3] !== undefined) ? packed(def) : undefined,
    total: entries.reduce((sum, e) => sum + e[2], 0),
    offMap: 0,
  };
}

const EMPTY: ReplayMapGrids = {
  path: "",
  remixed: false,
  mapName: MAP,
  gameType: "Some Game 1.0",
  lastFrame: 20 * 1800,
  incomplete: false,
  starts: [],
  buildings: layer([]),
  orders: layer([]),
  unitAimed: 0,
  custom: 0,
  fromCache: false,
};

function record(over: Partial<StatRecord> & { filename: string }): StatRecord {
  return {
    path: `/demos/${over.filename}`,
    mapName: MAP,
    gameType: "Some Game 1.0",
    engineVersion: "2025.06.19",
    durationSec: 1200,
    startTimeMs: new Date(2026, 5, 15, 12).getTime(),
    sizeBytes: 1,
    modifiedMs: 1,
    winnersKnown: false,
    winningAllyTeams: [],
    remixed: false,
    players: [
      { name: "One", team: 0, allyTeam: 0, spectator: false },
      { name: "Two", team: 1, allyTeam: 1, spectator: false },
    ],
    ais: [],
    statsKnown: false,
    teamTotals: [],
    ingestedAt: 0,
    ...over,
  };
}

const stored = (gameId: string, state: StoredReplayAnalysis["state"]) =>
  ({ gameId, state, analysedAtMs: 5 }) as StoredReplayAnalysis;

/** Two matches with a stream. The first is early and the second is late. */
function twoMatches(): StatRecord[] {
  GRIDS = {
    "/demos/a.sdfz": {
      gameId: "aa",
      starts: [
        { team: 0, x: 1000, z: 2000 },
        { team: 1, x: 7000, z: 6000 },
      ],
      buildings: layer([[50 * 256 + 50, 0, 4, 1]]),
      orders: layer([[50 * 256 + 50, 0, 10]]),
    },
    "/demos/b.sdfz": {
      gameId: "bb",
      gameType: "Some Game 2.0",
      starts: [{ team: 0, x: 1100, z: 2100 }],
      buildings: layer([[200 * 256 + 200, 12, 6, 1]]),
      orders: layer([[200 * 256 + 200, 12, 100]]),
    },
  };
  return [
    record({ filename: "a.sdfz", gameId: "aa" }),
    record({ filename: "b.sdfz", gameId: "bb", gameType: "Some Game 2.0" }),
  ];
}

function show(records: StatRecord[], ingesting = false) {
  return render(
    <MapAggregate
      mapName={MAP}
      world={WORLD}
      minimapUrl="data:image/png;base64,AAAA"
      records={records}
      ingesting={ingesting}
      scene={null}
    />,
  );
}

const text = (id: string) => screen.getByTestId(id).textContent ?? "";
const settled = () =>
  waitFor(() => expect(text("aggregate-summary")).not.toMatch(/Reading/));

beforeEach(() => {
  GRIDS = {};
  SETS = [];
  UNITS = {};
  SETTINGS = {};
  asked.mockClear();
  resetMapReplayCounts();
  resetReplayAnalysisForTests();
  seedReplayAnalysisForTests({});
});
afterEach(cleanup);

describe("the picture of every match on a map", () => {
  it("asks for one replay a call, at the map's size", async () => {
    show(twoMatches());
    await settled();
    expect(asked.mock.calls.map(([a]) => a)).toEqual([
      { paths: ["/demos/a.sdfz"], worldWidth: 8192, worldHeight: 8192 },
      { paths: ["/demos/b.sdfz"], worldWidth: 8192, worldHeight: 8192 },
    ]);
  });

  it("says how many matches are behind the picture and how many have events", async () => {
    show(twoMatches());
    await settled();
    expect(text("aggregate-summary")).toBe(
      "All 2 matches on this map in your library are in this picture. 2 have orders recorded, and 0 have been analysed and have event data.",
    );
  });

  it("puts the count of matches beside every layer", async () => {
    show(twoMatches());
    await settled();
    expect(text("layer-starts")).toBe("Start positions · 2");
    expect(text("layer-buildings")).toBe("Building density · 2");
    expect(text("layer-orders")).toBe("Order density · 2");
    // No game is installed, so nothing says what a building is for.
    expect(text("layer-defence")).toBe("Defences · 0");
    expect(text("layer-economy")).toBe("Economy · 0");
    expect(text("layer-deaths")).toBe("Deaths · 0");
  });

  it("draws a dot a start a match, at its place on the map", async () => {
    const { container } = show(twoMatches());
    await settled();
    const dots = [...container.querySelectorAll('[data-layer="starts"]')].map(
      (d) => [(d as HTMLElement).style.left, (d as HTMLElement).style.top],
    );
    expect(dots).toEqual([
      [`${(1000 / 8192) * 100}%`, `${(2000 / 8192) * 100}%`],
      [`${(7000 / 8192) * 100}%`, `${(6000 / 8192) * 100}%`],
      [`${(1100 / 8192) * 100}%`, `${(2100 / 8192) * 100}%`],
    ]);
    expect(text("starts-note")).toMatch(/3 starts from 2 matches/);
  });

  it("states the default scaling in the legend as a share of a match", async () => {
    show(twoMatches());
    await settled();
    expect(text("layer-events")).toBe(
      "10 orders to place a building, from 2 matches.",
    );
    // Each match is in one place, so half of an average match is at the peak.
    expect(text("layer-notes")).toMatch(
      /Most is on average 50% of a match's orders to place a building within 256 elmos of one spot, across 2 matches\./,
    );
    expect(
      document.querySelector('canvas[data-layer="buildings"]'),
    ).not.toBeNull();
  });

  it("switches the density layer, one at a time", async () => {
    show(twoMatches());
    await settled();
    fireEvent.click(screen.getByTestId("layer-orders"));
    expect(text("layer-events")).toBe("110 orders, from 2 matches.");
    expect(document.querySelector('canvas[data-layer="buildings"]')).toBeNull();
    expect(
      document.querySelector('canvas[data-layer="orders"]'),
    ).not.toBeNull();
  });

  it("classifies buildings only for a match whose exact game build is installed", async () => {
    // Definition 1 is an armed building in the installed build.
    UNITS = {
      "Some Game 1.0": [
        { mobile: false, buildOptions: [], stats: { weapons: [{}] } },
      ],
    };
    show(twoMatches());
    await settled();
    await waitFor(() => expect(text("layer-defence")).toBe("Defences · 1"));
    fireEvent.click(screen.getByTestId("layer-defence"));
    expect(text("layer-events")).toBe(
      "4 orders to place a defence, from 1 match.",
    );
    expect(text("category-note")).toMatch(
      /1 match was played on a game or version that is not installed.*it is left out of this layer/,
    );
  });

  it("says no match has been analysed when the deaths layer has none", async () => {
    show(twoMatches());
    await settled();
    fireEvent.click(screen.getByTestId("layer-deaths"));
    expect(text("no-analysis")).toMatch(
      /No match on this map in the picture has been analysed/,
    );
    expect(screen.queryByTestId("layer-events")).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("draws deaths from the analysed matches and counts only those", async () => {
    const records = twoMatches();
    seedReplayAnalysisForTests({
      analyses: [stored("aa", "current"), stored("bb", "diverged")],
    });
    (GRIDS["/demos/a.sdfz"] as Partial<ReplayMapGrids>).deaths = {
      layer: layer([[60 * 256 + 60, 3, 7]]),
      unattacked: 2,
      noPosition: 1,
    };
    show(records);
    await settled();
    expect(text("aggregate-summary")).toMatch(
      /1 has been analysed and has event data\. 1 was analysed and the playback did not reproduce the match, so it has no events\./,
    );
    expect(text("layer-deaths")).toBe("Deaths · 1");
    fireEvent.click(screen.getByTestId("layer-deaths"));
    expect(text("layer-events")).toBe("7 deaths, from 1 match.");
    expect(text("layer-notes")).toMatch(/2 deaths name no attacker/);
    expect(text("layer-notes")).toMatch(
      /1 death was recorded at exactly the map's corner.*is left out/,
    );
  });

  it("leaves matches under a minute out until asked, and says so", async () => {
    const records = [
      ...twoMatches(),
      record({ filename: "short.sdfz", gameId: "cc", durationSec: 20 }),
    ];
    GRIDS["/demos/short.sdfz"] = { gameId: "cc", orders: layer([[5, 0, 3]]) };
    show(records);
    await settled();
    expect(text("aggregate-summary")).toMatch(/^2 matches of the 3 /);
    expect(text("map-aggregate")).toMatch(
      /1 match under a minute is left out too/,
    );
    expect(asked).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByText("Matches under a minute"));
    await waitFor(() => expect(text("layer-orders")).toBe("Order density · 3"));
    expect(text("aggregate-summary")).toMatch(/^All 3 matches /);
  });

  it("narrows to a range of days, and the counts follow", async () => {
    const records = twoMatches();
    records[1].startTimeMs = new Date(2026, 6, 20, 12).getTime();
    show(records);
    await settled();
    fireEvent.change(screen.getByLabelText("Played until"), {
      target: { value: "2026-06-30" },
    });
    expect(text("aggregate-summary")).toMatch(/^1 match of the 2 /);
    expect(text("layer-buildings")).toBe("Building density · 1");
    expect(text("layer-events")).toBe(
      "4 orders to place a building, from 1 match.",
    );
    fireEvent.click(screen.getByText("Clear filters"));
    expect(text("layer-buildings")).toBe("Building density · 2");
  });

  it("counts a match once and leaves its remixes out", async () => {
    const records = [
      ...twoMatches(),
      record({ filename: "a.remix.sdfz", gameId: "aa", remixed: true }),
      record({ filename: "a.remix-2.sdfz", gameId: "aa", remixed: true }),
    ];
    show(records);
    await settled();
    expect(text("aggregate-summary")).toMatch(/^All 2 matches /);
    expect(text("map-aggregate")).toMatch(
      /2 remixes are left out, so each match counts once/,
    );
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it("says when a replay could not be read, and draws the rest", async () => {
    const records = twoMatches();
    GRIDS["/demos/b.sdfz"] = new Error("read demo: gone");
    show(records);
    await settled();
    expect(text("map-aggregate")).toMatch(
      /1 replay could not be read and is not in the picture/,
    );
    expect(text("layer-orders")).toBe("Order density · 1");
  });

  it("says there is nothing yet for a map with no match", () => {
    show([record({ filename: "x.sdfz", mapName: "Some Map 1.1" })]);
    expect(text("map-aggregate")).toMatch(
      /No match on this map is in your library yet/,
    );
    expect(asked).not.toHaveBeenCalled();
    expect(screen.queryByTestId("aggregate-filters")).toBeNull();
  });

  it("says so when the filters leave no match", async () => {
    show(twoMatches());
    await settled();
    fireEvent.change(screen.getByLabelText("Played until"), {
      target: { value: "2020-01-01" },
    });
    expect(text("map-aggregate")).toMatch(
      /No match on this map passes these filters/,
    );
    expect(screen.queryByTestId("layer-buildings")).toBeNull();
  });
});

describe("scoping the picture to a set", () => {
  const SCRIMS = {
    id: "s1",
    name: "Scrims",
    members: [{ filename: "b.sdfz" }],
  };

  it("keeps only the set's members, and reads only those", async () => {
    SETS = [SCRIMS];
    SETTINGS["content.mapInsightSet"] = "s1";
    show(twoMatches());
    await settled();
    expect(text("aggregate-summary")).toMatch(/^1 match of the 2 /);
    expect(text("layer-orders")).toBe("Order density · 1");
    expect(asked.mock.calls.map(([a]) => a.paths)).toEqual([["/demos/b.sdfz"]]);
    expect(screen.getByLabelText("Scope to a set").textContent).toBe(
      "Set: Scrims",
    );
  });

  it("means every match again when the saved set was deleted", async () => {
    SETTINGS["content.mapInsightSet"] = "gone";
    show(twoMatches());
    await settled();
    expect(text("aggregate-summary")).toMatch(/^All 2 matches /);
    expect(screen.queryByText("Clear filters")).toBeNull();
  });

  it("offers no set scope when there are no sets", async () => {
    show(twoMatches());
    await settled();
    expect(screen.queryByLabelText("Scope to a set")).toBeNull();
  });
});
