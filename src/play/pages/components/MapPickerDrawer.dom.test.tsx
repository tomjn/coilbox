// @vitest-environment happy-dom

/**
 * The map picker's search box (issue #350). mapinfo.lua carries no structured
 * play-type field on any installed map we scanned, so fixed "1v1"/"ffa"/
 * "survival" tabs would filter almost nothing and risk misrepresenting
 * coverage. What some mappers do put in is the type as free text in the
 * description ("1v1 Map by...", "Survival Hill on..."), so the fix widens the
 * existing name search to match description too, rather than inventing a
 * category system the data can't back up.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MapItem } from "@/content/bindings";
import type { MapThumbData } from "@/content/config";
import { MapPickerDrawer } from "./MapPickerDrawer";

afterEach(cleanup);

function map(name: string, description?: string): MapItem {
  return {
    name,
    archives: [{ name: `${name}.sd7`, path: `/maps/${name}.sd7` }],
    info: description ? { description } : {},
  };
}

const MAPS: MapItem[] = [
  map("Duelling Grounds", "1v1 Map by Quanto"),
  map("Chicken Farm", "Survival Hill against the Chickens"),
  map("Flatlands", "32 player FFA over a massive continent"),
  map("No Description Map"),
];

function renderDrawer(maps: MapItem[] = MAPS) {
  return render(
    <MapPickerDrawer
      open
      onOpenChange={() => {}}
      maps={maps}
      thumbs={new Map<string, MapThumbData>()}
      selectedName=""
      onSelect={() => {}}
    />,
  );
}

describe("MapPickerDrawer search", () => {
  it("shows every map with no query, including one with no description", () => {
    renderDrawer();
    expect(screen.getByText("Duelling Grounds")).toBeTruthy();
    expect(screen.getByText("Chicken Farm")).toBeTruthy();
    expect(screen.getByText("Flatlands")).toBeTruthy();
    expect(screen.getByText("No Description Map")).toBeTruthy();
  });

  it("narrows by a term that only appears in the description", () => {
    renderDrawer();
    fireEvent.change(screen.getByPlaceholderText(/Search 4 maps/), {
      target: { value: "survival" },
    });
    expect(screen.getByText("Chicken Farm")).toBeTruthy();
    expect(screen.queryByText("Duelling Grounds")).toBeNull();
    expect(screen.queryByText("Flatlands")).toBeNull();
    expect(screen.queryByText("No Description Map")).toBeNull();
  });

  it("still matches by name alongside the description search", () => {
    renderDrawer();
    fireEvent.change(screen.getByPlaceholderText(/Search 4 maps/), {
      target: { value: "flatlands" },
    });
    expect(screen.getByText("Flatlands")).toBeTruthy();
    expect(screen.queryByText("Chicken Farm")).toBeNull();
  });

  it("matching a query against a map with no description never throws", () => {
    renderDrawer();
    fireEvent.change(screen.getByPlaceholderText(/Search 4 maps/), {
      target: { value: "no description" },
    });
    expect(screen.getByText("No Description Map")).toBeTruthy();
  });

  it("says no maps match an unmatched query", () => {
    renderDrawer();
    fireEvent.change(screen.getByPlaceholderText(/Search 4 maps/), {
      target: { value: "nonexistent" },
    });
    expect(screen.getByText(/No maps match/)).toBeTruthy();
  });
});
