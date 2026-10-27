import { describe, expect, it } from "vitest";
import { newScenario } from "../../create";
import { optionPreview } from "./LayoutPlacer";

const wall = {
  kind: "raise" as const,
  shape: "wall" as const,
  points: [
    { x: 0, z: 0 },
    { x: 64, z: 0 },
  ],
  height: 16,
  before: 0,
};

describe("optionPreview", () => {
  const scenario = {
    ...newScenario("test"),
    blueprints: [
      { id: "ring", name: "Wall ring", buildings: [], terrain: [wall] },
      { id: "none", name: "Nothing", buildings: [] },
    ],
  };

  /** The picker draws a layout of terrain steps alone with the same plan the
   *  Blueprints page uses (issue #4829). */
  it("draws a layout of terrain steps alone", () => {
    expect(
      optionPreview(scenario, [], "scenario:ring", undefined),
    ).not.toBeNull();
  });

  it("draws nothing for a layout with no buildings and no terrain", () => {
    expect(optionPreview(scenario, [], "scenario:none", undefined)).toBeNull();
  });
});
