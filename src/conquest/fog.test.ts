import { describe, expect, it } from "vitest";
import { expandRevealed, withinJumps } from "./fog";
import type { GalaxyDoc } from "./model";

/** a - b - c - d - e in a line (ids only; positions/battle irrelevant here). */
function line(): Pick<GalaxyDoc, "nodes" | "links"> {
  const ids = ["a", "b", "c", "d", "e"];
  return {
    nodes: ids.map((id) => ({
      id,
      name: id,
      pos: [0, 0],
      owner: "neutral",
      difficulty: 1,
      battle: { mapName: "m" },
    })),
    links: [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["d", "e"],
    ],
  };
}

describe("withinJumps", () => {
  it("includes the seed and everything up to the hop limit", () => {
    const g = line();
    expect([...withinJumps(g, ["a"], 2)].sort()).toEqual(["a", "b", "c"]);
    expect([...withinJumps(g, ["c"], 1)].sort()).toEqual(["b", "c", "d"]);
  });
});

describe("expandRevealed", () => {
  it("reveals within two jumps of player territory", () => {
    const g = line();
    const owners = { a: "p", b: "neutral", c: "neutral", d: "neutral", e: "n" };
    expect(expandRevealed(g, owners, "p")).toEqual(["a", "b", "c"]);
  });

  it("is monotonic — keeps previously revealed ids even after losing ground", () => {
    const g = line();
    // Player now only holds e; without memory only c,d,e would show.
    const owners = { a: "x", b: "x", c: "x", d: "neutral", e: "p" };
    const prev = ["a", "b", "c"];
    expect(expandRevealed(g, owners, "p", prev)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });
});
