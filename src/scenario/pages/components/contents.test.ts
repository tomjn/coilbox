import { describe, expect, it } from "vitest";
import type { Scenario } from "../../model";
import { contentsSelection, sceneContents } from "./contents";
import { pathKey } from "./groups";
import { placementKey } from "./placements";

type Registries = Pick<
  Scenario,
  "actors" | "groups" | "bases" | "blueprints" | "zones"
>;

const empty: Registries = {
  actors: [],
  groups: [],
  bases: [],
  blueprints: [],
  zones: [],
};

const actor = (id: string, name?: string): Scenario["actors"][number] => ({
  id,
  unitDef: "armcom",
  team: "p0",
  pos: { x: 100, z: 200 },
  facing: 0,
  ...(name ? { state: { name } } : {}),
});

const group = (id: string): Scenario["groups"][number] => ({
  id,
  team: "p1",
  units: [
    { def: "armpw", count: 3 },
    { def: "armflash", count: 2 },
  ],
  pos: { x: 900, z: 400 },
  orders: [{ kind: "move", waypoints: [{ x: 1000, z: 500 }] }],
  dormant: false,
});

/** A base and the layout it is placed from, which always travel together. */
const placedBase = (id: string): Pick<Registries, "bases" | "blueprints"> => ({
  blueprints: [
    {
      id: `${id}-layout`,
      name: "The keep",
      buildings: [
        { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
        { def: "armsolar", offset: { x: 96, z: 0 }, facing: 0 },
      ],
    },
  ],
  bases: [
    {
      id,
      blueprint: `${id}-layout`,
      team: "p0",
      origin: { x: 2048, z: 64 },
      buildings: [],
    },
  ],
});

const box = (id: string, name: string): Scenario["zones"][number] => ({
  id,
  name,
  shape: "box",
  min: { x: 1000, z: 1000 },
  max: { x: 3000, z: 2000 },
});

/** A zone drawn inside `box`, which is the one a click cannot always reach. */
const inner = (id: string, name: string): Scenario["zones"][number] => ({
  id,
  name,
  shape: "circle",
  center: { x: 2000, z: 1500 },
  radius: 200,
});

const everything: Registries = {
  actors: [actor("a1")],
  groups: [group("g1")],
  ...placedBase("p1"),
  zones: [box("z1", "Landing site"), inner("z2", "The pad")],
};

describe("sceneContents", () => {
  it("lists what the document puts on the map, in the order it draws it", () => {
    const out = sceneContents(everything);
    expect(out.map((entry) => entry.kind)).toEqual([
      "actor",
      "group",
      "base",
      "zone",
      "zone",
    ]);
    expect(out.map((entry) => entry.label)).toEqual([
      "armcom",
      "Group 1",
      "The keep",
      "Landing site",
      "The pad",
    ]);
  });

  it("numbers two bases placed from the same layout", () => {
    const shared = placedBase("p1");
    const out = sceneContents({
      ...empty,
      blueprints: shared.blueprints,
      bases: [
        shared.bases[0],
        { ...shared.bases[0], id: "p2" },
      ],
    });
    expect(out.map((entry) => entry.label)).toEqual([
      "The keep 1",
      "The keep 2",
    ]);
  });

  it("keys an entry by what selecting it selects", () => {
    expect(sceneContents(everything).map((entry) => entry.key)).toEqual([
      placementKey("actor", "a1"),
      placementKey("group", "g1", 0),
      placementKey("base", "p1", 0),
      "zone:z1",
      "zone:z2",
    ]);
  });

  it("takes the camera to where each thing stands", () => {
    expect(sceneContents(everything).map((entry) => entry.pos)).toEqual([
      { x: 100, z: 200 },
      { x: 900, z: 400 },
      { x: 2048, z: 64 },
      { x: 2000, z: 1500 },
      { x: 2000, z: 1500 },
    ]);
  });

  it("says how far each thing reaches, so the camera can show all of it", () => {
    // A five unit group is a 3 by 3 grid one spacing wide either side, a base
    // reaches to its furthest building, and a zone to its longer half-extent.
    expect(sceneContents(everything).map((entry) => entry.span)).toEqual([
      0, 96, 96, 1000, 200,
    ]);
  });

  it("says what shape a zone is, and that it belongs to nobody", () => {
    const out = sceneContents({ ...empty, zones: [box("z1", "Landing site")] });
    expect(out[0].detail).toBe("box");
    expect(out[0].team).toBeNull();
  });

  it("numbers two zones sharing a name", () => {
    const out = sceneContents({
      ...empty,
      zones: [box("z1", "Zone 1"), inner("z2", "Zone 1")],
    });
    expect(out.map((entry) => entry.label)).toEqual(["Zone 1 1", "Zone 1 2"]);
  });

  it("says what a group is made of and whether it has orders", () => {
    const [entry] = sceneContents({ ...empty, groups: [group("g1")] });
    expect(entry.detail).toBe("5 units · 1 order");
  });

  it("says a group with no orders has none rather than showing a zero", () => {
    const [entry] = sceneContents({
      ...empty,
      groups: [{ ...group("g1"), orders: [] }],
    });
    expect(entry.detail).toBe("5 units");
  });

  it("counts a base's buildings", () => {
    const [entry] = sceneContents({ ...empty, ...placedBase("p1") });
    expect(entry.detail).toBe("2 buildings");
  });

  it("calls an actor by its display name when it has one", () => {
    const [entry] = sceneContents({ ...empty, actors: [actor("a1", "Grigg")] });
    expect(entry.label).toBe("Grigg");
    expect(entry.detail).toBe("armcom");
  });

  it("numbers two actors that would read the same", () => {
    const out = sceneContents({ ...empty, actors: [actor("a1"), actor("a2")] });
    expect(out.map((entry) => entry.label)).toEqual(["armcom 1", "armcom 2"]);
  });

  it("carries the team each thing belongs to", () => {
    expect(sceneContents(everything).map((entry) => entry.team)).toEqual([
      "p0",
      "p1",
      "p0",
      null,
      null,
    ]);
  });

  it("holds nothing for a document that places nothing", () => {
    expect(sceneContents(empty)).toEqual([]);
  });
});

describe("contentsSelection", () => {
  const entries = sceneContents(everything);

  it("lights up the entry a selected unit belongs to", () => {
    expect(contentsSelection(entries, placementKey("actor", "a1"))).toBe(
      placementKey("actor", "a1"),
    );
  });

  it("reads a group's fifth unit as the group", () => {
    expect(contentsSelection(entries, placementKey("group", "g1", 4))).toBe(
      placementKey("group", "g1", 0),
    );
  });

  it("reads a base's second building as the base", () => {
    expect(contentsSelection(entries, placementKey("base", "p1", 1))).toBe(
      placementKey("base", "p1", 0),
    );
  });

  it("reads a point on a group's path as the group", () => {
    expect(contentsSelection(entries, pathKey("g1", 0, 0))).toBe(
      placementKey("group", "g1", 0),
    );
  });

  it("lights up the zone a click on its sheet selected", () => {
    expect(contentsSelection(entries, "zone:z2")).toBe("zone:z2");
  });

  it("reads a zone's resize handle as the zone", () => {
    expect(contentsSelection(entries, "zone:z1@nw")).toBe("zone:z1");
  });

  it("lights up nothing for a selection the list does not hold", () => {
    expect(contentsSelection(entries, placementKey("group", "gone", 0))).toBe(
      null,
    );
    expect(contentsSelection(entries, "zone:gone")).toBe(null);
    expect(contentsSelection(entries, null)).toBe(null);
  });
});
