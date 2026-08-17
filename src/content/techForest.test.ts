import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "./bindings";
import {
  buildTechForest,
  factionGroups,
  isSelected,
  toggleUnit,
  unknownSelected,
} from "./techForest";

function unit(name: string, buildOptions: string[] = []): UnitDatasetEntry {
  return { name, buildOptions };
}

describe("buildTechForest", () => {
  it("assigns every unit a faction its commander reaches", () => {
    const forest = buildTechForest(
      [
        unit("armcom", ["armsolar", "armlab"]),
        unit("armsolar"),
        unit("armlab", ["armpw"]),
        unit("armpw"),
        unit("corcom", ["corsolar"]),
        unit("corsolar"),
      ],
      ["armcom", "corcom"],
    );
    expect(forest.roots).toEqual(["armcom", "corcom"]);
    // Depth is not recorded: armpw is two build steps from the commander and
    // sits in the same block as the lab that makes it.
    expect(forest.factionOf.get("armpw")).toBe("armcom");
    expect(forest.factionOf.get("armlab")).toBe("armcom");
    expect(forest.factionOf.get("corsolar")).toBe("corcom");
    expect(forest.ungrouped).toEqual([]);
  });

  it("gives a unit both factions build to the first of them", () => {
    const forest = buildTechForest(
      [unit("acom", ["shared"]), unit("bcom", ["shared"]), unit("shared")],
      ["acom", "bcom"],
    );
    expect(forest.factionOf.get("shared")).toBe("acom");
  });

  it("keeps a root in its own faction even if another root builds it", () => {
    const forest = buildTechForest(
      [unit("acom", ["bcom"]), unit("bcom", ["bot"]), unit("bot")],
      ["acom", "bcom"],
    );
    expect(forest.roots).toEqual(["acom", "bcom"]);
    expect(forest.factionOf.get("bcom")).toBe("bcom");
    expect(forest.factionOf.get("bot")).toBe("bcom");
  });

  it("collects units unreachable from any root as ungrouped", () => {
    const forest = buildTechForest(
      [unit("com", ["fac"]), unit("fac"), unit("orphan"), unit("floater")],
      ["com"],
    );
    expect(forest.ungrouped).toEqual(["floater", "orphan"]);
  });

  it("ignores unknown roots and dangling build options", () => {
    const forest = buildTechForest(
      [unit("com", ["real", "ghost"]), unit("real")],
      ["nope", "com"],
    );
    expect(forest.roots).toEqual(["com"]);
    expect(forest.factionOf.get("real")).toBe("com");
    expect(forest.factionOf.has("ghost")).toBe(false);
  });

  it("matches roots case-insensitively and lowercases ids", () => {
    const forest = buildTechForest(
      [unit("ArmCom", ["ArmSolar"]), unit("ArmSolar")],
      ["armcom"],
    );
    expect(forest.roots).toEqual(["armcom"]);
    expect(forest.factionOf.get("armsolar")).toBe("armcom");
    expect(forest.known.has("armsolar")).toBe(true);
  });
});

describe("factionGroups", () => {
  const forest = buildTechForest(
    [
      unit("armcom", ["armlab"]),
      unit("armlab", ["armpw"]),
      unit("armpw"),
      unit("corcom", ["corsolar"]),
      unit("corsolar"),
      unit("scenery"),
    ],
    ["armcom", "corcom"],
  );
  const NAMES: Record<string, string> = {
    armcom: "Commander",
    armlab: "Bot Lab",
    armpw: "Peewee",
    corcom: "Commander",
    corsolar: "Solar Collector",
    scenery: "Rock",
  };
  const label = (id: string) => NAMES[id] ?? id;
  const heading = (root: string) => (root === "armcom" ? "Armada" : "Cortex");

  it("lists a faction's units flat, by name, whatever builds them", () => {
    const [armada] = factionGroups(forest, label, heading);
    // The lab and the unit it makes are siblings here, and the commander is not
    // first: the reader gets one alphabetical list per faction.
    expect(armada.label).toBe("Armada");
    expect(armada.units).toEqual(["armlab", "armcom", "armpw"]);
  });

  it("keeps factions in root order and puts the rest last", () => {
    const groups = factionGroups(forest, label, heading);
    expect(groups.map((g) => g.label)).toEqual([
      "Armada",
      "Cortex",
      "Other units",
    ]);
    expect(groups[2].units).toEqual(["scenery"]);
  });

  it("drops a block the search empties", () => {
    const groups = factionGroups(forest, label, heading, (id) =>
      id.startsWith("cor"),
    );
    expect(groups.map((g) => g.label)).toEqual(["Cortex"]);
  });
});

describe("toggleUnit", () => {
  it("adds the lowercased id when turning on", () => {
    expect(toggleUnit([], "ArmFlash", true)).toEqual(["armflash"]);
  });

  it("is idempotent on add and returns the same reference", () => {
    const set = ["armflash"];
    expect(toggleUnit(set, "armflash", true)).toBe(set);
  });

  it("removes case-insensitively", () => {
    expect(toggleUnit(["ArmFlash", "corcom"], "armflash", false)).toEqual([
      "corcom",
    ]);
  });

  it("returns the same reference when removing an absent id", () => {
    const set = ["corcom"];
    expect(toggleUnit(set, "armflash", false)).toBe(set);
  });
});

describe("unknownSelected / isSelected", () => {
  it("returns stored ids absent from the dataset, in original form", () => {
    const known = new Set(["armcom", "armsolar"]);
    expect(unknownSelected(["ArmSolar", "oldunit", "gone"], known)).toEqual([
      "oldunit",
      "gone",
    ]);
  });

  it("matches selection case-insensitively", () => {
    expect(isSelected(["ArmFlash"], "armflash")).toBe(true);
    expect(isSelected(["ArmFlash"], "corcom")).toBe(false);
  });
});
