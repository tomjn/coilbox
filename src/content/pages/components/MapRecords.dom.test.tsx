// @vitest-environment happy-dom
/**
 * What the library knows about a map (#1162, #1163), as the map's page shows
 * it under the picture: tables of counts, numbered marks that match the rows,
 * and the sentences that say what was left out. The sums are
 * `mapRecords.test.ts`. No percentage is asserted because none is shown.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapCountLayer, ReplayMapGrids, StatRecord } from "../../bindings";
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
  useSetting: (key: string, fallback: unknown) => {
    const [value, set] = useState<unknown>(SETTINGS[key] ?? fallback);
    return [
      value,
      (next: unknown) => {
        SETTINGS[key] = next;
        set(next);
      },
    ];
  },
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

const DECLARED = [
  { x: 1000, z: 1000 },
  { x: 3000, z: 1000 },
];

/** A match of two teams. Team 0 starts at `a` and team 1 at `b`. `winner` is
 *  the winning ally team, or null for no result. */
function duel(
  name: string,
  winner: 0 | 1 | null,
  a: [number, number] = [1000, 1000],
  b: [number, number] = [3000, 1000],
  over: Partial<StatRecord> = {},
): StatRecord {
  GRIDS[`/demos/${name}.sdfz`] = {
    gameId: name,
    starts: [
      { team: 0, x: a[0], z: a[1] },
      { team: 1, x: b[0], z: b[1] },
    ],
  };
  return record({
    filename: `${name}.sdfz`,
    gameId: name,
    winnersKnown: winner !== null,
    winningAllyTeams: winner === null ? [] : [winner],
    ...over,
  });
}

function show(
  records: StatRecord[],
  declared: { x: number; z: number }[] = DECLARED,
) {
  return render(
    <MapAggregate
      mapName={MAP}
      world={WORLD}
      minimapUrl="data:image/png;base64,AAAA"
      records={records}
      ingesting={false}
      scene={null}
      declared={declared}
    />,
  );
}

const text = (id: string) => screen.getByTestId(id).textContent ?? "";
const settled = () =>
  waitFor(() =>
    expect(text("aggregate-summary")).not.toMatch(/Reading replays/),
  );
const cells = (id: string) =>
  [...screen.getByTestId(id).querySelectorAll("td")].map(
    (c) => c.textContent ?? "",
  );

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

/** Three duels on two declared positions. */
function threeDuels(): StatRecord[] {
  return [
    duel("a", 0),
    duel("b", 1),
    duel("c", null, undefined, undefined, {
      startTimeMs: new Date(2026, 6, 20, 12).getTime(),
    }),
  ];
}

describe("start positions", () => {
  it("counts each declared position with its sample, split by team, as counts", async () => {
    show(threeDuels());
    await settled();
    await waitFor(() => screen.getByTestId("start-row-1"));
    // Position 1 is team 1's start in all three matches. It won in a, lost in
    // b, and c has no result.
    expect(cells("start-row-1")).toEqual([
      "1",
      "",
      "Declared by the map",
      "3",
      "won 1 of 2",
      "3 taken, won 1 of 2",
      "not taken",
    ]);
    expect(cells("start-row-2")).toEqual([
      "2",
      "",
      "Declared by the map",
      "3",
      "won 1 of 2",
      "not taken",
      "3 taken, won 1 of 2",
    ]);
    expect(text("starts-basis")).toMatch(/within 1,000 elmos of a position/);
    expect(text("starts-basis")).toMatch(/team of one/);
    expect(text("map-records")).not.toMatch(/%/);
  });

  it("draws a numbered mark on each position, matching the rows", async () => {
    const { container } = show(threeDuels());
    await settled();
    await waitFor(() => screen.getByTestId("start-mark-1"));
    const mark = (n: number) => screen.getByTestId(`start-mark-${n}`);
    expect(mark(1).textContent).toBe("1");
    expect(mark(1).style.left).toBe(`${(1000 / 8192) * 100}%`);
    expect(mark(1).style.top).toBe(`${(1000 / 8192) * 100}%`);
    expect(mark(2).style.left).toBe(`${(3000 / 8192) * 100}%`);
    const marks = container.querySelectorAll('[data-layer="start-places"]');
    expect(marks).toHaveLength(2);
    const rows = [...screen.getByTestId("start-table").querySelectorAll("tr")]
      .slice(1)
      .map((r) => r.querySelector("td")?.textContent);
    expect(rows.sort()).toEqual(["1", "2"]);
  });

  it("groups starts on a map that declares no position and numbers the groups", async () => {
    show(
      [
        duel("a", 0, [5000, 5000], [7000, 1000]),
        duel("b", 1, [5050, 5000], [7000, 1000]),
      ],
      [],
    );
    await settled();
    await waitFor(() => screen.getByTestId("start-row-1"));
    // The group with the most starts is number 1 and holds two of each.
    expect(cells("start-row-1").slice(0, 5)).toEqual([
      "1",
      "",
      "Around 5,025, 5,000, within 25 elmos",
      "2",
      "won 1 of 2",
    ]);
    expect(cells("start-row-2").slice(2, 4)).toEqual([
      "Around 7,000, 1,000",
      "2",
    ]);
    expect(text("starts-basis")).toMatch(/within 256 elmos of one another/);
    expect(text("starts-basis")).toMatch(/Nothing measured says that suits/);
    expect(screen.getByTestId("start-mark-1")).toBeTruthy();
  });

  it("says plainly that positions are not split by team in a free for all", async () => {
    GRIDS["/demos/f.sdfz"] = {
      gameId: "f",
      starts: [
        { team: 0, x: 1000, z: 1000 },
        { team: 1, x: 3000, z: 1000 },
        { team: 2, x: 5000, z: 5000 },
      ],
    };
    const ffa = record({
      filename: "f.sdfz",
      gameId: "f",
      winnersKnown: true,
      winningAllyTeams: [2],
      players: [0, 1, 2].map((t) => ({
        name: `P${t}`,
        team: t,
        allyTeam: t,
        spectator: false,
      })),
    });
    show([ffa]);
    await settled();
    await waitFor(() => screen.getByTestId("start-table"));
    expect(screen.queryByText("As team 1")).toBeNull();
    expect(text("starts-basis")).toMatch(/every player is a team of one/);
    expect(text("starts-basis")).toMatch(/not controlled for how many players/);
  });

  it("does not split by team when the matches are mixed arrangements", async () => {
    GRIDS["/demos/f.sdfz"] = {
      gameId: "f",
      starts: [{ team: 0, x: 1000, z: 1000 }],
    };
    const ffa = record({
      filename: "f.sdfz",
      gameId: "f",
      players: [0, 1, 2].map((t) => ({
        name: `P${t}`,
        team: t,
        allyTeam: t,
        spectator: false,
      })),
    });
    show([duel("a", 0), ffa]);
    await settled();
    await waitFor(() => screen.getByTestId("start-table"));
    expect(screen.queryByText("As team 1")).toBeNull();
    expect(text("starts-basis")).toMatch(/not all one arrangement/);
  });

  it("counts what could not be joined, and why", async () => {
    // An old record has no team ids, so its starts cannot be put to a result.
    GRIDS["/demos/old.sdfz"] = {
      gameId: "old",
      starts: [{ team: 0, x: 1000, z: 1000 }],
    };
    const old = record({
      filename: "old.sdfz",
      gameId: "old",
      players: [
        { name: "One", allyTeam: 0, spectator: false },
        { name: "Two", allyTeam: 1, spectator: false },
      ],
    });
    // A match whose replay recorded no start.
    GRIDS["/demos/none.sdfz"] = { gameId: "none", starts: [] };
    const none = record({ filename: "none.sdfz", gameId: "none" });
    show([duel("a", 0), old, none]);
    await settled();
    await waitFor(() => screen.getByTestId("starts-left-out"));
    expect(text("starts-left-out")).toBe(
      "Left out: 1 match saved before team numbers were kept, which a start cannot be matched to a result through until the library is read again. 1 match with no start recorded.",
    );
    // The match that could be joined is counted, and the old one is not.
    expect(cells("start-row-1")[3]).toBe("1");
  });
});

describe("what the library knows about the map", () => {
  it("says how many matches have a result and which team won, as counts", async () => {
    show(threeDuels());
    await settled();
    expect(text("records-played")).toMatch(
      /^3 matches played, 2 with a recorded result\./,
    );
    expect(text("team-record")).toMatch(
      /Team 1 won 1 of 2, team 2 won 1 of 2, in 2 matches of two teams with a result\. 1 more has no result\./,
    );
  });

  it("sets the map's length beside the rest of the library, each with its count", async () => {
    const elsewhere = [600, 1000, 1400].map((s, i) =>
      record({
        filename: `o${i}.sdfz`,
        gameId: `o${i}`,
        mapName: "Other Map",
        durationSec: s,
      }),
    );
    show([duel("a", 0), duel("b", 1), ...elsewhere]);
    await settled();
    expect(cells("length-here")).toEqual([
      "This map",
      "2",
      "20:00",
      "20:00",
      "20:00",
    ]);
    expect(cells("length-rest")).toEqual([
      "Every other map",
      "3",
      "16:40",
      "10:00",
      "23:20",
    ]);
    expect(text("length-record")).toMatch(
      /Nothing here tests whether a difference/,
    );
  });

  it("counts which factions won with every player, and says it is confounded", async () => {
    const played = (name: string, winner: 0 | 1, a: string, b: string) =>
      duel(name, winner, undefined, undefined, {
        players: [
          {
            name: "One",
            team: 0,
            allyTeam: 0,
            side: a,
            spectator: false,
            won: winner === 0,
          },
          {
            name: "Two",
            team: 1,
            allyTeam: 1,
            side: b,
            spectator: false,
            won: winner === 1,
          },
        ],
      });
    show([
      played("a", 0, "Alpha", "Beta"),
      played("b", 0, "Alpha", "Beta"),
      played("c", 1, "Alpha", "Beta"),
    ]);
    await settled();
    await waitFor(() => screen.getByTestId("faction-table"));
    const rows = [...screen.getByTestId("faction-table").querySelectorAll("tr")]
      .slice(1)
      .map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent));
    expect(rows).toEqual([
      ["Alpha", "3", "won 2 of 3"],
      ["Beta", "3", "won 1 of 3"],
    ]);
    expect(text("faction-record")).toMatch(
      /not separated from the team it was on/,
    );
  });

  it("follows the filters, so a narrower set changes every figure", async () => {
    show(threeDuels());
    await settled();
    await waitFor(() => screen.getByTestId("start-row-1"));
    fireEvent.change(screen.getByLabelText("Played from"), {
      target: { value: "2026-07-01" },
    });
    // Only match c is left, and it has no result.
    await waitFor(() =>
      expect(text("records-played")).toMatch(
        /^1 match played, 0 with a recorded result/,
      ),
    );
    expect(cells("start-row-1").slice(3, 5)).toEqual(["1", "no result"]);
    expect(text("team-record")).toMatch(
      /The one match of two teams has no recorded result, so neither team has a record\./,
    );
  });

  it("shows the empty state, and no records, when the filters leave nothing", async () => {
    show(threeDuels());
    await settled();
    fireEvent.change(screen.getByLabelText("Played from"), {
      target: { value: "2030-01-01" },
    });
    await waitFor(() =>
      screen.getByText("No match on this map passes these filters."),
    );
    expect(screen.queryByTestId("map-records")).toBeNull();
  });

  it("leaves a refight out of the picture and the records", async () => {
    render(
      <MapAggregate
        mapName={MAP}
        world={WORLD}
        minimapUrl={undefined}
        records={threeDuels()}
        ingesting={false}
        scene={null}
        declared={DECLARED}
        refights={new Set(["b.sdfz"])}
      />,
    );
    await settled();
    expect(text("records-played")).toMatch(/^2 matches played/);
    expect(text("aggregate-summary")).toMatch(/All 2 matches/);
    expect(document.body.textContent).toMatch(/1 refight is left out/);
  });
});

describe("names for start positions", () => {
  const NAMES = "content.mapPositionNames";
  const stored = () =>
    (SETTINGS[NAMES] as Record<string, unknown[]> | undefined)?.[MAP];
  const box = (n: number) =>
    screen.getByLabelText(`Name for place ${n}`) as HTMLInputElement;
  const type = (n: number, value: string, key = "Enter") => {
    fireEvent.change(box(n), { target: { value } });
    fireEvent.keyDown(box(n), { key });
  };
  const marks = (n: number) => screen.getAllByTestId(`start-mark-${n}`);

  async function open() {
    show(threeDuels());
    await settled();
    await waitFor(() => screen.getByTestId("start-row-1"));
  }

  it("names a declared position with Enter, and stores it with its key and centre", async () => {
    await open();
    type(1, "  Front  ");
    expect(stored()).toEqual([{ key: "d1", name: "Front", x: 1000, z: 1000 }]);
    expect(box(1).value).toBe("Front");
    // The minimap mark carries the name as a label and on hover.
    expect(marks(1)[0].textContent).toBe("1Front");
    expect(marks(1)[0].getAttribute("title")).toBe("Front");
    expect(marks(2)[0].getAttribute("title")).toBeNull();
  });

  it("keeps what was typed when the box is left", async () => {
    await open();
    fireEvent.change(box(2), { target: { value: "Back" } });
    fireEvent.blur(box(2));
    expect(stored()).toEqual([{ key: "d2", name: "Back", x: 3000, z: 1000 }]);
  });

  it("puts the old name back on Escape and stores nothing", async () => {
    await open();
    box(1).focus();
    type(1, "Front");
    box(1).focus();
    fireEvent.change(box(1), { target: { value: "Changed" } });
    fireEvent.keyDown(box(1), { key: "Escape" });
    expect(box(1).value).toBe("Front");
    expect(stored()).toEqual([{ key: "d1", name: "Front", x: 1000, z: 1000 }]);
  });

  it("renames in place, and clears a name that is emptied", async () => {
    await open();
    type(1, "Front");
    type(1, "Ridge");
    expect(stored()?.map((e) => (e as { name: string }).name)).toEqual([
      "Ridge",
    ]);
    type(1, "   ");
    expect(stored()).toBeUndefined();
    expect(box(1).value).toBe("");
    expect(marks(1)[0].textContent).toBe("1");
  });

  it("shows a name that was stored earlier", async () => {
    SETTINGS[NAMES] = {
      [MAP]: [{ key: "d2", name: "Hill", x: 3000, z: 1000 }],
    };
    await open();
    expect(box(2).value).toBe("Hill");
    expect(marks(2)[0].textContent).toBe("2Hill");
  });

  it("counts two positions as one row when they have the same name", async () => {
    await open();
    type(1, "Edge");
    type(2, "edge");
    // Both teams' starts are in one row of six, with a mark for each place.
    expect(screen.queryByTestId("start-row-2")).toBeNull();
    expect(cells("start-row-1").slice(2, 4)).toEqual([
      "2 places with this name",
      "6",
    ]);
    expect(marks(1)).toHaveLength(2);
    expect(marks(1).map((m) => m.textContent)).toEqual(["1Edge", "1Edge"]);
    expect(box(1).value).toBe("Edge");
    // Emptying the shared name takes it off both and splits the row again.
    type(1, "");
    expect(stored()).toBeUndefined();
    expect(screen.getByTestId("start-row-2")).toBeTruthy();
  });

  it("finds a group's name by the nearest centre when its key is no longer there", async () => {
    // No declared positions, so the starts are grouped. 5025 is cell 19 on a
    // grid of 256, and the name was given when the group was in cell 18.
    SETTINGS[NAMES] = {
      [MAP]: [{ key: "c18:19", name: "Mid", x: 4990, z: 5000 }],
    };
    show(
      [
        duel("a", 0, [5000, 5000], [7000, 1000]),
        duel("b", 1, [5050, 5000], [7000, 1000]),
      ],
      [],
    );
    await settled();
    await waitFor(() => screen.getByTestId("start-row-1"));
    expect(box(1).value).toBe("Mid");
    expect(screen.queryByTestId("orphan-names")).toBeNull();
  });

  it("lists a name with no position, keeps it, and deletes it only when asked", async () => {
    SETTINGS[NAMES] = {
      [MAP]: [{ key: "c1:1", name: "Lost lake", x: 300, z: 300 }],
    };
    await open();
    const list = screen.getByTestId("orphan-names");
    expect(list.textContent).toMatch(/Lost lake/);
    expect(list.textContent).toMatch(/was around 300, 300/);
    // Naming another place does not drop it.
    type(1, "Front");
    expect(stored()?.map((e) => (e as { name: string }).name)).toEqual([
      "Lost lake",
      "Front",
    ]);
    fireEvent.click(screen.getByLabelText("Delete the name Lost lake"));
    expect(stored()?.map((e) => (e as { name: string }).name)).toEqual([
      "Front",
    ]);
    expect(screen.queryByTestId("orphan-names")).toBeNull();
  });

  it("does not list a name as lost while the replays are still being read", async () => {
    SETTINGS[NAMES] = {
      [MAP]: [{ key: "d1", name: "Hill", x: 1000, z: 1000 }],
    };
    show(threeDuels());
    expect(screen.queryByTestId("orphan-names")).toBeNull();
    await settled();
  });

  it("shows a name as text and never as markup", async () => {
    const { container } = show(threeDuels());
    await settled();
    await waitFor(() => screen.getByTestId("start-row-1"));
    type(1, '<img src="x" onerror="alert(1)">');
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(marks(1)[0].textContent).toBe('1<img src="x" onerror="alert(1)">');
  });

  it("says the names are the player's own and kept for this exact map", async () => {
    await open();
    expect(text("starts-basis")).toMatch(
      /Names are yours, kept on this computer for Some Map 1\.0 by its exact name/,
    );
  });
});
