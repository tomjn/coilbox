import { describe, expect, it } from "vitest";

import { filterParts } from "./filter";
import type { LegoPartInfo } from "./pack";

function part(overrides: Partial<LegoPartInfo> & { id: string }): LegoPartInfo {
  return {
    shapeId: overrides.id,
    name: overrides.id,
    category: "grey",
    colourway: "grey",
    shape: "beam",
    material: "metal",
    tags: [],
    vFirst: 0,
    vCount: 0,
    iFirst: 0,
    iCount: 0,
    bbox: { min: [0, 0, 0], max: [1, 1, 1] },
    uvBox: { min: [0, 0], max: [1, 1] },
    pivot: [0, 0, 0],
    sourceNames: [],
    aliasCount: 0,
    ...overrides,
  };
}

/** The same shape in three colourways, which is how most of the pack is built. */
const TRIO = [
  part({ id: "beam_grey", shapeId: "beam", colourway: "grey" }),
  part({ id: "beam_tan", shapeId: "beam", colourway: "tan" }),
  part({ id: "beam_green", shapeId: "beam", colourway: "green" }),
];

describe("filterParts", () => {
  it("collapses colourways to one part per shape until one is picked", () => {
    expect(filterParts(TRIO, "", null)).toHaveLength(1);
    expect(filterParts(TRIO, "", "tan")).toEqual([TRIO[1]]);
  });

  it("matches on tags and on the original object names", () => {
    const parts = [
      part({ id: "a", tags: ["cockpit"] }),
      part({ id: "b", sourceNames: ["legs_walker_02"] }),
      part({ id: "c" }),
    ];

    expect(filterParts(parts, "cockpit", null).map((p) => p.id)).toEqual(["a"]);
    expect(filterParts(parts, "walker", null).map((p) => p.id)).toEqual(["b"]);
  });

  it("requires every term, in any order and any case", () => {
    const parts = [
      part({ id: "a", name: "long thin beam" }),
      part({ id: "b", name: "long fat beam" }),
    ];

    expect(filterParts(parts, "BEAM thin", null).map((p) => p.id)).toEqual([
      "a",
    ]);
    expect(filterParts(parts, "beam nothing", null)).toEqual([]);
  });

  it("applies the search and the colourway together", () => {
    const parts = [
      ...TRIO,
      part({ id: "hull_tan", shapeId: "hull", colourway: "tan", name: "hull" }),
    ];

    expect(filterParts(parts, "beam", "tan").map((p) => p.id)).toEqual([
      "beam_tan",
    ]);
  });
});
