import { describe, expect, it } from "vitest";
import { layoutFocusTree } from "./buildTreeLayout";

describe("layoutFocusTree", () => {
  it("centres the focused unit at the origin", () => {
    const pos = layoutFocusTree("com", [], []);
    // Only the focused node, centred horizontally on x=0 (top-left = -nodeW/2).
    expect([...pos.keys()]).toEqual(["com"]);
    const p = pos.get("com");
    expect(p?.y).toBe(0);
    expect(p?.x).toBe(-104 / 2);
  });

  it("puts builds below and built-by above the focused unit", () => {
    const pos = layoutFocusTree("factory", ["bot"], ["com"]);
    const focused = pos.get("factory");
    const build = pos.get("bot");
    const builder = pos.get("com");
    expect(focused).toBeDefined();
    expect(build).toBeDefined();
    expect(builder).toBeDefined();
    // Built-by sits above (smaller y), builds sit below (larger y).
    // biome-ignore lint/style/noNonNullAssertion: asserted defined above
    expect(builder!.y).toBeLessThan(focused!.y);
    // biome-ignore lint/style/noNonNullAssertion: asserted defined above
    expect(build!.y).toBeGreaterThan(focused!.y);
  });

  it("centres each band horizontally around the focused unit", () => {
    // Two builds -> the pair straddles x=0 symmetrically.
    const pos = layoutFocusTree("f", ["a", "b"], []);
    const a = pos.get("a");
    const b = pos.get("b");
    // biome-ignore lint/style/noNonNullAssertion: keys placed above
    expect(a!.x).toBeLessThan(0);
    // biome-ignore lint/style/noNonNullAssertion: keys placed above
    expect(b!.x).toBeGreaterThan(0);
    // biome-ignore lint/style/noNonNullAssertion: keys placed above
    expect(a!.x + b!.x).toBeCloseTo(-104, 5); // symmetric about the node centres
  });

  it("wraps a large band into a square-ish grid (uses vertical space)", () => {
    const builds = Array.from({ length: 9 }, (_, i) => `u${i}`);
    const pos = layoutFocusTree("hub", builds, []);
    const ys = new Set(builds.map((id) => pos.get(id)?.y));
    // 9 nodes -> 3 columns over 3 rows, not one wide strip.
    expect(ys.size).toBe(3);
  });

  it("is deterministic for a given input order", () => {
    const a = layoutFocusTree("f", ["x", "y"], ["p"]);
    const b = layoutFocusTree("f", ["x", "y"], ["p"]);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it("handles the no-neighbour case as a lone centred node", () => {
    const pos = layoutFocusTree("solo", [], []);
    expect(pos.size).toBe(1);
    expect(pos.get("solo")).toEqual({ x: -52, y: 0 });
  });
});
