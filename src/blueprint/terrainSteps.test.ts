import { describe, expect, it } from "vitest";
import { newScenario } from "../scenario/create";
import { parseScenario } from "../scenario/model";
import { countLine } from "./countLine";
import {
  libraryLayout,
  parseStoredBlueprintJson,
  recordWithLayout,
  type StoredBlueprint,
} from "./library";
import type { BaseBlueprint, TerrainStep } from "./model";
import { copyTerrainStep, parseBlueprintPayload } from "./payload";
import { flippedStep, terrainCount, turnedStep } from "./terrainSteps";
import {
  blueprintFromPayload,
  blueprintPayload,
  encodeBlueprintCode,
  encodeBlueprintJson,
  encodePayloadJson,
  readBlueprintContainer,
} from "./transfer";
import { readSpool, spoolRecords, widgetLibraryText } from "./widget";

const wall: TerrainStep = {
  kind: "raise",
  shape: "wall",
  points: [
    { x: 0, z: 0 },
    { x: 64, z: 0 },
    { x: 64, z: 32 },
  ],
  height: 24,
  before: 0,
};

const ramp: TerrainStep = {
  kind: "ramp",
  shape: "wall",
  points: [
    { x: -32, z: 0 },
    { x: 32, z: 0 },
  ],
  heights: [0, 40],
  width: 48,
  before: 1,
};

const pad: TerrainStep = {
  kind: "level",
  shape: "area",
  points: [
    { x: 0, z: 0 },
    { x: 64, z: 0 },
    { x: 64, z: 64 },
    { x: 0, z: 64 },
  ],
  height: -8,
  before: 1,
};

const smooth: TerrainStep = {
  kind: "smooth",
  shape: "area",
  points: [
    { x: 0, z: 0 },
    { x: 32, z: 0 },
    { x: 32, z: 32 },
  ],
  before: 1,
};

/** Buildings and steps, one step of each kind. */
const mixed: BaseBlueprint = {
  id: "mixed",
  name: "Walls and a factory",
  ordered: true,
  buildings: [{ def: "armlab", offset: { x: 0, z: 0 }, facing: 1 }],
  terrain: [wall, ramp, pad, smooth],
};

/** Steps and no buildings at all. */
const wallsOnly: BaseBlueprint = {
  id: "walls",
  name: "Ring of walls",
  buildings: [],
  terrain: [wall],
};

const payloadOf = (layout: BaseBlueprint) =>
  blueprintPayload(layout, { gameName: "Zero-K test" });

const without = ({ id: _id, ...rest }: BaseBlueprint) => rest;

describe("terrain steps in the share payload", () => {
  it.each([
    ["buildings and steps", mixed],
    ["steps alone", wallsOnly],
  ])("round trip through a share file with %s", (_name, layout) => {
    const read = readBlueprintContainer(
      encodeBlueprintJson(layout, { gameName: "Zero-K test" }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(blueprintFromPayload(read.payload)).toEqual(without(layout));
  });

  it.each([
    ["buildings and steps", mixed],
    ["steps alone", wallsOnly],
  ])("round trip through a share code with %s", (_name, layout) => {
    const code = encodeBlueprintCode(layout, { gameName: "Zero-K test" });
    expect(code.ok).toBe(true);
    if (!code.ok) return;
    const read = readBlueprintContainer(code.code);
    expect(read.ok && blueprintFromPayload(read.payload)).toEqual(
      without(layout),
    );
  });

  it("writes no terrain key for a layout that changes no ground", () => {
    expect(payloadOf({ ...mixed, terrain: undefined })).not.toHaveProperty(
      "terrain",
    );
    expect(payloadOf({ ...mixed, terrain: [] })).not.toHaveProperty("terrain");
  });

  it("does not move the container's kind version for an additive field", () => {
    const json = JSON.parse(encodePayloadJson(payloadOf(mixed)));
    expect(json.kindVersion).toBe(1);
  });

  it("writes plain values the hub can read without any coilbox code", () => {
    const written = JSON.parse(JSON.stringify(payloadOf(mixed)));
    expect(written.terrain).toEqual(mixed.terrain);
  });

  it("copies steps rather than sharing them with the layout", () => {
    const payload = payloadOf(mixed);
    payload.terrain?.[0].points.push({ x: 1, z: 1 });
    expect(mixed.terrain?.[0].points).toHaveLength(3);
  });

  it("reads the same layout an older coilbox would, buildings and all", () => {
    // An older build knows no `terrain`, so it drops the key and reads the rest.
    const { terrain: _terrain, ...old } = payloadOf(mixed);
    const read = parseBlueprintPayload(JSON.parse(JSON.stringify(old)));
    expect(read?.buildings).toEqual(mixed.buildings);
    expect(read).not.toHaveProperty("terrain");
  });

  it("accepts a payload with steps and no buildings", () => {
    const read = parseBlueprintPayload(
      JSON.parse(JSON.stringify(payloadOf(wallsOnly))),
    );
    expect(read?.buildings).toEqual([]);
    expect(read?.terrain).toEqual(wallsOnly.terrain);
  });

  it("drops a damaged step and keeps the buildings and the other steps", () => {
    const read = parseBlueprintPayload({
      ...JSON.parse(JSON.stringify(payloadOf(mixed))),
      terrain: [
        { ...wall, kind: "restore" },
        { ...wall, points: [{ x: 0, z: 0 }] },
        { ...wall, height: undefined },
        { ...ramp, heights: [0] },
        { ...ramp, width: 0 },
        { ...pad, points: pad.points.slice(0, 2) },
        { ...wall, before: -1 },
        { ...wall, before: 0.5 },
        "not a step",
        smooth,
      ],
    });
    expect(read?.buildings).toEqual(mixed.buildings);
    expect(read?.terrain).toEqual([smooth]);
  });

  it("puts a step that names a building the layout has not got after them all", () => {
    const read = parseBlueprintPayload({
      ...JSON.parse(JSON.stringify(payloadOf(wallsOnly))),
      terrain: [{ ...wall, before: 9 }],
    });
    expect(read?.terrain?.[0].before).toBe(0);
    const mixedRead = parseBlueprintPayload({
      ...JSON.parse(JSON.stringify(payloadOf(mixed))),
      terrain: [{ ...wall, before: 9 }],
    });
    expect(mixedRead?.terrain?.[0].before).toBe(1);
  });

  it("leaves out fields a step's kind does not use", () => {
    const read = parseBlueprintPayload({
      ...JSON.parse(JSON.stringify(payloadOf(wallsOnly))),
      terrain: [
        { ...smooth, height: 12, heights: [1, 2], width: 4 },
        { ...wall, heights: [1, 2], width: 4 },
      ],
    });
    // The layout has no buildings, so the last place a step can come is first.
    expect(read?.terrain).toEqual([{ ...smooth, before: 0 }, wall]);
  });

  it("refuses a ramp that is an outline, or has other than two points", () => {
    const read = parseBlueprintPayload({
      ...JSON.parse(JSON.stringify(payloadOf(wallsOnly))),
      terrain: [
        { ...ramp, shape: "area" },
        { ...ramp, points: pad.points },
      ],
    });
    expect(read?.terrain).toBeUndefined();
  });
});

describe("terrain steps in the library", () => {
  const stored = (layout: BaseBlueprint): StoredBlueprint => ({
    id: layout.id,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    layout: payloadOf(layout),
  });

  it.each([
    ["buildings and steps", mixed],
    ["steps alone", wallsOnly],
  ])("round trip through a library file with %s", (_name, layout) => {
    const record = stored(layout);
    const read = parseStoredBlueprintJson(JSON.stringify(record));
    expect(read).toEqual(record);
    expect(read && libraryLayout(read)).toEqual(layout);
  });

  it("keeps the steps when the buildings are edited", () => {
    const record = stored(mixed);
    const edited = recordWithLayout(record, {
      ...libraryLayout(record),
      buildings: [],
    });
    expect(edited.layout.terrain).toEqual(mixed.terrain);
  });

  it("drops the steps from a record when the layout no longer has any", () => {
    const record = stored(mixed);
    const edited = recordWithLayout(record, {
      ...libraryLayout(record),
      terrain: [],
    });
    expect(edited.layout).not.toHaveProperty("terrain");
  });
});

describe("terrain steps in the widget's files", () => {
  it.each([
    ["buildings and steps", mixed],
    ["steps alone", wallsOnly],
  ])("go into the library file the widget reads with %s", (_name, layout) => {
    const record: StoredBlueprint = {
      id: layout.id,
      createdAt: "",
      updatedAt: "",
      layout: payloadOf(layout),
    };
    const doc = JSON.parse(widgetLibraryText([record]));
    expect(doc.blueprints[0].terrain).toEqual(layout.terrain);
    expect(doc.blueprints[0].buildings).toEqual(layout.buildings);
  });

  it("come back out of the spool the widget writes", () => {
    const spool = JSON.stringify({
      version: 1,
      blueprints: [{ ...payloadOf(wallsOnly), recordedAt: 100 }],
    });
    const read = readSpool(spool);
    expect(read.skipped).toBe(0);
    const [record] = spoolRecords(read.entries, undefined);
    expect(libraryLayout({ ...record, id: "walls" })).toEqual(wallsOnly);
  });
});

describe("terrain steps in a scenario document", () => {
  it("round trip with a layout of buildings and steps, and one of steps alone", () => {
    const base = newScenario("Walls");
    const doc = JSON.parse(
      JSON.stringify({ ...base, blueprints: [mixed, wallsOnly] }),
    );
    const read = parseScenario(doc);
    expect(read?.blueprints.map((one) => one.terrain)).toEqual([
      mixed.terrain,
      wallsOnly.terrain,
    ]);
    expect(read?.blueprints[1].buildings).toEqual([]);
  });

  it("reads a document written before terrain changes as it always did", () => {
    const base = newScenario("Old");
    const doc = JSON.parse(
      JSON.stringify({
        ...base,
        blueprints: [{ ...mixed, terrain: undefined }],
      }),
    );
    expect(parseScenario(doc)?.blueprints[0]).not.toHaveProperty("terrain");
  });
});

describe("turning and flipping steps", () => {
  const pivot = { x: 10, z: 20 };

  it("turns points the way buildings are turned about the same pivot", () => {
    // One quarter turn sends a point due south of the pivot to due east of it.
    const south = {
      ...wall,
      points: [
        { x: 10, z: 52 },
        { x: 10, z: 84 },
      ],
    };
    expect(turnedStep(south, pivot, 1).points).toEqual([
      { x: 42, z: 20 },
      { x: 74, z: 20 },
    ]);
  });

  it("comes home after four quarter turns, exactly", () => {
    let step = wall;
    for (let turn = 0; turn < 4; turn++) step = turnedStep(step, pivot, 1);
    expect(step).toEqual(wall);
  });

  it("turns by any number of quarters, forward or back", () => {
    expect(turnedStep(wall, pivot, 5)).toEqual(turnedStep(wall, pivot, 1));
    expect(turnedStep(wall, pivot, -1)).toEqual(turnedStep(wall, pivot, 3));
  });

  it("keeps heights, width, kind, shape and place in the build order", () => {
    const turned = turnedStep(ramp, pivot, 1);
    expect(turned.heights).toEqual([0, 40]);
    expect(turned.width).toBe(48);
    expect(turned.kind).toBe("ramp");
    expect(turned.shape).toBe("wall");
    expect(turned.before).toBe(1);
  });

  it("keeps a ramp's ends in order, so the first height stays on the first point", () => {
    const flipped = flippedStep(ramp, { x: 0, z: 0 }, { x: true });
    expect(flipped.points).toEqual([
      { x: 32, z: 0 },
      { x: -32, z: 0 },
    ]);
    expect(flipped.heights).toEqual([0, 40]);
  });

  it("flips side to side along x and top to bottom along z", () => {
    expect(flippedStep(wall, pivot, { x: true }).points).toEqual([
      { x: 20, z: 0 },
      { x: -44, z: 0 },
      { x: -44, z: 32 },
    ]);
    expect(flippedStep(wall, pivot, { z: true }).points).toEqual([
      { x: 0, z: 40 },
      { x: 64, z: 40 },
      { x: 64, z: 8 },
    ]);
  });

  it("flips back to where it started", () => {
    const once = flippedStep(wall, pivot, { x: true, z: true });
    expect(flippedStep(once, pivot, { x: true, z: true })).toEqual(wall);
  });

  it("flipping both ways is a half turn", () => {
    expect(flippedStep(wall, pivot, { x: true, z: true })).toEqual(
      turnedStep(wall, pivot, 2),
    );
  });

  it("does not change the step it was given", () => {
    const before = structuredClone(ramp);
    turnedStep(ramp, pivot, 1);
    flippedStep(ramp, pivot, { x: true });
    expect(ramp).toEqual(before);
    expect(copyTerrainStep(ramp)).toEqual(before);
  });
});

describe("the count line", () => {
  it("counts buildings alone as it always did", () => {
    expect(countLine(1, 0)).toBe("1 building");
    expect(countLine(5, 0)).toBe("5 buildings");
    expect(countLine(0, 0)).toBe("0 buildings");
  });

  it("adds terrain changes", () => {
    expect(countLine(5, 3)).toBe("5 buildings, 3 terrain changes");
    expect(countLine(1, 1)).toBe("1 building, 1 terrain change");
  });

  it("says no buildings when there are steps and nothing else", () => {
    expect(countLine(0, 3)).toBe("No buildings, 3 terrain changes");
    expect(countLine(0, 1)).toBe("No buildings, 1 terrain change");
  });

  it("counts a layout's steps", () => {
    expect(terrainCount(mixed)).toBe(4);
    expect(terrainCount({ buildings: [] })).toBe(0);
  });
});
