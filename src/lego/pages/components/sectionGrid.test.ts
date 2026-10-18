import { describe, expect, it } from "vitest";

import {
  sectionCount,
  sectionLayout,
  stepFrom,
  tileAt,
  tilesBetween,
} from "./sectionGrid";

const metrics = { cell: 100, label: 20, gap: 10, heading: 30, sectionGap: 5 };

describe("sectionLayout", () => {
  it("puts each section under its heading, one after another", () => {
    // 3 then 1, two across: rows of 130 (100 + 20 + 10).
    const layout = sectionLayout([3, 1], 2, metrics);
    expect(layout.sections).toEqual([
      { top: 0, cellsTop: 30, first: 0, count: 3 },
      // 30 + 2 rows of 130, then the gap above a heading.
      { top: 295, cellsTop: 325, first: 3, count: 1 },
    ]);
    expect([0, 1, 2, 3].map((index) => tileAt(layout, index))).toEqual([
      { left: 0, top: 30 },
      { left: 110, top: 30 },
      { left: 0, top: 160 },
      { left: 0, top: 325 },
    ]);
    // The last row's own gap is not part of the grid.
    expect(layout.height).toBe(325 + 130 - 10);
    expect(layout.total).toBe(4);
  });

  it("leaves out a section with nothing in it, heading and all", () => {
    const layout = sectionLayout([0, 2, 0, 1], 4, metrics);
    expect(layout.sections.map((section) => section.count)).toEqual([2, 1]);
    expect(layout.sections[1].first).toBe(2);
    expect(tileAt(layout, 2)).toEqual({ left: 0, top: 30 + 130 + 5 + 30 });
  });

  it("has nothing to lay out for no tiles", () => {
    const layout = sectionLayout([0, 0], 3, metrics);
    expect(layout.sections).toEqual([]);
    expect(layout.height).toBe(0);
    expect(tileAt(layout, 0)).toBeUndefined();
  });
});

describe("tilesBetween", () => {
  // 10 tiles two across, then 4: rows at 30, 160, 290, 420, 550, then the
  // second section's rows at 715 and 845.
  const layout = sectionLayout([10, 4], 2, metrics);

  it("gives only the rows on screen, in list order", () => {
    // Row 1 runs from 160 to 290, the gap under it included.
    expect(tilesBetween(layout, 165, 280)).toEqual([2, 3]);
  });

  it("runs across a section's edge", () => {
    expect(tilesBetween(layout, 560, 720)).toEqual([8, 9, 10, 11]);
  });

  it("adds rows either side, but none outside a section", () => {
    expect(tilesBetween(layout, 860, 900, 1)).toEqual([10, 11, 12, 13]);
    // Only the heading is on screen, so the one row added is the first.
    expect(tilesBetween(layout, 0, 20, 1)).toEqual([0, 1]);
  });
});

describe("stepFrom", () => {
  // Shapes 6, parts 5, built in 2, three across:
  //   0 1 2 / 3 4 5 | 6 7 8 / 9 10 | 11 12
  const layout = sectionLayout([6, 5, 2], 3, metrics);

  it("moves along the whole list with left and right", () => {
    expect(stepFrom(layout, 5, "ArrowRight")).toBe(6);
    expect(stepFrom(layout, 6, "ArrowLeft")).toBe(5);
    expect(stepFrom(layout, 12, "ArrowRight")).toBe(12);
    expect(stepFrom(layout, 0, "ArrowLeft")).toBe(0);
  });

  it("goes down into the next section in the same column", () => {
    expect(stepFrom(layout, 1, "ArrowDown")).toBe(4);
    expect(stepFrom(layout, 4, "ArrowDown")).toBe(7);
  });

  it("goes up into the previous section's last row", () => {
    expect(stepFrom(layout, 7, "ArrowUp")).toBe(4);
    expect(stepFrom(layout, 12, "ArrowUp")).toBe(10);
  });

  it("stops at the last tile of a short row", () => {
    // Column 2 of parts' first row, and the built in row has only two.
    expect(stepFrom(layout, 8, "ArrowDown")).toBe(10);
    expect(stepFrom(layout, 10, "ArrowDown")).toBe(12);
  });

  it("stays put at either end", () => {
    expect(stepFrom(layout, 11, "ArrowDown")).toBe(11);
    expect(stepFrom(layout, 2, "ArrowUp")).toBe(2);
  });

  it("pages four rows across sections, and jumps to either end", () => {
    expect(stepFrom(layout, 0, "PageDown")).toBe(11);
    expect(stepFrom(layout, 12, "PageUp")).toBe(1);
    expect(stepFrom(layout, 7, "Home")).toBe(0);
    expect(stepFrom(layout, 7, "End")).toBe(12);
  });

  it("ignores any other key", () => {
    expect(stepFrom(layout, 3, "Enter")).toBeUndefined();
  });
});

describe("sectionCount", () => {
  it("is the number alone when nothing narrows the section", () => {
    expect(sectionCount(373, 373)).toBe("373");
  });

  it("says how many of the whole while a filter narrows it", () => {
    expect(sectionCount(12, 373)).toBe("12 of 373");
  });
});
