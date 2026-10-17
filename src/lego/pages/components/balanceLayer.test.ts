import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { BalanceResult } from "../../balance";
import { buildBalance, disposeBalance } from "./balanceLayer";

const basis = { mesh: 1, box: 0 };

function result(
  status: "inside" | "outside" | "noWidth",
  support: [number, number][],
): BalanceResult {
  return {
    status,
    centre: [1, 1],
    support,
    resting: ["a"],
    outsideBy: 0,
    basis,
  };
}

describe("buildBalance", () => {
  it("draws nothing when the check does not apply", () => {
    expect(
      buildBalance({ status: "notApplicable", reason: "none" }),
    ).toBeNull();
  });

  it("draws an outline, a fill and a dot for a support area", () => {
    const group = buildBalance(
      result("inside", [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ]),
    ) as THREE.Group;

    expect(group.children.map((c) => c.type).sort()).toEqual([
      "Line",
      "Mesh",
      "Points",
    ]);
    disposeBalance(group);
  });

  it("draws only the point a single foot stands on, and the dot", () => {
    const group = buildBalance(result("noWidth", [[0, 0]])) as THREE.Group;

    expect(group.children.map((c) => c.type)).toEqual(["Points", "Points"]);
  });

  it("draws a line, and no fill, for two points", () => {
    const group = buildBalance(
      result("noWidth", [
        [0, 0],
        [0, 6],
      ]),
    ) as THREE.Group;

    expect(group.children.map((c) => c.type).sort()).toEqual([
      "Line",
      "Points",
    ]);
  });
});
