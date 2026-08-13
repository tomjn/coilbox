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

  /**
   * Issue #1445. A base with one Legion solar in it drew exactly like a base
   * without one, because the import knew and the layout did not carry it.
   */
  describe("units the game has not got", () => {
    it("names the buildings and the units they name", () => {
      const html = markup({
        absent: [
          { index: 1, def: "legsolar" },
          { index: 4, def: "legwin" },
        ],
        buildings: 6,
      });
      expect(html).toContain("Buildings 2, 5");
      expect(html).toContain("legsolar");
      expect(html).toContain("legwin");
      expect(html).toContain("violet");
    });

    it("counts one building as one", () => {
      const html = markup({
        absent: [{ index: 0, def: "legsolar" }],
        buildings: 4,
      });
      expect(html).toContain("Building 1 is");
      expect(html).toContain("legsolar");
    });

    /** A layout the game has none of the units of is another game's, and that
     *  is a different thing from a layout with one unit missing. */
    it("says when the whole layout belongs to another game", () => {
      const html = markup({
        absent: [
          { index: 0, def: "legsolar" },
          { index: 1, def: "legwin" },
        ],
        buildings: 2,
      });
      expect(html).toContain("none of");
      expect(html).not.toContain("Buildings 1, 2");
    });

    it("says nothing before the game's units have been read", () => {
      expect(markup({ absent: [], buildings: 4 })).toBe("");
      expect(markup({ buildings: 4 })).toBe("");
    });
  });

  /**
   * Issue #1491. The dangerous silence: a check that ran and approved and a
   * check that never ran said the same nothing, which is how #1483 survived for
   * months.
   */
  describe("no verdict", () => {
    const none = { noGround: [], noUnits: [], noSlope: [] };

    it("says nothing while every building has been judged", () => {
      expect(markup({ unjudged: none })).toBe("");
    });

    it("says the map's heights would not read", () => {
      const html = markup({ unjudged: { ...none, noGround: [0, 1] } });
      expect(html).toContain("This map&#x27;s heights could not be read");
      expect(html).toContain("dashed");
    });

    it("says the game's units have not been read", () => {
      const html = markup({ unjudged: { ...none, noUnits: [0, 1] } });
      expect(html).toContain("has not read this game&#x27;s units");
      expect(html).toContain("dashed");
    });

    it("names the buildings the game's data gives no slope", () => {
      const html = markup({ unjudged: { ...none, noSlope: [0, 3] } });
      expect(html).toContain("Buildings 1, 4");
      expect(html).toContain("no slope");
    });

    /** Not a warning. An unknown is not a failure and must not be dressed as
     *  one, so none of these take the amber a refusal takes. */
    it("does not dress an unknown as a refusal", () => {
      const html = markup({ unjudged: { ...none, noGround: [0] } });
      expect(html).not.toContain("amber");
      expect(html).not.toContain("red");
    });

    /** A session that has only just opened knows nothing for a moment. Handed
     *  no groups at all, it says nothing rather than a wall of warnings that
     *  clears itself. */
    it("says nothing at all when the reads have not settled", () => {
      expect(markup()).toBe("");
    });
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
