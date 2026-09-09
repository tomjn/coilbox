import { describe, expect, it } from "vitest";
import type { StartRect } from "./geometry";
import {
  addMapLayout,
  layoutAlreadySaved,
  normaliseSaved,
  removeMapLayout,
  type SavedStartBoxes,
} from "./saved";

const west: StartRect = { left: 0, top: 0, right: 60, bottom: 200 };
const east: StartRect = { left: 140, top: 0, right: 200, bottom: 200 };
const north: StartRect = { left: 0, top: 0, right: 200, bottom: 60 };

const MAP = "All That Glitters v2.2.3";

describe("normaliseSaved", () => {
  it("carries a store already in the list shape through", () => {
    const store = { [MAP]: [{ id: "x", boxes: { "0": west } }] };
    expect(normaliseSaved(store)).toEqual(store);
  });

  it("migrates the single layout a map used to hold", () => {
    expect(normaliseSaved({ [MAP]: { "0": west, "1": east } })).toEqual({
      [MAP]: [{ id: "saved", boxes: { "0": west, "1": east } }],
    });
  });

  it("gives a migrated layout the same id every read, so React keys hold", () => {
    const stored = { [MAP]: { "0": west } };
    expect(normaliseSaved(stored)[MAP][0].id).toBe(
      normaliseSaved(stored)[MAP][0].id,
    );
  });

  it("drops a map left holding nothing by either shape", () => {
    expect(normaliseSaved({ [MAP]: {}, other: [] })).toEqual({});
  });

  it("reads an empty store", () => {
    expect(normaliseSaved({})).toEqual({});
  });
});

describe("addMapLayout", () => {
  it("appends a layout, oldest first", () => {
    const one = addMapLayout({}, MAP, { "0": west });
    const two = addMapLayout(one, MAP, { "0": north });
    expect(two[MAP]).toHaveLength(2);
    expect(two[MAP][0].boxes).toEqual({ "0": west });
    expect(two[MAP][1].boxes).toEqual({ "0": north });
  });

  it("saves nothing for an empty arrangement", () => {
    const store: SavedStartBoxes = {};
    expect(addMapLayout(store, MAP, {})).toBe(store);
  });

  it("refuses a duplicate, so saving twice leaves one tile", () => {
    const one = addMapLayout({}, MAP, { "0": west, "1": east });
    const again = addMapLayout(one, MAP, { "0": west, "1": east });
    expect(again).toBe(one);
  });

  it("treats a layout on different allies as its own", () => {
    const one = addMapLayout({}, MAP, { "0": west });
    const two = addMapLayout(one, MAP, { "1": west });
    expect(two[MAP]).toHaveLength(2);
  });

  it("keeps each map's layouts apart", () => {
    const store = addMapLayout(addMapLayout({}, MAP, { "0": west }), "other", {
      "0": north,
    });
    expect(store[MAP]).toHaveLength(1);
    expect(store.other).toHaveLength(1);
  });

  it("copies the boxes, so later edits to the live rects don't rewrite it", () => {
    const live: Record<string, StartRect> = { "0": west };
    const store = addMapLayout({}, MAP, live);
    live["1"] = east;
    expect(store[MAP][0].boxes).toEqual({ "0": west });
  });
});

describe("layoutAlreadySaved", () => {
  it("matches an identical arrangement", () => {
    const store = addMapLayout({}, MAP, { "0": west, "1": east });
    expect(layoutAlreadySaved(store, MAP, { "1": east, "0": west })).toBe(true);
  });

  it("does not match one edge off", () => {
    const store = addMapLayout({}, MAP, { "0": west });
    expect(
      layoutAlreadySaved(store, MAP, { "0": { ...west, right: 61 } }),
    ).toBe(false);
  });

  it("does not match a map that has nothing saved", () => {
    expect(layoutAlreadySaved({}, MAP, { "0": west })).toBe(false);
  });
});

describe("removeMapLayout", () => {
  it("removes one layout and keeps the rest", () => {
    const store = addMapLayout(addMapLayout({}, MAP, { "0": west }), MAP, {
      "0": north,
    });
    const left = removeMapLayout(store, MAP, store[MAP][0].id);
    expect(left[MAP]).toHaveLength(1);
    expect(left[MAP][0].boxes).toEqual({ "0": north });
  });

  it("drops the map entirely once its last layout goes", () => {
    const store = addMapLayout({}, MAP, { "0": west });
    expect(removeMapLayout(store, MAP, store[MAP][0].id)).toEqual({});
  });

  it("leaves the store alone for an id it does not hold", () => {
    const store = addMapLayout({}, MAP, { "0": west });
    expect(removeMapLayout(store, MAP, "nope")).toEqual(store);
  });
});
