/**
 * The library's half of a layout page: what it says about the layout it has
 * open, and what it does not offer to change (issue #1454).
 *
 * The page used to carry a name field of its own beside the editor's. Renaming
 * there went straight to the library rather than through the editor's history,
 * so taking back a drag made before the rename took the rename with it: a step
 * back is a whole layout, and the one being restored carries the name the layout
 * had at the time. One field, one route, and the page only names the layout.
 *
 * The editor is stubbed out because it is a three.js surface and this is about
 * the page around it.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { StoredBlueprint } from "../library";

const RECORD: StoredBlueprint = {
  id: "b1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  layout: {
    game: { name: "Beyond All Reason test-1", shortname: "BAR" },
    name: "Opening solars",
    buildings: [
      { def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 },
      { def: "armlab", offset: { x: 96, z: 0 }, facing: 1 },
    ],
    footprints: { armsolar: { x: 4, z: 4 }, armlab: { x: 8, z: 6 } },
  },
};

// Drawers live on the app frame, which is not mounted here, and the editor is a
// 3D surface that cannot render to markup.
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({ open: () => {}, close: () => {}, isOpen: false }),
}));
vi.mock("@/placement/BlueprintEditor", () => ({
  BlueprintEditor: () => null,
}));
vi.mock("@/content/useGameUnits", () => ({
  useGameUnits: () => ({ units: [], loading: false }),
}));
vi.mock("../store", () => ({
  blueprintRoute: (id: string) => `/content/blueprints/${id}`,
  deleteBlueprint: async () => {},
  saveBlueprint: async (record: StoredBlueprint) => record,
  useBlueprintLibrary: () => ({
    records: [RECORD],
    loading: false,
    error: null,
  }),
}));

const { default: BlueprintDetailPage } = await import("./BlueprintDetailPage");

function markup(): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/content/blueprints/b1"] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: "/content/blueprints/:id",
          element: createElement(BlueprintDetailPage),
        }),
      ),
    ),
  );
}

describe("BlueprintDetailPage", () => {
  it("names the layout it has open", () => {
    const html = markup();
    expect(html).toContain("Opening solars");
    expect(html).toContain("2 buildings");
  });

  it("offers no name field of its own, so a rename is an editor edit", () => {
    expect(markup()).not.toContain("<input");
  });

  /** The way to a variant of a layout, rather than drawing it again (issue
   *  #1452). */
  it("offers a copy of the layout", () => {
    expect(markup()).toContain("Duplicate");
  });
});
