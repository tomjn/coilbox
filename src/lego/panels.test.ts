import { describe, expect, it } from "vitest";

import {
  clampAsideWidth,
  clampDetailsHeight,
  clampPanelHeight,
  KEEP_VIEW,
  KEEP_VIEW_WIDTH,
  MIN_ASIDE_WIDTH,
  MIN_DETAILS_HEIGHT,
  MIN_PANEL_HEIGHT,
  MIN_TREE_HEIGHT,
  maxAsideWidth,
  maxDetailsHeight,
  panelHeightFrom,
  panelOpenFrom,
  STRIP_HEIGHT,
  visibleWidth,
} from "./panels";

describe("panelOpenFrom", () => {
  it("opens when nothing has been stored", () => {
    expect(panelOpenFrom(null)).toBe(true);
  });

  it("opens on junk rather than throwing or hiding the panel", () => {
    expect(panelOpenFrom("")).toBe(true);
    expect(panelOpenFrom("{}")).toBe(true);
    expect(panelOpenFrom("no")).toBe(true);
  });

  it("closes only on the value it wrote", () => {
    expect(panelOpenFrom("false")).toBe(false);
    expect(panelOpenFrom("true")).toBe(true);
  });
});

describe("panelHeightFrom", () => {
  it("falls back when nothing has been stored", () => {
    expect(panelHeightFrom(null)).toBe(STRIP_HEIGHT);
  });

  it("falls back on junk rather than collapsing the panel", () => {
    expect(panelHeightFrom("")).toBe(STRIP_HEIGHT);
    expect(panelHeightFrom("tall")).toBe(STRIP_HEIGHT);
    expect(panelHeightFrom("0")).toBe(STRIP_HEIGHT);
    expect(panelHeightFrom("-40")).toBe(STRIP_HEIGHT);
  });

  it("reads back what it wrote", () => {
    expect(panelHeightFrom("420")).toBe(420);
  });
});

describe("clampPanelHeight", () => {
  it("leaves a height the window can show alone", () => {
    expect(clampPanelHeight(300, 800)).toBe(300);
  });

  it("keeps some of the model view behind a drag to the bottom", () => {
    expect(clampPanelHeight(10_000, 800)).toBe(800 - KEEP_VIEW);
  });

  it("stops short of a panel with only its header", () => {
    expect(clampPanelHeight(0, 800)).toBe(MIN_PANEL_HEIGHT);
  });

  // A window too short for both still has to show the panel someone opened,
  // so the floor outranks the space kept for the view.
  it("gives the panel its floor in a window with no room for either", () => {
    expect(clampPanelHeight(400, 200)).toBe(MIN_PANEL_HEIGHT);
  });

  it("rounds, since a drag lands on fractional pixels", () => {
    expect(clampPanelHeight(300.6, 800)).toBe(301);
  });
});

describe("clampAsideWidth", () => {
  it("leaves a width the window can show alone", () => {
    expect(clampAsideWidth(400, 1600)).toBe(400);
  });

  it("never goes narrower than the panel was before it could be dragged", () => {
    expect(clampAsideWidth(100, 1600)).toBe(MIN_ASIDE_WIDTH);
    expect(clampAsideWidth(-5, 1600)).toBe(MIN_ASIDE_WIDTH);
  });

  it("leaves the model view its width at the far end of a drag", () => {
    expect(clampAsideWidth(10_000, 1600)).toBe(1600 - KEEP_VIEW_WIDTH);
    expect(maxAsideWidth(1600)).toBe(1600 - KEEP_VIEW_WIDTH);
  });

  it("gives the panel its floor in a window too narrow for both", () => {
    expect(clampAsideWidth(500, 700)).toBe(MIN_ASIDE_WIDTH);
    expect(maxAsideWidth(0)).toBe(MIN_ASIDE_WIDTH);
  });

  it("rounds, since a drag lands on fractional pixels", () => {
    expect(clampAsideWidth(400.4, 1600)).toBe(400);
  });
});

describe("visibleWidth", () => {
  it("is the row's width when the row fits the window", () => {
    expect(visibleWidth(1300, 0, 1300)).toBe(1300);
  });

  it("stops at the window's right edge when the row runs past it", () => {
    expect(visibleWidth(1424, 100, 1300)).toBe(1200);
  });

  it("is zero for a row entirely off screen", () => {
    expect(visibleWidth(500, 2000, 1300)).toBe(0);
  });

  it("keeps a stored side panel width on screen in a narrow window", () => {
    const space = visibleWidth(1424, 0, 1300);
    expect(clampAsideWidth(660, space)).toBe(1300 - KEEP_VIEW_WIDTH);
  });
});

describe("clampDetailsHeight", () => {
  it("leaves a height the column can show alone", () => {
    expect(clampDetailsHeight(300, 800)).toBe(300);
  });

  it("stops short of details with only their header", () => {
    expect(clampDetailsHeight(0, 800)).toBe(MIN_DETAILS_HEIGHT);
  });

  it("leaves the tree its minimum at the far end of a drag", () => {
    expect(clampDetailsHeight(10_000, 800)).toBe(800 - MIN_TREE_HEIGHT);
    expect(maxDetailsHeight(800)).toBe(800 - MIN_TREE_HEIGHT);
  });

  it("gives the details their floor in a column too short for both", () => {
    expect(clampDetailsHeight(400, 200)).toBe(MIN_DETAILS_HEIGHT);
  });

  it("rounds, since a drag lands on fractional pixels", () => {
    expect(clampDetailsHeight(300.6, 800)).toBe(301);
  });
});
