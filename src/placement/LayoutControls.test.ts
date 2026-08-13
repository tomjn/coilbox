/**
 * What a layout's notes say about the ground under it (issue #1315).
 *
 * The point of the check is the sentence an author reads, so the sentence is
 * what is tested. The dangerous case is the one that says nothing: a layout on
 * a map coilbox cannot read the terrain of must not read as a layout that is
 * fine, and it must not read as one that is broken either.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LayoutNotes } from "./LayoutControls";

type Notes = Parameters<typeof LayoutNotes>[0];

function markup(props: Partial<Notes> = {}): string {
  return renderToStaticMarkup(
    createElement(LayoutNotes, { overlaps: [], strays: [], ...props }),
  );
}

describe("LayoutNotes", () => {
  it("says nothing about a layout with nothing wrong with it", () => {
    expect(markup()).toBe("");
  });

  it("names the buildings the ground will not take", () => {
    const html = markup({ unstable: [0, 3] });
    expect(html).toContain("Buildings 1, 4");
    expect(html).toContain("too steep");
    expect(html).toContain("amber");
  });

  it("counts one building as one", () => {
    const html = markup({ unstable: [1] });
    expect(html).toContain("Building 2 stands on ground too steep for it");
  });

  /** No map, no dataset, or a heightmap too coarse to read. All of them arrive
   *  here as an empty list, and none of them may claim the layout is fine. */
  it("says nothing when nothing checked the ground", () => {
    expect(markup({ unstable: [] })).toBe("");
    expect(markup()).toBe("");
  });

  it("keeps the slope and the overlap apart", () => {
    const html = markup({ overlaps: [0], unstable: [1] });
    expect(html).toContain(
      "Building 1 stands on ground another building wants",
    );
    expect(html).toContain("Building 2 stands on ground too steep for it");
  });

  it("says which map a layout was drawn for when it is on another", () => {
    const html = markup({
      designedFor: "Comet Catcher",
      onMap: "Supreme Isthmus",
    });
    expect(html).toContain("Drawn for Comet Catcher");
  });

  it("says nothing about the map it was drawn for when it is on it", () => {
    expect(
      markup({ designedFor: "Comet Catcher", onMap: "Comet Catcher" }),
    ).toBe("");
  });

  it("says nothing when there is no map to compare with", () => {
    expect(markup({ designedFor: "Comet Catcher" })).toBe("");
    expect(markup({ onMap: "Comet Catcher" })).toBe("");
  });
});
