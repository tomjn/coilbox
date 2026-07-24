import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "./bindings";
import { buildEdgeMap } from "./buildTree";
import {
  buildTechForest,
  isSelected,
  subtreeOf,
  subtreeState,
  toggleSubtree,
  toggleUnit,
  unknownSelected,
} from "./techForest";

function unit(name: string, buildOptions: string[] = []): UnitDatasetEntry {
  return { name, buildOptions };
}

describe("buildTechForest", () => {
  it("roots each faction and nests its build options once", () => {
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
    expect(forest.childrenOf.get("armcom")).toEqual(["armlab", "armsolar"]);
    expect(forest.childrenOf.get("armlab")).toEqual(["armpw"]);
    expect(forest.childrenOf.get("corcom")).toEqual(["corsolar"]);
    expect(forest.ungrouped).toEqual([]);
  });

  it("attaches a shared unit to the first root only (no duplication)", () => {
    const forest = buildTechForest(
      [unit("acom", ["shared"]), unit("bcom", ["shared"]), unit("shared")],
      ["acom", "bcom"],
    );
    // shared is a child of acom (seeded/discovered first), not bcom.
    expect(forest.childrenOf.get("acom")).toEqual(["shared"]);
    expect(forest.childrenOf.get("bcom")).toBeUndefined();
  });

  it("keeps roots top-level even if one builds another", () => {
    const forest = buildTechForest(
      [unit("acom", ["bcom"]), unit("bcom", ["bot"]), unit("bot")],
      ["acom", "bcom"],
    );
    expect(forest.roots).toEqual(["acom", "bcom"]);
    // bcom stays a root, so acom does not adopt it as a child.
    expect(forest.childrenOf.get("acom")).toBeUndefined();
    expect(forest.childrenOf.get("bcom")).toEqual(["bot"]);
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
    expect(forest.childrenOf.get("com")).toEqual(["real"]);
  });

  it("matches roots case-insensitively and lowercases ids", () => {
    const forest = buildTechForest(
      [unit("ArmCom", ["ArmSolar"]), unit("ArmSolar")],
      ["armcom"],
    );
    expect(forest.roots).toEqual(["armcom"]);
    expect(forest.childrenOf.get("armcom")).toEqual(["armsolar"]);
    expect(forest.known.has("armsolar")).toBe(true);
  });

  it("flags builders that build at least one known unit", () => {
    const forest = buildTechForest(
      [unit("com", ["fac"]), unit("fac", ["bot", "ghost"]), unit("bot")],
      ["com"],
    );
    expect(forest.builders.has("com")).toBe(true);
    expect(forest.builders.has("fac")).toBe(true);
    expect(forest.builders.has("bot")).toBe(false);
  });
});

describe("subtreeOf", () => {
  it("returns the unit plus every transitive build option", () => {
    const edges = buildEdgeMap([
      unit("fac", ["bot", "veh"]),
      unit("bot", ["gun"]),
      unit("veh"),
      unit("gun"),
    ]);
    expect([...subtreeOf("fac", edges)].sort()).toEqual([
      "bot",
      "fac",
      "gun",
      "veh",
    ]);
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

describe("toggleSubtree", () => {
  const edges = buildEdgeMap([
    unit("fac", ["bot", "veh"]),
    unit("bot", ["gun"]),
    unit("veh"),
    unit("gun"),
  ]);

  it("adds the unit and its whole subtree, preserving existing entries", () => {
    expect(toggleSubtree(["keep"], "fac", edges, true).sort()).toEqual([
      "bot",
      "fac",
      "gun",
      "keep",
      "veh",
    ]);
  });

  it("does not duplicate already-present subtree members", () => {
    const next = toggleSubtree(["bot"], "fac", edges, true);
    expect(next.filter((x) => x === "bot")).toHaveLength(1);
  });

  it("removes the whole subtree, keeping unrelated entries", () => {
    const start = ["fac", "bot", "gun", "veh", "keep"];
    expect(toggleSubtree(start, "fac", edges, false)).toEqual(["keep"]);
  });

  it("returns the same reference when a removal changes nothing", () => {
    const set = ["keep"];
    expect(toggleSubtree(set, "fac", edges, false)).toBe(set);
  });

  it("falls back to a single toggle for a leaf with no subtree", () => {
    expect(toggleSubtree([], "gun", edges, true)).toEqual(["gun"]);
  });
});

describe("subtreeState", () => {
  const edges = buildEdgeMap([
    unit("fac", ["bot", "veh"]),
    unit("bot", ["gun"]),
    unit("veh"),
    unit("gun"),
  ]);

  it("reports none, some, all across a subtree", () => {
    expect(subtreeState([], "fac", edges)).toBe("none");
    expect(subtreeState(["gun"], "fac", edges)).toBe("some");
    expect(subtreeState(["fac", "bot", "veh", "gun"], "fac", edges)).toBe(
      "all",
    );
  });

  it("reports a leaf on its own selection", () => {
    expect(subtreeState(["gun"], "gun", edges)).toBe("all");
    expect(subtreeState([], "gun", edges)).toBe("none");
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
