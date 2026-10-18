import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  filterParts,
  filterShapes,
  MIXED_CATEGORY,
  SHAPES_CATEGORY,
} from "./filter";
import type { LegoPackManifest, LegoPartInfo } from "./pack";
import { shapeGroups } from "./partOrder";
import type { ShapeKind } from "./shapes";

function part(overrides: Partial<LegoPartInfo> & { id: string }): LegoPartInfo {
  return {
    packId: "base",
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

  it("keeps only the picked pack, and stacks with the rest", () => {
    const parts = [
      ...TRIO,
      part({
        id: "beam_alien",
        packId: "aliens",
        name: "beam",
        category: "tan",
      }),
    ];

    expect(filterParts(parts, "", null, "aliens").map((p) => p.id)).toEqual([
      "beam_alien",
    ]);
    expect(
      filterParts(parts, "beam", "tan", "aliens").map((p) => p.id),
    ).toEqual(["beam_alien"]);
    // Every pack, which is what the picker starts on however many are loaded.
    expect(filterParts(parts, "", null, null)).toEqual(parts);
  });
});

/** One tile per shape in the chosen colourway (#4540). */
describe("a colourway", () => {
  const mixed = part({
    id: "panel_mixed",
    category: MIXED_CATEGORY,
    colourway: MIXED_CATEGORY,
  });
  const hull = part({ id: "hull_grey", shapeId: "hull" });

  it("lists a part that spans colourways under every colourway", () => {
    const parts = [...TRIO, hull, mixed];
    expect(filterParts(parts, "", "grey").map((p) => p.id)).toEqual([
      "beam_grey",
      "hull_grey",
      "panel_mixed",
    ]);
    expect(filterParts(parts, "", "tan").map((p) => p.id)).toEqual([
      "beam_tan",
      "panel_mixed",
    ]);
  });

  it("leaves out a shape it does not have", () => {
    expect(filterParts([...TRIO, hull], "", "green").map((p) => p.id)).toEqual([
      "beam_green",
    ]);
  });

  it("still searches the mixed part", () => {
    expect(filterParts([...TRIO, mixed], "beam", "grey")).toEqual([TRIO[0]]);
  });

  it("leaves the mixed part out of Shapes", () => {
    expect(filterParts([mixed], "", SHAPES_CATEGORY)).toEqual([]);
  });

  describe("on the bundled pack", () => {
    const manifest = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL("../../src-tauri/legoparts/pack.json", import.meta.url),
        ),
        "utf8",
      ),
    ) as LegoPackManifest;
    const parts = manifest.parts.map((p) => ({ ...p, packId: "base" }));
    const groups = shapeGroups(parts, manifest.categories);

    for (const colourway of ["green", "tan", "grey"]) {
      it(`lists every shape once in ${colourway}`, () => {
        const shown = filterParts(parts, "", colourway);
        // 124 shapes in the colourway and the mixed part.
        expect(shown).toHaveLength(125);
        for (const group of groups) {
          const members = group.parts.filter((p) => shown.includes(p));
          expect(members).toHaveLength(1);
          expect([colourway, MIXED_CATEGORY]).toContain(members[0].colourway);
        }
      });
    }
  });
});

describe("filterShapes", () => {
  const kinds: ShapeKind[] = [
    {
      id: "cylinder",
      kind: "cylinder",
      label: "Cylinder",
      size: [2, 2, 2],
      tags: ["round"],
    },
    {
      id: "wedge",
      kind: "wedge",
      label: "Wedge",
      size: [2, 2, 2],
      tags: ["slope"],
    },
  ];

  it("keeps every kind with no search and no category", () => {
    expect(filterShapes(kinds, "", null)).toEqual(kinds);
  });

  it("finds a kind by its name and by its tags", () => {
    expect(filterShapes(kinds, "cyl", null)).toEqual([kinds[0]]);
    expect(filterShapes(kinds, "SLOPE", null)).toEqual([kinds[1]]);
    expect(filterShapes(kinds, "round wedge", null)).toEqual([]);
  });

  it("keeps every kind in the Shapes category and none in a colour", () => {
    expect(filterShapes(kinds, "", SHAPES_CATEGORY)).toEqual(kinds);
    expect(filterShapes(kinds, "", "grey")).toEqual([]);
  });

  it("leaves every part out when the Shapes category is chosen", () => {
    expect(filterParts(TRIO, "", SHAPES_CATEGORY)).toEqual([]);
  });
});
