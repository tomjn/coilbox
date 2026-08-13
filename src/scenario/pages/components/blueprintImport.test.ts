import { describe, expect, it } from "vitest";
import { readBarFile } from "@/blueprint/bar";
import { newScenario } from "../../create";
import { carryBlueprint, takeBlueprint } from "./blueprintImport";

const IDS = { base: "b1", blueprint: "bp1" };
const ORIGIN = { x: 0, z: 0 };

/** A layout as it comes out of a game's file, so this covers the whole way from
 *  the file to the document rather than from a hand-written object. */
function fromFile(ordered: boolean) {
  const text = JSON.stringify({
    savedBlueprints: [
      {
        name: "Opening solars",
        spacing: 0,
        facing: 0,
        ordered,
        units: [
          { unitName: "armsolar", position: [-48, 80, 0], facing: 0 },
          { unitName: "armmex", position: [56, 80, 0], facing: 1 },
        ],
      },
    ],
  });
  return readBarFile(text).blueprints[0].layout;
}

describe("takeBlueprint", () => {
  it("lands as a layout and one placement of it", () => {
    const done = takeBlueprint(
      newScenario("Mine"),
      fromFile(false),
      "p1",
      IDS,
      ORIGIN,
    );
    expect(done.blueprints).toEqual([
      {
        id: "bp1",
        name: "Opening solars",
        buildings: [
          { def: "armsolar", offset: { x: -48, z: 0 }, facing: 0 },
          { def: "armmex", offset: { x: 56, z: 0 }, facing: 1 },
        ],
      },
    ]);
    expect(done.bases).toEqual([
      {
        id: "b1",
        blueprint: "bp1",
        team: "p1",
        origin: ORIGIN,
        buildings: [{}, {}],
      },
    ]);
  });

  it("keeps a build order the file claimed", () => {
    const done = takeBlueprint(
      newScenario("Mine"),
      fromFile(true),
      "p1",
      IDS,
      ORIGIN,
    );
    expect(done.blueprints[0].ordered).toBe(true);
  });

  it("does not read an order into a layout that never claimed one", () => {
    const done = takeBlueprint(
      newScenario("Mine"),
      fromFile(false),
      "p1",
      IDS,
      ORIGIN,
    );
    expect(done.blueprints[0].ordered).toBeUndefined();
  });

  it("leaves what was already in the document where it was", () => {
    const first = takeBlueprint(
      newScenario("Mine"),
      fromFile(false),
      "p1",
      IDS,
      ORIGIN,
    );
    const second = takeBlueprint(
      first,
      fromFile(true),
      "p1",
      { base: "b2", blueprint: "bp2" },
      { x: 512, z: 512 },
    );
    expect(second.blueprints).toHaveLength(2);
    expect(second.bases).toHaveLength(2);
    expect(second.blueprints[0]).toEqual(first.blueprints[0]);
  });
});

describe("carryBlueprint", () => {
  it("lands as a layout and nothing on the map (issue #1434)", () => {
    const done = carryBlueprint(newScenario("Mine"), fromFile(false), "bp1");
    expect(done.blueprints).toEqual([
      {
        id: "bp1",
        name: "Opening solars",
        buildings: [
          { def: "armsolar", offset: { x: -48, z: 0 }, facing: 0 },
          { def: "armmex", offset: { x: 56, z: 0 }, facing: 1 },
        ],
      },
    ]);
    expect(done.bases).toEqual([]);
  });

  it("keeps a build order the file claimed", () => {
    const done = carryBlueprint(newScenario("Mine"), fromFile(true), "bp1");
    expect(done.blueprints[0].ordered).toBe(true);
  });

  it("does not read an order into a layout that never claimed one", () => {
    const done = carryBlueprint(newScenario("Mine"), fromFile(false), "bp1");
    expect(done.blueprints[0].ordered).toBeUndefined();
  });

  it("keeps whatever map the layout was drawn for", () => {
    const done = carryBlueprint(
      newScenario("Mine"),
      { ...fromFile(false), designedFor: "Comet Catcher Remake" },
      "bp1",
    );
    expect(done.blueprints[0].designedFor).toBe("Comet Catcher Remake");
  });

  it("leaves what was already in the document where it was", () => {
    const first = carryBlueprint(newScenario("Mine"), fromFile(false), "bp1");
    const second = carryBlueprint(first, fromFile(true), "bp2");
    expect(second.blueprints).toHaveLength(2);
    expect(second.bases).toEqual([]);
    expect(second.blueprints[0]).toEqual(first.blueprints[0]);
  });
});
