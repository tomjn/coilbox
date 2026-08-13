/**
 * The library grid: what a card offers without being opened (issue #1477).
 *
 * A card used to be one link and nothing else, so copying a layout meant opening
 * it, pressing Duplicate, and landing on the copy. The menu is the way to do
 * something to a layout you can see rather than to the one you have open.
 *
 * The card stays a link. A button inside an anchor is not a card with a button
 * on it, it is a broken link, so the menu sits beside the link and the link
 * covers the card behind it.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
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

// Drawers live on the app frame, which is not mounted here.
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({ open: () => {}, close: () => {}, isOpen: false }),
}));
vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => ({ data: { games: [] }, loading: false }),
}));
vi.mock("@/play/config", () => ({ usePreferredTarget: () => ({}) }));
vi.mock("@/deeplink/useImportParam", () => ({ useImportParam: () => ({}) }));
vi.mock("@/hub/imports", () => ({ useRecordHubImport: () => () => {} }));
vi.mock("../store", () => ({
  blueprintRoute: (id: string) => `/content/blueprints/${id}`,
  saveBlueprint: async (record: StoredBlueprint) => record,
  useBlueprintLibrary: () => ({
    records: [RECORD],
    loading: false,
    error: null,
  }),
}));

const { default: BlueprintsPage } = await import("./BlueprintsPage");

function markup(): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(BlueprintsPage)),
  );
}

/** The card's link, from its opening tag to its close. */
function cardLink(html: string): string {
  const at = html.indexOf("<a ");
  expect(at).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf("</a>", at));
}

describe("BlueprintsPage", () => {
  it("names each layout on a card", () => {
    const html = markup();
    expect(html).toContain("Opening solars");
    expect(html).toContain("2 buildings");
  });

  /** The way to a copy without opening the layout first (issue #1477). */
  it("gives each card a menu, named for the layout it acts on", () => {
    expect(markup()).toContain('aria-label="Actions for Opening solars"');
  });

  it("keeps the menu out of the link, so the card still opens the layout", () => {
    const link = cardLink(markup());
    expect(link).toContain('href="/content/blueprints/b1"');
    expect(link).not.toContain("<button");
  });
});
