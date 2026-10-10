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
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
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

function show(
  records: StatRecord[],
  ingesting = false,
  extra: Partial<ComponentProps<typeof MapAggregate>> = {},
) {
  return render(
    <MapAggregate
      mapName={MAP}
      world={WORLD}
      minimapUrl="data:image/png;base64,AAAA"
      records={records}
      ingesting={ingesting}
      scene={null}
      {...extra}
    />,
  );
}

const text = (id: string) => screen.getByTestId(id).textContent ?? "";
/** Opens the section's one help popover and reads inside it. Call it once a
 *  test: a second click would close it. */
function help() {
  fireEvent.click(
    screen.getByRole("button", { name: "About how this map is played" }),
  );
  return within(screen.getByRole("dialog"));
}
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
    const said = help();
    expect(said.getByText(/2 deaths name no attacker/)).toBeTruthy();
    expect(
      said.getByText(
        /1 death was recorded at exactly the map's corner.*is left out/,
      ),
    ).toBeTruthy();
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
    expect(help().getByText(/1 match under a minute is left out/)).toBeTruthy();
    expect(asked).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    fireEvent.click(screen.getByText("Matches under a minute"));
    await waitFor(() => expect(text("layer-orders")).toBe("Order density · 3"));
    expect(text("aggregate-summary")).toMatch(/^All 3 matches /);
  });

  it("narrows to a range of days, and the counts follow", async () => {
    const records = twoMatches();
    records[1].startTimeMs = new Date(2026, 6, 20, 12).getTime();
    show(records);
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /Played until/ }));
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

  it("shows no date until one is chosen, and clearing removes the filter", async () => {
    const records = twoMatches();
    records[1].startTimeMs = new Date(2026, 6, 20, 12).getTime();
    show(records);
    await settled();
    const filters = screen.getByTestId("aggregate-filters");
    expect(within(filters).getAllByText("Any date")).toHaveLength(2);
    expect(filters.querySelector('input[type="date"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Played until/ }));
    const until = screen.getByLabelText("Played until") as HTMLInputElement;
    expect(document.activeElement).toBe(until);
    fireEvent.change(until, { target: { value: "2026-06-30" } });
    expect(until.value).toBe("2026-06-30");
    expect(within(filters).getAllByText("Any date")).toHaveLength(1);
    expect(text("aggregate-summary")).toMatch(/^1 match of the 2 /);

    fireEvent.click(screen.getByRole("button", { name: "Clear played until" }));
    expect(filters.querySelector('input[type="date"]')).toBeNull();
    expect(within(filters).getAllByText("Any date")).toHaveLength(2);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /Played until/ }),
    );
    expect(text("aggregate-summary")).toMatch(/^All 2 matches /);
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
    expect(
      help().getByText(/2 remixes are left out, so each match counts once/),
    ).toBeTruthy();
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
    show([record({ filename: "x.sdfz", mapName: "Some Map Redux" })]);
    expect(text("map-aggregate")).toMatch(
      /No match on this map is in your library yet/,
    );
    expect(asked).not.toHaveBeenCalled();
    expect(screen.queryByTestId("aggregate-filters")).toBeNull();
  });

  it("says so when the filters leave no match", async () => {
    show(twoMatches());
    await settled();
    fireEvent.click(screen.getByRole("button", { name: /Played until/ }));
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

describe("versions of the map", () => {
  /** One match on each of three names: this page's map, a later version of
   *  it, and a third. The first two have a start each. */
  function versions(): StatRecord[] {
    const grid = (x: number) => ({
      starts: [{ team: 0, x, z: 2000 }],
      orders: layer([[50 * 256 + 50, 0, 10]]),
    });
    GRIDS = {
      "/demos/a.sdfz": { gameId: "aa", ...grid(1000) },
      "/demos/b.sdfz": { gameId: "bb", ...grid(3000) },
      "/demos/c.sdfz": { gameId: "cc", ...grid(5000) },
      "/demos/d.sdfz": { gameId: "dd", ...grid(6000) },
    };
    return [
      record({ filename: "a.sdfz", gameId: "aa" }),
      record({ filename: "b.sdfz", gameId: "bb", mapName: "Some Map 1.1" }),
      record({ filename: "c.sdfz", gameId: "cc", mapName: "Some Map 1.1" }),
      record({ filename: "d.sdfz", gameId: "dd", mapName: "Some Map v2" }),
    ];
  }
  const boxes = (id: string) =>
    [...screen.getByTestId(id).querySelectorAll("button[role=checkbox]")].map(
      (b) => b.getAttribute("aria-checked"),
    );

  it("lists each version with its count, marks the page's own and has them all in", async () => {
    show(versions());
    await settled();
    const list = screen.getByTestId("map-versions");
    expect(list.textContent).toMatch(/Some Map 1\.01 match, this page's map/);
    expect(list.textContent).toMatch(/Some Map 1\.12 matches/);
    expect(list.textContent).toMatch(/Some Map v21 match/);
    expect(boxes("map-versions")).toEqual(["true", "true", "true"]);
    expect(text("aggregate-summary")).toMatch(/^All 4 matches /);
    expect(text("layer-starts")).toBe("Start positions · 4");
  });

  it("says over the picture and over the records how many versions they span", async () => {
    show(versions());
    await settled();
    expect(text("versions-picture")).toBe("Across 3 versions of this map");
    expect(text("versions-records")).toBe("Across 3 versions of this map");
    expect(
      help().getByText(
        /every start is placed on Some Map 1\.0, this page's map/,
      ),
    ).toBeTruthy();
  });

  it("says the grouping is by name and not by archive", async () => {
    show(versions());
    await settled();
    expect(
      help().getByText(
        /grouped by the map's name with a trailing version taken off, and not by the map's archive/,
      ),
    ).toBeTruthy();
  });

  it("follows the versions that are switched off, in every count", async () => {
    show(versions());
    await settled();
    const [, v11] = screen
      .getByTestId("map-versions")
      .querySelectorAll("button[role=checkbox]");
    fireEvent.click(v11);
    await settled();
    expect(boxes("map-versions")).toEqual(["true", "false", "true"]);
    expect(text("aggregate-summary")).toMatch(
      /^2 matches of the 4 on this map in your library are in this picture\./,
    );
    expect(text("layer-starts")).toBe("Start positions · 2");
    expect(text("layer-orders")).toBe("Order density · 2");
    expect(text("versions-picture")).toBe("Across 2 versions of this map");
    expect(text("records-played")).toMatch(/^2 matches played/);
    // The switched off version still shows what it would add.
    expect(text("map-versions")).toMatch(/Some Map 1\.12 matches/);
  });

  it("drops the line when one version is left, and puts them all back on clear", async () => {
    show(versions());
    await settled();
    const [a, b, c] = screen
      .getByTestId("map-versions")
      .querySelectorAll("button[role=checkbox]");
    fireEvent.click(b);
    fireEvent.click(c);
    await settled();
    expect(screen.queryByTestId("versions-picture")).toBeNull();
    expect(screen.queryByTestId("versions-records")).toBeNull();
    fireEvent.click(a);
    expect(text("map-aggregate")).toMatch(/No match on this map passes/);
    fireEvent.click(screen.getByText("Clear filters"));
    expect(boxes("map-versions")).toEqual(["true", "true", "true"]);
  });

  it("leaves out a version known to be another size, says why, and takes it back when asked", async () => {
    show(versions(), false, {
      mapSizes: {
        "Some Map 1.0": { width: 16, height: 16 },
        "Some Map 1.1": { width: 16, height: 16 },
        "Some Map v2": { width: 32, height: 16 },
      },
    });
    await settled();
    expect(boxes("map-versions")).toEqual(["true", "true", "false"]);
    expect(text("map-versions")).toMatch(
      /Some Map v21 match, a different size from this page's map, so it is left out/,
    );
    expect(text("layer-starts")).toBe("Start positions · 3");
    fireEvent.click(
      screen
        .getByTestId("map-versions")
        .querySelectorAll("button[role=checkbox]")[2],
    );
    await settled();
    expect(text("layer-starts")).toBe("Start positions · 4");
  });

  it("says a version that is not installed has no size to compare", async () => {
    show(versions());
    await settled();
    expect(
      help().getByText(
        /not installed has no size to compare, because a replay does not record the size/,
      ),
    ).toBeTruthy();
  });

  it("leaves another map's matches out and the list off when there is one name", async () => {
    show([
      record({ filename: "a.sdfz", gameId: "aa" }),
      record({ filename: "x.sdfz", gameId: "xx", mapName: "Some Map Redux" }),
    ]);
    await settled();
    expect(screen.queryByTestId("map-versions")).toBeNull();
    expect(screen.queryByTestId("versions-picture")).toBeNull();
    expect(text("aggregate-summary")).toMatch(/^The 1 match on this map/);
  });

  it("switches games and versions the same way, with a count each", async () => {
    show(twoMatches());
    await settled();
    expect(text("game-versions")).toMatch(/Some Game 1\.01 match/);
    expect(text("game-versions")).toMatch(/Some Game 2\.01 match/);
    expect(boxes("game-versions")).toEqual(["true", "true"]);
    fireEvent.click(
      screen
        .getByTestId("game-versions")
        .querySelectorAll("button[role=checkbox]")[1],
    );
    await settled();
    expect(boxes("game-versions")).toEqual(["true", "false"]);
    expect(text("aggregate-summary")).toMatch(/^1 match of the 2 /);
    expect(text("layer-orders")).toBe("Order density · 1");
    fireEvent.click(screen.getByText("Clear filters"));
    expect(boxes("game-versions")).toEqual(["true", "true"]);
  });
});

describe("the section's explanation", () => {
  it("keeps explanation out of the page until the help is opened", async () => {
    show(twoMatches());
    await settled();
    const gone = [
      /grouped by the map's name/,
      /how many matches it is drawn from/,
      /Each match counts the same/,
      /A dot is where one team's start was set/,
      /Colours compare places on this map/,
      /Nothing here tests whether a difference/,
      /Team 1 is the team with the lower number/,
      /Every player counts in the faction record/,
      /From the orders and messages recorded during the match/,
    ];
    for (const pattern of gone) expect(screen.queryByText(pattern)).toBeNull();
    const said = help();
    for (const pattern of gone) expect(said.getByText(pattern)).toBeTruthy();
    expect(
      said.getByText(/orders given, which is what players meant to do/),
    ).toBeTruthy();
  });

  it("gives the deaths layer the playback source and says where deaths come from", async () => {
    show(twoMatches());
    await settled();
    fireEvent.click(screen.getByTestId("layer-deaths"));
    const said = help();
    expect(said.getByText(/From playing the match back/)).toBeTruthy();
    expect(said.getByText(/run from a replay's own page/)).toBeTruthy();
    expect(screen.queryByText(/run from a replay's own page/)).not.toBeNull();
  });

  it("keeps the counts, the warnings and the empty states in the page", async () => {
    const records = [
      ...twoMatches(),
      record({ filename: "a.remix.sdfz", gameId: "aa", remixed: true }),
    ];
    GRIDS["/demos/b.sdfz"] = new Error("read demo: gone");
    show(records);
    await settled();
    expect(text("starts-note")).toBe("2 starts from 1 match.");
    expect(text("layer-events")).toBe(
      "4 orders to place a building, from 1 match.",
    );
    expect(text("layer-orders")).toBe("Order density · 1");
    expect(text("map-aggregate")).toMatch(
      /1 replay could not be read and is not in the picture/,
    );
    fireEvent.click(screen.getByTestId("layer-deaths"));
    expect(text("no-analysis")).toBe(
      "No match on this map in the picture has been analysed, so there are no deaths to draw.",
    );
    expect(text("map-aggregate")).not.toMatch(/remix/);
  });

  it("keeps the different build warning and a short layout warning in the page", async () => {
    UNITS = {
      "Some Game 1.0": [
        { mobile: false, buildOptions: [], stats: { weapons: [{}] } },
      ],
    };
    show(twoMatches());
    await settled();
    fireEvent.click(screen.getByTestId("layer-defence"));
    await waitFor(() =>
      expect(text("category-note")).toMatch(
        /^1 match was played on a game or version that is not installed/,
      ),
    );
    expect(text("category-note")).not.toMatch(/What a building is for/);
    expect(
      help().getByText(/What a building is for is read from/),
    ).toBeTruthy();
  });

  it("says in the page that a version can differ in layout", async () => {
    GRIDS = {
      "/demos/a.sdfz": { gameId: "aa" },
      "/demos/b.sdfz": { gameId: "bb" },
    };
    show([
      record({ filename: "a.sdfz", gameId: "aa" }),
      record({ filename: "b.sdfz", gameId: "bb", mapName: "Some Map 1.1" }),
    ]);
    await settled();
    expect(text("version-layout-warning")).toMatch(/may be in the wrong place/);
    expect(screen.queryByText(/a version that moved things/)).toBeNull();
    expect(help().getByText(/a version that moved things/)).toBeTruthy();
  });

  it("says why there is nothing, with the remix count, when the map has no match", () => {
    show([record({ filename: "r.sdfz", gameId: "rr", remixed: true })]);
    expect(text("map-aggregate")).toMatch(
      /No match on this map is in your library yet\. 1 remix is here/,
    );
  });
});
