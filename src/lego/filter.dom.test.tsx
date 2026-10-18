// @vitest-environment happy-dom

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePartFilter } from "./filter";
import type { LegoPartInfo, LoadedPack } from "./pack";

const part = (id: string, shapeId: string, colourway: string) =>
  ({
    id,
    shapeId,
    colourway,
    category: colourway,
    name: id,
    tags: [],
    material: "",
    sourceNames: [],
    packId: "base",
    bbox: { min: [0, 0, 0], max: [1, 1, 1] },
  }) as unknown as LegoPartInfo;

// Pack order scatters the colourways of the two shapes.
const pack = {
  manifest: {
    categories: [
      { id: "green", label: "Team colour" },
      { id: "grey", label: "Grey" },
    ],
    swatches: [],
  },
  parts: [
    part("a-grey", "a", "grey"),
    part("b-grey", "b", "grey"),
    part("a-green", "a", "green"),
    part("b-green", "b", "green"),
  ],
} as unknown as LoadedPack;

describe("usePartFilter", () => {
  it("lists a shape's colourways side by side", () => {
    const { result } = renderHook(() => usePartFilter(pack));
    expect(result.current.parts.map((p) => p.id)).toEqual([
      "a-green",
      "a-grey",
      "b-green",
      "b-grey",
    ]);
  });
});
