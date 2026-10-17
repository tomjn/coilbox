import { describe, expect, it } from "vitest";

import { gridLayout } from "./moduleGrid";

const metrics = { cell: 100, label: 20, gap: 10, heading: 30 };

describe("gridLayout", () => {
  it("lays out the user's own modules with no headings, as before", () => {
    const layout = gridLayout([false, false, false], 2, metrics);
    expect(layout.headings).toEqual([]);
    expect(layout.cells).toEqual([
      { left: 0, top: 0 },
      { left: 110, top: 0 },
      { left: 0, top: 130 },
    ]);
    expect(layout.height).toBe(250);
  });

  it("puts the built in modules under their own heading, then the saved ones", () => {
    const layout = gridLayout([true, true, true, false], 2, metrics);
    expect(layout.headings).toEqual([
      { label: "Built in", top: 0 },
      { label: "Saved", top: 290 },
    ]);
    expect(layout.cells).toEqual([
      { left: 0, top: 30 },
      { left: 110, top: 30 },
      { left: 0, top: 160 },
      { left: 0, top: 320 },
    ]);
    expect(layout.height).toBe(440);
  });

  it("shows one heading when every module is built in", () => {
    const layout = gridLayout([true], 3, metrics);
    expect(layout.headings).toEqual([{ label: "Built in", top: 0 }]);
    expect(layout.cells).toEqual([{ left: 0, top: 30 }]);
  });

  it("has nothing to lay out for an empty list", () => {
    expect(gridLayout([], 3, metrics)).toEqual({
      cells: [],
      headings: [],
      height: 0,
    });
  });
});
