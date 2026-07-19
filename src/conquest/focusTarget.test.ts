import { describe, expect, it } from "vitest";
import { factionFocusNode } from "./focusTarget";
import type { GalaxyDoc, GalaxyNode } from "./model";

function node(
  id: string,
  owner: string,
  pos: [number, number],
  kind?: "capital" | "normal",
): GalaxyNode {
  return {
    id,
    name: id,
    pos,
    owner,
    kind,
    difficulty: 1,
    battle: { mapName: "m" },
  };
}

/** cap (capital) at origin, near/far owned normals, plus an enemy world. */
function galaxy(): GalaxyDoc {
  return {
    nodes: [
      node("cap", "arm", [0, 0], "capital"),
      node("near", "arm", [1, 0]),
      node("far", "arm", [10, 0]),
      node("enemy", "core", [5, 5]),
    ],
  } as GalaxyDoc;
}

describe("factionFocusNode", () => {
  it("focuses the capital while the faction still holds it", () => {
    const g = galaxy();
    const owners = { cap: "arm", near: "arm", far: "arm", enemy: "core" };
    expect(factionFocusNode(g, owners, "arm")).toBe("cap");
  });

  it("focuses the owned system nearest the lost capital", () => {
    const g = galaxy();
    // Capital captured; faction still holds two systems.
    const owners = { cap: "core", near: "arm", far: "arm", enemy: "core" };
    expect(factionFocusNode(g, owners, "arm")).toBe("near");
  });

  it("returns null for a faction that has been wiped out", () => {
    const g = galaxy();
    const owners = { cap: "core", near: "core", far: "core", enemy: "core" };
    expect(factionFocusNode(g, owners, "arm")).toBeNull();
  });

  it("falls back to an owned system when no capital is authored", () => {
    const g = {
      nodes: [node("a", "arm", [0, 0]), node("b", "arm", [1, 1])],
    } as GalaxyDoc;
    expect(factionFocusNode(g, { a: "arm", b: "arm" }, "arm")).toBe("a");
  });
});
