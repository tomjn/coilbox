import { describe, expect, it } from "vitest";

import {
  clampPanelHeight,
  KEEP_VIEW,
  MIN_PANEL_HEIGHT,
  panelHeightFrom,
  panelOpenFrom,
  STRIP_HEIGHT,
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
