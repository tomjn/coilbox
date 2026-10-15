import { describe, expect, it } from "vitest";
import { buildHeatField } from "@/lib/heatField";
import type {
  BuildOrder,
  DemoInfo,
  DemoTrailer,
  UnitDatasetEntry,
} from "./bindings";
import { colorSeries, teamSeries } from "./matchStats";
import {
  buildingHeatPoints,
  buildMarks,
  mapFraction,
  NEUTRAL_TEAM_COLOUR,
  openingsByTeam,
  startDotName,
  startDots,
  teamColours,
} from "./replayMapLayers";

const swatch = (rgb?: [number, number, number]) =>
  rgb ? `rgb(${rgb.map((v) => Math.round(v * 255)).join(", ")})` : undefined;

const info = (over: Partial<DemoInfo>): DemoInfo =>
  ({
    players: [],
    ais: [],
    allyTeams: [],
    winningAllyTeams: [],
    winnersKnown: false,
    ...over,
  }) as DemoInfo;

const order = (over: Partial<BuildOrder>): BuildOrder => ({
  frame: 0,
  player: 0,
  team: 0,
  origin: { kind: "selection" },
  unitDefId: 1,
  count: 1,
  slot: { kind: "append" },
  builders: 1,
  options: 0,
  ...over,
});

/**
 * Numbers read off real replays in the library on 10 October 2026, so the
 * placing is held against something that was not worked out from this code.
 */
describe("where a world position is drawn, against real replays", () => {
  it("puts a real start inside its own side's start box, and its mirror in the other side's", () => {
    // A 10 player match on a map of 8192 by 6144 elmos. One side's box is the
    // east strip from 83% across, the other's the west strip up to 17%. The
    // team that started at x 6812 is on the east side.
    const world = { worldWidth: 8192, worldHeight: 6144 };
    const east = { left: 0.83, top: 0, right: 1, bottom: 1 };
    const west = { left: 0, top: 0, right: 0.17, bottom: 1 };
    const inside = (
      at: { left: number; top: number },
      box: typeof east,
    ): boolean =>
      at.left >= box.left &&
      at.left <= box.right &&
      at.top >= box.top &&
      at.top <= box.bottom;

    const at = mapFraction({ x: 6812, z: 4030 }, world);
    expect(at?.left).toBeCloseTo(0.8315, 4);
    expect(at?.top).toBeCloseTo(0.6559, 4);
    expect(inside(at as NonNullable<typeof at>, east)).toBe(true);
    expect(inside(at as NonNullable<typeof at>, west)).toBe(false);
    // Mirrored east to west it would sit in the enemy's box, which is the
    // mistake this test exists to catch.
    const mirrored = { left: 1 - (at?.left ?? 0), top: at?.top ?? 0 };
    expect(inside(mirrored, west)).toBe(true);
  });

  it("puts fixed starts where the map page draws the map's own start positions", () => {
    // A 4 player match with fixed starts on a map of 7168 by 10240 elmos. The
    // map page draws the map's declared positions 3, 1, 2 and 4 at these
    // percentages, and the replay's recorded starts are the same four places.
    const world = { worldWidth: 7168, worldHeight: 10240 };
    const pairs: [{ x: number; z: number }, [number, number]][] = [
      [{ x: 3200, z: 2000 }, [44.642857, 19.53125]],
      [{ x: 4600, z: 2000 }, [64.174107, 19.53125]],
      [{ x: 2600, z: 8220 }, [36.272321, 80.273438]],
      [{ x: 4000, z: 8220 }, [55.803571, 80.273438]],
    ];
    for (const [pos, [left, top]] of pairs) {
      const at = mapFraction(pos, world);
      expect((at?.left ?? 0) * 100).toBeCloseTo(left, 5);
      expect((at?.top ?? 0) * 100).toBeCloseTo(top, 5);
    }
    // The map declares no position at the north to south mirror of the third
    // pair, so a flipped z would have matched nothing.
    expect(
      (mapFraction({ x: 2600, z: 10240 - 8220 }, world)?.top ?? 0) * 100,
    ).toBeCloseTo(19.726563, 5);
  });

  it("drops a position off the map, and any position on a map with no size", () => {
    const world = { worldWidth: 4096, worldHeight: 4096 };
    expect(mapFraction({ x: -1, z: 10 }, world)).toBeNull();
    expect(mapFraction({ x: 10, z: 4097 }, world)).toBeNull();
    expect(mapFraction({ x: 0, z: 4096 }, world)).toEqual({ left: 0, top: 1 });
    expect(
      mapFraction({ x: 10, z: 10 }, { worldWidth: 0, worldHeight: 0 }),
    ).toBeNull();
  });
});

const TWO_SEATS = info({
  players: [
    {
      name: "Alice",
      team: 0,
      allyTeam: 0,
      spectator: false,
      rgbColor: [1, 0, 0],
    },
    {
      name: "Bob",
      team: 1,
      allyTeam: 1,
      spectator: false,
      rgbColor: [0, 0, 1],
    },
    { name: "Watcher", team: 0, spectator: true },
  ] as DemoInfo["players"],
  ais: [
    { name: "AI 1", shortName: "TestAI", team: 2, allyTeam: 1 },
  ] as DemoInfo["ais"],
  startPositions: [
    { team: 0, x: 1024, y: 50, z: 512 },
    { team: 1, x: 3072, y: 50, z: 3584 },
    { team: 2, x: 9999, y: 0, z: 100 },
  ],
});

const WORLD = { worldWidth: 4096, worldHeight: 4096 };

describe("start dots", () => {
  const colours = new Map([
    [0, "#111111"],
    [1, "#222222"],
  ]);

  it("draws one per recorded start, named for who controls the team", () => {
    const dots = startDots(TWO_SEATS, WORLD, colours, 1, new Map());
    // The AI's start is off the map and is dropped.
    expect(dots.map((d) => d.team)).toEqual([0, 1]);
    expect(dots[0]).toMatchObject({
      left: 0.25,
      top: 0.125,
      names: ["Alice"],
      colour: "#111111",
      isMe: false,
      opening: null,
    });
    expect(dots[1]).toMatchObject({ left: 0.75, top: 0.875, isMe: true });
  });

  it("draws nothing for a replay with no stream", () => {
    const none = info({ players: TWO_SEATS.players });
    expect(startDots(none, WORLD, colours, undefined, new Map())).toEqual([]);
  });

  it("names every seat on a shared team, and says so when there is none", () => {
    expect(startDotName({ names: ["Alice", "Carol"] })).toBe("Alice, Carol");
    expect(startDotName({ names: [] })).toBe("Unnamed player");
  });

  it("carries what the team opened with", () => {
    const dots = startDots(
      TWO_SEATS,
      WORLD,
      colours,
      undefined,
      new Map([[0, "Land Factory"]]),
    );
    expect(dots[0].opening).toBe("Land Factory");
    expect(dots[1].opening).toBeNull();
  });
});

describe("a team's colour", () => {
  it("is the roster's swatch when there are no statistics", () => {
    const colours = teamColours(TWO_SEATS, null, null, "dark", swatch);
    expect(colours.get(0)).toBe("rgb(255, 0, 0)");
    expect(colours.get(1)).toBe("rgb(0, 0, 255)");
    // The AI's seat has no colour recorded.
    expect(colours.get(2)).toBe(NEUTRAL_TEAM_COLOUR);
  });

  it("is the chart line's colour when there are, in either mode", () => {
    const sample = { frame: 0 } as DemoTrailer["teams"][number]["samples"][0];
    const trailer = {
      teams: [
        { team: 0, samples: [sample] },
        { team: 1, samples: [sample] },
      ],
    } as DemoTrailer;
    for (const mode of ["palette", "game"] as const) {
      const lines = colorSeries(
        teamSeries(trailer, TWO_SEATS),
        trailer,
        TWO_SEATS,
        mode,
        "dark",
      );
      const colours = teamColours(TWO_SEATS, trailer, mode, "dark", swatch);
      expect(colours.get(0)).toBe(lines[0].color);
      expect(colours.get(1)).toBe(lines[1].color);
      expect(lines[0].color).not.toBe(lines[1].color);
    }
  });
});

const UNITS = [
  { name: "mex", fullName: "Metal Extractor", stats: { extractsMetal: 1 } },
  {
    name: "factory",
    fullName: "Land Factory",
    buildOptions: ["tank"],
    stats: { builder: true },
  },
  { name: "odd" },
] as unknown as UnitDatasetEntry[];

describe("building marks", () => {
  const orders = [
    order({ team: 0, unitDefId: 1, position: { x: 1024, y: 0, z: 2048 } }),
    order({ team: 1, unitDefId: 2, position: { x: 4096, y: 0, z: 0 } }),
    order({ team: 0, unitDefId: 2, count: 5 }),
    order({ team: 0, unitDefId: 3, position: { x: 5000, y: 0, z: 10 } }),
    order({ team: 0, unitDefId: 99, position: { x: 10, y: 0, z: 10 } }),
  ];

  it("draws only placed buildings on the map, and counts the rest", () => {
    const built = buildMarks(orders, WORLD, UNITS);
    expect(built.unplaced).toBe(1);
    expect(built.offMap).toBe(1);
    expect(built.marks).toEqual([
      { left: 0.25, top: 0.5, team: 0, category: "economy" },
      { left: 1, top: 0, team: 1, category: "factory" },
      // An id the dataset does not reach has no category to claim.
      expect.objectContaining({ team: 0, category: "unclassified" }),
    ]);
  });

  it("gives no category at all when no game can name the units", () => {
    const built = buildMarks(orders, WORLD, null);
    expect(built.marks.every((m) => m.category === null)).toBe(true);
    expect(built.marks).toHaveLength(3);
  });

  it("keeps a re-issued order as two marks on one spot", () => {
    const twice = [orders[0], orders[0]];
    expect(buildMarks(twice, WORLD, UNITS).marks).toHaveLength(2);
  });
});

describe("the density of buildings ordered", () => {
  it("is hottest where the marks are thickest and empty where there are none", () => {
    const at = (x: number, z: number) => order({ position: { x, y: 0, z } });
    const orders = [
      at(1000, 1000),
      at(3000, 3000),
      at(3010, 3020),
      at(2990, 3010),
      order({ count: 20 }),
    ];
    const points = buildingHeatPoints(orders);
    expect(points.positions).toHaveLength(8);
    const field = buildHeatField(points, WORLD);
    expect(field.counted).toBe(4);
    expect(field.peakWithinRadius).toBe(3);
    expect(field.peakAt?.x).toBeGreaterThan(2900);
    expect(field.peakAt?.z).toBeGreaterThan(2900);
  });
});

describe("what a team opened with", () => {
  const orders = [
    order({ team: 0, unitDefId: 1, frame: 10 }),
    order({ team: 0, unitDefId: 1, frame: 20 }),
    order({ team: 0, unitDefId: 2, frame: 30 }),
    order({ team: 1, unitDefId: 2, frame: 5 }),
    order({ team: 2, unitDefId: 99, frame: 5 }),
  ];

  it("names the first folded entry of each team", () => {
    const openings = openingsByTeam(orders, UNITS);
    expect(openings.get(0)).toBe("Metal Extractor ×2");
    expect(openings.get(1)).toBe("Land Factory");
    expect(openings.has(2)).toBe(false);
  });

  it("names nothing when the game is not installed", () => {
    expect(openingsByTeam(orders, null).size).toBe(0);
  });
});
