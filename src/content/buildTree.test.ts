import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "./bindings";
import {
  buildBuildGraph,
  buildEdgeMap,
  focusNeighbours,
  reachableCounts,
  reachableFrom,
} from "./buildTree";

function unit(name: string, buildOptions: string[] = []): UnitDatasetEntry {
  return { name, buildOptions };
}

describe("reachableFrom", () => {
  it("walks a linear build chain", () => {
    const edges = buildEdgeMap([
      unit("com", ["factory"]),
      unit("factory", ["bot"]),
      unit("bot"),
    ]);
    expect([...reachableFrom("com", edges)].sort()).toEqual([
      "bot",
      "com",
      "factory",
    ]);
  });

  it("counts a shared child only once (diamond)", () => {
    const edges = buildEdgeMap([
      unit("com", ["a", "b"]),
      unit("a", ["shared"]),
      unit("b", ["shared"]),
      unit("shared"),
    ]);
    expect(reachableFrom("com", edges).size).toBe(4);
  });

  it("terminates on self and mutual cycles", () => {
    const edges = buildEdgeMap([
      unit("com", ["factory"]),
      unit("factory", ["con", "factory"]), // self-cycle
      unit("con", ["factory"]), // mutual cycle with factory
    ]);
    expect([...reachableFrom("com", edges)].sort()).toEqual([
      "com",
      "con",
      "factory",
    ]);
  });

  it("matches the start unit case-insensitively", () => {
    const edges = buildEdgeMap([
      unit("armcom", ["armsolar"]),
      unit("armsolar"),
    ]);
    expect(reachableFrom("ArmCom", edges).size).toBe(2);
  });

  it("ignores dangling build options not present as nodes", () => {
    const edges = buildEdgeMap([unit("com", ["ghost", "real"]), unit("real")]);
    expect([...reachableFrom("com", edges)].sort()).toEqual(["com", "real"]);
  });

  it("returns empty for a missing or absent start unit", () => {
    const edges = buildEdgeMap([unit("com", ["a"]), unit("a")]);
    expect(reachableFrom(undefined, edges).size).toBe(0);
    expect(reachableFrom("nope", edges).size).toBe(0);
    expect(reachableFrom("com", new Map()).size).toBe(0);
  });
});

describe("buildBuildGraph", () => {
  it("puts a shared unit's tree edge under the first builder and the rest as extras", () => {
    const edges = buildEdgeMap([
      unit("com", ["conveh", "conair"]),
      unit("conveh", ["solar"]),
      unit("conair", ["solar"]),
      unit("solar"),
    ]);
    const { order, treeEdges, extraEdges } = buildBuildGraph("com", edges);
    // Every reachable unit appears once.
    expect(order.sort()).toEqual(["com", "conair", "conveh", "solar"]);
    // solar's tree parent is conveh (discovered first); conair->solar is an extra.
    expect(treeEdges).toContainEqual({ parent: "conveh", child: "solar" });
    expect(treeEdges).not.toContainEqual({ parent: "conair", child: "solar" });
    expect(extraEdges).toContainEqual({ parent: "conair", child: "solar" });
    // n reachable units -> n-1 tree edges (a spanning tree).
    expect(treeEdges).toHaveLength(order.length - 1);
  });

  it("keeps each builder's unique option under that builder", () => {
    const edges = buildEdgeMap([
      unit("com", ["conveh", "conair"]),
      unit("conveh", ["solar", "advveh"]),
      unit("conair", ["solar", "advair"]),
      unit("solar"),
      unit("advveh"),
      unit("advair"),
    ]);
    const { treeEdges } = buildBuildGraph("com", edges);
    expect(treeEdges).toContainEqual({ parent: "conveh", child: "advveh" });
    expect(treeEdges).toContainEqual({ parent: "conair", child: "advair" });
  });

  it("terminates on cycles and returns empty for a missing start", () => {
    const edges = buildEdgeMap([
      unit("com", ["fac"]),
      unit("fac", ["con", "fac"]),
      unit("con", ["fac"]),
    ]);
    const { order, extraEdges } = buildBuildGraph("com", edges);
    expect(order.sort()).toEqual(["com", "con", "fac"]);
    // The cycle back-edge (con->fac) survives as an extra, not a tree edge.
    expect(extraEdges).toContainEqual({ parent: "con", child: "fac" });
    expect(buildBuildGraph("nope", edges).order).toEqual([]);
  });
});

describe("focusNeighbours", () => {
  it("returns the unit plus its forward builds and reverse builders", () => {
    const edges = buildEdgeMap([
      unit("com", ["conveh", "solar"]),
      unit("conveh", ["solar", "advveh"]),
      unit("solar"),
      unit("advveh"),
    ]);
    // solar is built by com and conveh (reverse); it builds nothing (forward).
    expect([...focusNeighbours("solar", edges)].sort()).toEqual([
      "com",
      "conveh",
      "solar",
    ]);
    // conveh builds solar+advveh (forward) and is built by com (reverse).
    expect([...focusNeighbours("conveh", edges)].sort()).toEqual([
      "advveh",
      "com",
      "conveh",
      "solar",
    ]);
  });

  it("is direct-only — does not expand transitively", () => {
    const edges = buildEdgeMap([
      unit("com", ["fac"]),
      unit("fac", ["con"]),
      unit("con", ["bot"]),
      unit("bot"),
    ]);
    // Focusing fac reaches com (reverse) and con (forward), but NOT bot
    // (con's build option, two hops away) nor com's other ancestors.
    expect([...focusNeighbours("fac", edges)].sort()).toEqual([
      "com",
      "con",
      "fac",
    ]);
  });

  it("returns just the unit when it has no neighbours", () => {
    const edges = buildEdgeMap([unit("com", ["lonely"]), unit("lonely")]);
    // lonely builds nothing; drop com so it has no builder either.
    const isolated = buildEdgeMap([unit("lonely")]);
    expect([...focusNeighbours("lonely", isolated)]).toEqual(["lonely"]);
    // With com present, lonely gains com as a reverse builder.
    expect([...focusNeighbours("lonely", edges)].sort()).toEqual([
      "com",
      "lonely",
    ]);
  });

  it("matches case-insensitively and drops dangling options", () => {
    const edges = buildEdgeMap([unit("Com", ["Ghost", "Real"]), unit("Real")]);
    // Ghost has no node, so it is not a forward neighbour of com.
    expect([...focusNeighbours("com", edges)].sort()).toEqual(["com", "real"]);
  });

  it("returns empty for a missing or absent focus unit", () => {
    const edges = buildEdgeMap([unit("com", ["a"]), unit("a")]);
    expect(focusNeighbours(undefined, edges).size).toBe(0);
    expect(focusNeighbours("nope", edges).size).toBe(0);
  });
});

describe("reachableCounts", () => {
  it("counts reachable units per side, 0 for unknown start units", () => {
    const edges = buildEdgeMap([
      unit("armcom", ["armsolar", "armlab"]),
      unit("armsolar"),
      unit("armlab", ["armpw"]),
      unit("armpw"),
      unit("corcom"), // no build options
    ]);
    const counts = reachableCounts(
      [
        { name: "Arm", startUnit: "armcom" },
        { name: "Core", startUnit: "corcom" },
        { name: "Ghost", startUnit: "missing" },
        { name: "None" },
      ],
      edges,
    );
    expect(counts.get("Arm")).toBe(4);
    expect(counts.get("Core")).toBe(1);
    expect(counts.get("Ghost")).toBe(0);
    expect(counts.get("None")).toBe(0);
  });
});
