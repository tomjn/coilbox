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

import {
  LayoutNotes,
  layoutTriggerLabel,
  UncheckedNote,
} from "./LayoutControls";

type Notes = Parameters<typeof LayoutNotes>[0];

function markup(props: Partial<Notes> = {}): string {
  return renderToStaticMarkup(
    createElement(LayoutNotes, { overlaps: [], strays: [], ...props }),
  );
}

type Unchecked = Parameters<typeof UncheckedNote>[0];

function surface(props: Partial<Unchecked> = {}): string {
  return renderToStaticMarkup(
    createElement(UncheckedNote, { unchecked: null, ...props }),
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

  /** Issue #1459. The depth refusal is fixed its own way, so it is said its own
   *  way rather than folded into the slope sentence. */
  it("names the buildings the water is too deep for", () => {
    const html = markup({ tooDeep: [0, 3] });
    expect(html).toContain("Buildings 1, 4");
    expect(html).toContain("water too deep");
    expect(html).toContain("cyan");
  });

  /**
   * Issue #1552. Both ends of the engine's band are cyan, because both are the
   * water refusing the building, and one colour is one thing to learn. Which way
   * the building has to move is the sentence's job, and it is the half an author
   * acts on.
   */
  it("says the two ends of the band in opposite words", () => {
    const deep = markup({ tooDeep: [0] });
    const shallow = markup({ tooShallow: [0] });
    expect(deep).toContain("shallower");
    expect(shallow).toContain("deeper");
    expect(shallow).not.toContain("shallower");
    expect(shallow).toContain("cyan");
  });

  it("says both at once when a layout straddles a coast", () => {
    const html = markup({ tooDeep: [0], tooShallow: [1] });
    expect(html).toContain("Building 1 stands in water too deep for it");
    expect(html).toContain("Building 2 is not in deep enough water");
  });

  it("keeps the depth and the slope apart", () => {
    const html = markup({ unstable: [0], tooShallow: [1] });
    expect(html).toContain("Building 1 stands on ground too steep for it");
    expect(html).toContain("Building 2 is not in deep enough water");
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
    it("says nothing while every building has been judged", () => {
      expect(markup({ noSlope: [] })).toBe("");
    });

    it("names the buildings the game's data gives no slope", () => {
      const html = markup({ noSlope: [0, 3] });
      expect(html).toContain("Buildings 1, 4");
      expect(html).toContain("no slope");
    });

    /** Not a warning. An unknown is not a failure and must not be dressed as
     *  one, so none of these take the amber a refusal takes. */
    it("does not dress an unknown as a refusal", () => {
      const html = markup({ noSlope: [0] });
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

  /**
   * Issue #1479. The same layout, in the library or in the standalone editor,
   * used to say nothing about a position the engine will move. It is one
   * sentence about the layout, so it is said wherever the layout is drawn.
   */
  describe("off the build grid", () => {
    const off = [
      { index: 1, def: "armsolar", from: { x: 5, z: 5 }, to: { x: 8, z: 8 } },
    ];

    it("says which building the grid disagrees with", () => {
      const html = markup({ offGrid: off, onSnapToGrid: () => {} });
      expect(html).toContain("do not agree with the build grid");
      expect(html).toContain("Building 2");
      expect(html).toContain("Put the blueprint on the build grid");
    });

    it("says nothing when the grid agrees", () => {
      expect(markup({ offGrid: [], onSnapToGrid: () => {} })).toBe("");
    });

    /** Nothing has read the game's units, so nothing knows what any of these
     *  stand on and the caller hands over no list at all. */
    it("says nothing when nobody asked the question", () => {
      expect(markup({ onSnapToGrid: () => {} })).toBe("");
    });
  });
});

/**
 * Issue #1484. The one route to a layout's name while it is open is a popover,
 * and the button that opens it counted the buildings. Nobody clicks a count to
 * rename something, and the count is already said in the corner of the surface
 * and on the library card.
 */
describe("layoutTriggerLabel", () => {
  it("says what the layout is called", () => {
    expect(layoutTriggerLabel("Opening solars", 7)).toBe("Opening solars");
  });

  /** A blank button says nothing about what it opens, so a layout with no name
   *  keeps the count the button had before. */
  it("counts the buildings when the layout has no name", () => {
    expect(layoutTriggerLabel("", 7)).toBe("7 buildings");
    expect(layoutTriggerLabel("   ", 1)).toBe("1 building");
  });
});

/**
 * Issue #1496, and the drawing half of #1497.
 *
 * The case the dashed squares cannot cover: a surface where nothing at all has
 * a verdict, so there is no clean square beside a dashed one to read the
 * difference from.
 */
describe("UncheckedNote", () => {
  it("says nothing while the check is running normally", () => {
    expect(surface()).toBe("");
  });

  it("says the game's units have not been read", () => {
    const html = surface({ unchecked: "no-units" });
    expect(html).toContain("has not read this game&#x27;s units");
    expect(html).toContain("Nothing here has been checked");
  });

  it("says the map's heights would not read", () => {
    const html = surface({ unchecked: "no-ground" });
    expect(html).toContain("Nothing here has been checked");
  });

  /** The models are standing somewhere they will not stand, which no dashed
   *  square says and no popover said (issue #1497). */
  it("says the models are standing on the flat", () => {
    const html = surface({ unchecked: "no-ground", flattened: true });
    expect(html).toContain("heights could not be read");
    expect(html).toContain("flat ground");
  });

  /** A map with nothing on it to check is still a map drawing its units at the
   *  wrong height. */
  it("says so even where there is nothing to check", () => {
    const html = surface({ unchecked: null, flattened: true });
    expect(html).toContain("flat ground");
  });

  /** An unknown is not a refusal, so this takes the slate the dashed squares
   *  take rather than the amber a refusal takes. */
  it("does not dress an unknown as a refusal", () => {
    const html = surface({ unchecked: "no-ground", flattened: true });
    expect(html).not.toContain("amber");
    expect(html).not.toContain("red");
  });
});
