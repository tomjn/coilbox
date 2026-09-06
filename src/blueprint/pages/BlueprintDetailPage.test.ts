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

import type { BlueprintSource, StoredBlueprint } from "../library";

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

/** The record the page has open, so a test can give the layout a past. */
let open: StoredBlueprint = RECORD;

// Drawers live on the app frame, which is not mounted here, and the editor is a
// 3D surface that cannot render to markup.
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({ open: () => {}, close: () => {}, isOpen: false }),
}));
vi.mock("@/placement/BlueprintEditor", () => ({
  BlueprintEditor: () => null,
}));
// Named rather than nulled, so a test can tell "the map check is not mounted"
// from "it is mounted and drew nothing" (issue #1457).
vi.mock("@/placement/BlueprintOnMap", () => ({
  BlueprintOnMap: () => createElement("p", null, "the map check"),
}));
// The build the layout's game resolved to, which is the record's own name
// until a test says the archive has gone and another build answered for it.
let resolved: string | undefined = RECORD.layout.game?.name;
vi.mock("@/content/useGameUnits", () => ({
  useGameUnits: () => ({ units: [], loading: false, resolved }),
}));
// The hub backfill reads the hub address off the frame's settings store, which
// is not mounted here, and it has its own tests (issue #1636).
vi.mock("@/hub/assets/useBlueprintBackfill", () => ({
  useBlueprintBackfill: () => {},
}));
// The widget file sync reaches the play state and the engine config, which
// this test does not stand up. What it does is tested on its own.
vi.mock("../useWidgetFiles", () => ({ useWidgetFiles: () => {} }));
vi.mock("../store", () => ({
  blueprintRoute: (id: string) => `/library/blueprints/${id}`,
  deleteBlueprint: async () => {},
  saveBlueprint: async (record: StoredBlueprint) => record,
  useBlueprintLibrary: () => ({
    records: [open],
    loading: false,
    error: null,
  }),
}));

const { default: BlueprintDetailPage } = await import("./BlueprintDetailPage");

function markup(): string {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/library/blueprints/b1"] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: "/library/blueprints/:id",
          element: createElement(BlueprintDetailPage),
        }),
      ),
    ),
  );
}

/** The page, for a layout that arrived from somewhere. */
function markupFrom(source: BlueprintSource): string {
  open = { ...RECORD, source };
  try {
    return markup();
  } finally {
    open = RECORD;
  }
}

describe("BlueprintDetailPage", () => {
  it("names the layout it has open", () => {
    const html = markup();
    expect(html).toContain("Opening solars");
    expect(html).toContain("2 buildings");
  });

  /**
   * A game that releases often leaves every layout naming a build nobody has
   * any more. The shortname recognises the newest one as the same game, so the
   * layout still opens, and the page says which build it opened with rather
   * than quietly showing another version's models under the old name.
   */
  describe("a layout whose build has gone", () => {
    it("names the build it was drawn on, and the one it opened with", () => {
      resolved = "Beyond All Reason test-9";
      try {
        const html = markup();
        expect(html).toContain("Beyond All Reason test-1");
        expect(html).toContain(
          "You have Beyond All Reason test-9, which is the same game at another version",
        );
      } finally {
        resolved = RECORD.layout.game?.name;
      }
    });

    it("says nothing when the build it names is the one that is here", () => {
      expect(markup()).not.toContain("same game at another version");
    });
  });

  it("offers no name field of its own, so a rename is an editor edit", () => {
    expect(markup()).not.toContain("<input");
  });

  /** The way to a variant of a layout, rather than drawing it again (issue
   *  #1452). */
  it("offers a copy of the layout", () => {
    expect(markup()).toContain("Duplicate");
  });

  /**
   * Issue #1457. The check against real terrain is offered here, because this
   * is where a layout that came from somewhere else is opened.
   *
   * Offered rather than run. A blueprint is not made for one map and reading a
   * map is the slowest thing in coilbox, so a page nobody asks reads none: the
   * surface is not mounted until the button is pressed (issue #1416).
   */
  it("offers a check against a real map, and does not run one", () => {
    const html = markup();
    expect(html).toContain("Try it on a map");
    expect(html).not.toContain("the map check");
  });

  /**
   * Issue #1514. A layout saved out of a scenario recorded which scenario and
   * then did nothing with it, so the one thing the record was for, getting back
   * to the mission it was drawn in, was the one thing it could not do.
   */
  describe("a layout saved out of a scenario", () => {
    const source: BlueprintSource = {
      kind: "scenario",
      scenario: "s1",
      scenarioName: "Tutorial",
      at: "2026-08-02T00:00:00.000Z",
    };

    it("says which scenario, and opens it", () => {
      const html = markupFrom(source);
      expect(html).toContain("Tutorial");
      expect(html).toContain('href="/scenarios?scenario=s1"');
    });

    /** The player-facing list rather than the builder, which is advanced-gated
     *  and redirects home. Its own answer to a scenario that is gone is the
     *  wording a deleted one gets. */
    it("does not send anybody to the builder", () => {
      expect(markupFrom(source)).not.toContain("/scenario-builder");
    });

    it("offers nothing to open for a layout drawn here", () => {
      expect(markup()).not.toContain("/scenarios?scenario=");
    });
  });
});
