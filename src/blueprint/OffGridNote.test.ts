/**
 * What an author is told about a layout the build grid disagrees with (issue
 * #1427).
 *
 * The sentence is the whole feature, so the sentence is what is tested. The
 * case that matters most is the quiet one: a layout nothing disagrees with must
 * say nothing at all, or the note becomes something every author learns to
 * ignore.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OffGridNote } from "./OffGridNote";
import type { OffGridBuilding } from "./offGrid";

const off = (index: number, def = "armsolar"): OffGridBuilding => ({
  index,
  def,
  from: { x: 5, z: 0 },
  to: { x: 0, z: 0 },
});

function markup(offGrid: OffGridBuilding[]): string {
  return renderToStaticMarkup(
    createElement(OffGridNote, { offGrid, onSnap: () => {} }),
  );
}

describe("OffGridNote", () => {
  it("says nothing about a layout the grid agrees with", () => {
    expect(markup([])).toBe("");
  });

  it("names the buildings whose stored position the grid disagrees with", () => {
    const html = markup([off(1), off(4)]);
    expect(html).toContain("Buildings 2, 5");
    expect(html).toContain("build grid");
  });

  it("counts one building as one", () => {
    expect(markup([off(1)])).toContain("Building 2");
  });

  /** The point of the note is that the file has not been touched. An author who
   *  reads a position out of it is reading what is still in it. */
  it("says the layout has not been changed", () => {
    expect(markup([off(0)])).toContain("Nothing has been changed");
  });

  it("offers to put the layout on the grid", () => {
    expect(markup([off(0)])).toContain("Put the blueprint on the build grid");
  });
});
