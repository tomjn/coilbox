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

/**
 * The same geometry, offered in three categories. Each is its own part with
 * its own texture, not one shape with a colour option, so filtering never
 * folds them together.
 */
const TRIO = [
  part({
    id: "beam_grey",
    shapeId: "beam",
    category: "grey",
    colourway: "grey",
  }),
  part({ id: "beam_tan", shapeId: "beam", category: "tan", colourway: "tan" }),
  part({
    id: "beam_green",
    shapeId: "beam",
    category: "green",
    colourway: "green",
  }),
];

describe("filterParts", () => {
  it("shows every category when none is picked", () => {
    expect(filterParts(TRIO, "", null)).toEqual(TRIO);
  });

  it("keeps only the picked category", () => {
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

  it("applies the search and the category together", () => {
    const parts = [
      ...TRIO,
      part({ id: "hull_tan", shapeId: "hull", category: "tan", name: "hull" }),
    ];

    expect(filterParts(parts, "beam", "tan").map((p) => p.id)).toEqual([
      "beam_tan",
    ]);
  });
});
