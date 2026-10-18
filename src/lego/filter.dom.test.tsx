// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
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

  it("counts the parts a colourway holds, the mixed part too", () => {
    const withMixed = {
      ...pack,
      parts: [...pack.parts, part("m", "m", "mixed")],
    } as unknown as LoadedPack;
    const { result } = renderHook(() => usePartFilter(withMixed));
    expect(result.current.total).toBe(5);
    act(() => result.current.setCategory("grey"));
    expect(result.current.total).toBe(3);
    act(() => result.current.setQuery("a-"));
    expect(result.current.parts.map((p) => p.id)).toEqual(["a-grey"]);
    expect(result.current.total).toBe(3);
  });
});
