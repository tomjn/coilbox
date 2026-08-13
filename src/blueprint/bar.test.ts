import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  barEntry,
  barFormat,
  mergeBarFile,
  readBarFile,
  strippedByBar,
} from "./bar";
import { buildGridSnap } from "./footprint";
import type { BaseBlueprint } from "./model";
import { knownUnits } from "./units";

/** A real file in Beyond All Reason's shape, written by `cmd_blueprint.lua`.
 *  Its third entry is one this reader does not understand, which is what proves
 *  a merge does not drop what it cannot read. */
const FIXTURE = readFileSync(
  join(__dirname, "fixtures", "bar-blueprints.json"),
  "utf8",
);

/** One file holding two games' layouts, which is what the game's own file
 *  really looks like: its path has no game in it, so every game sharing a data
 *  directory writes into the same list. Its second entry is Zero-K's, its third
 *  is this game's with one unit a Legion-less install has not got. */
const TWO_GAMES = readFileSync(
  join(__dirname, "fixtures", "bar-two-games.json"),
  "utf8",
);

/** Balanced Annihilation's own footprints, so the snapping cases are shapes
 *  that really exist. `armsolar` spans an even number of squares and `armmex` an
 *  odd one, which snap to different points of the grid. */
const UNITS = [
  { name: "armsolar", footprintX: 4, footprintZ: 4 },
  { name: "armmex", footprintX: 3, footprintZ: 3 },
  { name: "corllt", footprintX: 2, footprintZ: 2 },
];

const layout = (patch: Partial<BaseBlueprint> = {}): BaseBlueprint => ({
  id: "l1",
  name: "Opening solars",
  buildings: [
    { def: "armsolar", offset: { x: -48, z: -48 }, facing: 0 },
    { def: "armmex", offset: { x: 48, z: 48 }, facing: 1 },
  ],
  ...patch,
});

describe("readBarFile", () => {
  it("reads a saved layout, its name, its buildings and its build order", () => {
    const read = readBarFile(FIXTURE);
    expect(read.blueprints[0].layout).toEqual({
      name: "Opening solars",
      ordered: true,
      buildings: [
        { def: "armsolar", offset: { x: -48, z: -48 }, facing: 0 },
        { def: "armsolar", offset: { x: 0, z: -48 }, facing: 0 },
        { def: "armmex", offset: { x: 56, z: 56 }, facing: 1 },
      ],
    });
  });

  it("leaves a layout whose order was not meant without one", () => {
    expect(readBarFile(FIXTURE).blueprints[1].layout.ordered).toBeUndefined();
  });

  it("calls an unnamed layout what the game calls it", () => {
    expect(readBarFile(FIXTURE).blueprints[1].layout.name).toBe("#2");
  });

  it("counts an entry it cannot read rather than pretending it is not there", () => {
    expect(readBarFile(FIXTURE).unreadable).toBe(1);
    expect(readBarFile(FIXTURE).blueprints).toHaveLength(2);
  });

  it("turns a layout the file saved on its side", () => {
    // The second entry is `facing: 1`, which the game applies when it places
    // the layout: a point at (64, 0) turns to (0, -64) and every building in it
    // gains a quarter turn.
    const second = readBarFile(FIXTURE).blueprints[1];
    expect(second.turned).toBe(1);
    expect(second.layout.buildings).toEqual([
      { def: "corllt", offset: { x: 0, z: -64 }, facing: 0 },
    ]);
  });

  it("says the repeat gap is not something a coilbox layout can keep", () => {
    expect(readBarFile(FIXTURE).blueprints[1].dropped).toEqual([
      "the 2 square gap it repeats at",
    ]);
    expect(readBarFile(FIXTURE).blueprints[0].dropped).toEqual([]);
  });

  it("reads the empty file the game writes as no layouts at all", () => {
    // `saveBlueprintsToFile` writes `0` rather than `[]` for an empty list.
    expect(readBarFile('{"savedBlueprints":0}').blueprints).toEqual([]);
    expect(readBarFile("{}").blueprints).toEqual([]);
  });

  it("refuses a file that is not this format rather than reading nothing out of it", () => {
    expect(() => readBarFile("not json at all")).toThrow(/could not be read/i);
    expect(() => readBarFile('{"savedBlueprints":"yes"}')).toThrow(
      /savedBlueprints/,
    );
  });

  it("leaves positions where the file put them when it has no footprints", () => {
    const read = readBarFile(
      '{"savedBlueprints":[{"name":"a","units":[' +
        '{"unitName":"armmex","position":[7,0,7],"facing":0}]}]}',
    );
    expect(read.blueprints[0].layout.buildings[0].offset).toEqual({
      x: 7,
      z: 7,
    });
    expect(read.blueprints[0].snapped).toEqual([]);
  });

  it("puts a building the build grid would move onto the grid, and says so", () => {
    const read = readBarFile(
      '{"savedBlueprints":[{"name":"a","units":[' +
        '{"unitName":"armmex","position":[7,0,7],"facing":0}]}]}',
      buildGridSnap(UNITS),
    );
    // An odd span centres in the middle of a build square, so 7 becomes 8.
    expect(read.blueprints[0].layout.buildings[0].offset).toEqual({
      x: 8,
      z: 8,
    });
    expect(read.blueprints[0].snapped).toEqual([
      { index: 0, def: "armmex", from: { x: 7, z: 7 }, to: { x: 8, z: 8 } },
    ]);
  });

  it("says nothing moved when the file's own positions are already on the grid", () => {
    const read = readBarFile(FIXTURE, buildGridSnap(UNITS));
    expect(read.blueprints[0].snapped).toEqual([]);
  });

  it("says which buildings name a unit the game being imported into has not got", () => {
    const read = readBarFile(TWO_GAMES, undefined, knownUnits(UNITS));
    expect(read.checked).toBe(true);
    expect(read.blueprints[0].unknown).toEqual([]);
    expect(read.blueprints[1].unknown).toEqual([
      { index: 0, def: "energysolar" },
      { index: 1, def: "turretlaser" },
      { index: 2, def: "factorycloak" },
    ]);
    expect(read.blueprints[2].unknown).toEqual([{ index: 3, def: "legsolar" }]);
  });

  it("still reads a layout of another game's units, because taking it is the reader's caller's decision", () => {
    const read = readBarFile(TWO_GAMES, undefined, knownUnits(UNITS));
    expect(read.blueprints).toHaveLength(3);
    expect(read.unreadable).toBe(0);
    expect(read.blueprints[1].layout.buildings).toHaveLength(3);
  });

  it("checks nothing, and says it checked nothing, without a game to check against", () => {
    const read = readBarFile(TWO_GAMES);
    expect(read.checked).toBe(false);
    expect(read.blueprints.every((one) => one.unknown.length === 0)).toBe(true);
  });

  it("counts a unit the game has not got by the layout's own order, turn and all", () => {
    // The turn reorders nothing, but the index has to be the building's place
    // in the layout that comes out, not in the file's own array.
    const read = readBarFile(
      '{"savedBlueprints":[{"name":"a","facing":1,"units":[' +
        '{"unitName":"armsolar","position":[0,0,0],"facing":0},' +
        '{"unitName":"legsolar","position":[64,0,0],"facing":0}]}]}',
      undefined,
      knownUnits(UNITS),
    );
    expect(read.blueprints[0].unknown).toEqual([{ index: 1, def: "legsolar" }]);
  });
});

describe("barEntry", () => {
  it("writes the shape the game reads", () => {
    expect(barEntry(layout({ ordered: true }))).toEqual({
      name: "Opening solars",
      spacing: 0,
      facing: 0,
      ordered: true,
      units: [
        { unitName: "armsolar", position: [-48, 0, -48], facing: 0 },
        { unitName: "armmex", position: [48, 0, 48], facing: 1 },
      ],
    });
  });

  it("says the order was not meant rather than leaving the game to guess", () => {
    expect(barEntry(layout()).ordered).toBe(false);
  });

  it("comes back out of a read the way it went in", () => {
    const there = barEntry(layout({ ordered: true }));
    const back = readBarFile(JSON.stringify({ savedBlueprints: [there] }));
    expect(back.blueprints[0].layout).toEqual({
      name: "Opening solars",
      ordered: true,
      buildings: layout().buildings,
    });
  });
});

describe("strippedByBar", () => {
  it("names the mission-only fields the file cannot carry", () => {
    expect(
      strippedByBar([
        { id: "keep" },
        { queue: ["armpw"], repeat: true },
        { id: "gate", queue: ["armpw"] },
      ]),
    ).toEqual([
      "the trigger name on 2 buildings",
      "the build queue on 2 buildings",
      "the repeating queue on 1 building",
    ]);
  });

  it("says nothing about a base carrying nothing a blueprint cannot hold", () => {
    expect(strippedByBar([{}, {}])).toEqual([]);
    expect(strippedByBar([])).toEqual([]);
  });
});

describe("mergeBarFile", () => {
  it("writes a file of its own when the game has none", () => {
    const plan = mergeBarFile("", [layout()]);
    expect(JSON.parse(plan.text)).toEqual({
      savedBlueprints: [barEntry(layout())],
    });
    expect(plan.added).toEqual(["Opening solars"]);
    expect(plan.replaced).toEqual([]);
  });

  it("replaces a layout of the same name where it stands", () => {
    const plan = mergeBarFile(FIXTURE, [layout()]);
    const written = JSON.parse(plan.text);
    expect(plan.replaced).toEqual(["Opening solars"]);
    expect(plan.added).toEqual([]);
    expect(written.savedBlueprints[0]).toEqual(barEntry(layout()));
    expect(written.savedBlueprints).toHaveLength(3);
  });

  it("adds a layout the file has not got on the end", () => {
    const plan = mergeBarFile(FIXTURE, [layout({ name: "Front line" })]);
    const written = JSON.parse(plan.text);
    expect(plan.added).toEqual(["Front line"]);
    expect(written.savedBlueprints).toHaveLength(4);
    expect(written.savedBlueprints[3].name).toBe("Front line");
  });

  it("carries an entry it cannot read through untouched", () => {
    const plan = mergeBarFile(FIXTURE, [layout()]);
    const before = JSON.parse(FIXTURE).savedBlueprints[2];
    expect(JSON.parse(plan.text).savedBlueprints[2]).toEqual(before);
    expect(plan.kept).toBe(1);
  });

  it("keeps every other thing the file says about itself", () => {
    const written = JSON.parse(mergeBarFile(FIXTURE, [layout()]).text);
    expect(written.lastSelected).toBe(1);
    expect(written.version).toBe(3);
  });

  it("refuses a file it cannot read rather than writing over it", () => {
    expect(() => mergeBarFile("{ half a file", [layout()])).toThrow(
      /could not be read/i,
    );
    expect(() => mergeBarFile('{"savedBlueprints":"yes"}', [layout()])).toThrow(
      /savedBlueprints/,
    );
  });

  it("takes the empty list the game writes as an empty list", () => {
    const plan = mergeBarFile('{"savedBlueprints":0,"version":3}', [layout()]);
    const written = JSON.parse(plan.text);
    expect(written.savedBlueprints).toHaveLength(1);
    expect(written.version).toBe(3);
  });
});

describe("barFormat", () => {
  it("says where the game keeps the file", () => {
    expect(barFormat.file).toBe("LuaUI/Config/blueprints.json");
    expect(barFormat.id).toBe("bar");
  });
});
