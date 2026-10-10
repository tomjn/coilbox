import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildHeatField } from "@/lib/heatField";
import type {
  BuildOrder,
  StoredReplayAnalysis,
  UnitDatasetEntry,
} from "./bindings";

const asked = vi.fn();
vi.mock("./bindings", async (original) => ({
  ...(await original<typeof import("./bindings")>()),
  contentReplayAnalysisEvents: async (args: { kinds?: string[] }) =>
    asked(args),
}));

const {
  costedDeaths,
  deathLegend,
  deathPoints,
  eventBlock,
  eventState,
  finishedBuildings,
  placedEvents,
  windowSubject,
} = await import("./replayEventLayers");
const { readReplayEvents, resetReplayEventReadsForTests } = await import(
  "./replayEventRead"
);
const { buildMarks, mapFraction } = await import("./replayMapLayers");
const { countInRange, filterByFrame, windowPoints, windowRange } = await import(
  "./replayTimeWindow"
);

/** A map twice as wide as it is tall, so a swapped axis cannot pass. */
const WORLD = { worldWidth: 4096, worldHeight: 2048 };

const SECOND = 30;

const death = (over: Record<string, unknown>) => ({
  kind: "unit_destroyed",
  frame: 0,
  unit: 1,
  def: 1,
  team: 1,
  x: 0,
  y: 0,
  z: 0,
  ...over,
});

const finished = (over: Record<string, unknown>) => ({
  kind: "unit_finished",
  frame: 0,
  unit: 1,
  def: 1,
  team: 0,
  x: 0,
  y: 0,
  z: 0,
  ...over,
});

/** Units in the order the dataset holds them. Definition id 1 is the first. */
const UNITS = [
  {
    name: "cheap",
    mobile: false,
    stats: { metalCost: 50, extractsMetal: 1 },
  },
  { name: "tank", mobile: true, stats: { metalCost: 400 } },
  { name: "wall", mobile: false, stats: { weapons: [{}], metalCost: 10 } },
  { name: "freebie", mobile: true },
] as unknown as UnitDatasetEntry[];

/** The column and row of a field's brightest cell. */
function brightest(field: ReturnType<typeof buildHeatField>) {
  let best = 0;
  for (let i = 1; i < field.values.length; i++)
    if (field.values[i] > field.values[best]) best = i;
  return { col: best % field.width, row: Math.floor(best / field.width) };
}

describe("placedEvents", () => {
  it("keeps one kind, with a frame and a position", () => {
    const placed = placedEvents(
      [
        death({ frame: 10, x: 5, z: 6, attackerTeam: 0 }),
        death({ frame: 11, x: "no", z: 6 }),
        { kind: "unit_destroyed", x: 1, z: 2 },
        finished({ frame: 12, x: 7, z: 8 }),
        { kind: "game_start", frame: 0 },
      ],
      "unit_destroyed",
    );
    expect(placed).toEqual([
      { frame: 10, team: 1, def: 1, x: 5, z: 6, attacked: true },
    ]);
  });

  it("says a death has no attacker when the log names none", () => {
    const [none, some] = placedEvents(
      [death({}), death({ attacker: 4 })],
      "unit_destroyed",
    );
    expect(none.attacked).toBe(false);
    expect(some.attacked).toBe(true);
  });
});

describe("where a death lands", () => {
  it("puts a death in the cell its world position names, not a mirrored one", () => {
    // A 256 by 128 grid over 4096 by 2048 elmos is 16 elmos a cell. x 3000 is
    // column 187 and z 500 is row 31, near the north east.
    const deaths = placedEvents([death({ x: 3000, z: 500 })], "unit_destroyed");
    const field = buildHeatField(deathPoints(deaths, null).points, WORLD);
    expect(field.width).toBe(256);
    expect(field.height).toBe(128);
    const cell = brightest(field);
    expect(Math.abs(cell.col - 187)).toBeLessThanOrEqual(1);
    expect(Math.abs(cell.row - 31)).toBeLessThanOrEqual(1);
    expect(Math.abs((field.peakAt?.x ?? 0) - 3000)).toBeLessThanOrEqual(16);
    expect(Math.abs((field.peakAt?.z ?? 0) - 500)).toBeLessThanOrEqual(16);
  });

  it("agrees with where the minimap puts the same position", () => {
    const at = mapFraction({ x: 3000, z: 500 }, WORLD);
    const field = buildHeatField(
      deathPoints(
        placedEvents([death({ x: 3000, z: 500 })], "unit_destroyed"),
        null,
      ).points,
      WORLD,
    );
    const cell = brightest(field);
    expect((cell.col + 0.5) / field.width).toBeCloseTo(at?.left ?? -1, 1);
    expect((cell.row + 0.5) / field.height).toBeCloseTo(at?.top ?? -1, 1);
  });

  it("counts deaths by default and metal cost when asked", () => {
    const deaths = placedEvents(
      [
        death({ def: 1, x: 100, z: 100 }),
        death({ def: 2, x: 200, z: 100 }),
        death({ def: 4, x: 300, z: 100 }),
        death({ def: 99, x: 400, z: 100 }),
      ],
      "unit_destroyed",
    );
    expect(deathPoints(deaths, null).points.weights).toBeUndefined();
    const weighted = deathPoints(deaths, UNITS).points;
    // The unit with no stated cost and the one the game does not have count nothing.
    expect(Array.from(weighted.weights ?? [])).toEqual([50, 400, 0, 0]);
    expect(Array.from(weighted.positions)).toEqual([
      100, 100, 200, 100, 300, 100, 400, 100,
    ]);
    expect(costedDeaths(deaths, UNITS)).toBe(2);
    expect(costedDeaths(deaths, null)).toBe(0);
  });
});

describe("the time window", () => {
  const deaths = placedEvents(
    [
      death({ frame: 5 * SECOND, x: 100, z: 100 }),
      death({ frame: 15 * SECOND, x: 200, z: 200 }),
      death({ frame: 25 * SECOND, x: 300, z: 300 }),
    ],
    "unit_destroyed",
  );

  it("keeps the deaths inside the window and their positions with them", () => {
    const { points, frames } = deathPoints(deaths, null);
    const range = windowRange({ startSec: 10, endSec: 20 }, 100);
    expect(countInRange(frames, range)).toBe(1);
    expect(Array.from(windowPoints(points, frames, range).positions)).toEqual([
      200, 200,
    ]);
  });

  it("keeps every death when the window is the whole match", () => {
    const { points, frames } = deathPoints(deaths, null);
    const range = windowRange(null, 100);
    expect(countInRange(frames, range)).toBe(3);
    expect(windowPoints(points, frames, range)).toBe(points);
  });
});

describe("finished buildings", () => {
  const events = placedEvents(
    [
      finished({ def: 1, team: 0, x: 1024, z: 512, frame: 100 }),
      finished({ def: 2, team: 0, x: 500, z: 500 }),
      finished({ def: 3, team: 1, x: 3072, z: 1536, frame: 900 }),
      finished({ def: 99, x: 10, z: 10 }),
      finished({ def: 1, x: 5000, z: 10 }),
    ],
    "unit_finished",
  );

  it("draws buildings, and counts what it leaves out", () => {
    const out = finishedBuildings(events, WORLD, UNITS);
    expect(out.marks).toEqual([
      { left: 0.25, top: 0.25, frame: 100, team: 0, category: "economy" },
      { left: 0.75, top: 0.75, frame: 900, team: 1, category: "defence" },
    ]);
    expect(out.mobile).toBe(1);
    expect(out.unknown).toBe(1);
    expect(out.offMap).toBe(1);
  });

  it("draws nothing without the game, since a building cannot be told from a unit", () => {
    const out = finishedBuildings(events, WORLD, null);
    expect(out.marks).toEqual([]);
    expect(out.mobile).toBe(0);
  });

  it("follows the time window", () => {
    const out = finishedBuildings(events, WORLD, UNITS);
    const early = filterByFrame(
      out.marks,
      windowRange({ startSec: 0, endSec: 10 }, 100),
    );
    expect(early.map((m) => m.frame)).toEqual([100]);
  });
});

describe("ordered against finished", () => {
  it("shows the order that was never finished and the building that was never ordered", () => {
    const order = (x: number, z: number): BuildOrder =>
      ({
        frame: 0,
        player: 0,
        team: 0,
        origin: { kind: "selection" },
        unitDefId: 1,
        count: 1,
        slot: { kind: "append" },
        builders: 1,
        options: 0,
        position: { x, y: 0, z },
      }) as BuildOrder;
    // Ordered: A and B. Finished: A and C.
    const ordered = buildMarks(
      [order(1024, 512), order(2048, 1024)],
      WORLD,
      UNITS,
    ).marks;
    const done = finishedBuildings(
      placedEvents(
        [
          finished({ def: 1, x: 1024, z: 512 }),
          finished({ def: 1, x: 3072, z: 1536 }),
        ],
        "unit_finished",
      ),
      WORLD,
      UNITS,
    ).marks;
    const at = (m: { left: number; top: number }) => `${m.left},${m.top}`;
    const orderedAt = new Set(ordered.map(at));
    const doneAt = new Set(done.map(at));
    expect([...orderedAt].filter((p) => !doneAt.has(p))).toEqual(["0.5,0.5"]);
    expect([...doneAt].filter((p) => !orderedAt.has(p))).toEqual(["0.75,0.75"]);
    expect([...doneAt].filter((p) => orderedAt.has(p))).toEqual(["0.25,0.25"]);
  });
});

describe("what the analysis lets the map do", () => {
  const stored = (over: Partial<StoredReplayAnalysis>) =>
    ({
      state: "current",
      gameId: "g",
      analysedAtMs: 7,
      ...over,
    }) as StoredReplayAnalysis;

  it("is ready for a current analysis", () => {
    const state = eventState({ gameId: "g" }, stored({}), false);
    expect(state).toEqual({
      kind: "ready",
      outdated: false,
      gameId: "g",
      analysedAtMs: 7,
    });
    expect(eventBlock(state)).toBeNull();
  });

  it("is ready and outdated for an older logger's analysis", () => {
    const state = eventState(
      { gameId: "g" },
      stored({ state: "outdated" }),
      false,
    );
    expect(state).toMatchObject({ kind: "ready", outdated: true });
    expect(eventBlock(state)).toBeNull();
  });

  it("says the replay has not been analysed", () => {
    const state = eventState({ gameId: "g" }, undefined, false);
    expect(state).toEqual({ kind: "notAnalysed", canAnalyse: true });
    expect(eventBlock(state)).toMatch(/This replay has not been analysed/);
  });

  it("does not point at a run a distribution has hidden", () => {
    const state = eventState({ gameId: "g" }, undefined, true);
    expect(state).toEqual({ kind: "notAnalysed", canAnalyse: false });
    expect(eventBlock(state)).toMatch(/cannot analyse replays/);
  });

  it("says there is nothing to draw when the playback did not reproduce the match", () => {
    const state = eventState(
      { gameId: "g" },
      stored({ state: "diverged" }),
      false,
    );
    expect(state.kind).toBe("diverged");
    expect(eventBlock(state)).toMatch(
      /did not reproduce the recorded match, so what it recorded was thrown away and there is nothing to draw/,
    );
  });

  it("says a remix has no analysis of its own, even beside its original's", () => {
    const state = eventState({ gameId: "g", remixed: true }, stored({}), false);
    expect(state.kind).toBe("remix");
    expect(eventBlock(state)).toMatch(/A remix has no analysis of its own/);
  });
});

describe("the wording", () => {
  it("names what the window is about from the layers that are on", () => {
    expect(windowSubject(true, false)).toBe("orders");
    expect(windowSubject(false, true)).toBe("events");
    expect(windowSubject(true, true)).toBe("both");
  });

  it("reads the legend's peak in deaths, or in metal", () => {
    const field = { peakWithinRadius: 2, radius: 128 };
    expect(deathLegend(field, false, false)).toEqual({
      label: "Where units died",
      peak: "2 deaths within 128 elmos of one spot",
    });
    expect(
      deathLegend({ ...field, peakWithinRadius: 1 }, false, true).peak,
    ).toBe("1 death within 128 elmos of one spot in this window");
    expect(
      deathLegend({ peakWithinRadius: 1450, radius: 128 }, true, false),
    ).toEqual({
      label: "Where metal was lost",
      peak: "1,450 metal of units lost within 128 elmos of one spot",
    });
  });
});

describe("reading the events", () => {
  beforeEach(() => {
    resetReplayEventReadsForTests();
    asked.mockReset();
    asked.mockImplementation(async (args: { kinds?: string[] }) => ({
      total: 0,
      events: [death({ frame: 1 }), finished({ frame: 2 })].filter(
        (e) => !args.kinds || args.kinds.includes(e.kind),
      ),
    }));
  });

  it("asks the command for only the kinds a layer draws", async () => {
    const events = await readReplayEvents("g", 1, ["unit_destroyed"]);
    expect(events.map((e) => e.kind)).toEqual(["unit_destroyed"]);
    expect(asked).toHaveBeenCalledWith({
      gameId: "g",
      kinds: ["unit_destroyed"],
    });
  });

  it("reads a kind once however many ask", async () => {
    await readReplayEvents("g", 1, ["unit_destroyed"]);
    await readReplayEvents("g", 1, ["unit_destroyed"]);
    await readReplayEvents("g", 1, ["unit_destroyed", "unit_finished"]);
    expect(asked).toHaveBeenCalledTimes(2);
    expect(asked).toHaveBeenLastCalledWith({
      gameId: "g",
      kinds: ["unit_finished"],
    });
  });

  it("answers a layer from the table's read of every kind", async () => {
    await readReplayEvents("g", 1, null);
    const events = await readReplayEvents("g", 1, ["unit_finished"]);
    expect(events.map((e) => e.kind)).toEqual(["unit_finished"]);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it("reads again for a newer run, and again after a failure", async () => {
    await readReplayEvents("g", 1, ["unit_destroyed"]);
    await readReplayEvents("g", 2, ["unit_destroyed"]);
    expect(asked).toHaveBeenCalledTimes(2);
    asked.mockRejectedValueOnce(new Error("gone"));
    await expect(readReplayEvents("h", 1, ["unit_destroyed"])).rejects.toThrow(
      "gone",
    );
    await expect(
      readReplayEvents("h", 1, ["unit_destroyed"]),
    ).resolves.toHaveLength(1);
  });
});
