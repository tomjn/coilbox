import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { LegoPackManifest, LegoPartInfo } from "./pack";
import {
  partTitles,
  shapeGroups,
  sortByShape,
  visibleTags,
} from "./partOrder";

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

/** The bundled pack's category order: team colour, tan, grey, mixed. */
const ORDER = [
  { id: "green", label: "Team colour" },
  { id: "tan", label: "Tan" },
  { id: "grey", label: "Grey" },
  { id: "mixed", label: "Mixed" },
];

describe("visibleTags", () => {
  it("drops atlas row tags and keeps the rest in order", () => {
    expect(visibleTags(["block", "huge", "row3"])).toEqual(["block", "huge"]);
  });

  it("keeps a tag that only starts with row", () => {
    expect(visibleTags(["rowing", "row", "row12x"])).toEqual([
      "rowing",
      "row",
      "row12x",
    ]);
  });
});

describe("shapeGroups and sortByShape", () => {
  // Pack order scatters the colourways of two shapes.
  const parts = [
    part({ id: "a-grey", shapeId: "a", colourway: "grey" }),
    part({ id: "b-grey", shapeId: "b", colourway: "grey" }),
    part({ id: "a-tan", shapeId: "a", colourway: "tan" }),
    part({ id: "b-green", shapeId: "b", colourway: "green" }),
    part({ id: "a-green", shapeId: "a", colourway: "green" }),
  ];

  it("keeps the colourways of one shape side by side, in category order", () => {
    const sorted = sortByShape(parts, shapeGroups(parts, ORDER));
    expect(sorted.map((p) => p.id)).toEqual([
      "a-green",
      "a-tan",
      "a-grey",
      "b-green",
      "b-grey",
    ]);
  });

  it("orders shapes by where each first appears in the pack", () => {
    const groups = shapeGroups(parts, ORDER);
    expect(groups.map((g) => g.parts.map((p) => p.id))).toEqual([
      ["a-green", "a-tan", "a-grey"],
      ["b-green", "b-grey"],
    ]);
  });

  it("sorts a filtered subset by the groups of the whole pack", () => {
    const groups = shapeGroups(parts, ORDER);
    const subset = [parts[3], parts[0], parts[1]];
    expect(sortByShape(subset, groups).map((p) => p.id)).toEqual([
      "a-grey",
      "b-green",
      "b-grey",
    ]);
  });

  it("puts a colourway the order does not name after those it does", () => {
    const odd = [
      part({ id: "x-red", shapeId: "x", colourway: "red" }),
      part({ id: "x-grey", shapeId: "x", colourway: "grey" }),
    ];
    expect(
      shapeGroups(odd, ORDER)[0].parts.map((p) => p.id),
    ).toEqual(["x-grey", "x-red"]);
  });

  it("joins groups with the same name and size and different colourways", () => {
    // The bundled pack gives the team colour plate its own mesh.
    const split = [
      part({ id: "g", shapeId: "g1", name: "grey plate 1", colourway: "grey" }),
      part({
        id: "t",
        shapeId: "t1",
        name: "team colour plate 1",
        colourway: "green",
      }),
      part({ id: "n", shapeId: "n1", name: "tan plate 1", colourway: "tan" }),
      ...["green", "tan", "grey"].map((colourway) =>
        part({
          id: `beam-${colourway}`,
          shapeId: "beam",
          name: `${colourway} beam`,
          colourway,
        }),
      ),
    ];
    const groups = shapeGroups(split, ORDER);
    expect(groups).toHaveLength(2);
    expect(groups[0].parts.map((p) => p.id)).toEqual(["t", "n", "g"]);
  });

  it("does not join groups that would repeat a colourway", () => {
    const twins = [
      part({ id: "g1", shapeId: "s1", name: "grey beam", colourway: "grey" }),
      part({ id: "g2", shapeId: "s2", name: "grey beam", colourway: "grey" }),
    ];
    expect(shapeGroups(twins, ORDER)).toHaveLength(2);
  });
});

describe("partTitles", () => {
  it("leaves a name that is unique alone", () => {
    const parts = [part({ id: "a", name: "grey beam", sourceNames: ["O1"] })];
    expect(partTitles(parts).get("a")).toBe("grey beam");
  });

  it("adds the source object name to parts that share a name", () => {
    const parts = [
      part({ id: "a", name: "grey beam", sourceNames: ["Object12"] }),
      part({ id: "b", name: "grey beam", sourceNames: ["Object40"] }),
      part({ id: "c", name: "tan beam", sourceNames: ["Object41"] }),
    ];
    const titles = partTitles(parts);
    expect(titles.get("a")).toBe("grey beam (Object12)");
    expect(titles.get("b")).toBe("grey beam (Object40)");
    expect(titles.get("c")).toBe("tan beam");
  });

  it("joins several source objects", () => {
    const parts = [
      part({ id: "a", name: "n", sourceNames: ["O1", "O2"] }),
      part({ id: "b", name: "n", sourceNames: ["O3"] }),
    ];
    expect(partTitles(parts).get("a")).toBe("n (O1, O2)");
  });

  it("leaves names alone when a part has no source object to add", () => {
    const parts = [
      part({ id: "a", name: "n", sourceNames: [] }),
      part({ id: "b", name: "n", sourceNames: [] }),
    ];
    expect(partTitles(parts).get("a")).toBe("n");
  });
});

describe("the bundled pack", () => {
  const manifest = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL("../../src-tauri/legoparts/pack.json", import.meta.url),
      ),
      "utf8",
    ),
  ) as LegoPackManifest;
  const parts = manifest.parts.map((p) => ({ ...p, packId: "base" }));
  const order = manifest.categories;

  it("has 124 shapes of three colourways, and the one mixed part", () => {
    const groups = shapeGroups(parts, order);
    const sizes = new Map<number, number>();
    for (const g of groups) {
      sizes.set(g.parts.length, (sizes.get(g.parts.length) ?? 0) + 1);
    }
    expect([...sizes]).toEqual(
      expect.arrayContaining([
        [3, 124],
        [1, 1],
      ]),
    );
    expect(groups).toHaveLength(125);
  });

  it("lists each shape's colourways together, team colour first", () => {
    const sorted = sortByShape(parts, shapeGroups(parts, order));
    expect(sorted).toHaveLength(parts.length);
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i].colourway !== "green") continue;
      expect(sorted[i + 1].colourway).toBe("tan");
      expect(sorted[i + 2].colourway).toBe("grey");
    }
  });

  it("gives every part a different title", () => {
    const titles = [...partTitles(parts).values()];
    expect(new Set(titles).size).toBe(parts.length);
  });
});
