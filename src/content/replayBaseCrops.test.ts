import { describe, expect, it } from "vitest";
import type { BuildOrder, DemoInfo, UnitDatasetEntry } from "./bindings";
import {
  baseCrops,
  CROP_RADII,
  cropFraction,
  cropImageBox,
  cropSide,
  cropWindow,
} from "./replayBaseCrops";
import { mapFraction, type StartDot } from "./replayMapLayers";

/** 4096 by 4096 elmos. */
const SQUARE = { worldWidth: 4096, worldHeight: 4096 };
/** Twice as wide as it is tall. */
const WIDE = { worldWidth: 8192, worldHeight: 4096 };

describe("the crop's size", () => {
  it("is eight heat radii of the map's shorter side, which is a quarter of it", () => {
    expect(CROP_RADII).toBe(8);
    expect(cropSide(SQUARE)).toBe(1024);
  });

  it("is the same on the wide map, because the shorter side is the same", () => {
    expect(cropSide(WIDE)).toBe(1024);
    expect(cropSide({ worldWidth: 4096, worldHeight: 8192 })).toBe(1024);
  });

  it("scales with the map, so a small map has the same grain", () => {
    expect(cropSide({ worldWidth: 2048, worldHeight: 2048 })).toBe(512);
  });

  it("has no window on a map with no size", () => {
    expect(cropWindow({ x: 1, z: 1 }, { worldWidth: 0, worldHeight: 0 })).toBe(
      null,
    );
  });
});

describe("the crop's window", () => {
  it("is centred on a start in the middle of the map", () => {
    const crop = cropWindow({ x: 2048, z: 2048 }, SQUARE);
    expect(crop).toEqual({ x0: 1536, z0: 1536, side: 1024 });
    const at = cropFraction(
      mapFraction({ x: 2048, z: 2048 }, SQUARE) ?? { left: 0, top: 0 },
      crop as never,
      SQUARE,
    );
    expect(at).toEqual({ left: 0.5, top: 0.5 });
  });

  it("slides along an edge to stay on the map and keeps its scale", () => {
    const crop = cropWindow({ x: 100, z: 2048 }, SQUARE);
    expect(crop).toEqual({ x0: 0, z0: 1536, side: 1024 });
    // The start is off centre: 100 elmos in from the west edge.
    const start = cropFraction(
      { left: 100 / 4096, top: 0.5 },
      crop as never,
      SQUARE,
    );
    expect(start.left).toBeCloseTo(100 / 1024, 10);
    expect(start.top).toBeCloseTo(0.5, 10);
  });

  it("slides into a corner on both axes", () => {
    const crop = cropWindow({ x: 4090, z: 50 }, SQUARE);
    expect(crop).toEqual({ x0: 3072, z0: 0, side: 1024 });
    const start = cropFraction(
      { left: 4090 / 4096, top: 50 / 4096 },
      crop as never,
      SQUARE,
    );
    expect(start.left).toBeCloseTo((4090 - 3072) / 1024, 10);
    expect(start.top).toBeCloseTo(50 / 1024, 10);
  });

  it("is square in elmos on a map that is not, so each axis has its own span", () => {
    const crop = cropWindow({ x: 4096, z: 2048 }, WIDE);
    expect(crop).toEqual({ x0: 3584, z0: 1536, side: 1024 });
    // A quarter of the map's height, but an eighth of its width.
    const east = cropFraction(
      { left: 4096 / 8192 + 0.125 / 2, top: 0.5 },
      crop as never,
      WIDE,
    );
    expect(east.left).toBeCloseTo(1, 10);
    const south = cropFraction(
      { left: 0.5, top: 0.5 + 0.25 / 2 },
      crop as never,
      WIDE,
    );
    expect(south.top).toBeCloseTo(1, 10);
  });

  it("places the minimap image so the window shows through a square box", () => {
    const crop = cropWindow({ x: 4096, z: 2048 }, WIDE);
    expect(cropImageBox(crop as never, WIDE)).toEqual({
      width: 800,
      height: 400,
      left: -350,
      top: -150,
    });
    const edge = cropWindow({ x: 10, z: 10 }, SQUARE);
    expect(cropImageBox(edge as never, SQUARE)).toEqual({
      width: 400,
      height: 400,
      left: -0,
      top: -0,
    });
  });
});

const dot = (team: number, x: number, z: number, world = SQUARE): StartDot => ({
  ...(mapFraction({ x, z }, world) as { left: number; top: number }),
  team,
  x,
  z,
  names: [`Player ${team}`],
  colour: "rgb(1, 2, 3)",
  isMe: false,
  opening: null,
});

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

const at = (x: number, z: number) => ({ x, y: 0, z });

const info = (over: Partial<DemoInfo> = {}) =>
  ({
    players: [
      { name: "A", team: 0, allyTeam: 1, spectator: false },
      { name: "B", team: 1, allyTeam: 0, spectator: false },
      { name: "C", team: 2, allyTeam: 1, spectator: false },
    ],
    ais: [],
    allyTeams: [],
    ...over,
  }) as unknown as DemoInfo;

describe("a mark inside a crop", () => {
  it("lands a known distance east and south of the start on a wide map", () => {
    const [crop] = baseCrops(
      [dot(0, 4096, 2048, WIDE)],
      [order({ position: at(4296, 2148) })],
      WIDE,
      null,
      info(),
    );
    // 200 of 1024 elmos east of the centre, and 100 south.
    expect(crop.start).toEqual({ left: 0.5, top: 0.5 });
    expect(crop.marks).toHaveLength(1);
    expect(crop.marks[0].left).toBeCloseTo(0.5 + 200 / 1024, 10);
    expect(crop.marks[0].top).toBeCloseTo(0.5 + 100 / 1024, 10);
  });

  it("keeps a mark where it is relative to a start that is off centre", () => {
    const [crop] = baseCrops(
      [dot(0, 100, 2048)],
      [order({ position: at(300, 1948) })],
      SQUARE,
      null,
      info(),
    );
    // West edge: the window starts at 0, so 300 elmos in is 300 of 1024.
    expect(crop.window.x0).toBe(0);
    expect(crop.start.left).toBeCloseTo(100 / 1024, 10);
    expect(crop.marks[0].left).toBeCloseTo(300 / 1024, 10);
    expect(crop.marks[0].top).toBeCloseTo(0.5 - 100 / 1024, 10);
  });

  it("has a neutral category when the game's units are not known", () => {
    const [crop] = baseCrops(
      [dot(0, 2048, 2048)],
      [order({ position: at(2048, 2048) })],
      SQUARE,
      null,
      info(),
    );
    expect(crop.marks[0].category).toBeNull();
  });

  it("classifies a mark from the same units the main map uses", () => {
    const units = [
      { name: "mex", fullName: "Metal Extractor", stats: { extractsMetal: 1 } },
    ] as unknown as UnitDatasetEntry[];
    const [crop] = baseCrops(
      [dot(0, 2048, 2048)],
      [order({ position: at(2048, 2048) })],
      SQUARE,
      units,
      info(),
    );
    expect(crop.marks[0].category).toBe("economy");
  });
});

describe("orders outside the crop", () => {
  it("counts an order on the map but outside the view, and one off the map", () => {
    const [crop] = baseCrops(
      [dot(0, 2048, 2048)],
      [
        order({ position: at(2048, 2048) }),
        order({ position: at(3000, 2048) }),
        order({ position: at(9000, 2048) }),
      ],
      SQUARE,
      null,
      info(),
    );
    expect(crop.marks).toHaveLength(1);
    expect(crop.outside).toBe(2);
    expect(crop.ordered).toBe(3);
  });

  it("does not count a factory queue order, which has no position", () => {
    const [crop] = baseCrops(
      [dot(0, 2048, 2048)],
      [order({ count: 5 }), order({ position: at(2048, 2048) })],
      SQUARE,
      null,
      info(),
    );
    expect(crop.ordered).toBe(1);
    expect(crop.outside).toBe(0);
  });

  it("keeps a mark on the crop's own edge", () => {
    const [crop] = baseCrops(
      [dot(0, 2048, 2048)],
      [order({ position: at(2048 + 512, 2048 - 512) })],
      SQUARE,
      null,
      info(),
    );
    expect(crop.marks).toHaveLength(1);
    expect(crop.marks[0]).toMatchObject({ left: 1, top: 0 });
  });
});

describe("whose orders a crop shows", () => {
  it("shows only its own team's orders", () => {
    const crops = baseCrops(
      [dot(0, 2048, 2048), dot(1, 2048, 2048)],
      [
        order({ team: 0, position: at(2048, 2048) }),
        order({ team: 1, position: at(2100, 2048) }),
        order({ team: 1, position: at(2200, 2048) }),
      ],
      SQUARE,
      null,
      info(),
    );
    expect(crops.map((c) => [c.team, c.marks.length])).toEqual([
      [1, 2],
      [0, 1],
    ]);
  });

  it("has a crop with no marks for a team that ordered nothing", () => {
    const [crop] = baseCrops([dot(0, 2048, 2048)], [], SQUARE, null, info());
    expect(crop.marks).toEqual([]);
    expect(crop.ordered).toBe(0);
  });
});

describe("the order of the crops", () => {
  it("puts allies together, by side and then by team", () => {
    const crops = baseCrops(
      [dot(2, 100, 100), dot(1, 200, 200), dot(0, 300, 300)],
      [],
      SQUARE,
      null,
      info(),
    );
    // Team 1 is alone on side 0. Teams 0 and 2 are allies on side 1.
    expect(crops.map((c) => [c.allyTeam, c.team])).toEqual([
      [0, 1],
      [1, 0],
      [1, 2],
    ]);
  });

  it("puts a team whose side is not described last", () => {
    const crops = baseCrops(
      [dot(7, 100, 100), dot(0, 300, 300)],
      [],
      SQUARE,
      null,
      info(),
    );
    expect(crops.map((c) => c.team)).toEqual([0, 7]);
  });
});
