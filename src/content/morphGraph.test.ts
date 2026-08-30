import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "./bindings";
import { buildEdgeMap } from "./buildTree";
import { foldMorphs, groupOf, morphEdgeMap, morphGroups } from "./morphGraph";

function unit(
  name: string,
  morphTargets: { into: string }[] = [],
): UnitDatasetEntry {
  return { name, morphTargets };
}

describe("morphEdgeMap", () => {
  it("drops an edge to a unit the game does not have", () => {
    const edges = morphEdgeMap([unit("armcom0", [{ into: "armcom1" }])]);
    expect(edges.get("armcom0")).toEqual([]);
  });

  it("lowercases both ends", () => {
    const units = [unit("ARMCOM0", [{ into: "ArmCom1" }]), unit("armcom1")];
    expect(morphEdgeMap(units).get("armcom0")).toEqual(["armcom1"]);
  });
});

describe("morphGroups", () => {
  it("gathers a ladder under the unit nothing morphs into", () => {
    const units = [
      unit("fedcommander", [{ into: "fedcommander_up1" }]),
      unit("fedcommander_up1", [{ into: "fedcommander_up2" }]),
      unit("fedcommander_up2"),
    ];
    expect(morphGroups(units)).toEqual([
      {
        base: "fedcommander",
        stages: ["fedcommander", "fedcommander_up1", "fedcommander_up2"],
      },
    ]);
  });

  it("keeps a unit that morphs into two things as one group", () => {
    const units = [
      unit("factory", [{ into: "gunyard" }, { into: "airyard" }]),
      unit("gunyard"),
      unit("airyard"),
    ];
    expect(morphGroups(units)).toEqual([
      { base: "factory", stages: ["airyard", "factory", "gunyard"] },
    ]);
  });

  it("survives a loop back to where it started", () => {
    const units = [
      unit("siegemode", [{ into: "walkmode" }]),
      unit("walkmode", [{ into: "siegemode" }]),
    ];
    // Every unit has something morphing into it, so the base is the first by
    // name rather than an exception.
    expect(morphGroups(units)).toEqual([
      { base: "siegemode", stages: ["siegemode", "walkmode"] },
    ]);
  });

  it("leaves a unit that morphs nowhere out of the groups", () => {
    expect(morphGroups([unit("armsolar"), unit("armwin")])).toEqual([]);
  });

  it("does not group two ladders that never meet", () => {
    const units = [
      unit("a1", [{ into: "a2" }]),
      unit("a2"),
      unit("b1", [{ into: "b2" }]),
      unit("b2"),
    ];
    expect(morphGroups(units).map((g) => g.base)).toEqual(["a1", "b1"]);
  });
});

describe("groupOf", () => {
  it("points every stage at its base", () => {
    const groups = morphGroups([
      unit("armcom0", [{ into: "armcom1" }]),
      unit("armcom1"),
    ]);
    const map = groupOf(groups);
    expect(map.get("armcom1")).toBe("armcom0");
    expect(map.get("armcom0")).toBe("armcom0");
  });
});

describe("foldMorphs", () => {
  it("counts a commander and its upgrades once", () => {
    const units = [
      {
        name: "armcom",
        buildOptions: ["armsolar"],
        morphTargets: [{ into: "armcom1" }],
      },
      { name: "armcom1", buildOptions: ["armsolar", "armlab"] },
      { name: "armsolar" },
      { name: "armlab" },
    ];
    const edges = foldMorphs(units, buildEdgeMap(units));
    // What the second stage builds is what the commander builds, and the stage
    // itself is not a node.
    expect(edges.get("armcom")?.sort()).toEqual(["armlab", "armsolar"]);
    expect(edges.has("armcom1")).toBe(false);
  });
});
