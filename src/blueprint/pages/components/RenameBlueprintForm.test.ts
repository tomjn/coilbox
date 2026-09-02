/**
 * Renaming a layout from the library (issue #1476).
 *
 * The arithmetic is small and the field is one box, so what is worth pinning
 * down is what a rename does to the record: everything else about it survives,
 * and a name that says nothing is not a rename at all.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { StoredBlueprint } from "../../library";
import { RenameBlueprintForm, renamedRecord } from "./RenameBlueprintForm";

const RECORD: StoredBlueprint = {
  id: "b1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  layout: {
    game: { name: "Beyond All Reason test-1", shortname: "BAR" },
    name: "Opening solars",
    buildings: [{ def: "armsolar", offset: { x: 0, z: 0 }, facing: 0 }],
    footprints: { armsolar: { x: 4, z: 4 } },
  },
  source: {
    kind: "pack",
    file: "/packs/openings.json",
    at: "2026-07-01T00:00:00.000Z",
  },
};

describe("renamedRecord", () => {
  it("changes the name and nothing else", () => {
    const next = renamedRecord(RECORD, "Opening wind");
    expect(next?.layout.name).toBe("Opening wind");
    expect(next?.id).toBe("b1");
    expect(next?.layout.buildings).toEqual(RECORD.layout.buildings);
    expect(next?.layout.footprints).toEqual(RECORD.layout.footprints);
    expect(next?.layout.game).toEqual(RECORD.layout.game);
    expect(next?.source).toEqual(RECORD.source);
  });

  it("takes the spaces off a name", () => {
    expect(renamedRecord(RECORD, "  Opening wind  ")?.layout.name).toBe(
      "Opening wind",
    );
  });

  /** A layout with no name is a card nobody can pick out, and an empty box is
   *  more often a slip than a wish. */
  it("refuses a name that says nothing", () => {
    expect(renamedRecord(RECORD, "   ")).toBeNull();
  });

  it("has nothing to write when the name is the one it had", () => {
    expect(renamedRecord(RECORD, "Opening solars")).toBeNull();
  });
});

describe("RenameBlueprintForm", () => {
  it("opens on the name the layout has, in a labelled box", () => {
    const html = renderToStaticMarkup(
      createElement(RenameBlueprintForm, { record: RECORD, onDone: () => {} }),
    );
    expect(html).toContain('value="Opening solars"');
    expect(html).toContain("Blueprint name");
    expect(html).toMatch(/for="[^"]+"/);
  });
});
