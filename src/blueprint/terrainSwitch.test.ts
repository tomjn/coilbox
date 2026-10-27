import { beforeEach, describe, expect, it } from "vitest";
import { resetShortnames } from "../container/shortnames";
import {
  libraryLayout,
  recordWithLayout,
  type StoredBlueprint,
} from "./library";
import type { TerrainStep } from "./model";
import {
  loadTerrainOverrides,
  resetTerrainOverrides,
  setTerrainOverride,
  terrainEnabled,
  terrainOverrideFor,
} from "./terrainSwitch";
import { blueprintPayload } from "./transfer";

function stubStorage() {
  const held = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => held.get(key) ?? null,
      setItem: (key: string, value: string) => held.set(key, value),
      removeItem: (key: string) => held.delete(key),
    },
  });
  return held;
}

beforeEach(() => {
  stubStorage();
  resetTerrainOverrides();
  resetShortnames();
});

describe("terrainEnabled", () => {
  it("follows detection when nobody has said otherwise", () => {
    expect(terrainEnabled(true, undefined)).toBe(true);
    expect(terrainEnabled(false, undefined)).toBe(false);
  });

  it("is undecided when the game's units have not been read and nobody has said", () => {
    expect(terrainEnabled(undefined, undefined)).toBeUndefined();
  });

  it("lets a choice beat detection in both directions", () => {
    expect(terrainEnabled(false, true)).toBe(true);
    expect(terrainEnabled(true, false)).toBe(false);
  });

  it("lets a choice stand without detection", () => {
    expect(terrainEnabled(undefined, true)).toBe(true);
    expect(terrainEnabled(undefined, false)).toBe(false);
  });
});

describe("the saved choice", () => {
  it("is absent until one is made", () => {
    expect(terrainOverrideFor("zk")).toBeUndefined();
  });

  it("is kept per game", () => {
    setTerrainOverride("zk", false);
    setTerrainOverride("bar", true);
    expect(terrainOverrideFor("zk")).toBe(false);
    expect(terrainOverrideFor("bar")).toBe(true);
    expect(terrainOverrideFor("sf")).toBeUndefined();
  });

  it("is read back from storage", () => {
    setTerrainOverride("zk", false);
    loadTerrainOverrides();
    expect(terrainOverrideFor("zk")).toBe(false);
  });

  it("goes back to detection when set to undefined", () => {
    setTerrainOverride("zk", false);
    setTerrainOverride("zk", undefined);
    loadTerrainOverrides();
    expect(terrainOverrideFor("zk")).toBeUndefined();
  });

  it("ignores a game with no key", () => {
    setTerrainOverride("", false);
    expect(terrainOverrideFor("")).toBeUndefined();
  });

  it("survives storage that holds nonsense", () => {
    localStorage.setItem("coilbox.blueprint.terrain", "{not json");
    loadTerrainOverrides();
    expect(terrainOverrideFor("zk")).toBeUndefined();
  });
});

describe("turning the switch off and on", () => {
  const steps: TerrainStep[] = [
    {
      kind: "raise",
      shape: "wall",
      points: [
        { x: 0, z: 0 },
        { x: 64, z: 0 },
      ],
      height: 24,
      before: 0,
    },
    {
      kind: "level",
      shape: "area",
      points: [
        { x: 0, z: 0 },
        { x: 32, z: 0 },
        { x: 32, z: 32 },
      ],
      height: 0,
      before: 1,
    },
  ];
  const layout = {
    id: "a",
    name: "Wall",
    buildings: [{ def: "armllt", offset: { x: 0, z: 0 }, facing: 0 as const }],
    terrain: steps,
  };
  const record: StoredBlueprint = {
    id: "a",
    createdAt: "",
    updatedAt: "",
    layout: blueprintPayload(layout, { gameName: "Zero-K v1.12" }),
  };

  it("loses no steps and does not touch the stored blueprint", () => {
    const before = structuredClone(record);
    setTerrainOverride("zk", false);
    expect(record).toEqual(before);
    setTerrainOverride("zk", true);
    expect(record).toEqual(before);
    expect(libraryLayout(record).terrain).toEqual(steps);
  });

  it("keeps the steps through an edit made while the switch is off", () => {
    setTerrainOverride("zk", false);
    const edited = recordWithLayout(record, libraryLayout(record));
    expect(libraryLayout(edited).terrain).toEqual(steps);
  });

  it("keeps a terrain only blueprint", () => {
    const only = {
      ...record,
      layout: blueprintPayload(
        { ...layout, buildings: [] },
        { gameName: "Metal Factions" },
      ),
    };
    setTerrainOverride("mf", false);
    expect(libraryLayout(only).terrain).toEqual(steps);
    expect(libraryLayout(only).buildings).toEqual([]);
  });
});
