import { describe, expect, it } from "vitest";
import type { Scenario } from "../../model";
import { contentsSelection, sceneContents } from "./contents";
import { placementKey } from "./placements";

type Registries = Pick<Scenario, "actors" | "groups" | "prefabs">;

const empty: Registries = { actors: [], groups: [], prefabs: [] };

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

const prefab = (id: string): Scenario["prefabs"][number] => ({
  id,
  team: "p0",
  origin: { x: 2048, z: 64 },
  buildings: [
    { def: "armlab", offset: { x: 0, z: 0 }, facing: 0 },
    { def: "armsolar", offset: { x: 96, z: 0 }, facing: 0 },
  ],
});

describe("sceneContents", () => {
  it("lists what the document places, actors then groups then bases", () => {
    const out = sceneContents({
      actors: [actor("a1")],
      groups: [group("g1")],
      prefabs: [prefab("p1")],
    });
    expect(out.map((entry) => entry.kind)).toEqual([
      "actor",
      "group",
      "prefab",
    ]);
    expect(out.map((entry) => entry.label)).toEqual([
      "armcom",
      "Group 1",
      "Base 1",
    ]);
  });

  it("keys an entry by what selecting it selects", () => {
    const out = sceneContents({
      actors: [actor("a1")],
      groups: [group("g1")],
      prefabs: [prefab("p1")],
    });
    expect(out.map((entry) => entry.key)).toEqual([
      placementKey("actor", "a1"),
      placementKey("group", "g1", 0),
      placementKey("prefab", "p1", 0),
    ]);
  });

  it("takes the camera to where each thing stands", () => {
    const out = sceneContents({
      actors: [actor("a1")],
      groups: [group("g1")],
      prefabs: [prefab("p1")],
    });
    expect(out.map((entry) => entry.pos)).toEqual([
      { x: 100, z: 200 },
      { x: 900, z: 400 },
      { x: 2048, z: 64 },
    ]);
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
    const [entry] = sceneContents({ ...empty, prefabs: [prefab("p1")] });
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
    const out = sceneContents({
      actors: [actor("a1")],
      groups: [group("g1")],
      prefabs: [prefab("p1")],
    });
    expect(out.map((entry) => entry.team)).toEqual(["p0", "p1", "p0"]);
  });

  it("holds nothing for a document that places nothing", () => {
    expect(sceneContents(empty)).toEqual([]);
  });
});

describe("contentsSelection", () => {
  const entries = sceneContents({
    actors: [actor("a1")],
    groups: [group("g1")],
    prefabs: [prefab("p1")],
  });

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
    expect(contentsSelection(entries, placementKey("prefab", "p1", 1))).toBe(
      placementKey("prefab", "p1", 0),
    );
  });

  it("lights up nothing for a selection the list does not hold", () => {
    expect(contentsSelection(entries, placementKey("group", "gone", 0))).toBe(
      null,
    );
    expect(contentsSelection(entries, "zone:z1")).toBe(null);
    expect(contentsSelection(entries, null)).toBe(null);
  });
});
