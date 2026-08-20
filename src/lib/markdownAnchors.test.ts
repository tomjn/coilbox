/**
 * The ids a heading gets, which is what a `#` link on a distribution page points
 * at (issue #1805). The click that uses them is driven through a real render in
 * `../profile/customPageLinks.dom.test.tsx`.
 */

import { describe, expect, it } from "vitest";
import { headingSlug, remarkHeadingIds } from "./markdownAnchors";

/** As much of an mdast tree as these cases build by hand. */
interface Probe {
  type: string;
  value?: string;
  children?: Probe[];
  data?: { hProperties?: { id?: string } };
}

/** Run the plugin over a tree of headings and report the id each one got. */
function idsFor(...headings: string[][]): (string | undefined)[] {
  const tree: Probe = {
    type: "root",
    children: headings.map((parts) => ({
      type: "heading",
      children: parts.map((value) => ({ type: "text", value })),
    })),
  };
  remarkHeadingIds()(tree);
  return (tree.children ?? []).map((h) => h.data?.hProperties?.id);
}

describe("the id a heading gets", () => {
  it("is the text, lowercased, with the spaces as dashes", () => {
    // What an author writing `[Installing](#installing-the-game)` expects, and
    // what GitHub would have given the same heading in a README.
    expect(headingSlug("Installing The Game")).toBe("installing-the-game");
  });

  it("drops punctuation and emoji but keeps letters from any alphabet", () => {
    expect(headingSlug("What's new?")).toBe("whats-new");
    expect(headingSlug("Neue Änderungen")).toBe("neue-änderungen");
    expect(headingSlug("Read_me first")).toBe("read_me-first");
  });

  it("numbers a repeated heading, so a link still lands on one of them", () => {
    expect(idsFor(["Setup"], ["Other"], ["Setup"], ["Setup"])).toEqual([
      "setup",
      "other",
      "setup-1",
      "setup-2",
    ]);
  });

  it("leaves a heading of nothing but punctuation without an id", () => {
    // There is no slug to give it, and an empty `id` is not something a link can
    // point at anyway.
    expect(idsFor(["***"])).toEqual([undefined]);
  });

  it("reads the whole heading, formatting and all", () => {
    // A heading is a run of inline nodes rather than one string, so `## The
    // `spring` binary` arrives in three pieces.
    expect(idsFor(["The ", "spring", " binary"])).toEqual([
      "the-spring-binary",
    ]);
  });
});
